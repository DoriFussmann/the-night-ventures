// Turn stored search + AI data into a ranked action list. Pure.
//
// Rules (thresholds scale with the range length):
//   striking   query ranks 4–20 with real impressions          → refresh the ranking page (Modify)
//   low_ctr    page in top 10 whose CTR is < half the expected → rewrite title/description
//   decaying   page lost ≥ 30% of clicks vs previous period    → refresh (Modify)
//   gap        query gets impressions but ranks below 20       → new article (Idea)
//   ai_gap     Google shows an AI Overview that doesn't cite us → Modify ranking page, else Idea

import { apexDomain } from '../audit-snapshot/domain.js'

export const OPPORTUNITY_TYPES = ['striking', 'low_ctr', 'decaying', 'gap', 'ai_gap']
const PER_TYPE = 15

/** Approximate organic CTR by position (1–10). Heuristic, used only for relative flags. */
const EXPECTED_CTR = [0.28, 0.15, 0.11, 0.08, 0.06, 0.045, 0.035, 0.03, 0.025, 0.02]

export function expectedCtr(position) {
  const p = Math.round(Number(position))
  if (!Number.isFinite(p) || p < 1) return null
  return EXPECTED_CTR[Math.min(p, 10) - 1]
}

/** Comparable URL key: host without www + path without trailing slash. */
export function urlKey(url) {
  try {
    const u = new URL(String(url || ''))
    const path = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}`
  } catch {
    return ''
  }
}

/** Brand terms from the product name and the domain stem (e.g. "acme" from acme.com). */
export function brandTerms(productName, domain) {
  const terms = new Set()
  const product = String(productName || '').trim().toLowerCase()
  if (product.length >= 3) terms.add(product)
  const stem = apexDomain(domain).split('.')[0]
  if (stem && stem.length >= 3) terms.add(stem)
  return [...terms]
}

function isBranded(query, terms) {
  const q = String(query || '').toLowerCase()
  return terms.some((t) => q.includes(t) || q.replace(/\s+/g, '').includes(t.replace(/\s+/g, '')))
}

/** Collapse (query, page) rows to one row per query with its best page. */
export function aggregateQueries(rows) {
  const byQuery = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const query = String(r.query || '')
    if (!query) continue
    const impressions = Number(r.impressions) || 0
    const clicks = Number(r.clicks) || 0
    const position = Number(r.position)
    const entry = byQuery.get(query) || { query, impressions: 0, clicks: 0, posSum: 0, page: '', pageImpr: -1 }
    entry.impressions += impressions
    entry.clicks += clicks
    if (Number.isFinite(position)) entry.posSum += position * impressions
    if (r.page && impressions > entry.pageImpr) {
      entry.page = r.page
      entry.pageImpr = impressions
    }
    byQuery.set(query, entry)
  }
  return [...byQuery.values()].map((e) => ({
    query: e.query,
    page: e.page,
    impressions: e.impressions,
    clicks: e.clicks,
    position: e.impressions > 0 ? e.posSum / e.impressions : null,
  }))
}

/**
 * @param {{
 *   days: number,
 *   queries: Array<{ query: string, page: string, clicks: number, impressions: number, position: number }>,
 *   pagesCurrent: Array<{ page: string, clicks: number, impressions: number, position: number }>,
 *   pagesPrevious: Array<{ page: string, clicks: number, impressions: number, position: number }>,
 *   aiChecks: Array<{ keyword: string, has_ai_overview: boolean, cited: boolean, organic_url?: string, organic_position?: number, competitors_cited?: string[], cited_domains?: string[] }>,
 *   brand: string[],
 *   library: Map<string, { slug: string, title: string }>,
 * }} input
 */
export function buildOpportunities(input) {
  const days = Math.max(1, Number(input.days) || 28)
  const brand = Array.isArray(input.brand) ? input.brand : []
  const library = input.library instanceof Map ? input.library : new Map()
  const lib = (page) => (page ? library.get(urlKey(page)) || null : null)
  const minImpr = Math.max(10, Math.round(days * 1.5))

  const queries = aggregateQueries(input.queries)
  const topQueryByPage = new Map()
  for (const r of Array.isArray(input.queries) ? input.queries : []) {
    if (!r.page || isBranded(r.query, brand)) continue
    const prev = topQueryByPage.get(r.page)
    if (!prev || (Number(r.impressions) || 0) > prev.impressions) {
      topQueryByPage.set(r.page, { query: r.query, impressions: Number(r.impressions) || 0 })
    }
  }

  const out = { striking: [], low_ctr: [], decaying: [], gap: [], ai_gap: [] }

  for (const q of queries) {
    if (q.position == null || isBranded(q.query, brand)) continue
    if (q.position > 3.5 && q.position <= 20 && q.impressions >= minImpr) {
      out.striking.push({
        type: 'striking',
        query: q.query,
        page: q.page || null,
        action: 'modify',
        metrics: { impressions: q.impressions, clicks: q.clicks, position: q.position },
        reason:
          q.position <= 10
            ? `Ranks #${q.position.toFixed(1)} — a push into the top 3 multiplies clicks.`
            : `Ranks #${q.position.toFixed(1)} — on page 2; a refresh can reach page 1.`,
        score: q.impressions * (q.position <= 10 ? 1 : 0.7),
        library: lib(q.page),
      })
    } else if (q.position > 20 && q.impressions >= minImpr * 2) {
      out.gap.push({
        type: 'gap',
        query: q.query,
        page: q.page || null,
        action: 'idea',
        metrics: { impressions: q.impressions, clicks: q.clicks, position: q.position },
        reason: `Google shows you for it (${q.impressions.toLocaleString()} impressions) but no page ranks well — write a dedicated article.`,
        score: q.impressions * 0.5,
        library: null,
      })
    }
  }

  const currentByPage = new Map((input.pagesCurrent || []).map((p) => [p.page, p]))
  for (const p of input.pagesCurrent || []) {
    const impressions = Number(p.impressions) || 0
    const clicks = Number(p.clicks) || 0
    const position = Number(p.position)
    const expected = expectedCtr(position)
    const ctr = impressions > 0 ? clicks / impressions : 0
    if (expected && position <= 10 && impressions >= Math.max(50, days * 3) && ctr < expected * 0.5) {
      out.low_ctr.push({
        type: 'low_ctr',
        query: topQueryByPage.get(p.page)?.query || null,
        page: p.page,
        action: 'meta',
        metrics: { impressions, clicks, position, ctr, expectedCtr: expected },
        reason: `CTR ${(ctr * 100).toFixed(1)}% vs ~${(expected * 100).toFixed(0)}% typical at #${position.toFixed(
          1
        )} — rewrite the title and description.`,
        score: impressions * (expected - ctr),
        library: lib(p.page),
      })
    }
  }

  for (const prev of input.pagesPrevious || []) {
    const before = Number(prev.clicks) || 0
    if (before < 10) continue
    const now = Number(currentByPage.get(prev.page)?.clicks) || 0
    if (now <= before * 0.7) {
      out.decaying.push({
        type: 'decaying',
        query: topQueryByPage.get(prev.page)?.query || null,
        page: prev.page,
        action: 'modify',
        metrics: { clicks: now, prevClicks: before, change: before > 0 ? (now - before) / before : null },
        reason: `Clicks fell from ${before.toLocaleString()} to ${now.toLocaleString()} vs the previous period — refresh it.`,
        score: before - now,
        library: lib(prev.page),
      })
    }
  }

  for (const check of input.aiChecks || []) {
    if (!check?.has_ai_overview || check.cited) continue
    const page = check.organic_url || null
    const competitors = Array.isArray(check.competitors_cited) ? check.competitors_cited : []
    const others = Array.isArray(check.cited_domains) ? check.cited_domains.slice(0, 3) : []
    out.ai_gap.push({
      type: 'ai_gap',
      query: check.keyword,
      page,
      action: page ? 'modify' : 'idea',
      metrics: { position: check.organic_position ?? null },
      reason: competitors.length
        ? `AI Overview cites ${competitors.join(', ')} — not you.`
        : others.length
          ? `AI Overview cites ${others.join(', ')} — not you.`
          : 'Google shows an AI Overview and does not cite you.',
      score: page ? 2 : 1,
      library: lib(page),
    })
  }

  for (const type of OPPORTUNITY_TYPES) {
    out[type] = out[type].sort((a, b) => b.score - a.score).slice(0, PER_TYPE)
  }
  return out
}
