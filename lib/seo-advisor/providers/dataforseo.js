import { markProviderFailure, markProviderSuccess } from '../health.js'

const TIMEOUT_MS = 30000
const LOCATION_CODE = 2840
const LANGUAGE_CODE = 'en'

function unavailable(reason) {
  return { available: false, provider: 'dataforseo', reason: String(reason || 'unavailable') }
}

function normalizeDomain(value) {
  let d = String(value || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  return d.replace(/\.$/, '')
}

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) return null
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

async function dfsPost(path, task) {
  const auth = authHeader()
  if (!auth) return unavailable('DATAFORSEO_LOGIN/PASSWORD not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.dataforseo.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([task]),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      markProviderFailure('dataforseo', `HTTP ${res.status}`)
      return unavailable(`DataForSEO HTTP ${res.status}`)
    }
    if (!data || data.status_code !== 20000) {
      markProviderFailure('dataforseo', data?.status_message || 'top-level error')
      return unavailable(data?.status_message || `status_code ${data?.status_code}`)
    }
    const taskResult = Array.isArray(data.tasks) ? data.tasks[0] : null
    if (!taskResult || taskResult.status_code !== 20000) {
      markProviderFailure(
        'dataforseo',
        taskResult?.status_message || 'task error'
      )
      return unavailable(
        taskResult?.status_message || `task status ${taskResult?.status_code}`
      )
    }
    markProviderSuccess('dataforseo')
    return { available: true, provider: 'dataforseo', taskResult }
  } catch (err) {
    const msg =
      err?.name === 'AbortError' ? 'DataForSEO request timed out' : err?.message
    markProviderFailure('dataforseo', msg)
    return unavailable(msg)
  } finally {
    clearTimeout(timer)
  }
}

export async function keywordData({
  keywords,
  keyword,
  locationCode = LOCATION_CODE,
  languageCode = LANGUAGE_CODE,
}) {
  const list = Array.isArray(keywords)
    ? keywords.map((k) => String(k || '').trim()).filter(Boolean)
    : []
  if (keyword && String(keyword).trim()) list.unshift(String(keyword).trim())
  const unique = [...new Set(list)].slice(0, 20)
  if (unique.length === 0) return unavailable('keyword or keywords required')

  const result = await dfsPost('/v3/keywords_data/google_ads/search_volume/live', {
    keywords: unique,
    location_code: locationCode,
    language_code: languageCode,
  })
  if (!result.available) return result

  const items = Array.isArray(result.taskResult.result) ? result.taskResult.result : []
  return {
    available: true,
    provider: 'dataforseo',
    report: 'keyword_data',
    keywords: items.map((item) => ({
      keyword: item?.keyword ?? null,
      searchVolume: item?.search_volume ?? null,
      competition: item?.competition ?? null,
      competitionIndex: item?.competition_index ?? null,
      cpc: item?.cpc ?? null,
      monthlySearches: item?.monthly_searches ?? null,
    })),
  }
}

function mapKeywordInfo(keyword, info = {}) {
  const competition =
    typeof info.competition === 'number' && Number.isFinite(info.competition)
      ? info.competition
      : null
  const competitionIndex =
    typeof info.competition_index === 'number' && Number.isFinite(info.competition_index)
      ? info.competition_index
      : competition != null
        ? Math.round(competition * 100)
        : null
  return {
    keyword,
    searchVolume:
      typeof info.search_volume === 'number' && Number.isFinite(info.search_volume)
        ? info.search_volume
        : null,
    competition,
    competitionLevel:
      typeof info.competition_level === 'string' ? info.competition_level : null,
    competitionIndex,
    cpc: typeof info.cpc === 'number' && Number.isFinite(info.cpc) ? info.cpc : null,
  }
}

/**
 * Full-text keyword suggestions containing the seed phrase.
 * Endpoint: /v3/dataforseo_labs/google/keyword_suggestions/live
 */
