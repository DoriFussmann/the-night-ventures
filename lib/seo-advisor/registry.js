/**
 * SEO data capability registry — the ONE place that declares what data the
 * Advisor can get and from where.
 *
 * Everything else is generated from this file:
 *   - the data agent's catalog + tool schemas (router.js)
 *   - the health intro on the Advisor page (liveHealth.js)
 *   - the contract check script (scripts/check-seo-advisor-contracts.mjs)
 *
 * Adding an endpoint = add a provider function + one entry below. If it isn't
 * here, the agent can't see it. If it's here, it's wired. No separate doc to
 * drift out of sync. See docs/SEO_ADVISOR.md.
 */
import { semrushTools } from './providers/semrush.js'
import { dataforseoTools } from './providers/dataforseo.js'
import { mozTools } from './providers/moz.js'

/** Review vendor docs against the entries below at least this often. */
export const DOCS_STALE_AFTER_DAYS = 90

export const PROVIDERS = {
  semrush: {
    id: 'semrush',
    name: 'Semrush',
    docsUrl: 'https://developer.semrush.com/api/v3/analytics/',
    docsVerifiedAt: '2026-09-27',
    envKeys: ['SEMRUSH_API_KEY'],
    strengths: 'US keyword volume + 12-mo trend, organic KD, domain organic footprint, organic competitors',
  },
  dataforseo: {
    id: 'dataforseo',
    name: 'DataForSEO',
    docsUrl: 'https://docs.dataforseo.com/v3/',
    docsVerifiedAt: '2026-09-27',
    envKeys: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    strengths: 'Bulk Google Ads volume with monthly history, keyword ideas, organic KD in bulk, live SERP, backlinks, on-page',
  },
  moz: {
    id: 'moz',
    name: 'Moz',
    docsUrl: 'https://moz.com/api/docs',
    docsVerifiedAt: '2026-09-27',
    envKeys: ['MOZ_API_TOKEN'],
    strengths: 'Domain Authority / Page Authority, spam score, linking root domains',
  },
}

// ---------------------------------------------------------------------------
// helpers

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const kwKey = (k) => String(k || '').trim().toLowerCase()

/** Compare the latest 3 points with the earliest 3 points of a series. */
export function trendFromSeries(values, basis) {
  const series = (values || []).map(num).filter((v) => v != null)
  if (series.length < 6) return null
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length
  const early = avg(series.slice(0, 3))
  const late = avg(series.slice(-3))
  if (early <= 0) return late > 0 ? { direction: 'rising', changePct: null, basis } : null
  const changePct = Math.round(((late - early) / early) * 100)
  const direction = changePct >= 15 ? 'rising' : changePct <= -15 ? 'falling' : 'flat'
  return { direction, changePct, basis }
}

/** DataForSEO monthly_searches: [{year, month, search_volume}] (newest first). */
function trendFromMonthly(monthly) {
  if (!Array.isArray(monthly) || monthly.length < 6) return null
  const sorted = [...monthly].sort(
    (a, b) => a.year * 12 + a.month - (b.year * 12 + b.month)
  )
  return trendFromSeries(
    sorted.map((m) => m.search_volume),
    `last 3 mo vs first 3 of ${sorted.length} mo (Google Ads)`
  )
}

/** Semrush Td: "0.81,1.00,..." — 12 normalized monthly values, oldest first. */
function trendFromSemrushTd(td) {
  if (!td) return null
  return trendFromSeries(String(td).split(','), 'last 3 mo vs first 3 of 12 mo (Semrush)')
}

const top = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : [])

// ---------------------------------------------------------------------------
// endpoint catalog
//
// answers: which kinds of data questions this endpoint answers. The data agent
// sees these; keep them honest.
// compact(result): lean payload handed back to the Advisor (token budget).
// metrics(result): [{ keyword, searchVolume?, keywordDifficulty?, trend? }]
//   used to verify numbers shown on keyword proposal cards.
// probe: { args, check(result) } for scripts/check-seo-advisor-contracts.mjs.

