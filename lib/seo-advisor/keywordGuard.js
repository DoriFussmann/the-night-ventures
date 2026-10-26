/**
 * Server-side same-results guard around keyword writes. Runs the SERP
 * overlap check against the stored map, caches every top 10 it fetched,
 * and refuses an add whose results match an existing article.
 */
import { serpResults } from './providers/dataforseo.js'
import {
  keywordLabel,
  loadCoverageState,
  mutateCoverage,
  normalizeCoveragePillars,
  slugifyKeyword,
} from './pillars.js'
import {
  applySerpCache,
  checkSerpOverlap,
  mapEntries,
  overlapMessage,
  topUrlsFromSerp,
} from './serpOverlap.js'

export function serpFetcher(locale) {
  return (keyword) =>
    serpResults({
      keyword,
      depth: 10,
      locationCode: locale.dfsLocationCode,
      languageCode: locale.dfsLanguageCode,
    })
}

function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.statusCode = status
  Object.assign(err, extra)
  return err
}

export function summarizeOverlap(result, keyword) {
  return {
    checked: result.checked,
    verdict: result.verdict,
    closest: result.closest,
    matches: result.matches.slice(0, 5),
    skipped: result.skipped.length,
    message: overlapMessage(result, keyword),
  }
}

/**
 * Check one keyword. Persists fetched SERPs. Throws 409 same_results when
 * the keyword shares 4+ results with an article in the map.
 * @returns { overlap, candidateSerp }
 */
export async function guardKeyword(supabase, companyId, keyword, locale, { fetchSerp, exclude } = {}) {
  const state = await loadCoverageState(supabase, companyId)
  const result = await checkSerpOverlap({
    keyword,
    pillars: state.pillars,
    fetchSerp: fetchSerp || serpFetcher(locale),
    market: locale.market,
    language: locale.language,
    exclude,
  })
  if (Object.keys(result.refreshed).length > 0) {
    await mutateCoverage(supabase, companyId, (pillars) => applySerpCache(pillars, result.refreshed))
  }
  const overlap = summarizeOverlap(result, keyword)
  if (result.verdict === 'same') {
    throw httpError(409, overlap.message, { code: 'same_results', overlap })
  }
  return { overlap, candidateSerp: result.candidateSerp }
}

/** Cache the new keyword's own top 10 on it right after it is added. */
export function withOwnSerp(pillars, { core, keyword }, candidateSerp) {
  if (!candidateSerp) return { pillars }
  const list = normalizeCoveragePillars(pillars)
  const coreSlug = slugifyKeyword(core || keyword)
  const path = core ? `${coreSlug}/${slugifyKeyword(keyword)}` : coreSlug
  return applySerpCache(list, { [path]: candidateSerp })
}

/** Fetch top 10s for every keyword in the map whose cache is missing or stale. */
export async function backfillSerps(supabase, companyId, locale, { limit = 60, fetchSerp } = {}) {
  const state = await loadCoverageState(supabase, companyId)
  const fetcher = fetchSerp || serpFetcher(locale)
  const maxAge = 30 * 86400000
  const stale = mapEntries(state.pillars).filter((entry) => {
    const s = entry.serp
    if (!s?.fetchedAt || !Array.isArray(s.urls)) return true
    if (s.market && s.market !== locale.market) return true
    return Date.now() - Date.parse(s.fetchedAt) > maxAge
  })
  const refreshed = {}
  const failed = []
  const batch = stale.slice(0, limit)
  // Fetch the batch in parallel; one slow keyword doesn't hold up the rest.
  const results = await Promise.all(
    batch.map((entry) => fetcher(entry.keyword).catch((err) => ({ available: false, reason: err?.message })))
  )
  for (const [i, entry] of batch.entries()) {
    const urls = topUrlsFromSerp(results[i])
    if (!urls) {
      failed.push({ keyword: entry.keyword, reason: results[i]?.reason || 'no results' })
      continue
    }
    refreshed[entry.path] = {
      urls,
      fetchedAt: new Date().toISOString(),
      market: locale.market,
      language: locale.language,
    }
  }
  if (Object.keys(refreshed).length > 0) {
    await mutateCoverage(supabase, companyId, (pillars) => applySerpCache(pillars, refreshed))
  }
  return {
    fetched: Object.keys(refreshed).length,
    failed,
    remaining: Math.max(stale.length - limit, 0),
    total: mapEntries(state.pillars).length,
  }
}

/** Keywords in an edited tree that are not in the stored one. */
export function newKeywordsIn(pillars, input) {
  const existing = new Set(mapEntries(pillars).map((e) => slugifyKeyword(e.keyword)))
  const out = []
  for (const row of Array.isArray(input) ? input : []) {
    for (const label of [keywordLabel(row), ...(row?.supporting || []).map(keywordLabel)]) {
      if (label && !existing.has(slugifyKeyword(label))) out.push(label)
    }
  }
  return out
}
