/**
 * The 7 US holidays nothing publishes on: New Year's Day, Memorial Day,
 * Independence Day, Labor Day, Thanksgiving, the day after Thanksgiving and
 * Christmas. A fixed-date holiday on a Saturday is observed on the Friday
 * before, on a Sunday on the Monday after. Pure; days are "YYYY-MM-DD".
 */

const pad = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

function dow(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = dow(y, m, 1)
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return last - ((dow(y, m, last) - weekday + 7) % 7)
}

function observed(y, m, d) {
  const w = dow(y, m, d)
  const shift = w === 6 ? -1 : w === 0 ? 1 : 0
  const t = new Date(Date.UTC(y, m - 1, d + shift))
  return t.toISOString().slice(0, 10)
}

const cache = new Map()

/** Map day → holiday name for one year (includes Dec 31 of the year before when New Year's is observed then). */
export function usHolidays(year) {
  if (cache.has(year)) return cache.get(year)
  const thanks = nthWeekday(year, 11, 4, 4)
  const out = new Map([
    [observed(year, 1, 1), "New Year's Day"],
    [ymd(year, 5, nthWeekday(year, 5, 1, -1)), 'Memorial Day'],
    [observed(year, 7, 4), 'Independence Day'],
    [ymd(year, 9, nthWeekday(year, 9, 1, 1)), 'Labor Day'],
    [ymd(year, 11, thanks), 'Thanksgiving'],
    [ymd(year, 11, thanks + 1), 'Day after Thanksgiving'],
    [observed(year, 12, 25), 'Christmas'],
  ])
  cache.set(year, out)
  return out
}

/** Holiday name for a day, or "". Checks next year too (New Year's observed on Dec 31). */
export function usHolidayName(day) {
  const y = Number(String(day).slice(0, 4))
  if (!y) return ''
  return usHolidays(y).get(day) || usHolidays(y + 1).get(day) || ''
}

export function isUsHoliday(day) {
  return Boolean(usHolidayName(day))
}
