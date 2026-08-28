import { requireAuth } from '../seo-advisor/auth.js'
import { publishedArticles, todayIso } from '../wire-internal-links/plan.js'
import {
  MERGE_VIA_API,
  commitFiles,
  createOctokit,
  githubErrorMessage,
  loadLiveArticles,
  mergeBranch,
  readDestination,
} from '../wire-internal-links/github.js'
import {
  bucketNeedsUpdateCheck,
  daysSinceUpdate,
  summarizeBuckets,
  stalenessBucket,
} from './staleness.js'
import { bumpUpdatedDate, replaceWtsSection } from './wts.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function updatesBranchName(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  return `updates/${y}-${m}-${d}-${hh}${mm}`
}

function titleOf(article) {
  return String(article?.data?.title || article?.slug || '')
}

function asApprovedUpdates(body) {
  const raw = Array.isArray(body.updates)
    ? body.updates
    : Array.isArray(body.articles)
      ? body.articles
      : []
  const seen = new Set()
  const updates = []
  for (const item of raw) {
    const slug = String(item?.slug || '').trim()
    const newParagraph = String(
      item?.newParagraph || item?.proposedParagraph || ''
    ).trim()
    if (!slug || !newParagraph || seen.has(slug)) continue
    seen.add(slug)
    updates.push({ slug, newParagraph })
  }
  return updates
}

function libraryBySlug(rows) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const slug = String(row?.slug || '').trim()
    if (!slug) continue
    map.set(slug, row)
  }
  return map
}

function presentArticle(article, libraryRow, now) {
  const date = String(article?.data?.date || '').trim()
  const updatedDate = String(article?.data?.updatedDate || '').trim()
  const daysSince = daysSinceUpdate(updatedDate || date, now)
  const bucket = stalenessBucket(daysSince)
  const publishedUrl = String(libraryRow?.published_url || '').trim()
  const targetKeyword = String(
    article?.data?.targetKeyword || libraryRow?.target_keyword || ''
  ).trim()
  const pillarKeyword = String(
    article?.data?.pillarKeyword || libraryRow?.pillar_keyword || ''
  ).trim()
  return {
    slug: article.slug,
    title: titleOf(article),
    path: article.path,
    date,
    updatedDate: updatedDate || date,
    daysSince,
    bucket,
    needsUpdateCheck: bucketNeedsUpdateCheck(bucket),
    targetKeyword,
    pillarKeyword,
    publishedUrl,
    canCheck: Boolean(publishedUrl && targetKeyword && pillarKeyword),
    draft: article?.data?.draft === true,
  }
}

async function loadLibraryRows(supabase, companyId) {
  if (!supabase || !companyId) return []
  const { data, error } = await supabase
    .from('generated_articles')
    .select(
      'id, slug, published_url, target_keyword, pillar_keyword, updated_date, date'
    )
    .eq('company_id', companyId)
  if (error) throw error
  return data || []
}

async function persistLastChecked(supabase, companyId, checkedAt) {
  if (!supabase || !companyId) return { ok: false }
  const { error } = await supabase
    .from('companies')
    .update({ articles_update_checked_at: checkedAt })
    .eq('id', companyId)
  if (error) {
    if (
      /articles_update_checked_at/i.test(error.message || '') ||
      error.code === 'PGRST204'
    ) {
      return { ok: false, missingColumn: true }
    }
    throw error
  }
  return { ok: true }
}

async function syncLibraryDates(supabase, companyId, slugs, isoDate) {
  if (!supabase || !companyId || !slugs.length) return
  const now = new Date().toISOString()
  const payload = {
    updated_date: isoDate,
    last_synced_at: now,
    updated_at: now,
  }
  const { error } = await supabase
    .from('generated_articles')
    .update(payload)
    .eq('company_id', companyId)
    .in('slug', slugs)

  if (
    error &&
    (/last_synced_at/i.test(error.message || '') || error.code === 'PGRST204')
  ) {
    const { last_synced_at: _ignored, ...fallback } = payload
    const retry = await supabase
      .from('generated_articles')
      .update(fallback)
      .eq('company_id', companyId)
      .in('slug', slugs)
    if (retry.error) {
      console.error('article-updates library date sync failed:', retry.error)
    }
    return
  }

  if (error) {
    console.error('article-updates library date sync failed:', error)
  }
}