export const ENDPOINTS = [
  // ---------------- volume / trend
  {
    id: 'dataforseo_keyword_data',
    provider: 'dataforseo',
    label: 'Keyword volume + 12-mo history (bulk)',
    answers: ['volume', 'trend', 'cpc'],
    description:
      'Google Ads monthly search volume, 12-month history, CPC and PAID ads competition for up to 20 exact keywords. Best first call for "how many people search X, Y, Z" and trend. competition here is ads competition, NOT organic difficulty.',
    docsUrl: 'https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, description: 'Up to 20 keywords' },
      },
      required: ['keywords'],
    },
    run: (a) => dataforseoTools.keywordData(a),
    metrics: (r) =>
      (r.keywords || []).map((k) => ({
        keyword: k.keyword,
        searchVolume: num(k.searchVolume),
        trend: trendFromMonthly(k.monthlySearches),
      })),
    compact: (r) => ({
      keywords: (r.keywords || []).map((k) => ({
        keyword: k.keyword,
        volume: num(k.searchVolume),
        trend: trendFromMonthly(k.monthlySearches),
        cpc: num(k.cpc),
        adsCompetition: k.competition ?? null,
      })),
    }),
    probe: {
      args: { keywords: ['running shoes'] },
      check: (r) => Array.isArray(r.keywords) && r.keywords.length > 0 && 'searchVolume' in r.keywords[0],
    },
  },
  {
    id: 'semrush_keyword_research',
    provider: 'semrush',
    label: 'Keyword overview + related terms',
    answers: ['volume', 'trend', 'related_keywords', 'cpc'],
    description:
      'Semrush US volume, CPC and 12-month trend for ONE seed phrase plus up to 50 related phrases with volume. Good for expanding a topic from a single seed. "competition" is paid competition, NOT organic difficulty.',
    docsUrl: 'https://developer.semrush.com/api/v3/analytics/keyword-reports/',
    cost: 'medium',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        limit: { type: 'number', description: 'Related phrases to return (default 20, max 50)' },
      },
      required: ['keyword'],
    },
    run: (a) => semrushTools.keywordResearch(a),
    metrics: (r) => [
      ...(r.overview
        ? [
            {
              keyword: r.overview.keyword,
              searchVolume: num(r.overview.searchVolume),
              trend: trendFromSemrushTd(r.overview.trend),
            },
          ]
        : []),
      ...(r.related || []).map((k) => ({ keyword: k.keyword, searchVolume: num(k.searchVolume) })),
    ],
    compact: (r) => ({
      seed: r.overview
        ? {
            keyword: r.overview.keyword,
            volume: num(r.overview.searchVolume),
            trend: trendFromSemrushTd(r.overview.trend),
            cpc: num(r.overview.cpc),
          }
        : null,
      related: top(r.related, 25).map((k) => ({ keyword: k.keyword, volume: num(k.searchVolume) })),
    }),
    probe: {
      args: { keyword: 'running shoes', limit: 3 },
      check: (r) => r.overview && 'searchVolume' in r.overview,
    },
  },

  // ---------------- keyword ideas
  {
    id: 'dataforseo_keyword_suggestions',
    provider: 'dataforseo',
    label: 'Keyword ideas containing a seed',
    answers: ['related_keywords', 'volume'],
    description:
      'Long-tail keywords that CONTAIN the seed phrase, sorted by volume (e.g. "off grid" → "off grid solar system", "off grid cabin"). Use to size a topic and find cluster candidates.',
    docsUrl: 'https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live/',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        limit: { type: 'number', description: 'default 50, max 200' },
      },
      required: ['keyword'],
    },
    run: (a) => dataforseoTools.keywordSuggestions({ limit: 50, ...a }),
    metrics: (r) =>
      (r.keywords || []).map((k) => ({ keyword: k.keyword, searchVolume: num(k.searchVolume) })),
    compact: (r) => ({
      seed: r.keyword,
      totalFound: (r.keywords || []).length,
      totalVolume: (r.keywords || []).reduce((s, k) => s + (num(k.searchVolume) || 0), 0),
      keywords: top(r.keywords, 30).map((k) => ({ keyword: k.keyword, volume: num(k.searchVolume) })),
    }),
    probe: {
      args: { keyword: 'running shoes', limit: 3 },
      check: (r) => Array.isArray(r.keywords),
    },
  },
  {
    id: 'dataforseo_related_keywords',
    provider: 'dataforseo',
    label: 'Semantically related keywords',
    answers: ['related_keywords', 'volume'],
    description:
      'Keywords from Google "searches related to" — semantically adjacent terms that do NOT need to contain the seed. Use to find distinct sub-topics (candidate core keywords) around an idea.',
    docsUrl: 'https://docs.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live/',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        limit: { type: 'number', description: 'default 60, max 200' },
      },
      required: ['keyword'],
    },
    run: (a) => dataforseoTools.relatedKeywords(a),
    metrics: (r) =>
      (r.keywords || []).map((k) => ({ keyword: k.keyword, searchVolume: num(k.searchVolume) })),
    compact: (r) => ({
      seed: r.keyword,
      keywords: top(r.keywords, 30).map((k) => ({ keyword: k.keyword, volume: num(k.searchVolume) })),
    }),
    probe: {
      args: { keyword: 'running shoes', limit: 3 },
      check: (r) => Array.isArray(r.keywords),
    },
  },

  // ---------------- organic difficulty
  {
    id: 'dataforseo_keyword_difficulty',
    provider: 'dataforseo',
    label: 'Organic keyword difficulty (bulk)',
    answers: ['difficulty'],
    description:
      'Organic keyword difficulty 0–100 (how hard to reach the top 10) for up to 100 keywords in one call. Preferred source for difficulty.',
    docsUrl: 'https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, description: 'Up to 100 keywords' },
      },
      required: ['keywords'],
    },
    run: (a) => dataforseoTools.bulkKeywordDifficulty(a),
    metrics: (r) =>
      (r.keywords || []).map((k) => ({ keyword: k.keyword, keywordDifficulty: num(k.keywordDifficulty) })),
    compact: (r) => ({
      keywords: (r.keywords || []).map((k) => ({ keyword: k.keyword, kd: num(k.keywordDifficulty) })),
    }),
    probe: {
      args: { keywords: ['running shoes'] },
      check: (r) => Array.isArray(r.keywords) && r.keywords.length > 0 && 'keywordDifficulty' in r.keywords[0],
    },
  },
  {
    id: 'semrush_keyword_difficulty',
    provider: 'semrush',
    label: 'Organic keyword difficulty (Semrush)',
    answers: ['difficulty'],
    description:
      'Semrush organic Keyword Difficulty 0–100 for up to 100 phrases. Use when DataForSEO is down or a second opinion is needed.',
    docsUrl: 'https://developer.semrush.com/api/v3/analytics/keyword-reports/#keyword-difficulty',
    cost: 'medium',
    input_schema: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' } },
      },
      required: ['keywords'],
    },
    run: (a) => semrushTools.keywordDifficulty(a),
    metrics: (r) =>
      (r.keywords || []).map((k) => ({ keyword: k.keyword, keywordDifficulty: num(k.keywordDifficulty) })),
    compact: (r) => ({
      keywords: (r.keywords || []).map((k) => ({ keyword: k.keyword, kd: num(k.keywordDifficulty) })),
    }),
    probe: {
      args: { keywords: ['running shoes'] },
      check: (r) => Array.isArray(r.keywords) && r.keywords.length > 0,
    },
  },

  // ---------------- competition / SERP
  {
    id: 'dataforseo_serp_results',
    provider: 'dataforseo',
    label: 'Live Google top 10',
    answers: ['serp', 'competition', 'intent'],
    description:
      'Who ranks right now for ONE keyword (live Google US organic results). Use to judge what we are up against, dominant intent (guides vs products vs forums), and weak spots (Reddit/Quora/thin pages in top 10).',
    docsUrl: 'https://docs.dataforseo.com/v3/serp/google/organic/live/regular/',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        depth: { type: 'number', description: 'default 10' },
      },
      required: ['keyword'],
    },
    run: (a) => dataforseoTools.serpResults(a),
    metrics: () => [],
    compact: (r) => ({
      keyword: r.keyword,
      top: top(r.items, 10).map((i) => ({ rank: i.rank, domain: i.domain, title: i.title })),
    }),
    probe: {
      args: { keyword: 'running shoes', depth: 10 },
      check: (r) => Array.isArray(r.items) && r.items.length > 0 && 'domain' in r.items[0],
    },
  },
  {
    id: 'moz_domain_metrics',
    provider: 'moz',
    label: 'Domain Authority',
    answers: ['authority', 'competition'],
    description:
      'Moz Domain Authority, Page Authority, spam score and linking root domains for ONE domain. Call it on the strongest 2–3 SERP domains (or our own domain) to judge whether a new site can compete.',
    docsUrl: 'https://moz.com/api/docs/links/url-metrics',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
    },
    run: (a) => mozTools.domainMetrics(a),
    metrics: () => [],
    compact: (r) => ({ domain: r.target, ...r.metrics }),
    probe: {
      args: { domain: 'moz.com' },
      check: (r) => r.metrics && 'domainAuthority' in r.metrics,
    },
  },
  {
    id: 'semrush_competitors_research',
    provider: 'semrush',
    label: 'Organic competitors of a domain',
    answers: ['competitors'],
    description: 'Domains competing with a given domain for the same organic keywords.',
    docsUrl: 'https://developer.semrush.com/api/v3/analytics/domain-reports/#competitors-in-organic-search',
    cost: 'medium',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string' }, limit: { type: 'number' } },
      required: ['domain'],
    },
    run: (a) => semrushTools.competitorsResearch(a),
    metrics: () => [],
    compact: (r) => ({
      domain: r.domain,
      competitors: top(r.competitors, 12).map((c) => ({
        domain: c.domain,
        commonKeywords: num(c.commonKeywords),
        organicTraffic: num(c.organicTraffic),
      })),
    }),
    probe: {
      args: { domain: 'nike.com', limit: 3 },
      check: (r) => Array.isArray(r.competitors),
    },
  },

  // ---------------- domain footprint
  {
    id: 'semrush_domain_overview',
    provider: 'semrush',
    label: 'Domain organic footprint',
    answers: ['domain_footprint'],
    description: 'How big a domain is in organic search: ranking keywords, estimated traffic, rank.',
    docsUrl: 'https://developer.semrush.com/api/v3/analytics/domain-reports/#domain-overview-one-database',
    cost: 'medium',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
    },
    run: (a) => semrushTools.domainOverview(a),
    metrics: () => [],
    compact: (r) => ({ domain: r.domain, ...r.metrics }),
    probe: {
      args: { domain: 'nike.com' },
      check: (r) => r.metrics && 'organicKeywords' in r.metrics,
    },
  },
  {
    id: 'semrush_organic_research',
    provider: 'semrush',
    label: 'Top keywords a domain ranks for',
    answers: ['domain_keywords', 'difficulty', 'volume'],
    description:
      'The keywords and URLs driving organic traffic to a domain, with position, volume and KD. Use to reverse-engineer what a competitor wins on.',
    docsUrl: 'https://developer.semrush.com/api/v3/analytics/domain-reports/#domain-organic-search-keywords',
    cost: 'high',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string' }, limit: { type: 'number' } },
      required: ['domain'],
    },
    run: (a) => semrushTools.organicResearch(a),
    metrics: (r) =>
      (r.keywords || []).map((k) => ({
        keyword: k.keyword,
        searchVolume: num(k.searchVolume),
        keywordDifficulty: num(k.keywordDifficulty),
      })),
    compact: (r) => ({
      domain: r.domain,
      keywords: top(r.keywords, 20).map((k) => ({
        keyword: k.keyword,
        position: num(k.position),
        volume: num(k.searchVolume),
        kd: num(k.keywordDifficulty),
        url: k.url,
      })),
    }),
    probe: {
      args: { domain: 'nike.com', limit: 3 },
      check: (r) => Array.isArray(r.keywords),
    },
  },

  // ---------------- links / technical
  {
    id: 'dataforseo_backlinks_summary',
    provider: 'dataforseo',
    label: 'Backlink profile summary',
    answers: ['backlinks', 'authority'],
    description: 'Backlinks and referring domains for a domain or URL.',
    docsUrl: 'https://docs.dataforseo.com/v3/backlinks/summary/live/',
    cost: 'medium',
    input_schema: {
      type: 'object',
      properties: { target: { type: 'string', description: 'Domain or URL' } },
      required: ['target'],
    },
    run: (a) => dataforseoTools.backlinksSummary(a),
    metrics: () => [],
    compact: (r) => ({ target: r.target, ...r.summary }),
    probe: {
      args: { target: 'moz.com' },
      check: (r) => r.summary && 'referringDomains' in r.summary,
    },
  },
  {
    id: 'moz_link_data',
    provider: 'moz',
    label: 'Top linking root domains',
    answers: ['backlinks'],
    description: 'Strongest root domains linking to a target domain (by DA).',
    docsUrl: 'https://moz.com/api/docs/links/linking-root-domains',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string' }, limit: { type: 'number' } },
      required: ['domain'],
    },
    run: (a) => mozTools.linkData(a),
    metrics: () => [],
    compact: (r) => ({ target: r.target, linkingRootDomains: top(r.linkingRootDomains, 10) }),
    probe: {
      args: { domain: 'moz.com', limit: 2 },
      check: (r) => Array.isArray(r.linkingRootDomains),
    },
  },
  {
    id: 'dataforseo_onpage_audit',
    provider: 'dataforseo',
    label: 'On-page check of one URL',
    answers: ['technical'],
    description: 'Title, meta, status code, obvious technical issues for ONE URL.',
    docsUrl: 'https://docs.dataforseo.com/v3/on_page/instant_pages/',
    cost: 'low',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    run: (a) => dataforseoTools.onPageAudit(a),
    metrics: () => [],
    compact: (r) => ({ url: r.url, statusCode: r.statusCode, meta: r.meta, onpageScore: r.onpageScore, issues: r.issues }),
    probe: {
      args: { url: 'https://example.com' },
      check: (r) => 'statusCode' in r,
    },
  },
]

