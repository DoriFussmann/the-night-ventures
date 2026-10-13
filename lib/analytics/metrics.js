// Pure aggregation helpers for the Analytics summary.

import { dateSpan } from './dates.js'

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

/** One point per day in [from, to], zero-filled. */
export function dailySeries(rows, from, to, fields) {
  const byDate = new Map()
  for (const r of rows || []) {
    if (r?.date) byDate.set(r.date, r)
  }
  return dateSpan(from, to).map((date) => {
    const row = byDate.get(date)
    const point = { date }
    for (const f of fields) point[f] = n(row?.[f])
    return point
  })
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
