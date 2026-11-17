// Events view: which weekly metrics exist, which weeks count as a "move", and
// what a move is made of. Pure.

import { addDays, parseIsoDate, isoDate } from './dates.js'

export const WEEKS_SHOWN = 26
const LOOKBACK_WEEKS = 4
const MOVE_SHARE = 0.5

/**
 * minMove: smallest weekly change (in the metric's unit) worth flagging.
 * eventDays: how far back before a move an event can still be its cause.
 * gaps: 'zero' when a week with no rows means 0, 'skip' when it means not measured.
 */
export const METRICS = [
  {
    id: 'search_top10', group: 'search', label: 'Google impressions in the top 10',
    note: 'Times a page showed on page 1 of Google (position 10 or better).',
    minMove: 20, eventDays: 35, gaps: 'zero', parts: 'pages',
  },
  {
    id: 'search_impressions', group: 'search', label: 'Google impressions',
    note: 'Every time a page showed in Google, at any position.',
    minMove: 100, eventDays: 35, gaps: 'zero', parts: 'pages',
  },
  {
    id: 'search_clicks', group: 'search', label: 'Google clicks',
    note: 'Clicks from Google results.',
    minMove: 5, eventDays: 35, gaps: 'zero', parts: 'pages',
  },
  {
    id: 'ai_mention_rate', group: 'ai', label: 'Named or cited in AI answers', unit: '%',
    note: 'Share of prompt-test runs where the brand is named or one of its pages is cited.',
    minMove: 10, eventDays: 35, gaps: 'skip', parts: null,
  },
  {
    id: 'ai_sessions', group: 'ai', label: 'Visits from AI assistants',
    note: 'Visits that arrived from an AI answer (GA4).',
    minMove: 8, eventDays: 35, gaps: 'zero', parts: 'landing pages',
  },
  {
    id: 'ai_crawler_hits', group: 'ai', label: 'AI crawler page reads',
    note: 'Pages read by AI crawlers (needs crawler tracking).',
    minMove: 30, eventDays: 21, gaps: 'skip', parts: 'crawlers',
  },
  {
    id: 'traffic_engaged', group: 'traffic', label: 'Engaged visits',
    note: 'Visits that stayed, clicked or converted (GA4).',
    minMove: 20, eventDays: 14, gaps: 'zero', parts: 'sources',
  },
  {
    id: 'traffic_engaged_ex_direct', group: 'traffic', label: 'Engaged visits, excluding direct',
    note: 'Engaged visits without direct traffic, which often includes your own team and bots.',
    minMove: 10, eventDays: 14, gaps: 'zero', parts: 'sources',
  },
  {
    id: 'traffic_sessions', group: 'traffic', label: 'All visits',
    note: 'Every visit from every source (GA4).',
    minMove: 40, eventDays: 14, gaps: 'zero', parts: 'sources',
  },
]

export const DEFAULT_METRIC = 'search_top10'

export function metricById(id) {
  return METRICS.find((m) => m.id === id) || null
}

/** Monday (UTC) of the week containing `iso`. */
export function weekStart(iso) {
  const date = parseIsoDate(iso)
  if (!date) return null
  const offset = (date.getUTCDay() + 6) % 7
  return isoDate(new Date(date.getTime() - offset * 86400000))
}

/**
 * The Mondays of the last `count` complete weeks, oldest first. A week is
 * complete when its Sunday is on or before `lastDate`.
 * @param {string | null} lastDate latest date with data
 */
export function completeWeeks(lastDate, count = WEEKS_SHOWN) {
  if (!parseIsoDate(lastDate)) return []
  let last = weekStart(lastDate)
  if (addDays(last, 6) > lastDate) last = addDays(last, -7)
  const out = []
  for (let i = count - 1; i >= 0; i -= 1) out.push(addDays(last, -7 * i))
  return out
}

/**
 * Rows from analytics_events_weekly laid onto `weeks`.
 * Weeks with no row are 0 ('zero') or null ('skip'); leading weeks before the
 * first row are always null, so history that was never tracked is not read as zero.
 * @returns {Array<{ week: string, value: number | null }>}
 */
export function fillSeries(weeks, rows, gaps = 'zero') {
  const byWeek = new Map((rows || []).map((r) => [String(r.week).slice(0, 10), Number(r.value)]))
  const first = [...byWeek.keys()].sort()[0] || null
  return weeks.map((week) => {
    if (byWeek.has(week)) return { week, value: byWeek.get(week) }
    if (gaps === 'zero' && first && week > first) return { week, value: 0 }
    return { week, value: null }
  })
}

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length

/**
 * Flag weeks that differ from the average of the 4 measured weeks before them
 * by more than half and by at least `minMove`, then merge neighbours that moved
 * the same way into one move.
 * @param {Array<{ week: string, value: number | null }>} series
 * @returns {Array<{ start: string, end: string, direction: 'up' | 'down', value: number, baseline: number, weeks: number }>}
 */