function buildCommitPlan(articles, approved) {
  const bySlug = new Map(articles.map((article) => [article.slug, article]))
  const files = []
  const skipped = []
  const errors = []
  const isoDate = todayIso()

  for (const update of approved) {
    const article = bySlug.get(update.slug)
    if (!article) {
      skipped.push({
        slug: update.slug,
        reason: 'not_found',
        message: 'Slug not found in the live destination repo',
      })
      continue
    }
    if (article.data?.draft === true) {
      skipped.push({
        slug: update.slug,
        reason: 'draft',
        message: 'Draft articles are not updated',
      })
      continue
    }

    const replaced = replaceWtsSection(article.raw, update.newParagraph)
    if (!replaced.ok) {
      errors.push({ slug: update.slug, message: replaced.error })
      continue
    }

    const content = bumpUpdatedDate(replaced.content, isoDate)
    if (content === article.raw) {
      skipped.push({
        slug: update.slug,
        reason: 'unchanged',
        message: 'Live markdown already matches the proposed update',
      })
      continue
    }

    files.push({
      slug: update.slug,
      path: article.path,
      content,
      title: titleOf(article),
    })
  }

  return { files, skipped, errors, isoDate }
}

export async function handleArticleUpdates(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  let auth
  try {
    auth = await requireAuth(req)
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
  if (!['audit', 'commit'].includes(step)) {
    return json(res, 400, { error: 'step must be "audit" or "commit"' })
  }

  const companyId = String(body.companyId || '').trim()
  const octokit = createOctokit(dest)
  let branchName = null

  try {
    const [liveArticles, libraryRows] = await Promise.all([
      loadLiveArticles(octokit, dest),
      loadLibraryRows(auth.supabase, companyId),
    ])
    const library = libraryBySlug(libraryRows)
    const published = publishedArticles(liveArticles)
    const now = new Date()
    const articles = published.map((article) =>
      presentArticle(article, library.get(article.slug), now)
    )

    if (step === 'audit') {
      const checkedAt = now.toISOString()
      try {
        await persistLastChecked(auth.supabase, companyId, checkedAt)
      } catch (err) {
        console.error('article-updates last-checked persist failed:', err)
      }
      return json(res, 200, {
        ok: true,
        step: 'audit',
        lastCheckedAt: checkedAt,
        corpusCount: liveArticles.length,
        publishedCount: published.length,
        buckets: summarizeBuckets(articles),
        articles,
      })
    }

    const approved = asApprovedUpdates(body)
    if (approved.length === 0) {
      return json(res, 200, {
        ok: false,
        step: 'commit',
        branch: null,
        mergeCommitSha: null,
        committed: [],
        skipped: [],
        errors: [{ message: 'No approved Where Things Stand updates to commit.' }],
      })
    }

    const plan = buildCommitPlan(liveArticles, approved)
    if (plan.files.length === 0) {
      return json(res, 200, {
        ok: false,
        step: 'commit',
        branch: null,
        mergeCommitSha: null,
        committed: [],
        skipped: plan.skipped,
        errors:
          plan.errors.length > 0
            ? plan.errors
            : [{ message: 'No Where Things Stand updates to commit.' }],
      })
    }

    const committed = await commitFiles(octokit, dest, plan.files, {
      message: 'Articles Update: Where Things Stand',
      branchName: updatesBranchName(),
    })
    branchName = committed.branchName

    if (!MERGE_VIA_API) {
      const { data: pr } = await octokit.pulls.create({
        owner: dest.owner,
        repo: dest.repo,
        title: `Articles Update (${branchName})`,
        head: branchName,
        base: dest.targetBranch,
        body: `Replaces the Where Things Stand section on ${plan.files.length} article(s).`,
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
        errors: plan.errors,
      })
    }

    const merge = await mergeBranch(octokit, dest, branchName)
    const committedSlugs = plan.files.map((file) => file.slug)
    try {
      await syncLibraryDates(
        auth.supabase,
        companyId,
        committedSlugs,
        plan.isoDate
      )
    } catch (err) {
      console.error('article-updates library date sync failed:', err)
    }

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
      errors: plan.errors,
    })
  } catch (err) {
    console.error('article-updates error:', err)
    return json(res, err.statusCode || 502, {
      ok: false,
      branch: branchName,
      error: githubErrorMessage(err),
    })
  }
}
