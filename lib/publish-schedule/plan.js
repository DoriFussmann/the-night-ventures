/**
 * Scheduled publishing: dates, reflows and status. Pure; shared by the
 * browser (Article Generation) and the daily publisher.
 *
 * Dates are local calendar days ("YYYY-MM-DD") in settings.timezone.
 */

export const DEFAULT_SETTINGS = Object.freeze({
  intervalDays: 2,
  weekends: 'allow', // 'allow' | 'skip'
  approval: 'auto', // 'auto' | 'approve'
  timezone: 'America/Los_Angeles',
})
export const MAX_ATTEMPTS = 3
export const STALE_DRAFT_DAYS = 14

/** Items still to go out. */
export const OPEN_STATUSES = new Set(['to_write', 'scheduled', 'publishing', 'failed'])
/** Schedules still running (one per pillar). */
export const OPEN_SCHEDULE_STATUSES = new Set(['writing', 'active', 'paused'])

export function normalizeSettings(value = {}) {
  const v = value && typeof value === 'object' ? value : {}
  const interval = Math.round(Number(v.intervalDays))
  return {
    intervalDays: interval >= 1 && interval <= 7 ? interval : DEFAULT_SETTINGS.intervalDays,
    weekends: v.weekends === 'skip' ? 'skip' : 'allow',
    approval: v.approval === 'approve' ? 'approve' : 'auto',
    timezone: String(v.timezone || '').trim() || DEFAULT_SETTINGS.timezone,
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Today's calendar day in a time zone. */
export function todayIn(timezone = DEFAULT_SETTINGS.timezone, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return new Date(now).toISOString().slice(0, 10)
  }
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Number(n || 0))
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

export function isWeekend(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}

function firstAllowed(day, settings, taken) {
  let d = day
  for (let i = 0; i < 400; i += 1) {
    const weekendOk = settings.weekends !== 'skip' || !isWeekend(d)
    if (weekendOk && !taken.has(d)) return d
    d = addDays(d, 1)
  }
  return d
}

/**
 * Publish days for `count` articles: the first on `start` (or the next allowed
 * day), then one every intervalDays. Days in `taken` (another schedule on the
 * same site) and skipped weekends push an article to the next free day.
 */
export function planDates({ count, start, settings, taken = [] }) {
  const s = normalizeSettings(settings)
  const busy = new Set(taken)
  const out = []
  let d = firstAllowed(start, s, busy)
  for (let i = 0; i < count; i += 1) {
    out.push(d)
    busy.add(d)
    d = firstAllowed(addDays(d, s.intervalDays), s, busy)
  }
  return out
}

function byDateThenPosition(a, b) {
  const da = a.publish_on || '9999-12-31'
  const db = b.publish_on || '9999-12-31'
  return da.localeCompare(db) || (a.position ?? 0) - (b.position ?? 0)
}

/** Open items in the order they go out. */
export function openItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => OPEN_STATUSES.has(item.status))
    .sort(byDateThenPosition)
}

/**
 * Re-space every open item from `start`, keeping their order. Returns
 * [{ id, publish_on }] for the items whose day changed.
 */
export function reflowOpen(items, { start, settings, taken = [] }) {
  const open = openItems(items)
  const dates = planDates({ count: open.length, start, settings, taken })
  const changes = []
  open.forEach((item, i) => {
    if (item.publish_on !== dates[i]) changes.push({ id: item.id, publish_on: dates[i] })
  })
  return changes
}

/** Days used by other open schedules of the same company (one article per site per day). */
export function takenDays(otherItems) {
  return (Array.isArray(otherItems) ? otherItems : [])
    .filter((item) => OPEN_STATUSES.has(item.status) && DAY_RE.test(String(item.publish_on || '')))
    .map((item) => item.publish_on)
}

export function needsApproval(item, schedule) {
  return normalizeSettings(schedule?.settings).approval === 'approve' && !item?.approved_at
}

/** A failed item that used up its attempts stops the schedule until someone acts. */
export function isStuck(item) {
  return item?.status === 'failed'
}

