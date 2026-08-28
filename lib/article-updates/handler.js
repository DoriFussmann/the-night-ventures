import { requireAuth } from '../seo-advisor/auth.js'
import { publishedArticles, todayIso } from '../wire-internal-links/plan.js'
import { applyExternalLinksToMarkdown } from '../wire-internal-links/plan.js'
import { loadSources, ownHost } from '../external-links/search.js'
import { pickBestSource, wireProofLink } from './proof-link.js'
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
import {
  asApprovedSlugs,
  buildCleanupCommitPlan,
  buildCleanupPreview,
  cleanupCandidateMetas,
  readCleanupOpts,
} from './cleanup-run.js'
import { annotateCandidatesWithRank, partitionByRank } from './rank.js'
import Anthropic from '@anthropic-ai/sdk'
import {
  readRewriteOpts,
  pickSectionItems,
  proposeRewrites,
  buildRewriteCommitPlan,
} from './rewrite-run.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const REWRITE_MODEL = 'claude-sonnet-4-6'

function extractModelText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => String(block.text))
    .join('\n')
    .trim()
}

async function defaultCallModel({ prompt, needsWebSearch }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: REWRITE_MODEL,
    max_tokens: 1500,
    ...(needsWebSearch
      ? { tools: [{ type: 'web_search_20250305', name: 'web_search' }] }
      : {}),
    messages: [{ role: 'user', content: prompt }],
  })
  return extractModelText(message?.content)
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
    const newSources = Array.isArray(item?.newSources) ? item.newSources : []
    updates.push({ slug, newParagraph, newSources })
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

function isMissingColumnError(error, column) {
  if (!error) return false
  const re = new RegExp(column, 'i')
  return re.test(error.message || '') || error.code === 'PGRST204'
}

