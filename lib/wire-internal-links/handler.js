import { Octokit } from '@octokit/rest'
import { requireAuth } from '../seo-advisor/auth.js'
import {
  applyInternalLinksToMarkdown,
  parseArticleMarkdown,
  planDeltas,
} from './plan.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const ARTICLE_CONTENT_DIR = 'site/src/content/articles'
const MERGE_VIA_API = true
const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+$/
const TOKEN_KEY_RE = /^[A-Z][A-Z0-9_]*$/

function githubErrorMessage(err) {
  const fromResponse = err?.response?.data?.message
  if (fromResponse) return String(fromResponse)
  if (err?.message) return String(err.message)
  return String(err)
}

function linksBranchName(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  return `links/${y}-${m}-${d}-${hh}${mm}`
}

function readDestination(body) {
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

async function loadLiveArticles(octokit, dest) {
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

function buildUpdates(articles) {
  const { published, proposed, skipped } = planDeltas(articles)
  const bySlug = new Map(articles.map((a) => [a.slug, a]))
  const files = []
  const toShow = []
  for (const item of proposed) {
    const article = bySlug.get(item.slug)
    if (!article) continue
    const applied = applyInternalLinksToMarkdown(article.raw, item.next)
    if (!applied.changed) {
      skipped.push({
        slug: item.slug,
        title: item.title,
        reason: 'unchanged',
      })
      continue
    }
    files.push({
      slug: item.slug,
      path: article.path,
      content: applied.content,
      added: item.added,
    })
    toShow.push({
      slug: item.slug,
      title: item.title,
      added: item.added,
    })
  }
  return {
    publishedCount: published.length,
    corpusCount: articles.length,
    proposed: toShow,
    skipped,
    files,
  }
}

async function commitFiles(octokit, dest, files) {
  const { owner, repo, targetBranch } = dest
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

  const branchName = linksBranchName()
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
    message: 'Wire internal links',
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

export async function handleWireInternalLinks(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, {
      error: err.message || 'Unauthorized',
    })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const dest = readDestination(body)
  if (dest.error) {
    return json(res, dest.status, { error: dest.error })
  }

  const step = String(body.step || '').trim().toLowerCase()
  if (step !== 'propose' && step !== 'commit') {
    return json(res, 400, { error: 'step must be "propose" or "commit"' })
  }

  const octokit = new Octokit({ auth: dest.token })
  let branchName = null

  try {
    const articles = await loadLiveArticles(octokit, dest)
    const plan = buildUpdates(articles)

    if (step === 'propose') {
      return json(res, 200, {
        ok: true,
        step: 'propose',
        corpusCount: plan.corpusCount,
        publishedCount: plan.publishedCount,
        proposed: plan.proposed,
        skipped: plan.skipped,
      })
    }

    if (plan.files.length === 0) {
      return json(res, 200, {
        ok: false,
        step: 'commit',
        branch: null,
        mergeCommitSha: null,
        committed: [],
        skipped: plan.skipped,
        errors: [{ message: 'No internal-link updates to commit.' }],
      })
    }

    const committed = await commitFiles(octokit, dest, plan.files)
    branchName = committed.branchName

    if (!MERGE_VIA_API) {
      const { data: pr } = await octokit.pulls.create({
        owner: dest.owner,
        repo: dest.repo,
        title: `Wire internal links (${branchName})`,
        head: branchName,
        base: dest.targetBranch,
        body: `Updates internal links on ${plan.files.length} article(s).`,
      })
      return json(res, 200, {
        ok: true,
        step: 'commit',
        branch: branchName,
        mergeCommitSha: null,
        mergeStrategy: 'open-pr',
        pullRequestUrl: pr.html_url || null,
        committed: plan.files.map((file) => ({
          path: file.path,
          slug: file.slug,
        })),
        skipped: plan.skipped,
        errors: [],
      })
    }

    const { data: merge } = await octokit.repos.merge({
      owner: dest.owner,
      repo: dest.repo,
      base: dest.targetBranch,
      head: branchName,
      commit_message: `Merge ${branchName}`,
    })

    return json(res, 200, {
      ok: true,
      step: 'commit',
      branch: branchName,
      mergeCommitSha: merge?.sha || committed.newCommit.sha,
      mergeStrategy: 'merge',
      committed: plan.files.map((file) => ({
        path: file.path,
        slug: file.slug,
      })),
      skipped: plan.skipped,
      errors: [],
    })
  } catch (err) {
    console.error('wire-internal-links error:', err)
    return json(res, err.statusCode || 502, {
      ok: false,
      branch: branchName,
      error: githubErrorMessage(err),
    })
  }
}