export async function keywordSuggestions({
  keyword,
  limit = 80,
  locationCode = LOCATION_CODE,
  languageCode = LANGUAGE_CODE,
}) {
  const seed = String(keyword || '').trim()
  if (!seed) return unavailable('keyword is required')

  const result = await dfsPost('/v3/dataforseo_labs/google/keyword_suggestions/live', {
    keyword: seed,
    location_code: locationCode,
    language_code: languageCode,
    include_seed_keyword: true,
    limit: Math.min(Math.max(Number(limit) || 80, 1), 200),
    order_by: ['keyword_info.search_volume,desc'],
    filters: ['keyword_info.search_volume', '>', 0],
  })
  if (!result.available) return result

  const result0 = Array.isArray(result.taskResult.result)
    ? result.taskResult.result[0]
    : null
  const items = Array.isArray(result0?.items) ? result0.items : []

  return {
    available: true,
    provider: 'dataforseo',
    report: 'keyword_suggestions',
    keyword: seed,
    keywords: items
      .map((item) => {
        const kw = typeof item?.keyword === 'string' ? item.keyword.trim() : ''
        if (!kw) return null
        return mapKeywordInfo(kw, item?.keyword_info || {})
      })
      .filter(Boolean),
  }
}

/**
 * Related keywords from Google "Searches related to".
 * Endpoint: /v3/dataforseo_labs/google/related_keywords/live
 */
export async function relatedKeywords({
  keyword,
  limit = 60,
  depth = 2,
  locationCode = LOCATION_CODE,
  languageCode = LANGUAGE_CODE,
}) {
  const seed = String(keyword || '').trim()
  if (!seed) return unavailable('keyword is required')

  const result = await dfsPost('/v3/dataforseo_labs/google/related_keywords/live', {
    keyword: seed,
    location_code: locationCode,
    language_code: languageCode,
    include_seed_keyword: true,
    depth: Math.min(Math.max(Number(depth) || 2, 1), 4),
    limit: Math.min(Math.max(Number(limit) || 60, 1), 200),
    order_by: ['keyword_data.keyword_info.search_volume,desc'],
    filters: ['keyword_data.keyword_info.search_volume', '>', 0],
  })
  if (!result.available) return result

  const result0 = Array.isArray(result.taskResult.result)
    ? result.taskResult.result[0]
    : null
  const items = Array.isArray(result0?.items) ? result0.items : []

  return {
    available: true,
    provider: 'dataforseo',
    report: 'related_keywords',
    keyword: seed,
    keywords: items
      .map((item) => {
        const data = item?.keyword_data || {}
        const kw = typeof data.keyword === 'string' ? data.keyword.trim() : ''
        if (!kw) return null
        return mapKeywordInfo(kw, data.keyword_info || {})
      })
      .filter(Boolean),
  }
}

export async function serpResults({
  keyword,
  depth = 10,
  locationCode = LOCATION_CODE,
  languageCode = LANGUAGE_CODE,
}) {
  const phrase = String(keyword || '').trim()
  if (!phrase) return unavailable('keyword is required')

  const result = await dfsPost('/v3/serp/google/organic/live/regular', {
    keyword: phrase,
    location_code: locationCode,
    language_code: languageCode,
    depth: Math.min(Number(depth) || 10, 50),
  })
  if (!result.available) return result

  const result0 = Array.isArray(result.taskResult.result)
    ? result.taskResult.result[0]
    : null
  const items = Array.isArray(result0?.items) ? result0.items : []

  return {
    available: true,
    provider: 'dataforseo',
    report: 'serp_results',
    keyword: phrase,
    items: items
      .filter((item) => item?.type === 'organic' || item?.url)
      .slice(0, 20)
      .map((item) => ({
        type: item.type || 'organic',
        rank: item.rank_absolute ?? item.rank_group ?? null,
        title: item.title ?? null,
        url: item.url ?? null,
        domain: item.domain ?? null,
        description: item.description ?? null,
      })),
  }
}

export async function backlinksSummary({ target, domain }) {
  const t = normalizeDomain(target || domain)
  if (!t) return unavailable('target/domain is required')

  const result = await dfsPost('/v3/backlinks/summary/live', {
    target: t,
    internal_list_limit: 10,
    backlinks_status_type: 'live',
  })
  if (!result.available) return result

  const summary = Array.isArray(result.taskResult.result)
    ? result.taskResult.result[0]
    : null

  return {
    available: true,
    provider: 'dataforseo',
    report: 'backlinks_summary',
    target: t,
    summary: {
      rank: summary?.rank ?? null,
      backlinks: summary?.backlinks ?? null,
      referringDomains: summary?.referring_domains ?? null,
      referringMainDomains: summary?.referring_main_domains ?? null,
      referringIps: summary?.referring_ips ?? null,
      referringPages: summary?.referring_pages ?? null,
      brokenBacklinks: summary?.broken_backlinks ?? null,
      referringDomainsNofollow: summary?.referring_domains_nofollow ?? null,
    },
  }
}

