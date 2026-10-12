import { markProviderFailure, markProviderSuccess } from '../../seo-advisor/health.js'
import { apexDomain } from '../domain.js'

const TIMEOUT_MS = 25000
const STALE_DAYS = 45
const STALE_BANNER =
  "Moz has not crawled this site's current content yet — data below may be stale or reflect a prior domain owner"

function unavailable(reason) {
  return { available: false, provider: 'moz', reason: String(reason || 'unavailable') }
}

function mozAuthHeaders() {
  const token = String(process.env.MOZ_API_TOKEN || '').trim()
  const accessId = String(process.env.MOZ_ACCESS_ID || '').trim()
  const secretKey = String(process.env.MOZ_SECRET_KEY || '').trim()

  if (accessId && secretKey) {
    const basic = Buffer.from(`${accessId}:${secretKey}`).toString('base64')
    return { Authorization: `Basic ${basic}` }
  }

  if (!token) return null

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

async function mozUrlMetrics(target) {
  const auth = mozAuthHeaders()
  if (!auth) return unavailable('MOZ_API_TOKEN not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://lsapi.seomoz.com/v2/url_metrics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth,
      },
      body: JSON.stringify({ targets: [target] }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      markProviderFailure('moz', `HTTP ${res.status}`)
      return unavailable(data?.message || data?.error || `Moz HTTP ${res.status}`)
    }
    markProviderSuccess('moz')
    const results = Array.isArray(data?.results) ? data.results : []
    return { available: true, provider: 'moz', row: results[0] || null, data }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Moz request timed out' : err?.message
    markProviderFailure('moz', msg)
    return unavailable(msg)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Domain metrics for several targets in one request (results keep target order).
 * Used by the Audit tool's Authority category for competitor benchmarks.
 * @param {string[]} targets
 * @returns {Promise<{ available: boolean, reason?: string, rows?: Array<object|null> }>}
 */
export async function mozBatchMetrics(targets) {
  const list = (targets || []).filter(Boolean)
  if (!list.length) return { available: true, provider: 'moz', rows: [] }
  const auth = mozAuthHeaders()
  if (!auth) return unavailable('MOZ_API_TOKEN not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://lsapi.seomoz.com/v2/url_metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ targets: list }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      markProviderFailure('moz', `HTTP ${res.status}`)
      return unavailable(data?.message || data?.error || `Moz HTTP ${res.status}`)
    }
    markProviderSuccess('moz')
    const results = Array.isArray(data?.results) ? data.results : []
    return { available: true, provider: 'moz', rows: list.map((_, i) => mapMetrics(results[i] || null)) }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Moz request timed out' : err?.message
    markProviderFailure('moz', msg)
    return unavailable(msg)
  } finally {
    clearTimeout(timer)
  }
}

function isEmptyMozRow(row) {
  if (!row || typeof row !== 'object') return true
  const httpCode = Number(row.http_code)
  if (!httpCode || httpCode === 0) return true
  const title = String(row.title || '').trim()
  const lastCrawled = String(row.last_crawled || '').trim()
  // Empty crawl markers per Moz docs.
  if (!title && !lastCrawled && (!httpCode || httpCode === 0)) return true
  return false
}

/**
 * Simple substring / token-overlap check against product_name and/or company name.
 * Accepts a single string or list of candidate brand strings.
 */
export function titleMatchesProduct(mozTitle, productNameOrCandidates) {
  const title = String(mozTitle || '').trim().toLowerCase()
  const candidates = (
    Array.isArray(productNameOrCandidates)
      ? productNameOrCandidates
      : [productNameOrCandidates]
  )
    .map((v) => String(v || '').trim())
    .filter(Boolean)

  if (candidates.length === 0) {
    return { matched: true, reason: 'No product_name/company name to compare' }
  }
  if (!title) return { matched: false, reason: 'Moz title is empty' }

  for (const candidate of candidates) {
    const product = candidate.toLowerCase()
    if (title.includes(product) || product.includes(title)) {
      return { matched: true, reason: `Substring match ("${candidate}")` }
    }

    // Prefer distinctive tokens; skip generic filler words in tagline-style product names.
    const stop = new Set([
      'the',
      'and',
      'for',
      'your',
      'with',
      'from',
      'platform',
      'managed',
      'expert',
      'outreach',
    ])
    const tokens = product
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !stop.has(t))
    if (tokens.length === 0) continue
    const hits = tokens.filter((t) => title.includes(t))
    const needed = Math.max(1, Math.ceil(tokens.length / 2))
    if (hits.length >= needed) {
      return {
        matched: true,
        reason: `Matched tokens for "${candidate}": ${hits.join(', ')}`,
      }
    }
  }

  return {
    matched: false,
    reason: `Title did not match product_name/company name (moz title: "${mozTitle}")`,
  }
}