/**
 * The item a schedule publishes next, and whether it is due today.
 * @returns {{ item, due: boolean, reason?: string } | null}
 */
export function nextOf(schedule, items, today) {
  const open = openItems(items)
  if (!open.length) return null
  const stuck = open.find(isStuck)
  if (stuck) return { item: stuck, due: false, reason: 'failed' }
  const item = open[0]
  if (schedule?.status !== 'active') return { item, due: false, reason: schedule?.status || 'inactive' }
  if (item.status === 'to_write' || !item.generated_article_id) return { item, due: false, reason: 'not_written' }
  if (item.status !== 'scheduled') return { item, due: false, reason: item.status }
  if (!item.publish_on || item.publish_on > today) return { item, due: false, reason: 'later' }
  if (needsApproval(item, schedule)) return { item, due: false, reason: 'needs_approval' }
  return { item, due: true }
}

/**
 * Items to publish in this run: at most one per schedule, and at most one per
 * company (site) per day — a company that already published today is skipped.
 * @param schedules rows with settings
 * @param items all items of those schedules
 * @param publishedToday Set of company ids that already published today
 */
export function dueItems(schedules, items, { now = new Date(), publishedToday = new Set() } = {}) {
  const bySchedule = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (!bySchedule.has(item.schedule_id)) bySchedule.set(item.schedule_id, [])
    bySchedule.get(item.schedule_id).push(item)
  }
  const candidates = []
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    const today = todayIn(normalizeSettings(schedule.settings).timezone, now)
    const next = nextOf(schedule, bySchedule.get(schedule.id) || [], today)
    if (next?.due) candidates.push({ schedule, item: next.item })
  }
  candidates.sort((a, b) => byDateThenPosition(a.item, b.item))
  const companies = new Set(publishedToday)
  const out = []
  for (const c of candidates) {
    if (companies.has(c.schedule.company_id)) continue
    companies.add(c.schedule.company_id)
    out.push(c)
  }
  return out
}

/** Label shown in the status panel for one item. */
export function itemLabel(item, schedule, today) {
  if (item.status === 'published') return 'Live'
  if (item.status === 'skipped') return 'Skipped'
  if (item.status === 'failed') return 'Failed'
  if (item.status === 'publishing') return 'Publishing'
  if (item.status === 'to_write') return schedule?.status === 'writing' ? 'Writing' : 'Not written'
  const next = nextOf(schedule, [item], today)
  if (needsApproval(item, schedule)) {
    return item.publish_on && daysBetween(today, item.publish_on) <= 1 ? 'Needs approval' : 'Scheduled'
  }
  return next?.due ? 'Due' : 'Scheduled'
}

/**
 * Summary for the panel and the Advisor: "3 of 6 published, next Nov 1".
 */
export function summarize(schedule, items, today) {
  const list = Array.isArray(items) ? items : []
  const counted = list.filter((item) => item.status !== 'skipped')
  const published = counted.filter((item) => item.status === 'published').length
  const next = nextOf(schedule, list, today)
  const toWrite = list.filter((item) => item.status === 'to_write').length
  const failed = list.filter((item) => item.status === 'failed')
  return {
    total: counted.length,
    published,
    toWrite,
    failed: failed.length,
    next: next?.item || null,
    nextReason: next?.reason || (next?.due ? 'due' : null),
    done: openItems(list).length === 0,
  }
}

export function formatDay(day) {
  if (!DAY_RE.test(String(day || ''))) return ''
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** One line, e.g. "Investor outreach: 3 of 6 published, next Nov 1". */
export function summaryLine(schedule, items, today) {
  const s = summarize(schedule, items, today)
  const head = `${schedule?.pillar_keyword || 'Schedule'}: ${s.published} of ${s.total} published`
  if (schedule?.status === 'paused') return `${head}, paused`
  if (schedule?.status === 'cancelled') return `${head}, cancelled`
  if (s.done) return `${head}, done`
  if (s.nextReason === 'failed') return `${head}, a publish failed and needs attention`
  if (s.next?.publish_on) return `${head}, next ${formatDay(s.next.publish_on)}`
  return head
}
