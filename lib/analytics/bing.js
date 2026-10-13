// Bing Webmaster Tools API (JSON endpoint, API-key auth).
// Totals are daily; page and query stats come back in weekly buckets.

import { apexDomain } from '../audit-snapshot/domain.js'
import { fromMsJsonDate } from './dates.js'

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json'
const TIMEOUT_MS = 30000

export function bingApiKey() {
  const key = String(process.env.BING_WEBMASTER_API_KEY || '').trim()
  return key.length >= 16 ? key : ''
}

async function bingGet(method, params = {}) {
  const key = bingApiKey()
  if (!key) throw new Error('BING_WEBMASTER_API_KEY is not set')
  const qs = new URLSearchParams({ ...params, apikey: key })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/${method}?${qs}`, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(`Bing ${method}: ${data?.Message || data?.message || `HTTP ${res.status}`}`)
    }
    return Array.isArray(data?.d) ? data.d : []
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Bing ${method} timed out`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** @returns {Promise<Array<{ Url: string, IsVerified: boolean }>>} */
export function listBingSites() {
  return bingGet('GetUserSites')
}

/**
 * Verified Bing site for a domain, preferring https://www.
 * @param {Array<{ Url: string, IsVerified?: boolean }>} sites
 * @param {string} domain
 */
export function pickBingSite(sites, domain) {
  const apex = apexDomain(domain)
  if (!apex) return null
  const matches = (Array.isArray(sites) ? sites : [])
    .filter((s) => s?.Url && s.IsVerified !== false && apexDomain(s.Url) === apex)
    .map((s) => String(s.Url))
  const rank = (url) =>
    /^https:\/\/www\./i.test(url) ? 0 : /^https:/i.test(url) ? 1 : /^http:\/\/www\./i.test(url) ? 2 : 3
  return matches.sort((a, b) => rank(a) - rank(b))[0] || null
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Daily clicks + impressions. */
export async function bingDailyTotals(siteUrl) {
  const rows = await bingGet('GetRankAndTrafficStats', { siteUrl })
  return rows
    .map((r) => ({ date: fromMsJsonDate(r.Date), clicks: num(r.Clicks), impressions: num(r.Impressions) }))
    .filter((r) => r.date)
}

/** Weekly page buckets ("Query" holds the page URL). */
export async function bingPageStats(siteUrl) {
  const rows = await bingGet('GetPageStats', { siteUrl })
  return rows
    .map((r) => ({
      date: fromMsJsonDate(r.Date),
      page: String(r.Query || ''),
      clicks: num(r.Clicks),
      impressions: num(r.Impressions),
      position: r.AvgImpressionPosition == null ? null : num(r.AvgImpressionPosition),
    }))
    .filter((r) => r.date && r.page)
}

/** Weekly query buckets. */
export async function bingQueryStats(siteUrl) {
  const rows = await bingGet('GetQueryStats', { siteUrl })
  return rows
    .map((r) => ({
      date: fromMsJsonDate(r.Date),
      query: String(r.Query || ''),
      clicks: num(r.Clicks),
      impressions: num(r.Impressions),
      position: r.AvgImpressionPosition == null ? null : num(r.AvgImpressionPosition),
    }))
    .filter((r) => r.date && r.query)
}
