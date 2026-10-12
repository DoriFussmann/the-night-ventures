import { markProviderFailure, markProviderSuccess } from '../health.js'

const TIMEOUT_MS = 25000

function unavailable(reason) {
  return { available: false, provider: 'moz', reason: String(reason || 'unavailable') }
}

function normalizeDomain(value) {
  let d = String(value || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  return d.replace(/\.$/, '')
}

/** Build auth headers: prefer x-moz-token; also accept legacy AccessID:SecretKey (plain or base64). */
function mozAuthHeaders() {
  const token = String(process.env.MOZ_API_TOKEN || '').trim()
  const accessId = String(process.env.MOZ_ACCESS_ID || '').trim()
  const secretKey = String(process.env.MOZ_SECRET_KEY || '').trim()

  if (accessId && secretKey) {
    const basic = Buffer.from(`${accessId}:${secretKey}`).toString('base64')
    return { Authorization: `Basic ${basic}` }
  }

  if (!token) return null

  // Legacy Mozscape credentials are often stored base64(AccessID:SecretKey)
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8')
    if (decoded.includes(':') && decoded.length < 200) {
      return { Authorization: `Basic ${token}` }
    }
  } catch {
    // ignore
  }

  if (token.includes(':')) {
    return { Authorization: `Basic ${Buffer.from(token).toString('base64')}` }
  }

  return { 'x-moz-token': token }
}

async function mozPost(path, body) {
  const auth = mozAuthHeaders()
  if (!auth) return unavailable('MOZ_API_TOKEN not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://lsapi.seomoz.com/v2/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      markProviderFailure('moz', `HTTP ${res.status}`)
      return unavailable(
        data?.message || data?.error || `Moz HTTP ${res.status}`
      )
    }
    markProviderSuccess('moz')
    return { available: true, provider: 'moz', data }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Moz request timed out' : err?.message
    markProviderFailure('moz', msg)
    return unavailable(msg)
  } finally {
    clearTimeout(timer)
  }
}

export async function domainMetrics({ domain, url }) {
  const target = normalizeDomain(url || domain)
  if (!target) return unavailable('domain is required')

  const result = await mozPost('url_metrics', { targets: [target] })
  if (!result.available) return result

  const results = Array.isArray(result.data?.results) ? result.data.results : []
  const row = results[0] || {}

  return {
    available: true,
    provider: 'moz',
    report: 'domain_metrics',
    target,
    metrics: {
      domainAuthority: row.domain_authority ?? null,
      pageAuthority: row.page_authority ?? null,
      spamScore: row.spam_score ?? null,
      rootDomainsToRootDomain: row.root_domains_to_root_domain ?? null,
      externalPagesToRootDomain: row.external_pages_to_root_domain ?? null,
      linkPropensity: row.link_propensity ?? null,
    },
  }
}

/** Keyword metrics via Moz JSON-RPC when available; otherwise clear unavailable. */
export async function keywordMetrics({ keyword, locale = 'en-US' }) {
  const phrase = String(keyword || '').trim()
  if (!phrase) return unavailable('keyword is required')

  const token = process.env.MOZ_API_TOKEN
  if (!token) return unavailable('MOZ_API_TOKEN not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.moz.com/jsonrpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-moz-token': token,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'seo-advisor-kw',
        method: 'data.keyword.metrics.fetch',
        params: {
          data: {
            serps_query: {
              keyword: phrase,
              locale: String(locale || 'en-US'),
              device: 'desktop',
              engine: 'google',
            },
          },
        },
      }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || data?.error) {
      markProviderFailure('moz', data?.error?.message || `HTTP ${res.status}`)
      return unavailable(
        data?.error?.message ||
          'Moz keyword metrics unavailable (plan may not include this method)'
      )
    }
    markProviderSuccess('moz')
    const metrics = data?.result?.keyword_metrics || data?.result || {}
    return {
      available: true,
      provider: 'moz',
      report: 'keyword_metrics',
      keyword: phrase,
      metrics: {
        volume: metrics.volume ?? metrics.search_volume ?? null,
        difficulty: metrics.difficulty ?? null,
        organicCtr: metrics.organic_ctr ?? null,
        priority: metrics.priority ?? null,
      },
    }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Moz request timed out' : err?.message
    markProviderFailure('moz', msg)
    return unavailable(msg)
  } finally {
    clearTimeout(timer)
  }
}

export async function linkData({ domain, url, limit = 10 }) {
  const target = normalizeDomain(url || domain)
  if (!target) return unavailable('domain is required')

  const result = await mozPost('linking_root_domains', {
    target,
    scope: 'root_domain',
    sort: 'root_domain_authority',
    limit: Math.min(Number(limit) || 10, 25),
  })
  if (!result.available) return result

  const results = Array.isArray(result.data?.results) ? result.data.results : []
  return {
    available: true,
    provider: 'moz',
    report: 'link_data',
    target,
    linkingRootDomains: results.map((r) => ({
      rootDomain: r.root_domain ?? null,
      domainAuthority: r.root_domain_authority ?? r.domain_authority ?? null,
      pagesToTarget: r.pages_to_target ?? null,
      spamScore: r.root_domain_spam_score ?? null,
    })),
  }
}

export const mozTools = {
  domainMetrics,
  keywordMetrics,
  linkData,
}
