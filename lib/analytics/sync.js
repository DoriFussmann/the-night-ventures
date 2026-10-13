// Pull GSC, GA4, Bing (and, when due, AI visibility) for one company and store
// it. Idempotent: every write is an upsert on the natural key, and each run
// re-pulls the last few days so late-arriving data settles.

import { apexDomain } from '../audit-snapshot/domain.js'
import { listGscSites, pickGscProperty, searchAnalytics } from './gsc.js'
import { listGa4Properties, pickGa4Property, normalizeGa4Property, runGa4Report } from './ga4.js'
import { bingApiKey, listBingSites, pickBingSite, bingDailyTotals, bingPageStats, bingQueryStats } from './bing.js'
import { readServiceAccount } from './google.js'
import { aiAssistantForSource, ga4AiSourceRegex } from './aiSources.js'
import { runAiVisibility } from './aiVisibility.js'
import { addDays, fromCompactDate, utcToday } from './dates.js'

const FIRST_PULL_DAYS = 200
const TOTALS_HISTORY_DAYS = 480
const REPULL_DAYS = 4
const RETENTION_DAYS = 200
const LOCK_MS = 5 * 60 * 1000
export const AI_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const CHUNK = 1000

export class AnalyticsError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

/** Merge rows that share a key (sums clicks/impressions) so one upsert batch never hits a key twice. */
function sumByKey(rows, keyOf) {
  const map = new Map()
  for (const r of rows) {
    const key = keyOf(r)
    const prev = map.get(key)
    map.set(
      key,
      prev ? { ...prev, clicks: prev.clicks + r.clicks, impressions: prev.impressions + r.impressions } : r
    )
  }
  return [...map.values()]
}

async function upsertChunks(supabase, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict })
    if (error) throw error
  }
}

