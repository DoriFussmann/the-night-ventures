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

export async function keywordData({ keywords, keyword }) {
  const list = Array.isArray(keywords)
    ? keywords.map((k) => String(k || '').trim()).filter(Boolean)
    : []
  if (keyword && String(keyword).trim()) list.unshift(String(keyword).trim())
  const unique = [...new Set(list)].slice(0, 20)
  if (unique.length === 0) return unavailable('keyword or keywords required')

  const result = await dfsPost('/v3/keywords_data/google_ads/search_volume/live', {
    keywords: unique,
    location_code: LOCATION_CODE,
    language_code: LANGUAGE_CODE,
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

export async function serpResults({ keyword, depth = 10 }) {
  const phrase = String(keyword || '').trim()
  if (!phrase) return unavailable('keyword is required')

  const result = await dfsPost('/v3/serp/google/organic/live/regular', {
    keyword: phrase,
    location_code: LOCATION_CODE,
    language_code: LANGUAGE_CODE,
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

export const dataforseoTools = {
  keywordData,
  serpResults,
  backlinksSummary,
  onPageAudit,
}
