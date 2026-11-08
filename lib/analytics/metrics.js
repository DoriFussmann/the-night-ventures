// Pure aggregation helpers for the Analytics summary.

import { dateSpan } from './dates.js'
import { trafficAssistant } from './aiSources.js'

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Totals of daily search rows inside [from, to]. Position is impression-weighted.
 * @param {Array<{ date: string, clicks: number, impressions: number, position?: number | null }>} rows
 */
export function sumSearch(rows, from, to) {
  let clicks = 0
  let impressions = 0
  let posWeight = 0
  let posImpr = 0
  for (const r of rows || []) {
    if (!r?.date || r.date < from || r.date > to) continue
    clicks += n(r.clicks)
    impressions += n(r.impressions)
    if (r.position != null && Number.isFinite(Number(r.position))) {
      posWeight += Number(r.position) * n(r.impressions)
      posImpr += n(r.impressions)
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: posImpr > 0 ? posWeight / posImpr : null,
  }
}

/** Relative change, null when there is no baseline. */
export function change(current, previous) {
  const c = Number(current)
  const p = Number(previous)
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null
  return (c - p) / p
}

/**
 * Merge current + previous page stats.
 * @returns {{ top: object[], gainers: object[], losers: object[] }}
 */
export function comparePages(current, previous, { top = 20, movers = 10 } = {}) {
  const prev = new Map((previous || []).map((p) => [p.page, p]))
  const seen = new Set()
  const merged = []
  for (const c of current || []) {
    seen.add(c.page)
    const p = prev.get(c.page)
    merged.push({
      page: c.page,
      clicks: n(c.clicks),
      impressions: n(c.impressions),
      position: c.position == null ? null : Number(c.position),
      prevClicks: n(p?.clicks),
      delta: n(c.clicks) - n(p?.clicks),
    })
  }
  for (const p of previous || []) {
    if (seen.has(p.page)) continue
    merged.push({
      page: p.page,
      clicks: 0,
      impressions: 0,
      position: null,
      prevClicks: n(p.clicks),
      delta: -n(p.clicks),
    })
  }
  return {
    top: merged
      .filter((m) => m.clicks > 0 || m.impressions > 0)
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, top),
    gainers: merged
      .filter((m) => m.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, movers),
    losers: merged
      .filter((m) => m.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, movers),
  }
}

/**
 * GA4 source stats → channels, AI assistants, top sources (each with previous).
 * @param {Array<{ source: string, channel: string, ai_assistant: string | null, sessions: number, engaged_sessions: number }>} current
 * @param {typeof current} previous
 */
export function groupTraffic(current, previous) {
  const sumBy = (rows, keyOf) => {
    const map = new Map()
    for (const r of rows || []) {
      const key = keyOf(r)
      if (!key) continue
      const prev = map.get(key) || { sessions: 0, engaged: 0 }
      map.set(key, { sessions: prev.sessions + n(r.sessions), engaged: prev.engaged + n(r.engaged_sessions) })
    }
    return map
  }
  const merge = (cur, prev, limit) =>
    [...cur.entries()]
      .map(([name, v]) => ({
        name,
        sessions: v.sessions,
        engaged: v.engaged,
        prevSessions: prev.get(name)?.sessions || 0,
      }))
      .concat(
        [...prev.entries()]
          .filter(([name]) => !cur.has(name))
          .map(([name, v]) => ({ name, sessions: 0, engaged: 0, prevSessions: v.sessions }))
      )
      .sort((a, b) => b.sessions - a.sessions || b.prevSessions - a.prevSessions)
      .slice(0, limit)

  const channelKey = (r) => (r.ai_assistant ? 'AI assistants' : r.channel || 'Unassigned')
  return {
    channels: merge(sumBy(current, channelKey), sumBy(previous, channelKey), 20),
    assistants: merge(
      sumBy(current, (r) => r.ai_assistant),
      sumBy(previous, (r) => r.ai_assistant),
      20
    ),
    sources: merge(
      sumBy(current, (r) => r.source),
      sumBy(previous, (r) => r.source),
      15
    ),
  }
}

/** Sum a numeric field over rows. */
export function total(rows, field) {
  return (rows || []).reduce((acc, r) => acc + n(r?.[field]), 0)
}

// ---------------------------------------------------------------------------
// Chart timelines. `buckets` comes from chartBuckets() (daily or weekly).
// ---------------------------------------------------------------------------

/** Source groups for "Sources over time", in stacking order. */
export const SOURCE_GROUPS = ['organic', 'ai', 'direct', 'referral', 'social', 'other']

