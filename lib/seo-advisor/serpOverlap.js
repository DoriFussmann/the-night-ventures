/**
 * Same-results check: two keywords that share 4+ of their Google top-10 URLs
 * have the same search intent and belong in one article.
 *
 * Each keyword in content_coverage can carry a cached top 10:
 *   serp: { urls: [normalized url], fetchedAt: ISO, market, language }
 *
 * Pure helpers + one orchestrator that takes a fetchSerp function, so it is
 * testable without network.
 */
import { keywordLabel, normalizeCoveragePillars, slugifyKeyword } from './pillars.js'

export const SAME_INTENT_SHARED = 4
export const CLOSE_SHARED = 2
export const SERP_MAX_AGE_DAYS = 30
export const MAX_REFRESH_PER_CHECK = 40

/** Comparable form of a result URL: host without www, path without trailing slash. */
export function normalizeResultUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '').toLowerCase()
    return `${host}${path}`
  } catch {
    return raw.toLowerCase()
  }
}

/** Top-10 organic URLs from a DataForSEO serpResults() result. */
export function topUrlsFromSerp(result, limit = 10) {
  if (!result || result.available === false || !Array.isArray(result.items)) return null
  const urls = []
  for (const item of result.items) {
    if (item?.type && item.type !== 'organic') continue
    const url = normalizeResultUrl(item?.url)
    if (url && !urls.includes(url)) urls.push(url)
    if (urls.length >= limit) break
  }
  return urls
}

export function sharedCount(a, b) {
  const set = new Set(Array.isArray(a) ? a : [])
  return (Array.isArray(b) ? b : []).filter((url) => set.has(url)).length
}

export function verdictFor(shared) {
  if (shared >= SAME_INTENT_SHARED) return 'same'
  if (shared >= CLOSE_SHARED) return 'close'
  return 'distinct'
}

function isFresh(serp, { market, language, now = Date.now(), maxAgeDays = SERP_MAX_AGE_DAYS }) {
  if (!serp || !Array.isArray(serp.urls) || !serp.fetchedAt) return false
  if (market && serp.market && serp.market !== market) return false
  if (language && serp.language && serp.language !== language) return false
  const age = now - Date.parse(serp.fetchedAt)
  return Number.isFinite(age) && age <= maxAgeDays * 86400000
}

/** Every keyword in the map with its place: [{ path, keyword, core, type, serp }]. */
export function mapEntries(pillars) {
  const out = []
  for (const pillar of normalizeCoveragePillars(pillars)) {
    const coreSlug = slugifyKeyword(pillar.slug || keywordLabel(pillar))
    out.push({
      path: coreSlug,
      keyword: keywordLabel(pillar),
      core: keywordLabel(pillar),
      type: 'core',
      serp: pillar.serp || null,
    })
    for (const item of Array.isArray(pillar.supporting) ? pillar.supporting : []) {
      out.push({
        path: `${coreSlug}/${slugifyKeyword(item.slug || keywordLabel(item))}`,
        keyword: keywordLabel(item),
        core: keywordLabel(pillar),
        type: 'supporting',
        serp: item.serp || null,
      })
    }
  }
  return out
}

/**
 * Compare a candidate keyword's top 10 with every keyword in the map.
 *
 * @param fetchSerp async (keyword) => serpResults()-shaped result
 * @returns {
 *   checked: boolean,           // false when results could not be fetched
 *   verdict: 'same'|'close'|'distinct'|'unchecked',
 *   closest: { keyword, core, type, shared } | null,
 *   matches: [{ keyword, core, type, shared }],  // shared >= CLOSE_SHARED, most shared first
 *   candidateSerp, refreshed: { [path]: serp }, skipped: [keyword]
 * }
 */
export async function checkSerpOverlap({
  keyword,
  pillars,
  fetchSerp,
  market = '',
  language = '',
  now = Date.now(),
  maxRefresh = MAX_REFRESH_PER_CHECK,
  exclude = [],
}) {
  const stamp = () => ({ fetchedAt: new Date(now).toISOString(), market, language })
  const excluded = new Set(exclude.map((k) => slugifyKeyword(k)))
  const candidateResult = await fetchSerp(keyword).catch((err) => ({
    available: false,
    reason: err?.message,
  }))
  const candidateUrls = topUrlsFromSerp(candidateResult)
  if (!candidateUrls || candidateUrls.length === 0) {
    return {
      checked: false,
      verdict: 'unchecked',
      reason: candidateResult?.reason || 'No Google results returned',
      closest: null,
      matches: [],
      candidateSerp: null,
      refreshed: {},
      skipped: [],
    }
  }

  const refreshed = {}
  const skipped = []
  const compared = []
  let refreshes = 0
  for (const entry of mapEntries(pillars)) {
    if (slugifyKeyword(entry.keyword) === slugifyKeyword(keyword)) continue
    if (excluded.has(slugifyKeyword(entry.keyword))) continue
    let urls = isFresh(entry.serp, { market, language, now }) ? entry.serp.urls : null
    if (!urls) {
      if (refreshes >= maxRefresh) {
        skipped.push(entry.keyword)
        continue
      }
      refreshes += 1
      const result = await fetchSerp(entry.keyword).catch(() => null)
      urls = topUrlsFromSerp(result)
      if (!urls) {
        skipped.push(entry.keyword)
        continue
      }
      refreshed[entry.path] = { urls, ...stamp() }
    }
    compared.push({
      keyword: entry.keyword,
      core: entry.core,
      type: entry.type,
      shared: sharedCount(candidateUrls, urls),
    })
  }

  compared.sort((a, b) => b.shared - a.shared)
  const closest = compared[0] || null
  return {
    checked: true,
    verdict: closest ? verdictFor(closest.shared) : 'distinct',
    closest,
    matches: compared.filter((row) => row.shared >= CLOSE_SHARED),
    candidateSerp: { urls: candidateUrls, ...stamp() },
    refreshed,
    skipped,
  }
}

/** Store fetched top-10s on the matching keywords (pure). */
export function applySerpCache(pillars, refreshed) {
  const updates = refreshed && typeof refreshed === 'object' ? refreshed : {}
  if (Object.keys(updates).length === 0) return { pillars: normalizeCoveragePillars(pillars) }
  const next = normalizeCoveragePillars(pillars).map((pillar) => {
    const coreSlug = slugifyKeyword(pillar.slug || keywordLabel(pillar))
    const own = updates[coreSlug]
    const supporting = Array.isArray(pillar.supporting)
      ? pillar.supporting.map((item) => {
          const path = `${coreSlug}/${slugifyKeyword(item.slug || keywordLabel(item))}`
          return updates[path] ? { ...item, serp: updates[path] } : item
        })
      : pillar.supporting
    return { ...pillar, ...(own ? { serp: own } : {}), supporting }
  })
  return { pillars: next }
}

/** One-line message for the UI and the Advisor. */
export function overlapMessage(result, keyword) {
  if (!result?.checked) return `Couldn't check Google results for “${keyword}” (${result?.reason || 'unavailable'}).`
  const c = result.closest
  if (!c || result.verdict === 'distinct') return `“${keyword}” has its own Google results. OK to add.`
  if (result.verdict === 'same') {
    return `Same Google results as “${c.keyword}” (${c.shared} of 10 shared). Cover it inside that article as a secondary keyword.`
  }
  return `Close to “${c.keyword}” (${c.shared} of 10 results shared). Fine to add, but keep the two angles clearly different.`
}