async function persistAuditSnapshot(supabase, companyId, checkedAt, snapshot) {
  if (!supabase || !companyId) return { ok: false }

  const full = {
    articles_update_checked_at: checkedAt,
    articles_update_snapshot: snapshot || null,
  }
  const { error } = await supabase
    .from('companies')
    .update(full)
    .eq('id', companyId)

  if (!error) return { ok: true }

  if (isMissingColumnError(error, 'articles_update_snapshot')) {
    const { error: tsError } = await supabase
      .from('companies')
      .update({ articles_update_checked_at: checkedAt })
      .eq('id', companyId)
    if (!tsError) return { ok: true, missingSnapshotColumn: true }
    if (isMissingColumnError(tsError, 'articles_update_checked_at')) {
      return { ok: false, missingColumn: true }
    }
    throw tsError
  }

  if (isMissingColumnError(error, 'articles_update_checked_at')) {
    return { ok: false, missingColumn: true }
  }

  throw error
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

function buildCommitPlan(articles, approved, opts = {}) {
  const bySlug = new Map(articles.map((article) => [article.slug, article]))
  const files = []
  const skipped = []
  const errors = []
  const isoDate = todayIso()
  const proofCtx = {
    host: opts.ownHost || '',
    allow: opts.allow || new Set(),
    deny: opts.deny || new Set(),
  }

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

    let content = bumpUpdatedDate(replaced.content, isoDate)

    // Wire the best surfaced source as a typed WTS proof link (replaces any
    // prior proof, enforces the external-link cap of 5). Optional per update.
    let proof = null
    if (Array.isArray(update.newSources) && update.newSources.length) {
      const best = pickBestSource(update.newSources, {
        targetKeyword: article.data?.targetKeyword,
        pillarKeyword: article.data?.pillarKeyword,
        ...proofCtx,
      })
      if (best) {
        const nextLinks = wireProofLink(article.data?.externalLinks || [], best, {
          today: isoDate,
        })
        const applied = applyExternalLinksToMarkdown(content, nextLinks)
        content = applied.content
        proof = best
      }
    }

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
      proof: proof ? proof.url : null,
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
  if (
    ![
      'audit',
      'commit',
      'cleanup-audit',
      'cleanup-commit',
      'rewrite-audit',
      'rewrite-propose',
      'rewrite-commit',
    ].includes(step)
  ) {
    return json(res, 400, {
      error:
        'step must be one of: audit, commit, cleanup-audit, cleanup-commit, rewrite-audit, rewrite-propose, rewrite-commit',
    })
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
      const buckets = summarizeBuckets(articles)
      const snapshot = {
        lastCheckedAt: checkedAt,
        corpusCount: liveArticles.length,
        publishedCount: published.length,
        buckets,
        articles,
      }
      try {
        await persistAuditSnapshot(
          auth.supabase,
          companyId,
          checkedAt,
          snapshot
        )
      } catch (err) {
        console.error('article-updates snapshot persist failed:', err)
      }
      return json(res, 200, {
        ok: true,
        step: 'audit',
        ...snapshot,
      })
    }

    if (step === 'cleanup-audit') {
      const opts = readCleanupOpts(body)
      const metas = cleanupCandidateMetas(articles, opts)
      const rankBySlug = await annotateCandidatesWithRank(metas, opts)
      const preview = buildCleanupPreview(liveArticles, articles, opts, rankBySlug)
      return json(res, 200, { ok: true, step: 'cleanup-audit', ...preview })
    }

    if (step === 'cleanup-commit') {
      const opts = readCleanupOpts(body)
      const approvedSlugs = asApprovedSlugs(body)
      if (approvedSlugs.length === 0) {
        return json(res, 200, {
          ok: false,
          step: 'cleanup-commit',
          branch: null,
          mergeCommitSha: null,
          committed: [],
          skipped: [],
          errors: [{ message: 'No approved slugs to clean up.' }],
        })
      }

      const presentedBySlug = new Map(articles.map((a) => [a.slug, a]))
      const rankMetas = approvedSlugs.map((slug) => {
        const a = presentedBySlug.get(slug) || {}
        return { slug, keyword: a.targetKeyword || '', publishedUrl: a.publishedUrl || '' }
      })
      const rankBySlug = await annotateCandidatesWithRank(rankMetas, opts)
      const { commit: toCommit, rankSkipped } = partitionByRank(approvedSlugs, rankBySlug, {
        force: body.force === true,
        forceSlugs: Array.isArray(body.forceSlugs) ? body.forceSlugs : [],
      })

      const plan = buildCleanupCommitPlan(liveArticles, toCommit, opts)
      plan.skipped = [...rankSkipped, ...plan.skipped]
      if (plan.files.length === 0) {
        return json(res, 200, {
          ok: false,
          step: 'cleanup-commit',
          branch: null,
          mergeCommitSha: null,
          committed: [],
          skipped: plan.skipped,
          errors:
            plan.errors.length > 0
              ? plan.errors
              : [{ message: 'No cleanup changes to commit.' }],
        })
      }

      const committed = await commitFiles(octokit, dest, plan.files, {
        message: 'Articles Cleanup: deterministic hygiene',
        branchName: updatesBranchName(),
      })
      branchName = committed.branchName

      if (!MERGE_VIA_API) {
        const { data: pr } = await octokit.pulls.create({
          owner: dest.owner,
          repo: dest.repo,
          title: `Articles Cleanup (${branchName})`,
          head: branchName,
          base: dest.targetBranch,
          body: `Deterministic cleanup on ${plan.files.length} article(s).`,
        })
        return json(res, 200, {
          ok: true,
          step: 'cleanup-commit',
          branch: branchName,
          mergeCommitSha: null,
          mergeStrategy: 'open-pr',
          pullRequestUrl: pr.html_url || null,
          committed: plan.files.map((file) => ({ path: file.path, slug: file.slug })),
          skipped: plan.skipped,
          errors: plan.errors,
          stats: plan.stats,
        })
      }

      const merge = await mergeBranch(octokit, dest, branchName)
      return json(res, 200, {
        ok: true,
        step: 'cleanup-commit',
        branch: branchName,
        mergeCommitSha: merge?.sha || committed.newCommit.sha,
        mergeStrategy: 'merge',
        committed: plan.files.map((file) => ({ path: file.path, slug: file.slug })),
        skipped: plan.skipped,
        errors: plan.errors,
        stats: plan.stats,
      })
    }

    if (step === 'rewrite-audit') {
      const opts = readRewriteOpts(body)
      const metas = cleanupCandidateMetas(articles, opts)
      const rankBySlug = await annotateCandidatesWithRank(metas, opts)
      // Hard-exclude top-ranked pages entirely (unlike cleanup's soft skip).
      const eligibleSlugs = metas
        .map((m) => m.slug)
        .filter((slug) => !rankBySlug[slug]?.rankSkip)
      const rankExcluded = metas
        .map((m) => m.slug)
        .filter((slug) => rankBySlug[slug]?.rankSkip)
        .map((slug) => ({ slug, position: rankBySlug[slug]?.position ?? null }))
      const { items, noSection } = pickSectionItems(liveArticles, eligibleSlugs, rankBySlug)
      return json(res, 200, {
        ok: true,
        step: 'rewrite-audit',
        batchSize: opts.batchSize,
        rankThreshold: opts.threshold,
        items,
        noSection,
        rankExcluded,
      })
    }

    if (step === 'rewrite-propose') {
      if (!process.env.ANTHROPIC_API_KEY) {
        return json(res, 500, { error: 'ANTHROPIC_API_KEY not configured' })
      }
      const items = Array.isArray(body.items) ? body.items : []
      if (items.length === 0) {
        return json(res, 200, { ok: false, step: 'rewrite-propose', proposals: [], dropped: [] })
      }
      const result = await proposeRewrites(liveArticles, items, readRewriteOpts(body), {
        callModel: defaultCallModel,
      })
      return json(res, 200, { ok: true, step: 'rewrite-propose', ...result })
    }

    if (step === 'rewrite-commit') {
      const opts = readRewriteOpts(body)
      const approvedItems = Array.isArray(body.approved) ? body.approved : []
      if (approvedItems.length === 0) {
        return json(res, 200, {
          ok: false,
          step: 'rewrite-commit',
          branch: null,
          mergeCommitSha: null,
          committed: [],
          skipped: [],
          errors: [{ message: 'No approved section rewrites to commit.' }],
        })
      }

      // Rank hard-exclude re-check on the write path.
      const presentedBySlug = new Map(articles.map((a) => [a.slug, a]))
      const rankMetas = approvedItems.map((it) => {
        const a = presentedBySlug.get(it.slug) || {}
        return { slug: it.slug, keyword: a.targetKeyword || '', publishedUrl: a.publishedUrl || '' }
      })
      const rankBySlug = await annotateCandidatesWithRank(rankMetas, opts)
      const rankSkipped = []
      const survivors = approvedItems.filter((it) => {
        if (rankBySlug[it.slug]?.rankSkip) {
          rankSkipped.push({ slug: it.slug, reason: 'ranking', position: rankBySlug[it.slug]?.position ?? null })
          return false
        }
        return true
      })

      const plan = buildRewriteCommitPlan(liveArticles, survivors, opts)
      plan.skipped = [...rankSkipped, ...plan.skipped]
      if (plan.files.length === 0) {
        return json(res, 200, {
          ok: false,
          step: 'rewrite-commit',
          branch: null,
          mergeCommitSha: null,
          committed: [],
          skipped: plan.skipped,
          errors: plan.errors.length > 0 ? plan.errors : [{ message: 'No section rewrites to commit.' }],
        })
      }

      const committed = await commitFiles(octokit, dest, plan.files, {
        message: 'Articles Update: section improvement',
        branchName: updatesBranchName(),
      })
      branchName = committed.branchName

      if (!MERGE_VIA_API) {
        const { data: pr } = await octokit.pulls.create({
          owner: dest.owner,
          repo: dest.repo,
          title: `Articles Section Improvement (${branchName})`,
          head: branchName,
          base: dest.targetBranch,
          body: `Improves one section on ${plan.files.length} article(s).`,
        })
        return json(res, 200, {
          ok: true,
          step: 'rewrite-commit',
          branch: branchName,
          mergeCommitSha: null,
          mergeStrategy: 'open-pr',
          pullRequestUrl: pr.html_url || null,
          committed: plan.files.map((file) => ({ path: file.path, slug: file.slug, heading: file.heading })),
          skipped: plan.skipped,
          errors: plan.errors,
        })
      }

      const merge = await mergeBranch(octokit, dest, branchName)
      return json(res, 200, {
        ok: true,
        step: 'rewrite-commit',
        branch: branchName,
        mergeCommitSha: merge?.sha || committed.newCommit.sha,
        mergeStrategy: 'merge',
        committed: plan.files.map((file) => ({ path: file.path, slug: file.slug, heading: file.heading })),
        skipped: plan.skipped,
        errors: plan.errors,
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

    const loadedSources = loadSources()
    const allowSet = new Set(
      (loadedSources.allow || []).map((d) => String(d).replace(/^www\./, ''))
    )
    const denySet = new Set(
      (loadedSources.deny || []).map((d) => String(d).replace(/^www\./, ''))
    )
    const plan = buildCommitPlan(liveArticles, approved, {
      ownHost: ownHost(String(body.siteUrl || body.ownHost || '').trim()),
      allow: allowSet,
      deny: denySet,
    })
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
