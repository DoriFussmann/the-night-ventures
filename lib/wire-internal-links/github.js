import { Octokit } from '@octokit/rest'
import { parseArticleMarkdown } from './plan.js'

export const ARTICLE_CONTENT_DIR = 'site/src/content/articles'
export const MERGE_VIA_API = true

const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+$/
const TOKEN_KEY_RE = /^[A-Z][A-Z0-9_]*$/

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

  if (!owner || !repo || !tokenKey) {
    return { error: 'owner, repo, and tokenKey are required', status: 400 }
  }
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return { error: 'owner or repo is invalid', status: 400 }
  }
  if (!TOKEN_KEY_RE.test(tokenKey)) {
    return {
      error: 'tokenKey is invalid (use A–Z, 0–9, underscore; e.g. HEYRUPERT)',
      status: 400,
    }
  }

  const token = process.env[`GITHUB_TOKEN_${tokenKey}`]
  if (!token) {
    console.error(`Missing GITHUB_TOKEN_${tokenKey}`)
    return { error: `GITHUB_TOKEN_${tokenKey} is not set`, status: 500 }
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
    const { data: blob } = await octokit.git.createBlob({
      owner,
      repo,
      content: file.content,
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
  return merge
}
