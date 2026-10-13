// Read side: everything the Analytics page shows, from stored rows only.
// Each source is windowed to its own latest available date so partial or
// lagging days never skew the comparison with the previous period.

import { ensureSettings, loadCompanyContext, aiCheckDue } from './sync.js'
import { buildOpportunities, brandTerms, urlKey } from './opportunities.js'
import { sumSearch, dailySeries, change, comparePages, groupTraffic, total } from './metrics.js'
import { addDays, periodWindows, utcToday } from './dates.js'
import { readServiceAccount } from './google.js'
import { bingApiKey } from './bing.js'
import { BOT_KIND_LABELS } from './aiSources.js'

const PAGE = 1000

async function rpcAll(supabase, fn, args, cap = 5000) {
  const out = []
  for (let offset = 0; offset < cap; offset += PAGE) {
    const { data, error } = await supabase.rpc(fn, args).range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

async function latest(supabase, table, companyId, source) {
  let q = supabase.from(table).select('date').eq('company_id', companyId)
  if (source) q = q.eq('source', source)
  const { data, error } = await q.order('date', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data?.date || null
}

async function selectAll(query, cap = 5000) {
  const out = []
  for (let offset = 0; offset < cap; offset += PAGE) {
    const { data, error } = await query().range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

function latestPer(rows, keyOf) {
  const latestRows = new Map()
  const previousRows = new Map()
  for (const r of rows) {
    const key = keyOf(r)
    if (!latestRows.has(key)) latestRows.set(key, r)
    else if (!previousRows.has(key)) previousRows.set(key, r)
  }
  return { latestRows, previousRows }
}

function searchBlock(daily, end, days) {
  if (!end) return null
  const w = periodWindows(end, days)
  const cur = sumSearch(daily, w.current.from, w.current.to)
  const prev = sumSearch(daily, w.previous.from, w.previous.to)
  return {
    window: w,
    current: cur,
    previous: prev,
    change: {
      clicks: change(cur.clicks, prev.clicks),
      impressions: change(cur.impressions, prev.impressions),
      ctr: change(cur.ctr, prev.ctr),
      position: cur.position != null && prev.position != null ? cur.position - prev.position : null,
    },
    series: dailySeries(daily, w.current.from, w.current.to, ['clicks', 'impressions']),
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {number} days 7 | 28 | 90
 */
export async function buildSummary(supabase, companyId, days) {
  const settings = await ensureSettings(supabase, companyId)
  const context = await loadCompanyContext(supabase, companyId)

  const [gscEnd, bingEnd, ga4End] = await Promise.all([
    latest(supabase, 'analytics_daily', companyId, 'gsc'),
    latest(supabase, 'analytics_daily', companyId, 'bing'),
    latest(supabase, 'analytics_traffic', companyId),
  ])
  // Crawler hits are live: include today (UTC) so a fresh install shows up immediately.
  const botEnd = utcToday(0)
  const oldest = [gscEnd, bingEnd, ga4End, botEnd].filter(Boolean).sort()[0] || botEnd
  const since = addDays(oldest, -(days * 2 + 1))

  const daily = await selectAll(() =>
    supabase
      .from('analytics_daily')
      .select('source, date, clicks, impressions, position')
      .eq('company_id', companyId)
      .gte('date', since)
      .order('date', { ascending: true })
  )
  const gscDaily = daily.filter((r) => r.source === 'gsc')
  const bingDaily = daily.filter((r) => r.source === 'bing')

  const gsc = searchBlock(gscDaily, gscEnd, days)
  const bing = searchBlock(bingDaily, bingEnd, days)

  // --- pages + queries (Google and Bing) ---
  const pages = {}
  let gscQueries = []
  let gscPagesCur = []
  let gscPagesPrev = []
  for (const [source, block] of [
    ['gsc', gsc],
    ['bing', bing],
  ]) {
    if (!block) continue
    const args = (w) => ({ p_company_id: companyId, p_source: source, p_from: w.from, p_to: w.to })
    const [cur, prev, queries] = await Promise.all([
      rpcAll(supabase, 'analytics_page_stats', args(block.window.current)),
      rpcAll(supabase, 'analytics_page_stats', args(block.window.previous)),
      rpcAll(supabase, 'analytics_query_stats', { ...args(block.window.current), p_limit: 3000 }, 3000),
    ])
    const topQueries = new Map()
    for (const q of queries) {
      const entry = topQueries.get(q.query) || { query: q.query, clicks: 0, impressions: 0, posSum: 0 }
      entry.clicks += Number(q.clicks) || 0
      entry.impressions += Number(q.impressions) || 0
      entry.posSum += (Number(q.position) || 0) * (Number(q.impressions) || 0)
      topQueries.set(q.query, entry)
    }
    pages[source] = {
      ...comparePages(cur, prev),
      queries: [...topQueries.values()]
        .map((q) => ({
          query: q.query,
          clicks: q.clicks,
          impressions: q.impressions,
          position: q.impressions > 0 ? q.posSum / q.impressions : null,
        }))
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, 20),
    }
    if (source === 'gsc') {
      gscQueries = queries
      gscPagesCur = cur
      gscPagesPrev = prev
    }
  }

  // --- GA4 traffic ---
  let traffic = null
  if (ga4End) {
    const w = periodWindows(ga4End, days)
    const args = (win) => ({ p_company_id: companyId, p_from: win.from, p_to: win.to })
    const [cur, prev, dailyRows, landing] = await Promise.all([
      rpcAll(supabase, 'analytics_traffic_stats', args(w.current)),
      rpcAll(supabase, 'analytics_traffic_stats', args(w.previous)),
      rpcAll(supabase, 'analytics_traffic_daily', args(w.current)),
      rpcAll(supabase, 'analytics_ai_landing_stats', args(w.current), 2000),
    ])
    const sessions = total(cur, 'sessions')
    const prevSessions = total(prev, 'sessions')
    const aiSessions = total(
      cur.filter((r) => r.ai_assistant),
      'sessions'
    )
    const prevAiSessions = total(
      prev.filter((r) => r.ai_assistant),
      'sessions'
    )
    const engaged = total(cur, 'engaged_sessions')
    const byPage = new Map()
    for (const row of landing) {
      const entry = byPage.get(row.landing_page) || { page: row.landing_page, sessions: 0, engaged: 0, assistants: {} }
      entry.sessions += Number(row.sessions) || 0
      entry.engaged += Number(row.engaged_sessions) || 0
      entry.assistants[row.ai_assistant] = (entry.assistants[row.ai_assistant] || 0) + (Number(row.sessions) || 0)
      byPage.set(row.landing_page, entry)
    }
    traffic = {
      window: w,
      current: { sessions, aiSessions, engagedRate: sessions > 0 ? engaged / sessions : null },
      previous: { sessions: prevSessions, aiSessions: prevAiSessions },
      change: { sessions: change(sessions, prevSessions), aiSessions: change(aiSessions, prevAiSessions) },
      series: dailySeries(dailyRows, w.current.from, w.current.to, ['sessions', 'ai_sessions']),
      ...groupTraffic(cur, prev),
      aiLanding: [...byPage.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 15),
    }
  }

  // --- AI crawlers ---
  const botWindow = periodWindows(botEnd, days)
  const botArgs = (win) => ({ p_company_id: companyId, p_from: win.from, p_to: win.to })
  const [botCur, botPrev, botPaths, botDaily] = await Promise.all([
    rpcAll(supabase, 'analytics_bot_stats', botArgs(botWindow.current), 500),
    rpcAll(supabase, 'analytics_bot_stats', botArgs(botWindow.previous), 500),
    rpcAll(supabase, 'analytics_bot_paths', { ...botArgs(botWindow.current), p_limit: 20 }, 20),
    rpcAll(supabase, 'analytics_bot_daily', botArgs(botWindow.current), 200),
  ])
  const aiHits = (rows) => total(rows.filter((r) => r.kind !== 'search'), 'hits')
  const prevBot = new Map(botPrev.map((b) => [b.bot, Number(b.hits) || 0]))
  const bots = {
    window: botWindow,
    installed: Boolean(settings.bot_last_hit_at),
    lastHitAt: settings.bot_last_hit_at,
    current: { aiHits: aiHits(botCur), searchHits: total(botCur, 'hits') - aiHits(botCur) },
    previous: { aiHits: aiHits(botPrev) },
    change: { aiHits: change(aiHits(botCur), aiHits(botPrev)) },
    byBot: botCur.map((b) => ({
      bot: b.bot,
      kind: b.kind,
      kindLabel: BOT_KIND_LABELS[b.kind] || b.kind,
      hits: Number(b.hits) || 0,
      prevHits: prevBot.get(b.bot) || 0,
      pages: Number(b.pages) || 0,
      lastHitAt: b.last_hit_at,
    })),
    topPaths: botPaths.map((p) => ({
      path: p.path,
      hits: Number(p.hits) || 0,
      aiHits: Number(p.ai_hits) || 0,
      bots: p.bots || [],
    })),
    series: dailySeries(botDaily, botWindow.current.from, botWindow.current.to, ['ai_hits', 'search_hits']),
  }

  // --- AI visibility ---
  const { data: checkRows, error: checkError } = await supabase
    .from('analytics_ai_checks')
    .select(
      'keyword, checked_at, has_ai_overview, cited, cited_urls, cited_domains, competitors_cited, organic_position, organic_url, error'
    )
    .eq('company_id', companyId)
    .order('checked_at', { ascending: false })
    .limit(400)
  if (checkError) throw checkError
  const { latestRows: latestChecks, previousRows: previousChecks } = latestPer(checkRows || [], (r) => r.keyword)
  const aiChecks = [...latestChecks.values()]
    .map((r) => ({ ...r, previouslyCited: previousChecks.get(r.keyword)?.cited ?? null }))
    .sort((a, b) => String(a.keyword).localeCompare(String(b.keyword)))

  const { data: mentionRows, error: mentionError } = await supabase
    .from('analytics_ai_mentions')
    .select('platform, checked_at, total_count, items, error')
    .eq('company_id', companyId)
    .order('checked_at', { ascending: false })
    .limit(20)
  if (mentionError) throw mentionError
  const { latestRows: latestMentions, previousRows: previousMentions } = latestPer(
    mentionRows || [],
    (r) => r.platform
  )
  const mentions = ['chat_gpt', 'google'].map((platform) => {
    const row = latestMentions.get(platform)
    return {
      platform,
      checkedAt: row?.checked_at || null,
      totalCount: row?.total_count ?? null,
      previousCount: previousMentions.get(platform)?.total_count ?? null,
      items: Array.isArray(row?.items) ? row.items.slice(0, 10) : [],
      error: row?.error || null,
    }
  })

  // --- opportunities ---
  const { data: libraryRows, error: libraryError } = await supabase
    .from('generated_articles')
    .select('slug, title, published_url')
    .eq('company_id', companyId)
    .not('published_url', 'is', null)
    .limit(1000)
  if (libraryError) throw libraryError
  const library = new Map(
    (libraryRows || [])
      .filter((r) => urlKey(r.published_url))
      .map((r) => [urlKey(r.published_url), { slug: r.slug, title: r.title }])
  )
  const opportunities = buildOpportunities({
    days,
    queries: gscQueries,
    pagesCurrent: gscPagesCur,
    pagesPrevious: gscPagesPrev,
    aiChecks: aiChecks.filter((c) => !c.error),
    brand: brandTerms(context.productName, context.domain),
    library,
  })

  return {
    days,
    domain: context.domain,
    keywordCount: context.keywords.length,
    setup: {
      googleConfigured: Boolean(readServiceAccount()),
      serviceAccountEmail: readServiceAccount()?.client_email || null,
      bingConfigured: Boolean(bingApiKey()),
      dataforseoConfigured: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
      cronConfigured: Boolean(String(process.env.CRON_SECRET || '').trim()),
      status: settings.status || {},
      gscProperty: settings.gsc_property,
      ga4Property: settings.ga4_property,
      bingSite: settings.bing_site,
      overrides: {
        gsc: settings.gsc_property_override || '',
        ga4: settings.ga4_property_override || '',
        bing: settings.bing_site_override || '',
      },
      syncedAt: settings.synced_at,
      aiCheckedAt: settings.ai_checked_at,
      aiCheckDue: aiCheckDue(settings),
      botToken: settings.bot_token,
    },
    gsc,
    bing,
    traffic,
    pages,
    bots,
    ai: { checks: aiChecks, mentions },
    opportunities,
  }
}
