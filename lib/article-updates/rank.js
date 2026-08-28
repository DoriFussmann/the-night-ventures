// lib/article-updates/rank.js
//
// Slice 2 — Rank-awareness. Pull the target keyword's SERP position for an
// article's published URL, so cleanup (and later the section rewrite) can flag
// and default-skip pages that already rank well.
//
// Policy (cleanup): flag-and-default-skip — top-`threshold` pages are marked
// rankSkip and dropped from a commit BY DEFAULT, but overridable via force /
// forceSlugs. No-rank, not-found, or provider-unavailable => eligible (clean it).
//
// Shared: this is deliberately its own module so the future random-section
// rewrite can consume the same signal (where it will hard-exclude instead).
//
// The pure functions (normalize / findPosition / classify / partitionByRank)
// take no I/O and are fully unit-tested. fetchRankForCandidate does the cached
// DataForSEO call; the SERP function is injectable so tests never hit network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serpOrganic } from '../external-links/serp.js'

export const RANK_DEFAULTS = {
  threshold: 30, // positions 1..threshold are "ranking well" => default skip
  ttlMs: 7 * 24 * 60 * 60 * 1000, // rank moves faster than the 30-day source cache
}

// --- pure: URL normalization + matching -----------------------------------

export function normalizeUrlForMatch(url) {
  let s = String(url || '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^https?:\/\//, '')
  s = s.replace(/^www\./, '')
  s = s.split('#')[0].split('?')[0]
  s = s.replace(/\/+$/, '')
  return s
}

/**
 * Return the SERP rank of the item whose URL matches publishedUrl, else null.
 * Matches on normalized host+path so protocol / www / trailing slash / query
 * differences don't cause a miss.
 */
export function findPosition(items, publishedUrl) {
  const target = normalizeUrlForMatch(publishedUrl)
  if (!target) return null
  for (const item of Array.isArray(items) ? items : []) {
    if (normalizeUrlForMatch(item?.url) === target) {
      const rank = Number(item?.rank)
      return Number.isFinite(rank) ? rank : null
    }
  }
  return null
}

// --- pure: classification --------------------------------------------------

export function classifyRank(position, threshold = RANK_DEFAULTS.threshold, available = true) {
  const n = position == null || position === '' ? NaN : Number(position)
  const pos = Number.isFinite(n) ? n : null
  return {
    available,
    position: pos,
    ranking: pos != null,
    rankSkip: pos != null && pos <= threshold,
  }
}

/**
 * Split approved slugs into what to commit vs what to hold back for ranking.
 * Default-skip is enforced here (safe even when driven API-only); force / a
 * per-slug forceSlugs list overrides it.
 */
export function partitionByRank(slugs, rankBySlug = {}, { force = false, forceSlugs = [] } = {}) {
  const forceSet = new Set((Array.isArray(forceSlugs) ? forceSlugs : []).map(String))
  const commit = []
  const rankSkipped = []
  for (const slug of Array.isArray(slugs) ? slugs : []) {
    const r = rankBySlug[slug]
    if (!force && r?.rankSkip && !forceSet.has(slug)) {
      rankSkipped.push({ slug, reason: 'ranking', position: r.position ?? null })
    } else {
      commit.push(slug)
    }
  }
  return { commit, rankSkipped }
}

// --- cached fetch (impure; serpFn injectable) ------------------------------

function rankCacheDir() {
  if (process.env.VERCEL) return join(tmpdir(), 'tnv-rank-cache')
  return join(process.cwd(), '.cache', 'rank')
}

function safeKey(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'x'
  )
}

function rankCachePath(slug, keyword, dir) {
  const base = dir || rankCacheDir()
  return join(base, `${safeKey(slug)}__${safeKey(keyword)}.json`)
}

function readRankCache(slug, keyword, ttlMs, dir) {
  const path = rankCachePath(slug, keyword, dir)
  if (!existsSync(path)) return null
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'))
    if (Date.now() - new Date(json.fetchedAt).getTime() > ttlMs) return null
    return json // { position } (may be null — negative results are cached too)
  } catch {
    return null
  }
}

function writeRankCache(slug, keyword, position, dir) {
  try {
    const base = dir || rankCacheDir()
    mkdirSync(base, { recursive: true })
    writeFileSync(
      rankCachePath(slug, keyword, dir),
      JSON.stringify({ slug, keyword, position, fetchedAt: new Date().toISOString() }, null, 2)
    )
  } catch {
    // best-effort cache; never fail the request over a cache write
  }
}

/**
 * Resolve rank for one candidate. Returns a classifyRank() shape.
 * opts: { threshold, ttlMs, depth, serpFn, noCache, cacheDir }
 */
export async function fetchRankForCandidate(meta, opts = {}) {
  const slug = String(meta?.slug || '')
  const keyword = String(meta?.keyword || '').trim()
  const publishedUrl = String(meta?.publishedUrl || '').trim()
  const threshold = Number(opts.threshold) || RANK_DEFAULTS.threshold
  const ttlMs = Number(opts.ttlMs) || RANK_DEFAULTS.ttlMs
  const depth = Math.max(Number(opts.depth) || threshold, 10)
  const serpFn = opts.serpFn || serpOrganic

  // Missing inputs => can't establish it ranks => eligible.
  if (!keyword || !publishedUrl) {
    return { ...classifyRank(null, threshold, false), reason: 'missing keyword or publishedUrl' }
  }

  if (!opts.noCache) {
    const cached = readRankCache(slug, keyword, ttlMs, opts.cacheDir)
    if (cached) return classifyRank(cached.position, threshold, true)
  }

  let res
  try {
    res = await serpFn({ keyword, depth })
  } catch (err) {
    return { ...classifyRank(null, threshold, false), reason: err?.message || 'serp error' }
  }
  if (!res || res.available === false) {
    return { ...classifyRank(null, threshold, false), reason: res?.reason || 'serp unavailable' }
  }

  const position = findPosition(res.items, publishedUrl)
  if (!opts.noCache) writeRankCache(slug, keyword, position, opts.cacheDir)
  return classifyRank(position, threshold, true)
}

/** Resolve rank for a batch of candidates → { [slug]: classifyRank() }. */
export async function annotateCandidatesWithRank(metas, opts = {}) {
  const out = {}
  for (const meta of Array.isArray(metas) ? metas : []) {
    if (!meta?.slug) continue
    out[meta.slug] = await fetchRankForCandidate(meta, opts)
  }
  return out
}
