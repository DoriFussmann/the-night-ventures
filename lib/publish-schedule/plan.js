/**
 * Scheduled publishing: dates, reflows and status. Pure; shared by the
 * browser (Article Generation) and the daily publisher.
 *
 * Dates are local calendar days ("YYYY-MM-DD") in settings.timezone.
 */

export const DEFAULT_SETTINGS = Object.freeze({
  intervalDays: 2,
  weekends: 'allow', // 'allow' | 'skip'
  approval: 'approve', // 'approve' (default: hold each for approval) | 'auto'
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
    approval: v.approval === 'auto' ? 'auto' : 'approve',
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

/** A failed item used up its attempts; it waits for Retry now or Skip (it no longer blocks the rest). */
export function isStuck(item) {
  return item?.status === 'failed'
}

/** A run that died mid-publish (timeout) leaves 'publishing' behind; after this long it is retried. */
export const STALE_PUBLISHING_MINUTES = 20

export function isStalePublishing(item, now = new Date()) {
  if (item?.status !== 'publishing') return false
  const at = Date.parse(item.updated_at || '')
  if (!Number.isFinite(at)) return true
  return now.getTime() - at > STALE_PUBLISHING_MINUTES * 60000
}

/** Written and waiting for its day (or a dead 'publishing' run to redo). */
function isPublishable(item, now) {
  if (!item?.generated_article_id) return false
  return item.status === 'scheduled' || isStalePublishing(item, now)
}

/**
 * The item a schedule publishes next, and whether it is due today. Items that
 * are not written yet or failed are passed over so they never hold up the
 * written articles behind them; they are reported as needing attention.
 * @returns {{ item, due: boolean, reason?: string } | null}
 */
export function nextOf(schedule, items, today, now = new Date()) {
  const open = openItems(items)
  if (!open.length) return null
  const ready = open.find((item) => isPublishable(item, now))
  const live = open.find((item) => item.status === 'publishing' && !isStalePublishing(item, now))
  if (schedule?.status !== 'active') return { item: ready || open[0], due: false, reason: schedule?.status || 'inactive' }
  if (live) return { item: live, due: false, reason: 'publishing' }
  if (!ready) {
    const item = open[0]
    return { item, due: false, reason: isStuck(item) ? 'failed' : 'not_written' }
  }
  if (!ready.publish_on || ready.publish_on > today) return { item: ready, due: false, reason: 'later' }
  if (needsApproval(ready, schedule)) return { item: ready, due: false, reason: 'needs_approval' }
  return { item: ready, due: true }
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
export function itemLabel(item, schedule, today, now = new Date()) {
  if (item.status === 'published') return 'Live'
  if (item.status === 'skipped') return 'Skipped'
  if (item.status === 'failed') return 'Failed'
  if (item.status === 'publishing' && !isStalePublishing(item, now)) return 'Publishing'
  if (item.status === 'to_write') return schedule?.status === 'writing' ? 'Writing' : 'Not written'
  if (needsApproval(item, schedule)) {
    return item.publish_on && daysBetween(today, item.publish_on) <= 1 ? 'Needs approval' : 'Scheduled'
  }
  if (schedule?.status !== 'active') return 'Scheduled'
  if (item.publish_on && item.publish_on < today) return 'Late'
  if (item.publish_on && item.publish_on === today) return 'Due'
  return 'Scheduled'
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
  const notWritten = list.filter((item) => item.status === 'to_write' && item.last_error)
  return {
    total: counted.length,
    published,
    toWrite,
    failed: failed.length,
    // Items the user has to act on (Retry/Skip, or fix the spec and Resume writing).
    attention: failed.length + notWritten.length,
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
  const attention = s.attention ? `, ${s.attention} need${s.attention === 1 ? 's' : ''} attention` : ''
  if (s.nextReason === 'failed' || s.nextReason === 'not_written') return `${head}${attention || ', nothing ready to publish'}`
  if (s.next?.publish_on) return `${head}, next ${formatDay(s.next.publish_on)}${attention}`
  return `${head}${attention}`
}

/** "Planned Oct 28, published Nov 1 (4 days late)." or '' when on time. */
export function lateNote(plannedDay, publishedDay) {
  if (!DAY_RE.test(String(plannedDay || '')) || !DAY_RE.test(String(publishedDay || ''))) return ''
  const late = daysBetween(plannedDay, publishedDay)
  if (late <= 0) return ''
  return `Planned for ${formatDay(plannedDay)}, published ${formatDay(publishedDay)} (${late} day${late === 1 ? '' : 's'} late).`
}

/**
 * Turn a stored publish/writing error into what happened and what to do.
 * Works on errors already saved, so old rows read better too.
 */
export function friendlyError(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const rules = [
    [/spec is not complete/i, 'Its article spec is incomplete. In Advisor, give it an angle and 3–5 key messages, then click Resume writing.'],
    [/no longer in the map/i, 'This keyword was removed from the keyword map. Skip it, or add it back in Advisor and click Resume writing.'],
    [/already has an article/i, 'This keyword already has an article. Skip it.'],
    [/draft for this article no longer exists/i, 'Its draft was deleted from Articles. Skip it, or write it again.'],
    [/bad credentials|401|token.*(expired|invalid)|GITHUB_TOKEN/i, 'GitHub refused the site’s access token (it is missing, wrong or expired). Renew the GITHUB_TOKEN_… value in Vercel, then click Retry now.'],
    [/^Publish destination/i, 'The site’s GitHub destination is not set up correctly. Check Publish Destination in Company Intelligence, then click Retry now.'],
    [/seo-core/i, 'The site runs an seo-core version this app does not support. Update it under Admin → Core Version, then click Retry now.'],
    [/merge failed|not mergeable|conflict/i, 'GitHub could not merge the article into the site (usually a conflict or branch protection). Check the site repo’s open pull requests, then click Retry now.'],
    [/rate limit|429|overloaded|529|timeout|timed out|ECONNRESET|fetch failed|network/i, 'A temporary outage (GitHub or the model). It usually works on retry: click Retry now.'],
  ]
  const hit = rules.find(([re]) => re.test(text))
  return hit ? `${hit[1]} (Detail: ${text})` : text
}
