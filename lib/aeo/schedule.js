/**
 * AEO Generation: publish days for approved briefs. Pure; shared by the browser.
 *
 * A weekly batch goes out one article per workday from the Monday in its
 * label ("Week of YYYY-MM-DD"). If that Monday has passed, it starts the next
 * workday. A single article takes the next free workday. Days another
 * schedule of the same site already uses are skipped (one article per day).
 */
import { addDays, isWeekend } from '../publish-schedule/plan.js'

export function weekStartFromLabel(label) {
  const m = /Week of (\d{4}-\d{2}-\d{2})/.exec(String(label || ''))
  return m ? m[1] : ''
}

/**
 * @param {number} count articles to place
 * @param {{ today: string, batchLabel?: string, taken?: string[] }} opts
 * @returns {string[]} one YYYY-MM-DD per article
 */
export function planPublishDays(count, { today, batchLabel = '', taken = [] }) {
  const busy = new Set(taken)
  const tomorrow = addDays(today, 1)
  const weekStart = weekStartFromLabel(batchLabel)
  let day = weekStart && weekStart > tomorrow ? weekStart : tomorrow
  const out = []
  for (let guard = 0; out.length < count && guard < 400; guard += 1) {
    if (!isWeekend(day) && !busy.has(day)) {
      out.push(day)
      busy.add(day)
    }
    day = addDays(day, 1)
  }
  return out
}

/** Topic slug for a pillar: from its hub path, else from its topic name. */
export function pillarSlug(pillar) {
  const fromHub = String(pillar?.hub_path || '').split('/').filter(Boolean).pop()
  if (fromHub) return fromHub
  return String(pillar?.topic_name || pillar?.name || 'pillar')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Schedule key for AEO publishing, kept apart from older per-pillar schedules. */
export function aeoScheduleSlug(pillar) {
  return `aeo-${pillarSlug(pillar)}`
}

/** Reader intent for the writer, from the brief's dominant tier. */
export function searchIntentFor(tier) {
  if (tier === 'Buy') return 'commercial: the reader is choosing a provider or approach and wants a recommendation'
  if (tier === 'Problem') return 'problem-aware: the reader has a fundraising problem and wants a way to solve it'
  return 'informational: the reader wants to understand how something works'
}

/**
 * CTA wording for the writer. Tool pages, Resources and the newsletter do not
 * exist yet, so every tier points to the free consultation, with a softer
 * touch for Problem and Learn readers.
 */
export function ctaAngleFor(cta, conversion) {
  const path = /(\/[a-z0-9-]+\/)/i.exec(String(conversion || ''))?.[1]
  const how = path ? ` at ${path}` : ''
  if (cta?.primary === 'consultation') return `Invite the reader to book a free 30-minute consultation${how}.`
  if (cta?.primary === 'tool') return `Offer a free consultation as the practical next step for founders facing this problem${how}; keep it low-pressure.`
  return `Close with a light mention that founders who want help can book a free consultation${how}; no hard sell.`
}