// Moz keyword metrics exists in providers/moz.js but is plan-dependent and
// frequently unavailable; intentionally NOT registered. Add it here when the
// Moz plan includes it.

const BY_ID = new Map(ENDPOINTS.map((e) => [e.id, e]))

export function getEndpoint(id) {
  return BY_ID.get(id) || null
}

export function endpointsForProvider(providerId) {
  return ENDPOINTS.filter((e) => e.provider === providerId)
}

export function providerLabel(providerId) {
  return PROVIDERS[providerId]?.name || providerId
}

export function docsAgeDays(provider, now = Date.now()) {
  const t = Date.parse(provider?.docsVerifiedAt || '')
  if (!Number.isFinite(t)) return null
  return Math.floor((now - t) / 86400000)
}

export function isDocsStale(provider, now = Date.now()) {
  const age = docsAgeDays(provider, now)
  return age == null || age > DOCS_STALE_AFTER_DAYS
}

/**
 * Catalog text for the data agent. Generated, never hand-written.
 * @param {Record<string, {ok?: boolean|null}>} health
 */
export function catalogForAgent(health = {}) {
  const lines = []
  for (const provider of Object.values(PROVIDERS)) {
    const h = health[provider.id]
    const status = h?.ok === false ? 'DEGRADED (last call failed — prefer another provider)' : 'up'
    lines.push(`## ${provider.name} [${status}] — ${provider.strengths}`)
    for (const e of endpointsForProvider(provider.id)) {
      lines.push(`- ${e.id} (cost ${e.cost}; answers: ${e.answers.join(', ')}): ${e.description}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** Anthropic tool definitions for the data agent. */
export function agentToolDefinitions() {
  return ENDPOINTS.map((e) => ({
    name: e.id,
    description: `[${providerLabel(e.provider)}] ${e.description}`,
    input_schema: e.input_schema,
  }))
}

/** Pull verified keyword metrics out of an endpoint result. */
export function extractMetrics(endpointId, result) {
  const e = getEndpoint(endpointId)
  if (!e || !result || result.available === false) return []
  try {
    return (e.metrics(result) || [])
      .filter((m) => m && m.keyword)
      .map((m) => ({ ...m, source: endpointId }))
  } catch {
    return []
  }
}

/**
 * Merge metric rows into an index keyed by lowercase keyword.
 * Difficulty only ever comes from organic-KD sources (never ads competition).
 */
export function mergeMetrics(index, rows) {
  for (const m of rows || []) {
    const key = kwKey(m.keyword)
    if (!key) continue
    const prev = index.get(key) || { keyword: m.keyword, sources: [] }
    const next = { ...prev }
    if (m.searchVolume != null && next.searchVolume == null) next.searchVolume = m.searchVolume
    if (m.keywordDifficulty != null && next.keywordDifficulty == null)
      next.keywordDifficulty = m.keywordDifficulty
    if (m.trend && !next.trend) next.trend = m.trend
    if (m.source && !next.sources.includes(m.source)) next.sources = [...next.sources, m.source]
    index.set(key, next)
  }
  return index
}

export function lookupMetrics(index, keyword) {
  return index.get(kwKey(keyword)) || null
}