export function detectMoves(series, { minMove = 1 } = {}) {
  const flags = []
  for (let i = 0; i < series.length; i += 1) {
    const point = series[i]
    if (point.value == null) continue
    const before = series.slice(0, i).filter((p) => p.value != null).slice(-LOOKBACK_WEEKS)
    if (before.length < LOOKBACK_WEEKS) continue
    const baseline = mean(before.map((p) => p.value))
    const diff = point.value - baseline
    if (Math.abs(diff) < minMove) continue
    if (Math.abs(diff) <= MOVE_SHARE * baseline) continue
    flags.push({ week: point.week, value: point.value, baseline, diff, direction: diff > 0 ? 'up' : 'down' })
  }

  const moves = []
  for (const f of flags) {
    const last = moves[moves.length - 1]
    if (last && last.direction === f.direction && addDays(last.end, 7) === f.week) {
      last.end = f.week
      last.weeks += 1
      if (Math.abs(f.value - last.baseline) > Math.abs(last.value - last.baseline)) last.value = f.value
    } else {
      moves.push({ start: f.week, end: f.week, direction: f.direction, value: f.value, baseline: f.baseline, weeks: 1 })
    }
  }
  return moves.map((m) => ({ ...m, baseline: Math.round(m.baseline * 10) / 10 }))
}

/** Date ranges a move is compared over and searched for events in. */
export function moveWindows(move, metric) {
  return {
    current: { from: move.start, to: addDays(move.end, 6) },
    baseline: { from: addDays(move.start, -7 * LOOKBACK_WEEKS), to: addDays(move.start, -1) },
    events: { from: addDays(move.start, -(metric?.eventDays || 28)), to: addDays(move.end, 6) },
  }
}

/**
 * The parts that changed most between the baseline and the move, per week.
 * @param {Array<{ key: string, value: number }>} current totals over the move's weeks
 * @param {Array<{ key: string, value: number }>} baseline totals over the 4 weeks before
 * @param {number} weeks number of weeks in the move
 */
export function topContributors(current, baseline, weeks, limit = 5) {
  const cur = new Map((current || []).map((r) => [r.key, Number(r.value) / Math.max(1, weeks)]))
  const base = new Map((baseline || []).map((r) => [r.key, Number(r.value) / LOOKBACK_WEEKS]))
  const keys = new Set([...cur.keys(), ...base.keys()])
  const rows = [...keys].map((key) => {
    const c = cur.get(key) || 0
    const b = base.get(key) || 0
    return { key, current: c, baseline: b, delta: c - b }
  })
  const totalDelta = rows.reduce((sum, r) => sum + r.delta, 0)
  const round = (n) => Math.round(n * 10) / 10
  return rows
    .filter((r) => Math.abs(r.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit)
    .map((r) => ({
      key: r.key,
      current: round(r.current),
      baseline: round(r.baseline),
      delta: round(r.delta),
      // Share of the net change. Null when parts cancel out and a share would mislead.
      share: Math.abs(totalDelta) >= 1 && Math.sign(r.delta) === Math.sign(totalDelta)
        ? Math.min(1, Math.round((r.delta / totalDelta) * 100) / 100)
        : null,
    }))
}

/**
 * How a newly detected move relates to stored annotations on the same metric.
 * @returns {{ kind: 'new' } | { kind: 'covered' } | { kind: 'extend', annotation: object } | { kind: 'old' }}
 */
export function classifyMove(move, annotations, analyzedThrough) {
  const hit = (annotations || []).find(
    (a) => a.direction === move.direction && move.start <= addDays(a.through_week, 7) && move.end >= a.week_start
  )
  if (hit) return move.end > hit.through_week ? { kind: 'extend', annotation: hit } : { kind: 'covered' }
  if (analyzedThrough && move.end <= analyzedThrough) return { kind: 'old' }
  return { kind: 'new' }
}

const pct = (share) => `${Math.round(share * 100)}%`

/** Verdict written without a model: used when no API key is set or the call fails. */
export function ruleVerdict({ move, metric, contributors, events }) {
  const top = contributors[0]
  const lead = top && top.share != null && top.share >= 0.4
  const parts = []
  if (lead) {
    parts.push(`${top.key} accounts for ${pct(top.share)} of the change (${top.baseline} to ${top.current} a week).`)
  } else if (contributors.length) {
    parts.push(`The change is spread across ${metric?.parts || 'several parts'}; the largest is ${top.key}.`)
  }
  if (events.length) {
    parts.push(
      `${events.length === 1 ? 'One logged event falls' : `${events.length} logged events fall`} in the window: ${events
        .slice(0, 3)
        .map((e) => `${e.title} (${e.date})`)
        .join('; ')}. Timing matches but the link is not confirmed.`
    )
  } else {
    parts.push('No logged event falls in the window.')
  }
  const verdict = events.length ? 'partly' : 'unexplained'
  return {
    verdict,
    summary: parts.join(' '),
    links: events.slice(0, 3).map((e) => ({ id: e.id, strength: 'possible' })),
    model: null,
  }
}
