// GA4 Admin (property discovery) + Data API (reports) via the service account.

import { googleJson } from './google.js'
import { apexDomain } from '../audit-snapshot/domain.js'

const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta'
const DATA = 'https://analyticsdata.googleapis.com/v1beta'
const REPORT_PAGE = 100000
const MAX_PAGES = 5

async function listAll(url, key) {
  const out = []
  let pageToken = ''
  for (let i = 0; i < 20; i += 1) {
    const qs = new URLSearchParams({ pageSize: '200' })
    if (pageToken) qs.set('pageToken', pageToken)
    const data = await googleJson(`${url}?${qs}`)
    out.push(...(Array.isArray(data[key]) ? data[key] : []))
    pageToken = data.nextPageToken || ''
    if (!pageToken) break
  }
  return out
}

/**
 * Every GA4 property the service account can read, with its web stream hosts.
 * @returns {Promise<Array<{ property: string, displayName: string, hosts: string[] }>>}
 */
export async function listGa4Properties() {
  const summaries = await listAll(`${ADMIN}/accountSummaries`, 'accountSummaries')
  const properties = summaries.flatMap((a) =>
    (Array.isArray(a.propertySummaries) ? a.propertySummaries : []).map((p) => ({
      property: String(p.property || ''),
      displayName: String(p.displayName || ''),
    }))
  )
  const out = []
  for (const p of properties.filter((x) => /^properties\/\d+$/.test(x.property))) {
    let hosts = []
    try {
      const streams = await listAll(`${ADMIN}/${p.property}/dataStreams`, 'dataStreams')
      hosts = streams
        .map((s) => apexDomain(s?.webStreamData?.defaultUri || ''))
        .filter(Boolean)
    } catch {
      hosts = []
    }
    out.push({ ...p, hosts })
  }
  return out
}

/**
 * GA4 property whose web stream points at the company domain.
 * @param {Array<{ property: string, hosts: string[] }>} properties
 * @param {string} domain
 * @returns {string | null}
 */
export function pickGa4Property(properties, domain) {
  const apex = apexDomain(domain)
  if (!apex) return null
  const match = (Array.isArray(properties) ? properties : []).find((p) =>
    (p.hosts || []).some((h) => h === apex || h.endsWith(`.${apex}`))
  )
  return match?.property || null
}

/** "123456" or "properties/123456" → "properties/123456" (null when invalid). */
export function normalizeGa4Property(value) {
  const v = String(value || '').trim()
  if (/^properties\/\d+$/.test(v)) return v
  if (/^\d+$/.test(v)) return `properties/${v}`
  return null
}

/**
 * Run a GA4 report and return flat rows { dims: string[], metrics: number[] }.
 * @param {string} property properties/123
 * @param {object} body runReport body without limit/offset
 */
export async function runGa4Report(property, body) {
  const rows = []
  let truncated = true
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await googleJson(`${DATA}/${property}:runReport`, {
      method: 'POST',
      body: { ...body, limit: String(REPORT_PAGE), offset: String(page * REPORT_PAGE) },
      timeoutMs: 60000,
    })
    const batch = Array.isArray(data.rows) ? data.rows : []
    for (const row of batch) {
      rows.push({
        dims: (row.dimensionValues || []).map((d) => String(d?.value ?? '')),
        metrics: (row.metricValues || []).map((m) => Number(m?.value) || 0),
      })
    }
    const total = Number(data.rowCount) || 0
    if (batch.length < REPORT_PAGE || rows.length >= total) {
      truncated = false
      break
    }
  }
  return { rows, truncated }
}
