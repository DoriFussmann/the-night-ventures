import { Octokit } from '@octokit/rest'
import { parseArticleMarkdown } from './plan.js'
import { demoteArticleMarkdownH1 } from '../demoteBodyH1.js'
import { OWNER_REPO_RE, resolveGithubToken } from '../publish-destination/tokenKey.js'

export const ARTICLE_CONTENT_DIR = 'site/src/content/articles'
/**
 * Changes to existing live articles (link wiring, cleanups, rewrites, Where
 * Things Stand updates, link fixes) never merge straight to the live branch:
 * they open a pull request for review. Brand-new article files are published by
 * publish-to-site, which still merges them (see mergeOrOpenPr there).
 */
export const MERGE_VIA_API = false


export function githubErrorMessage(err) {
  const fromResponse = err?.response?.data?.message
  if (fromResponse) return String(fromResponse)
  if (err?.message) return String(err.message)
  return String(err)
}

export function linksBranchName(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  return `links/${y}-${m}-${d}-${hh}${mm}`
}

export function readDestination(body) {
  const owner = String(body.owner || '').trim()
  const repo = String(body.repo || '').trim()
  const tokenKey = String(body.tokenKey || body.github_token_key || '')
    .trim()
    .toUpperCase()
  const targetBranch = String(body.branch || 'main').trim() || 'main'

  if (!owner || !repo) {
    return { error: 'owner and repo are required', status: 400 }
  }
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return { error: 'owner or repo is invalid', status: 400 }
  }

  const { token, envName } = resolveGithubToken(tokenKey)
  if (!token) {
    console.error(`Missing ${envName}`)
    return { error: `${envName} is not set`, status: 500 }
  }

  return { owner, repo, tokenKey, targetBranch, token }
}

export function createOctokit(dest) {
  return new Octokit({ auth: dest.token })
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) || 0 },
    async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx], idx)
      }
    }
  )
  await Promise.all(workers)
  return out
}

async function listArticleFiles(octokit, { owner, repo, ref }) {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path: ARTICLE_CONTENT_DIR,
    ref,
  })
  if (!Array.isArray(data)) {
    const err = new Error(`${ARTICLE_CONTENT_DIR} is not a directory`)
    err.statusCode = 400
    throw err
  }
  return data.filter(
    (item) => item?.type === 'file' && /\.md$/i.test(String(item.name || ''))
  )
}

export async function loadLiveArticles(octokit, dest) {
  const files = await listArticleFiles(octokit, {
    owner: dest.owner,
    repo: dest.repo,
    ref: dest.targetBranch,
  })
  const fetched = await mapPool(files, 8, async (file) => {
    const { data } = await octokit.repos.getContent({
      owner: dest.owner,
      repo: dest.repo,
      path: file.path,
      ref: dest.targetBranch,
    })
    const encoded = String(data.content || '').replace(/\n/g, '')
    const raw = Buffer.from(encoded, 'base64').toString('utf8')
    const parsed = parseArticleMarkdown(raw, file.name)
    return {
      ...parsed,
      path: file.path,
      sha: data.sha,
    }
  })
  return fetched.filter((article) => article.ok && article.slug)
}

export async function commitFiles(octokit, dest, files, options = {}) {
  const { owner, repo, targetBranch } = dest
  const message = String(options.message || 'Wire internal links')
  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${targetBranch}`,
  })
  const baseSha = baseRef.object.sha
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  })

  const branchName = String(options.branchName || '').trim() || linksBranchName()
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  })

  const treeItems = []
  for (const file of files) {
    // Every article write goes through the same H1 guard as publish, so link
    // wiring / link checks / rewrites / cleanup can't ship a body H1 either.
    const isArticle =
      String(file.path || '').startsWith(`${ARTICLE_CONTENT_DIR}/`) &&
      /\.md$/i.test(String(file.path || ''))
    const content = isArticle ? demoteArticleMarkdownH1(file.content) : file.content
    const { data: blob } = await octokit.git.createBlob({
      owner,
      repo,
      content,
      encoding: 'utf-8',
    })
    treeItems.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    })
  }

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  })
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [baseSha],
  })
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: newCommit.sha,
  })

  return { branchName, newCommit }
}

export async function mergeBranch(octokit, dest, branchName, commitMessage) {
  const { data: merge } = await octokit.repos.merge({
    owner: dest.owner,
    repo: dest.repo,
    base: dest.targetBranch,
    head: branchName,
    commit_message: commitMessage || `Merge ${branchName}`,
  })
  try {
    await octokit.git.deleteRef({
      owner: dest.owner,
      repo: dest.repo,
      ref: `heads/${branchName}`,
    })
  } catch {
    // best-effort cleanup; ignore
  }
  return merge
}

/**
 * Close open pull requests from earlier branches with the same prefix (e.g.
 * "links/"). A newer link-wiring run is computed from the live branch and so
 * supersedes older unmerged ones; closing them avoids piles of conflicting PRs.
 */
export async function closeSupersededPullRequests(octokit, dest, branchName) {
  const prefix = String(branchName).split('/')[0]
  if (!prefix || prefix === branchName) return 0
  const { data: open } = await octokit.pulls.list({
    owner: dest.owner,
    repo: dest.repo,
    state: 'open',
    base: dest.targetBranch,
    per_page: 100,
  })
  let closed = 0
  for (const pr of open || []) {
    const ref = pr?.head?.ref || ''
    if (!ref.startsWith(`${prefix}/`) || ref === branchName) continue
    try {
      await octokit.issues.createComment({
        owner: dest.owner,
        repo: dest.repo,
        issue_number: pr.number,
        body: `Superseded by ${branchName}.`,
      })
      await octokit.pulls.update({ owner: dest.owner, repo: dest.repo, pull_number: pr.number, state: 'closed' })
      closed += 1
    } catch (err) {
      console.error('closeSupersededPullRequests failed:', githubErrorMessage(err))
    }
  }
  return closed
}

/** Open a pull request for a branch. Returns its URL. */
export async function openPullRequest(octokit, dest, branchName, { title, body } = {}) {
  const { data: pr } = await octokit.pulls.create({
    owner: dest.owner,
    repo: dest.repo,
    title: title || `Review ${branchName}`,
    head: branchName,
    base: dest.targetBranch,
    body: body || '',
  })
  return pr?.html_url || null
}
