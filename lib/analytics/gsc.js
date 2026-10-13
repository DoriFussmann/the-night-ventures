// Google Search Console (Search Analytics) via the service account.

import { googleJson } from './google.js'
import { apexDomain } from '../audit-snapshot/domain.js'

const BASE = 'https://www.googleapis.com/webmasters/v3'
const PAGE_SIZE = 25000

/** @returns {Promise<Array<{ siteUrl: string, permissionLevel: string }>>} */
export async function listGscSites() {
  const data = await googleJson(`${BASE}/sites`)
  return Array.isArray(data.siteEntry) ? data.siteEntry : []
}

/**
 * Best GSC property for a domain among the ones the service account can read.
 * Prefers the Domain property, then https://www., https://, http:// variants.
 * @param {Array<{ siteUrl: string, permissionLevel?: string }>} sites
 * @param {string} domain
 * @returns {string | null}
 */
export function pickGscProperty(sites, domain) {
  const apex = apexDomain(domain)
  if (!apex) return null
  const readable = new Set(
    (Array.isArray(sites) ? sites : [])
      .filter((s) => s?.siteUrl && s.permissionLevel !== 'siteUnverifiedUser')
      .map((s) => String(s.siteUrl))
  )
  const candidates = [
    `sc-domain:${apex}`,
    `https://www.${apex}/`,
    `https://${apex}/`,
    `http://www.${apex}/`,
    `http://${apex}/`,
  ]
  return candidates.find((c) => readable.has(c)) || null
}

/**
 * All rows for one Search Analytics request, paging by 25k up to `maxRows`.
 * @param {string} property
 * @param {{ startDate: string, endDate: string, dimensions: string[] }} params
 * @param {number} [maxRows]
 * @returns {Promise<{ rows: Array<{ keys: string[], clicks: number, impressions: number, position: number }>, truncated: boolean }>}
 */
export async function searchAnalytics(property, params, maxRows = 100000) {
  const url = `${BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`
  const rows = []
  let startRow = 0
  while (rows.length < maxRows) {
    const rowLimit = Math.min(PAGE_SIZE, maxRows - rows.length)
    const data = await googleJson(url, {
      method: 'POST',
      body: {
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions,
        type: 'web',
        dataState: 'final',
        rowLimit,
        startRow,
      },
      timeoutMs: 60000,
    })
    const batch = Array.isArray(data.rows) ? data.rows : []
    rows.push(...batch)
    if (batch.length < rowLimit) return { rows, truncated: false }
    startRow += batch.length
  }
  return { rows, truncated: true }
}
