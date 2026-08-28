// lib/article-updates/cleanup-run.js
//
// Batching + selection layer for Slice 1 (deterministic cleanup).
// Pure functions — no network, no octokit. The handler supplies already-loaded
// live articles + presented metadata and wires the results into the existing
// branch-one-merge commit path.
//
// Governing principle enforced here:
//   - oldest bucket first (stalest daysSince processed first)
//   - batch-capped (never the whole corpus in one run)
//   - freshest bucket excluded by default (never touch fresh)
//   - drafts skipped
//   - mechanical pass: updatedDate is NOT bumped by default (no faked freshness)

import { cleanupArticle } from './cleanup.js'
import { bumpUpdatedDate } from './wts.js'

export const CLEANUP_DEFAULTS = {
  batchSize: 5, // max articles surfaced/committed per run
  excludeBuckets: ['0-14'], // never touch the freshest bucket
  bumpDate: false, // mechanical hygiene should not fake a content refresh
  maxCommit: 10, // hard safety rail on a single commit
  threshold: 30, // rank threshold: positions 1..threshold default-skip
}

export function readCleanupOpts(body = {}) {
  const out = { ...CLEANUP_DEFAULTS }
  if (Number.isFinite(Number(body.batchSize)) && Number(body.batchSize) > 0) {
    out.batchSize = Math.min(Number(body.batchSize), 25)
  }
  if (Array.isArray(body.excludeBuckets)) {
    out.excludeBuckets = body.excludeBuckets.map((b) => String(b))
  }
  if (typeof body.bumpDate === 'boolean') out.bumpDate = body.bumpDate
  if (Number.isFinite(Number(body.maxCommit)) && Number(body.maxCommit) > 0) {
    out.maxCommit = Math.min(Number(body.maxCommit), 25)
  }
  if (Number.isFinite(Number(body.rankThreshold)) && Number(body.rankThreshold) > 0) {
    out.threshold = Math.min(Number(body.rankThreshold), 100)
  }
  return out
}