function daysSince(isoDate) {
  if (!isoDate) return null
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return null
  const ms = Date.now() - d.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function mapMetrics(row) {
  if (!row) return null
  return {
    domainAuthority: row.domain_authority ?? null,
    pageAuthority: row.page_authority ?? null,
    spamScore: row.spam_score ?? null,
    linkingRootDomains: row.root_domains_to_root_domain ?? null,
    externalPagesToRootDomain: row.external_pages_to_root_domain ?? null,
    title: row.title || null,
    lastCrawled: row.last_crawled || null,
    httpCode: row.http_code ?? null,
    page: row.page || null,
    rootDomain: row.root_domain || null,
  }
}

/**
 * Moz panel: DA/PA/Spam/linking roots.
 * Primary target is www.{domain}; fall back to apex only if www is empty/http_code 0.
 * Staleness warning when last_crawled > 45 days OR title doesn't match product_name.
 */
export async function runMozPanel({ siteUrl, productName, companyName }) {
  const apex = apexDomain(siteUrl)
  if (!apex) {
    return { ok: false, error: 'Invalid domain for Moz panel', panel: 'moz' }
  }

  const wwwTarget = `www.${apex}`
  let usedTarget = wwwTarget
  let fetchResult = await mozUrlMetrics(wwwTarget)
  let fallbackUsed = false
  let wwwWasEmpty = false

  if (!fetchResult.available) {
    return {
      ok: false,
      error: fetchResult.reason || 'Moz request failed',
      panel: 'moz',
      target: wwwTarget,
    }
  }

  if (isEmptyMozRow(fetchResult.row)) {
    wwwWasEmpty = true
    const apexResult = await mozUrlMetrics(apex)
    if (apexResult.available && !isEmptyMozRow(apexResult.row)) {
      fetchResult = apexResult
      usedTarget = apex
      fallbackUsed = true
    }
  }

  const row = fetchResult.row
  if (isEmptyMozRow(row)) {
    return {
      ok: false,
      error: `Moz returned empty metrics for www.${apex} and apex ${apex}`,
      panel: 'moz',
      target: usedTarget,
      triedWww: true,
      triedApex: true,
      stale: {
        isStale: true,
        banner: STALE_BANNER,
        reasons: ['Moz returned empty/http_code 0 for both www and apex targets'],
      },
    }
  }

  const metrics = mapMetrics(row)
  const ageDays = daysSince(metrics.lastCrawled)
  const titleCheck = titleMatchesProduct(metrics.title, [productName, companyName])
  const reasons = []

  if (ageDays == null) {
    reasons.push('Moz last_crawled is missing')
  } else if (ageDays > STALE_DAYS) {
    reasons.push(`last_crawled is ${ageDays} days old (threshold ${STALE_DAYS})`)
  }

  if (!titleCheck.matched) {
    reasons.push(titleCheck.reason)
  }

  // www is the canonical host for this build — empty www crawl is a strong
  // signal the metrics may reflect a prior/apex-only index.
  if (wwwWasEmpty && fallbackUsed) {
    reasons.push(`www.${apex} returned empty/http_code 0; fell back to apex`)
  }

  const isStale = reasons.length > 0

  return {
    ok: true,
    panel: 'moz',
    target: usedTarget,
    fallbackUsed,
    productName: productName || null,
    companyName: companyName || null,
    metrics,
    titleMatch: titleCheck,
    crawlAgeDays: ageDays,
    stale: {
      isStale,
      banner: isStale ? STALE_BANNER : null,
      reasons,
      thresholdDays: STALE_DAYS,
    },
  }
}