/** Load (or create) the settings row. */
export async function ensureSettings(supabase, companyId) {
  const { data, error } = await supabase
    .from('analytics_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  if (data) return data
  const { data: created, error: insertError } = await supabase
    .from('analytics_settings')
    .upsert({ company_id: companyId }, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (insertError) throw insertError
  return created
}

/** Domain, keywords (pillars first, then supporting), competitors. */
export async function loadCompanyContext(supabase, companyId) {
  const [profileRes, coverageRes] = await Promise.all([
    supabase
      .from('company_profiles')
      .select('domain, product_name, competitors')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase.from('content_coverage').select('pillars').eq('company_id', companyId).maybeSingle(),
  ])
  if (profileRes.error) throw profileRes.error
  if (coverageRes.error) throw coverageRes.error
  const pillars = Array.isArray(coverageRes.data?.pillars) ? coverageRes.data.pillars : []
  const core = pillars.map((p) => String(p?.keyword || '').trim()).filter(Boolean)
  const supporting = pillars.flatMap((p) =>
    (Array.isArray(p?.supporting) ? p.supporting : [])
      .map((s) => String(s?.keyword || '').trim())
      .filter(Boolean)
  )
  return {
    domain: profileRes.data?.domain || null,
    productName: profileRes.data?.product_name || null,
    competitors: Array.isArray(profileRes.data?.competitors) ? profileRes.data.competitors : [],
    keywords: [...new Set([...core, ...supporting])],
  }
}

async function latestDate(supabase, table, companyId, source) {
  let query = supabase.from(table).select('date').eq('company_id', companyId)
  if (source) query = query.eq('source', source)
  const { data, error } = await query.order('date', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data?.date || null
}

function pullStart(latest, firstDays) {
  if (!latest) return utcToday(-firstDays)
  const repull = addDays(latest, -REPULL_DAYS)
  const floor = utcToday(-firstDays)
  return repull < floor ? floor : repull
}

const okStatus = (message, extra = {}) => ({ ok: true, message, at: new Date().toISOString(), ...extra })
const errStatus = (message, extra = {}) => ({ ok: false, message, at: new Date().toISOString(), ...extra })

// --- property resolution ---------------------------------------------------

async function resolveGsc(settings, domain, cache) {
  if (settings.gsc_property_override) return settings.gsc_property_override
  if (!cache.gscSites) cache.gscSites = await listGscSites()
  return pickGscProperty(cache.gscSites, domain)
}

async function resolveGa4(settings, domain, cache) {
  if (settings.ga4_property_override) return normalizeGa4Property(settings.ga4_property_override)
  if (!cache.ga4Properties) cache.ga4Properties = await listGa4Properties()
  return pickGa4Property(cache.ga4Properties, domain)
}

async function resolveBing(settings, domain, cache) {
  if (settings.bing_site_override) return settings.bing_site_override
  if (!cache.bingSites) cache.bingSites = await listBingSites()
  return pickBingSite(cache.bingSites, domain)
}

// --- source pulls ----------------------------------------------------------

async function syncGsc(supabase, companyId, property) {
  const end = utcToday(-1)
  const latest = await latestDate(supabase, 'analytics_daily', companyId, 'gsc')
  const totalsStart = pullStart(latest, TOTALS_HISTORY_DAYS)
  const detailStart = pullStart(latest, FIRST_PULL_DAYS)

  const totals = await searchAnalytics(property, { startDate: totalsStart, endDate: end, dimensions: ['date'] })
  await upsertChunks(
    supabase,
    'analytics_daily',
    totals.rows.map((r) => ({
      company_id: companyId,
      source: 'gsc',
      date: r.keys[0],
      clicks: Math.round(r.clicks || 0),
      impressions: Math.round(r.impressions || 0),
      position: r.position ?? null,
    })),
    'company_id,source,date'
  )

  const pages = await searchAnalytics(property, { startDate: detailStart, endDate: end, dimensions: ['date', 'page'] })
  await upsertChunks(
    supabase,
    'analytics_pages',
    sumByKey(
      pages.rows.map((r) => ({
        company_id: companyId,
        source: 'gsc',
        date: r.keys[0],
        page: String(r.keys[1] || '').slice(0, 1000),
        clicks: Math.round(r.clicks || 0),
        impressions: Math.round(r.impressions || 0),
        position: r.position ?? null,
      })),
      (r) => `${r.date}|${r.page}`
    ),
    'company_id,source,date,page'
  )

  const queries = await searchAnalytics(property, {
    startDate: detailStart,
    endDate: end,
    dimensions: ['date', 'query', 'page'],
  })
  await upsertChunks(
    supabase,
    'analytics_queries',
    sumByKey(
      queries.rows
        .filter((r) => r.keys[1])
        .map((r) => ({
          company_id: companyId,
          source: 'gsc',
          date: r.keys[0],
          query: String(r.keys[1]).slice(0, 500),
          page: String(r.keys[2] || '').slice(0, 1000),
          clicks: Math.round(r.clicks || 0),
          impressions: Math.round(r.impressions || 0),
          position: r.position ?? null,
        })),
      (r) => `${r.date}|${r.query}|${r.page}`
    ),
    'company_id,source,date,query,page'
  )

  const truncated = pages.truncated || queries.truncated
  return okStatus(
    `${totals.rows.length} days, ${pages.rows.length} page rows, ${queries.rows.length} query rows${
      truncated ? ' (capped)' : ''
    }`,
    { property }
  )
}

async function syncGa4(supabase, companyId, property) {
  const end = utcToday(-1)
  const latest = await latestDate(supabase, 'analytics_traffic', companyId)
  const start = pullStart(latest, FIRST_PULL_DAYS)
  const dateRanges = [{ startDate: start, endDate: end }]

  const traffic = await runGa4Report(property, {
    dateRanges,
    dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }],
  })
  const trafficRows = new Map()
  for (const row of traffic.rows) {
    const date = fromCompactDate(row.dims[0])
    if (!date) continue
    const rawSource = row.dims[1] || '(not set)'
    const source = rawSource.slice(0, 300)
    const channel = (row.dims[2] || 'Unassigned').slice(0, 100)
    const key = `${date}|${source}|${channel}`
    const prev = trafficRows.get(key)
    trafficRows.set(key, {
      company_id: companyId,
      date,
      source,
      channel,
      ai_assistant: aiAssistantForSource(rawSource),
      sessions: (prev?.sessions || 0) + Math.round(row.metrics[0] || 0),
      engaged_sessions: (prev?.engaged_sessions || 0) + Math.round(row.metrics[1] || 0),
    })
  }
  await upsertChunks(supabase, 'analytics_traffic', [...trafficRows.values()], 'company_id,date,source,channel')

  const landing = await runGa4Report(property, {
    dateRanges,
    dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'landingPage' }],
    metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }],
    dimensionFilter: {
      filter: {
        fieldName: 'sessionSource',
        stringFilter: { matchType: 'PARTIAL_REGEXP', value: ga4AiSourceRegex(), caseSensitive: false },
      },
    },
  })
  const landingRows = new Map()
  for (const row of landing.rows) {
    const date = fromCompactDate(row.dims[0])
    const assistant = aiAssistantForSource(row.dims[1])
    if (!date || !assistant) continue
    const page = String(row.dims[2] || '(not set)').slice(0, 500)
    const key = `${date}|${assistant}|${page}`
    const prev = landingRows.get(key)
    landingRows.set(key, {
      company_id: companyId,
      date,
      ai_assistant: assistant,
      landing_page: page,
      sessions: (prev?.sessions || 0) + Math.round(row.metrics[0] || 0),
      engaged_sessions: (prev?.engaged_sessions || 0) + Math.round(row.metrics[1] || 0),
    })
  }
  await upsertChunks(
    supabase,
    'analytics_ai_landing',
    [...landingRows.values()],
    'company_id,date,ai_assistant,landing_page'
  )

  return okStatus(
    `${trafficRows.size} source rows, ${landingRows.size} AI landing rows${
      traffic.truncated || landing.truncated ? ' (capped)' : ''
    }`,
    { property }
  )
}

