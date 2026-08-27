import { requireAuth } from '../seo-advisor/auth.js'
import {
  MERGE_VIA_API,
  commitFiles,
  createOctokit,
  githubErrorMessage,
  loadLiveArticles,
  mergeBranch,
  readDestination,
} from './github.js'
import { applyInternalLinksToMarkdown, planDeltas } from './plan.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
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

  const octokit = createOctokit(dest)
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

    const merge = await mergeBranch(octokit, dest, branchName)

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