export function asApprovedSlugs(body = {}) {
  const raw = Array.isArray(body.slugs)
    ? body.slugs
    : Array.isArray(body.updates)
      ? body.updates.map((u) => u?.slug)
      : Array.isArray(body.articles)
        ? body.articles.map((a) => a?.slug)
        : []
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const slug = String(item || '').trim()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

// Oldest-first ordering. Articles with no parseable date (daysSince == null)
// sort last, since we can't establish they're stale.
function byOldestFirst(a, b) {
  const da = a?.daysSince
  const db = b?.daysSince
  if (da == null && db == null) return 0
  if (da == null) return 1
  if (db == null) return -1
  return db - da
}

/**
 * Pick the batch to clean: eligible, oldest-first, capped.
 * `presented` are the objects produced by the handler's presentArticle()
 * (they carry slug, bucket, daysSince, draft).
 */
export function selectCleanupCandidates(presented, opts = CLEANUP_DEFAULTS) {
  const exclude = new Set(opts.excludeBuckets || [])
  const eligible = (Array.isArray(presented) ? presented : []).filter((a) => {
    if (!a || !a.slug) return false
    if (a.draft === true) return false
    if (exclude.has(a.bucket)) return false
    return true
  })
  eligible.sort(byOldestFirst)
  return eligible.slice(0, opts.batchSize).map((a) => a.slug)
}

/**
 * Metadata for the selected batch, so the handler can resolve rank before
 * building the preview. Uses targetKeyword + publishedUrl from presentArticle().
 */
export function cleanupCandidateMetas(presented, opts = CLEANUP_DEFAULTS) {
  const slugs = selectCleanupCandidates(presented, opts)
  const map = presentedMap(presented)
  return slugs.map((slug) => {
    const a = map.get(slug) || {}
    return { slug, keyword: a.targetKeyword || '', publishedUrl: a.publishedUrl || '' }
  })
}

function liveMap(liveArticles) {
  const map = new Map()
  for (const art of Array.isArray(liveArticles) ? liveArticles : []) {
    if (art && art.slug) map.set(art.slug, art)
  }
  return map
}

function presentedMap(presented) {
  const map = new Map()
  for (const a of Array.isArray(presented) ? presented : []) {
    if (a && a.slug) map.set(a.slug, a)
  }
  return map
}

/**
 * Preview step (no writes). Runs cleanup on the selected batch and returns
 * per-article diffs/stats/flags for the ones that actually change.
 */
export function buildCleanupPreview(liveArticles, presented, opts = CLEANUP_DEFAULTS, rankBySlug = {}) {
  const slugs = selectCleanupCandidates(presented, opts)
  const live = liveMap(liveArticles)
  const meta = presentedMap(presented)

  const previews = []
  const skipped = []
  let scanned = 0
  let rankSkipCount = 0

  for (const slug of slugs) {
    const article = live.get(slug)
    if (!article || typeof article.raw !== 'string') {
      skipped.push({ slug, reason: 'not_found' })
      continue
    }
    scanned++
    const result = cleanupArticle(article.raw, opts)
    if (!result.changed) {
      skipped.push({ slug, reason: 'already_clean' })
      continue
    }
    const info = meta.get(slug) || {}
    const rank = rankBySlug[slug] || {}
    if (rank.rankSkip) rankSkipCount++
    previews.push({
      slug,
      path: article.path,
      title: String(article?.data?.title || info.title || slug),
      bucket: info.bucket ?? null,
      daysSince: info.daysSince ?? null,
      position: rank.position ?? null,
      rankSkip: rank.rankSkip === true, // default-deselect these in the UI
      stats: result.stats,
      flags: result.flags,
      diffs: result.diffs,
    })
  }

  return {
    batchSize: opts.batchSize,
    excludeBuckets: opts.excludeBuckets,
    rankThreshold: opts.threshold,
    scanned,
    changedCount: previews.length,
    rankSkipCount,
    previews,
    skipped,
  }
}

/**
 * Commit step. Recomputes cleanup deterministically for the approved slugs
 * (never trusts client-sent content) and produces files for commitFiles().
 */
export function buildCleanupCommitPlan(liveArticles, approvedSlugs, opts = CLEANUP_DEFAULTS) {
  const live = liveMap(liveArticles)
  const capped = (Array.isArray(approvedSlugs) ? approvedSlugs : []).slice(0, opts.maxCommit)

  const files = []
  const skipped = []
  const errors = []
  const statsBySlug = {}

  for (const slug of capped) {
    const article = live.get(slug)
    if (!article || typeof article.raw !== 'string') {
      skipped.push({ slug, reason: 'not_found', message: 'Slug not found in live repo' })
      continue
    }
    if (article?.data?.draft === true) {
      skipped.push({ slug, reason: 'draft', message: 'Draft articles are not cleaned' })
      continue
    }

    let result
    try {
      result = cleanupArticle(article.raw, opts)
    } catch (err) {
      errors.push({ slug, message: err?.message || 'cleanup failed' })
      continue
    }
    if (!result.changed) {
      skipped.push({ slug, reason: 'unchanged', message: 'No cleanup changes for this article' })
      continue
    }

    let content = result.cleaned
    if (opts.bumpDate) content = bumpUpdatedDate(content, todayIso())

    files.push({
      slug,
      path: article.path,
      content,
      title: String(article?.data?.title || slug),
    })
    statsBySlug[slug] = result.stats
  }

  const deferred = (Array.isArray(approvedSlugs) ? approvedSlugs : []).slice(opts.maxCommit)
  for (const slug of deferred) {
    skipped.push({ slug, reason: 'deferred', message: `Exceeds maxCommit (${opts.maxCommit}); run again next batch` })
  }

  return { files, skipped, errors, stats: statsBySlug }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