async function syncBing(supabase, companyId, siteUrl) {
  const [totals, pages, queries] = await Promise.all([
    bingDailyTotals(siteUrl),
    bingPageStats(siteUrl),
    bingQueryStats(siteUrl),
  ])
  const floor = utcToday(-TOTALS_HISTORY_DAYS)
  const detailFloor = utcToday(-RETENTION_DAYS)

  await upsertChunks(
    supabase,
    'analytics_daily',
    sumByKey(
      totals.filter((r) => r.date >= floor),
      (r) => r.date
    ).map((r) => ({
      company_id: companyId,
      source: 'bing',
      date: r.date,
      clicks: r.clicks,
      impressions: r.impressions,
      position: null,
    })),
    'company_id,source,date'
  )
  await upsertChunks(
    supabase,
    'analytics_pages',
    sumByKey(
      pages.filter((r) => r.date >= detailFloor),
      (r) => `${r.date}|${r.page}`
    ).map((r) => ({
      company_id: companyId,
      source: 'bing',
      date: r.date,
      page: r.page.slice(0, 1000),
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
    })),
    'company_id,source,date,page'
  )
  await upsertChunks(
    supabase,
    'analytics_queries',
    sumByKey(
      queries.filter((r) => r.date >= detailFloor),
      (r) => `${r.date}|${r.query}`
    ).map((r) => ({
      company_id: companyId,
      source: 'bing',
      date: r.date,
      query: r.query.slice(0, 500),
      page: '',
      clicks: r.clicks,
      impressions: r.impressions,
      position: r.position,
    })),
    'company_id,source,date,query,page'
  )
  return okStatus(`${totals.length} days, ${pages.length} page rows, ${queries.length} query rows`, {
    property: siteUrl,
  })
}

async function prune(supabase, companyId) {
  const before = utcToday(-RETENTION_DAYS)
  for (const table of [
    'analytics_pages',
    'analytics_queries',
    'analytics_traffic',
    'analytics_ai_landing',
    'analytics_bot_hits',
  ]) {
    const { error } = await supabase.from(table).delete().eq('company_id', companyId).lt('date', before)
    if (error) throw error
  }
}

/** Whether a weekly AI check is due. */
export function aiCheckDue(settings, now = Date.now()) {
  if (!settings?.ai_checked_at) return true
  return now - new Date(settings.ai_checked_at).getTime() >= AI_CHECK_INTERVAL_MS
}

/**
 * Sync one company.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {{ ai?: boolean, cache?: object }} [options]
 */
