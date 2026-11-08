// UTC calendar-date helpers (YYYY-MM-DD strings). Pure.

const DAY_MS = 24 * 60 * 60 * 1000

export const RANGE_DAYS = [7, 28, 90]

/** @param {Date} date */
export function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

/** @param {string} iso YYYY-MM-DD */
export function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * @param {string} iso
 * @param {number} days
 */
export function addDays(iso, days) {
  const date = parseIsoDate(iso)
  if (!date) return null
  return isoDate(new Date(date.getTime() + days * DAY_MS))
}

/** Today (UTC) shifted by `offset` days. */
export function utcToday(offset = 0, now = new Date()) {
  return isoDate(new Date(now.getTime() + offset * DAY_MS))
}

/** GA4 "20261012" → "2026-10-12". */
export function fromCompactDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value || ''))
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

/** Bing "/Date(1316156400000-0700)/" → "YYYY-MM-DD" (UTC calendar date of the instant + offset). */
export function fromMsJsonDate(value) {
  const match = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(String(value || ''))
  if (!match) return null
  let ms = Number(match[1])
  if (match[2]) {
    const sign = match[2][0] === '-' ? -1 : 1
    const hours = Number(match[2].slice(1, 3))
    const minutes = Number(match[2].slice(3, 5))
    ms += sign * (hours * 60 + minutes) * 60 * 1000
  }
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : isoDate(date)
}

/**
 * Current and previous windows of `days` length ending at `end` (inclusive).
 * @param {string} end YYYY-MM-DD
 * @param {number} days
 */
export function periodWindows(end, days) {
  const currentFrom = addDays(end, -(days - 1))
  const previousTo = addDays(currentFrom, -1)
  const previousFrom = addDays(previousTo, -(days - 1))
  return {
    current: { from: currentFrom, to: end },
    previous: { from: previousFrom, to: previousTo },
  }
}

/** Every date from `from` to `to` inclusive. */
export function dateSpan(from, to) {
  const out = []
  let cursor = from
  let guard = 0
  while (cursor && cursor <= to && guard < 1000) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
    guard += 1
  }
  return out
}

/** Chart point size for a range: daily up to 28 days, weekly beyond. */
export function granularityFor(days) {
  return Number(days) > 28 ? 'week' : 'day'
}

/**
 * Chart buckets covering [from, to]. Weekly buckets are counted back from `to`,
 * so every bucket is a full 7 days except possibly the oldest one.
 * Each bucket is labelled by its first day.
 * @returns {Array<{ date: string, from: string, to: string }>}
 */
export function chartBuckets(from, to, granularity) {
  if (!from || !to || from > to) return []
  if (granularity !== 'week') return dateSpan(from, to).map((d) => ({ date: d, from: d, to: d }))
  const out = []
  let end = to
  let guard = 0
  while (end >= from && guard < 200) {
    const start = addDays(end, -6) < from ? from : addDays(end, -6)
    out.unshift({ date: start, from: start, to: end })
    end = addDays(start, -1)
    guard += 1
  }
  return out
}