export async function onPageAudit({ url, domain }) {
  let targetUrl = String(url || '').trim()
  if (!targetUrl && domain) {
    const d = normalizeDomain(domain)
    targetUrl = d ? `https://${d}` : ''
  }
  if (!targetUrl) return unavailable('url or domain is required')
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`

  const result = await dfsPost('/v3/on_page/instant_pages', {
    url: targetUrl,
    enable_javascript: false,
    load_resources: false,
  })
  if (!result.available) return result

  const page = Array.isArray(result.taskResult.result)
    ? result.taskResult.result[0]
    : null
  const meta = page?.meta || {}
  const checks = page?.checks || {}
  const pageTiming = page?.page_timing || {}

  const issues = []
  if (checks.no_title) issues.push({ severity: 'high', issue: 'Missing title tag' })
  if (checks.no_description) issues.push({ severity: 'medium', issue: 'Missing meta description' })
  if (checks.is_4xx_code || checks.is_5xx_code) {
    issues.push({ severity: 'high', issue: `HTTP status ${page?.status_code}` })
  }
  if (checks.https_to_http_links) {
    issues.push({ severity: 'medium', issue: 'HTTPS page links to HTTP resources' })
  }
  if (checks.has_render_blocking_resources) {
    issues.push({ severity: 'low', issue: 'Render-blocking resources detected' })
  }
  if (meta?.title && String(meta.title).length > 60) {
    issues.push({ severity: 'low', issue: 'Title longer than ~60 characters' })
  }

  return {
    available: true,
    provider: 'dataforseo',
    report: 'on_page_audit',
    url: targetUrl,
    statusCode: page?.status_code ?? null,
    meta: {
      title: meta.title ?? null,
      description: meta.description ?? null,
      canonical: meta.canonical ?? null,
      h1: Array.isArray(meta.htags?.h1) ? meta.htags.h1[0] : null,
    },
    timing: {
      timeToInteractive: pageTiming.time_to_interactive ?? null,
      domComplete: pageTiming.dom_complete ?? null,
      durationTime: pageTiming.duration_time ?? null,
    },
    onpageScore: page?.onpage_score ?? null,
    issues,
    checksSummary: {
      isHttps: checks.is_https ?? null,
      hasHtmlDoctype: checks.has_html_doctype ?? null,
      size: page?.size ?? null,
    },
  }
}

/**
 * Keyword difficulty (0–100) for up to 100 keywords.
 * Endpoint: /v3/dataforseo_labs/google/bulk_keyword_difficulty/live
 */
export async function keywordDifficulty({
  keywords,
  keyword,
  locationCode = LOCATION_CODE,
  languageCode = LANGUAGE_CODE,
}) {
  const list = Array.isArray(keywords)
    ? keywords.map((k) => String(k || '').trim()).filter(Boolean)
    : []
  if (keyword && String(keyword).trim()) list.unshift(String(keyword).trim())
  const unique = [...new Set(list)].slice(0, 100)
  if (unique.length === 0) return unavailable('keyword or keywords required')

  const result = await dfsPost('/v3/dataforseo_labs/google/bulk_keyword_difficulty/live', {
    keywords: unique,
    location_code: locationCode,
    language_code: languageCode,
  })
  if (!result.available) return result

  const result0 = Array.isArray(result.taskResult.result)
    ? result.taskResult.result[0]
    : null
  const items = Array.isArray(result0?.items) ? result0.items : []
  return {
    available: true,
    provider: 'dataforseo',
    report: 'keyword_difficulty',
    keywords: items.map((item) => ({
      keyword: item?.keyword ?? null,
      keywordDifficulty:
        typeof item?.keyword_difficulty === 'number' ? item.keyword_difficulty : null,
    })),
  }
}

export const dataforseoTools = {
  keywordData,
  keywordSuggestions,
  relatedKeywords,
  keywordDifficulty,
  serpResults,
  backlinksSummary,
  onPageAudit,
}