export async function syncCompany(supabase, companyId, options = {}) {
  const cache = options.cache || {}
  const settings = await ensureSettings(supabase, companyId)
  const startedAt = settings.sync_started_at ? new Date(settings.sync_started_at).getTime() : 0
  const finishedAt = settings.synced_at ? new Date(settings.synced_at).getTime() : 0
  if (startedAt > finishedAt && Date.now() - startedAt < LOCK_MS) {
    throw new AnalyticsError('A refresh is already running for this company — try again in a few minutes', 409)
  }

  const context = await loadCompanyContext(supabase, companyId)
  if (!apexDomain(context.domain)) {
    throw new AnalyticsError('No domain set — add it in Company Intelligence')
  }

  const { error: lockError } = await supabase
    .from('analytics_settings')
    .update({ sync_started_at: new Date().toISOString() })
    .eq('company_id', companyId)
  if (lockError) throw lockError

  const status = { ...(settings.status || {}) }
  const resolved = {
    gsc_property: settings.gsc_property,
    ga4_property: settings.ga4_property,
    bing_site: settings.bing_site,
  }
  const hasGoogle = Boolean(readServiceAccount())

  // GSC
  if (!hasGoogle) {
    status.gsc = errStatus('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  } else {
    try {
      const property = await resolveGsc(settings, context.domain, cache)
      resolved.gsc_property = property
      status.gsc = property
        ? await syncGsc(supabase, companyId, property)
        : errStatus('No Search Console property for this domain is shared with the service account')
    } catch (err) {
      status.gsc = errStatus(err?.message || 'Search Console sync failed', { property: resolved.gsc_property })
    }
  }

  // GA4
  if (!hasGoogle) {
    status.ga4 = errStatus('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  } else {
    try {
      const property = await resolveGa4(settings, context.domain, cache)
      resolved.ga4_property = property
      status.ga4 = property
        ? await syncGa4(supabase, companyId, property)
        : errStatus('No GA4 property with a web stream for this domain is shared with the service account')
    } catch (err) {
      status.ga4 = errStatus(err?.message || 'GA4 sync failed', { property: resolved.ga4_property })
    }
  }

  // Bing
  if (!bingApiKey()) {
    status.bing = errStatus('BING_WEBMASTER_API_KEY is not set')
  } else {
    try {
      const site = await resolveBing(settings, context.domain, cache)
      resolved.bing_site = site
      status.bing = site
        ? await syncBing(supabase, companyId, site)
        : errStatus('This domain is not a verified site in your Bing Webmaster account')
    } catch (err) {
      status.bing = errStatus(err?.message || 'Bing sync failed', { property: resolved.bing_site })
    }
  }

  // AI visibility (paid) — only when asked or due.
  let aiCheckedAt = settings.ai_checked_at
  if (options.ai) {
    try {
      const result = await runAiVisibility(supabase, {
        companyId,
        domain: context.domain,
        keywords: context.keywords,
        competitors: context.competitors,
      })
      status.ai = result.ok
        ? okStatus(result.message, { costUsd: result.costUsd })
        : errStatus(result.message, { costUsd: result.costUsd })
      aiCheckedAt = new Date().toISOString()
    } catch (err) {
      status.ai = errStatus(err?.message || 'AI visibility check failed')
    }
  }

  try {
    await prune(supabase, companyId)
  } catch (err) {
    console.error('analytics prune failed:', err)
  }

  const syncedAt = new Date().toISOString()
  const { error: saveError } = await supabase
    .from('analytics_settings')
    .update({
      ...resolved,
      status,
      synced_at: syncedAt,
      ai_checked_at: aiCheckedAt,
      updated_at: syncedAt,
    })
    .eq('company_id', companyId)
  if (saveError) throw saveError

  return { status, syncedAt, ...resolved }
}

/**
 * Daily cron: sync every company with a domain, stalest first, inside a time budget.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase service-role client
 * @param {{ budgetMs?: number }} [options]
 */
export async function runAnalyticsCron(supabase, { budgetMs = 200000 } = {}) {
  const started = Date.now()
  const [{ data: profiles, error }, { data: settingsRows, error: settingsError }] = await Promise.all([
    supabase.from('company_profiles').select('company_id, domain').not('domain', 'is', null),
    supabase.from('analytics_settings').select('company_id, synced_at, ai_checked_at'),
  ])
  if (error) throw error
  if (settingsError) throw settingsError

  const byCompany = new Map((settingsRows || []).map((s) => [s.company_id, s]))
  const freshCutoff = Date.now() - 20 * 60 * 60 * 1000
  const queue = (profiles || [])
    .filter((p) => apexDomain(p.domain))
    .map((p) => ({ companyId: p.company_id, settings: byCompany.get(p.company_id) || null }))
    .filter((c) => !c.settings?.synced_at || new Date(c.settings.synced_at).getTime() < freshCutoff)
    .sort((a, b) => {
      const ta = a.settings?.synced_at ? new Date(a.settings.synced_at).getTime() : 0
      const tb = b.settings?.synced_at ? new Date(b.settings.synced_at).getTime() : 0
      return ta - tb
    })

  const cache = {}
  const results = []
  for (const item of queue) {
    if (Date.now() - started > budgetMs) {
      results.push({ companyId: item.companyId, skipped: 'time budget' })
      continue
    }
    try {
      const out = await syncCompany(supabase, item.companyId, { ai: aiCheckDue(item.settings), cache })
      results.push({ companyId: item.companyId, ok: true, status: out.status })
    } catch (err) {
      results.push({ companyId: item.companyId, ok: false, error: err?.message || 'sync failed' })
    }
  }
  return { processed: results.length, results, ms: Date.now() - started }
}
