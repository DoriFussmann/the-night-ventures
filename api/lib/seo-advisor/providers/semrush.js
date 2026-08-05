import { markProviderFailure, markProviderSuccess } from '../health.js'

const BASE = 'https://api.semrush.com/'
const TIMEOUT_MS = 25000

function unavailable(reason) {
  return { available: false, provider: 'semrush', reason: String(reason || 'unavailable') }
}

function normalizeDomain(value) {
  let d = String(value || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  return d.replace(/\.$/, '')
}

function parseCsv(text) {
  const lines = String(text || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
  if (lines.length === 0) return { columns: [], rows: [] }
  const columns = lines[0].split(';').map((c) => c.trim())
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(';')
    const obj = {}
    columns.forEach((col, i) => {
      obj[col] = cells[i] != null ? cells[i].trim() : ''
    })
    return obj
  })
  return { columns, rows }
}

async function semrushGet(params) {
  const key = process.env.SEMRUSH_API_KEY
  if (!key) {
    return unavailable('SEMRUSH_API_KEY not configured')
  }

  const url = new URL(BASE)
  url.searchParams.set('key', key)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    const text = await res.text()
    if (!res.ok) {
      markProviderFailure('semrush', `HTTP ${res.status}`)
      return unavailable(`Semrush HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    if (/^ERROR\s+\d+/i.test(text.trim())) {
      markProviderFailure('semrush', text.trim())
      return unavailable(text.trim())
    }
    markProviderSuccess('semrush')
    return { available: true, provider: 'semrush', raw: text, ...parseCsv(text) }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'Semrush request timed out' : err?.message
    markProviderFailure('semrush', msg)
    return unavailable(msg)
  } finally {
    clearTimeout(timer)
  }
}

export async function domainOverview({ domain, database = 'us' }) {
  const d = normalizeDomain(domain)
  if (!d) return unavailable('domain is required')

  const result = await semrushGet({
    type: 'domain_rank',
    domain: d,
    database,
    export_columns: 'Db,Dn,Rk,Or,Ot,Oc,Ad,At,Ac,Sh,Sv',
  })
  if (!result.available) return result

  const row = result.rows[0] || {}
  return {
    available: true,
    provider: 'semrush',
    report: 'domain_overview',
    domain: d,
    database,
    metrics: {
      rank: row.Rk ?? row.rank ?? null,
      organicKeywords: row.Or ?? null,
      organicTraffic: row.Ot ?? null,
      organicCost: row.Oc ?? null,
      adwordsKeywords: row.Ad ?? null,
      adwordsTraffic: row.At ?? null,
      adwordsCost: row.Ac ?? null,
    },
    rows: result.rows.slice(0, 5),
  }
}

export async function keywordResearch({ keyword, database = 'us', limit = 20 }) {
  const phrase = String(keyword || '').trim()
  if (!phrase) return unavailable('keyword is required')

  const overview = await semrushGet({
    type: 'phrase_this',
    phrase,
    database,
    export_columns: 'Ph,Nq,Cp,Co,Nr,Td',
  })
  if (!overview.available) return overview

  const related = await semrushGet({
    type: 'phrase_related',
    phrase,
    database,
    display_limit: Math.min(Number(limit) || 20, 50),
    export_columns: 'Ph,Nq,Cp,Co,Nr,Td,Rr',
    display_sort: 'nq_desc',
  })

  const overviewRow = overview.rows[0] || {}
  return {
    available: true,
    provider: 'semrush',
    report: 'keyword_research',
    keyword: phrase,
    database,
    overview: {
      keyword: overviewRow.Ph || phrase,
      searchVolume: overviewRow.Nq ?? null,
      cpc: overviewRow.Cp ?? null,
      competition: overviewRow.Co ?? null,
      results: overviewRow.Nr ?? null,
      trend: overviewRow.Td ?? null,
    },
    related: (related.available ? related.rows : []).map((r) => ({
      keyword: r.Ph,
      searchVolume: r.Nq ?? null,
      cpc: r.Cp ?? null,
      competition: r.Co ?? null,
    })),
  }
}

export async function organicResearch({ domain, database = 'us', limit = 20 }) {
  const d = normalizeDomain(domain)
  if (!d) return unavailable('domain is required')

  const result = await semrushGet({
    type: 'domain_organic',
    domain: d,
    database,
    display_limit: Math.min(Number(limit) || 20, 50),
    export_columns: 'Ph,Po,Pp,Pd,Nq,Cp,Ur,Tr,Tc,Co,Nr,Td,Kd',
    display_sort: 'tr_desc',
  })
  if (!result.available) return result

  return {
    available: true,
    provider: 'semrush',
    report: 'organic_research',
    domain: d,
    database,
    keywords: result.rows.map((r) => ({
      keyword: r.Ph,
      position: r.Po ?? null,
      previousPosition: r.Pp ?? null,
      searchVolume: r.Nq ?? null,
      cpc: r.Cp ?? null,
      url: r.Ur ?? null,
      traffic: r.Tr ?? null,
      trafficCost: r.Tc ?? null,
      keywordDifficulty: r.Kd ?? null,
    })),
  }
}

export async function competitorsResearch({ domain, database = 'us', limit = 15 }) {
  const d = normalizeDomain(domain)
  if (!d) return unavailable('domain is required')

  const result = await semrushGet({
    type: 'domain_organic_organic',
    domain: d,
    database,
    display_limit: Math.min(Number(limit) || 15, 40),
    export_columns: 'Dn,Cr,Np,Or,Ot,Oc,Ad',
    display_sort: 'np_desc',
  })
  if (!result.available) return result

  return {
    available: true,
    provider: 'semrush',
    report: 'competitors_research',
    domain: d,
    database,
    competitors: result.rows.map((r) => ({
      domain: r.Dn,
      competitionLevel: r.Cr ?? null,
      commonKeywords: r.Np ?? null,
      organicKeywords: r.Or ?? null,
      organicTraffic: r.Ot ?? null,
      organicCost: r.Oc ?? null,
    })),
  }
}

export const semrushTools = {
  domainOverview,
  keywordResearch,
  organicResearch,
  competitorsResearch,
}
