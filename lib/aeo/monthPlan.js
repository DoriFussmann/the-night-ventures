/**
 * AEO monthly plan: how many articles next month needs, and which prompt
 * groups fill them. Pure; shared by the browser.
 *
 * - Working days: Monday to Friday, minus the 7 US holidays.
 * - Slots: working days not already used by another schedule of the site.
 * - Score per open group: intent × demand × business value (× small bonuses).
 *   Test results (Gap) join this in phase 2.
 * - Allocation: greedy by value; the k-th article on one theme (pillar) is
 *   worth score × DECAY^k; at most CAP per theme while other themes still have
 *   groups. Fewer groups than slots = shortfall: the plan cannot be approved.
 * - Days: themes interleaved (round robin, strongest first).
 */
import { addDays, isWeekend } from '../publish-schedule/plan.js'
import { isUsHoliday, usHolidayName } from '../publish-schedule/holidays.js'
import { groupStats, isOpenGroup } from './nextUp.js'

export const DECAY = 0.6
export const CAP = 5
export const LEAD_WORKDAYS = 5
export const INTENT_WEIGHT = { Buy: 1, Problem: 0.6, Learn: 0.3 }
const VALUE_WEIGHT = { 1: 0.8, 2: 0.9, 3: 1 }

export const isWorkday = (day) => !isWeekend(day) && !isUsHoliday(day)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-12-01" → "December 2026". */
export function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** First day of the month after `today`. */
export function nextMonthStart(today) {
  const [y, m] = String(today).split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

export function shiftMonth(month, n) {
  const [y, m] = String(month).split('-').map(Number)
  const t = (y * 12 + (m - 1)) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

/** Every calendar day of a month: [{ day, workday, holiday }]. */
export function monthCalendar(month) {
  const out = []
  let d = month
  while (d.slice(0, 7) === month.slice(0, 7)) {
    out.push({ day: d, workday: isWorkday(d), weekend: isWeekend(d), holiday: usHolidayName(d) })
    d = addDays(d, 1)
  }
  return out
}

export function workingDays(month) {
  return monthCalendar(month).filter((c) => c.workday).map((c) => c.day)
}

/** The day the plan is due: LEAD_WORKDAYS working days before the month starts (counting the last day back). */
export function planDueDay(month, lead = LEAD_WORKDAYS) {
  let d = addDays(month, -1)
  let n = 0
  for (let guard = 0; guard < 60; guard += 1) {
    if (isWorkday(d)) {
      n += 1
      if (n === lead) return d
    }
    d = addDays(d, -1)
  }
  return d
}

function demandRaw(stats) {
  return Math.log1p(stats.impressions || 0) + 0.5 * Math.log1p(stats.volume || 0)
}

/** Score 0..~1.3 for one group from its prompt stats. `maxDemand` normalises demand across the candidates. */
export function scoreGroup(group, stats, maxDemand) {
  const intent = INTENT_WEIGHT[stats.dominant] ?? INTENT_WEIGHT.Learn
  const demand = maxDemand > 0 ? demandRaw(stats) / maxDemand : 0
  const value = VALUE_WEIGHT[Math.round(stats.value)] ?? 0.9
  const ranking = stats.bestPosition != null && stats.bestPosition <= 20 ? 1.1 : 1
  const pillarArticle = group.page_type === 'pillar' ? 1.15 : 1
  return intent * (0.4 + 0.6 * demand) * value * ranking * pillarArticle
}

/**
 * Open groups with their score, best first.
 * @returns {Array<{ group, pillar, stats, score, why: string[] }>}
 */
export function scoreCandidates({ pillars, groups, prompts, excludeGroupIds = new Set() }) {
  const pillarById = new Map(pillars.map((p) => [p.id, p]))
  const byGroup = new Map()
  for (const p of prompts) {
    if (!p.group_id) continue
    if (!byGroup.has(p.group_id)) byGroup.set(p.group_id, [])
    byGroup.get(p.group_id).push(p)
  }
  const items = groups
    .filter((g) => isOpenGroup(g) && !excludeGroupIds.has(g.id))
    .map((g) => ({ group: g, pillar: pillarById.get(g.pillar_id) || null, stats: groupStats(byGroup.get(g.id) || []) }))
  const maxDemand = Math.max(0, ...items.map((i) => demandRaw(i.stats)))
  return items
    .map((i) => {
      const why = [`${i.stats.count} prompts`, `mostly ${i.stats.dominant}`]
      if (i.stats.bestPosition != null) why.push(`Google position ${Math.round(i.stats.bestPosition)}`)
      if (i.stats.impressions) why.push(`${i.stats.impressions} impressions`)
      if (i.stats.volume) why.push(`volume ${i.stats.volume}`)
      if (i.group.page_type === 'pillar') why.unshift('Pillar article')
      return { ...i, score: scoreGroup(i.group, i.stats, maxDemand), why }
    })
    .sort((a, b) => b.score - a.score || String(a.group.code).localeCompare(String(b.group.code)))
}

const themeKey = (item) => item.pillar?.id || 'none'

/**
 * Pick `slots` candidates. Returns { picks: [...candidate, k, value], shortfall, capRelaxed }.
 */
export function allocate(candidates, slots, { decay = DECAY, cap = CAP } = {}) {
  const queues = new Map()
  for (const c of candidates) {
    const k = themeKey(c)
    if (!queues.has(k)) queues.set(k, [])
    queues.get(k).push(c)
  }
  const taken = new Map()
  const picks = []
  let capRelaxed = false
  const nextValue = (k) => queues.get(k)[0].score * Math.pow(decay, taken.get(k) || 0)
  while (picks.length < slots) {
    const open = [...queues.keys()].filter((k) => queues.get(k).length)
    if (!open.length) break
    let pool = open.filter((k) => (taken.get(k) || 0) < cap)
    if (!pool.length) {
      pool = open
      capRelaxed = true
    }
    pool.sort((a, b) => nextValue(b) - nextValue(a))
    const k = pool[0]
    const value = nextValue(k)
    const item = queues.get(k).shift()
    picks.push({ ...item, k: taken.get(k) || 0, value })
    taken.set(k, (taken.get(k) || 0) + 1)
  }
  return { picks, shortfall: Math.max(0, slots - picks.length), capRelaxed }
}

/** Publish order: themes round robin, strongest theme first, each theme's picks in pick order. */
export function interleave(picks) {
  const queues = new Map()
  for (const p of picks) {
    const k = themeKey(p)
    if (!queues.has(k)) queues.set(k, [])
    queues.get(k).push(p)
  }
  const order = [...queues.keys()].sort((a, b) => queues.get(b)[0].value - queues.get(a)[0].value)
  const out = []
  while (out.length < picks.length) {
    for (const k of order) if (queues.get(k).length) out.push(queues.get(k).shift())
  }
  return out
}

/**
 * The plan for one month.
 * @param {{ month, pillars, groups, prompts, excludeGroupIds?, removedGroupIds?, takenDays?: string[] }} input
 */
export function buildMonthPlan({ month, pillars, groups, prompts, excludeGroupIds = new Set(), removedGroupIds = new Set(), takenDays = [] }) {
  const workdays = workingDays(month)
  const busy = new Set(takenDays)
  const freeDays = workdays.filter((d) => !busy.has(d))
  const exclude = new Set([...excludeGroupIds, ...removedGroupIds])
  const candidates = scoreCandidates({ pillars, groups, prompts, excludeGroupIds: exclude })
  const { picks, shortfall, capRelaxed } = allocate(candidates, freeDays.length)
  const ordered = interleave(picks).map((p, i) => ({ ...p, day: freeDays[i] }))
  const pickedIds = new Set(picks.map((p) => p.group.id))
  return {
    month,
    workdays,
    freeDays,
    takenDays: workdays.filter((d) => busy.has(d)),
    slots: freeDays.length,
    picks: ordered,
    shortfall,
    capRelaxed,
    spare: candidates.filter((c) => !pickedIds.has(c.group.id)),
  }
}

/** Group the plan's picks by theme, in theme strength order. */
export function themesOf(picks) {
  const map = new Map()
  for (const p of picks) {
    const k = themeKey(p)
    if (!map.has(k)) map.set(k, { key: k, pillar: p.pillar, picks: [], score: p.score })
    const t = map.get(k)
    t.picks.push(p)
    t.score = Math.max(t.score, p.score)
  }
  for (const t of map.values()) t.picks.sort((a, b) => a.k - b.k)
  return [...map.values()].sort((a, b) => b.score - a.score)
}