/** Fill ai_assistant from the source and GA4 channel, so older rows classify the same way. */
export function normalizeTraffic(rows) {
  return (rows || []).map((r) => ({
    ...r,
    ai_assistant: r.ai_assistant || trafficAssistant(r.source, r.channel),
  }))
}

/** Group key for one normalized GA4 row. */
export function sourceGroup(row) {
  if (row.ai_assistant) return 'ai'
  const channel = String(row.channel || '')
  if (channel === 'Organic Search') return 'organic'
  if (channel === 'Direct') return 'direct'
  if (channel === 'Referral') return 'referral'
  if (/Social/i.test(channel)) return 'social'
  return 'other'
}

function bucketIndex(buckets) {
  const map = new Map()
  buckets.forEach((b, i) => {
    for (const d of dateSpan(b.from, b.to)) map.set(d, i)
  })
  return map
}

const rate = (engaged, sessions) => (sessions > 0 ? engaged / sessions : null)

/**
 * Visits per bucket: totals, AI visits, sessions per source group and the
 * engagement rate for organic, AI and direct.
 */
export function trafficTimeline(rows, buckets) {
  const index = bucketIndex(buckets)
  const acc = buckets.map(() => {
    const point = { sessions: 0, ai_sessions: 0 }
    for (const g of SOURCE_GROUPS) {
      point[g] = 0
      point[`${g}_engaged`] = 0
    }
    return point
  })
  for (const r of rows || []) {
    const i = index.get(r.date)
    if (i === undefined) continue
    const sessions = n(r.sessions)
    const group = sourceGroup(r)
    acc[i].sessions += sessions
    if (group === 'ai') acc[i].ai_sessions += sessions
    acc[i][group] += sessions
    acc[i][`${group}_engaged`] += n(r.engaged_sessions)
  }
  return buckets.map((b, i) => {
    const a = acc[i]
    const point = { date: b.date, sessions: a.sessions, ai_sessions: a.ai_sessions }
    for (const g of SOURCE_GROUPS) point[g] = a[g]
    point.organic_rate = rate(a.organic_engaged, a.organic)
    point.ai_rate = rate(a.ai_engaged, a.ai)
    point.direct_rate = rate(a.direct_engaged, a.direct)
    return point
  })
}

/** Sessions and engaged sessions per source group. */
export function groupTotals(rows) {
  const out = Object.fromEntries(SOURCE_GROUPS.map((g) => [g, { sessions: 0, engaged: 0 }]))
  for (const r of rows || []) {
    const g = out[sourceGroup(r)]
    g.sessions += n(r.sessions)
    g.engaged += n(r.engaged_sessions)
  }
  return out
}

/** Search clicks and impressions per bucket. */
export function searchTimeline(dailyRows, buckets) {
  const index = bucketIndex(buckets)
  const acc = buckets.map((b) => ({ date: b.date, clicks: 0, impressions: 0 }))
  for (const r of dailyRows || []) {
    const i = index.get(r.date)
    if (i === undefined) continue
    acc[i].clicks += n(r.clicks)
    acc[i].impressions += n(r.impressions)
  }
  return acc
}

/** Crawler hits per bucket, by kind. */
export function botTimeline(rows, buckets) {
  const index = bucketIndex(buckets)
  const acc = buckets.map((b) => ({ date: b.date, ai_search: 0, ai_user: 0, ai_training: 0, search: 0 }))
  for (const r of rows || []) {
    const i = index.get(r.date)
    if (i === undefined || !(r.kind in acc[i])) continue
    acc[i][r.kind] += n(r.hits)
  }
  return acc
}

/**
 * AI Overview citations per bucket from the check history: for the latest run
 * inside each bucket, how many keywords cite the company out of those checked.
 * Buckets without a run get null (no point on the chart).
 * @param {Array<{ checked_at: string, cited: boolean | null, error?: string | null }>} checks
 */
export function citationTimeline(checks, buckets) {
  const index = bucketIndex(buckets)
  const runs = new Map()
  for (const c of checks || []) {
    if (!c?.checked_at || c.error) continue
    const run = runs.get(c.checked_at) || { at: c.checked_at, cited: 0, checked: 0 }
    run.checked += 1
    if (c.cited) run.cited += 1
    runs.set(c.checked_at, run)
  }
  const latest = buckets.map(() => null)
  for (const run of runs.values()) {
    const i = index.get(String(run.at).slice(0, 10))
    if (i === undefined) continue
    if (!latest[i] || run.at > latest[i].at) latest[i] = run
  }
  return buckets.map((b, i) => ({
    date: b.date,
    cited: latest[i] ? latest[i].cited : null,
    checked: latest[i] ? latest[i].checked : null,
  }))
}
