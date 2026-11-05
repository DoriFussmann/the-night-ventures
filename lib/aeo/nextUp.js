/**
 * AEO Playbook: which article to write next. Pure; shared by the browser.
 *
 * Rules (playbook Step 7):
 *  1. New pillar articles first.
 *  2. Rank pillars by how many of their unwritten groups are mostly Buy or
 *     Problem tier (Google impressions break ties).
 *  3. Inside a pillar: Buy, then Problem, then Learn; within a tier, groups
 *     already ranking best on Google first, then more impressions, then
 *     higher business value.
 *  4. The top pillar gets the first `leadCount` articles (default 10), then
 *     pillars rotate `perPillar` at a time (default 5) in rank order.
 */

export const TIER_ORDER = { Buy: 0, Problem: 1, Learn: 2 }

/** Groups that still need an article written. */
export function isOpenGroup(group) {
  return group && group.status === 'new' && group.page_type !== 'money'
}

export function groupStats(prompts) {
  const tiers = {}
  let impressions = 0
  let best = null
  let valueSum = 0
  let valueCount = 0
  for (const p of prompts) {
    tiers[p.intent_tier] = (tiers[p.intent_tier] || 0) + 1
    impressions += Number(p.gsc_impressions) || 0
    if (p.gsc_best_position != null && p.gsc_best_position !== '') {
      const pos = Number(p.gsc_best_position)
      if (Number.isFinite(pos)) best = best == null ? pos : Math.min(best, pos)
    }
    if (p.business_value != null) {
      valueSum += Number(p.business_value) || 0
      valueCount += 1
    }
  }
  const dominant =
    Object.entries(tiers).sort((a, b) => b[1] - a[1] || TIER_ORDER[a[0]] - TIER_ORDER[b[0]])[0]?.[0] || 'Learn'
  return {
    count: prompts.length,
    dominant,
    impressions,
    bestPosition: best,
    value: valueCount ? valueSum / valueCount : 0,
  }
}

function compareInPillar(a, b) {
  const t = TIER_ORDER[a.stats.dominant] - TIER_ORDER[b.stats.dominant]
  if (t) return t
  const pa = a.stats.bestPosition ?? Infinity
  const pb = b.stats.bestPosition ?? Infinity
  if (pa !== pb) return pa - pb
  if (b.stats.impressions !== a.stats.impressions) return b.stats.impressions - a.stats.impressions
  return b.stats.value - a.stats.value
}

function reasonFor(item) {
  const bits = [item.pillar?.name || 'No pillar', `mostly ${item.stats.dominant}`]
  if (item.stats.bestPosition != null) bits.push(`already at Google position ${item.stats.bestPosition}`)
  else if (item.stats.impressions) bits.push(`${item.stats.impressions} Google impressions`)
  if (item.group.page_type === 'pillar') bits.unshift('New pillar article')
  return bits.join(' · ')
}

/**
 * @param {{ pillars: object[], groups: object[], prompts: object[], excludeGroupIds?: Set<string> }} data
 * @returns {Array<{ group, pillar, stats, reason, rank }>}
 */
export function rankNextUp({ pillars, groups, prompts, excludeGroupIds = new Set() }, opts = {}) {
  const leadCount = opts.leadCount ?? 10
  const perPillar = opts.perPillar ?? 5
  const pillarById = new Map(pillars.map((p) => [p.id, p]))
  const promptsByGroup = new Map()
  for (const p of prompts) {
    if (!p.group_id) continue
    if (!promptsByGroup.has(p.group_id)) promptsByGroup.set(p.group_id, [])
    promptsByGroup.get(p.group_id).push(p)
  }

  const items = groups
    .filter((g) => isOpenGroup(g) && !excludeGroupIds.has(g.id))
    .map((g) => ({ group: g, pillar: pillarById.get(g.pillar_id) || null, stats: groupStats(promptsByGroup.get(g.id) || []) }))

  // 1. New pillar articles first, in pillar order.
  const pillarArticles = items
    .filter((i) => i.group.page_type === 'pillar')
    .sort((a, b) => (a.pillar?.sort ?? 0) - (b.pillar?.sort ?? 0))
  const rest = items.filter((i) => i.group.page_type !== 'pillar')

  // 2. Rank pillars.
  const byPillar = new Map()
  for (const item of rest) {
    const key = item.pillar?.id || 'none'
    if (!byPillar.has(key)) byPillar.set(key, { key, buyProblem: 0, impressions: 0, items: [] })
    const bucket = byPillar.get(key)
    bucket.items.push(item)
    if (item.stats.dominant !== 'Learn') bucket.buyProblem += 1
    bucket.impressions += item.stats.impressions
  }
  const ranked = [...byPillar.values()].sort((a, b) => b.buyProblem - a.buyProblem || b.impressions - a.impressions)
  for (const bucket of ranked) bucket.items.sort(compareInPillar)

  // 4. Lead pillar first, then rotate.
  const order = [...pillarArticles]
  if (ranked.length) order.push(...ranked[0].items.splice(0, leadCount))
  while (ranked.some((b) => b.items.length)) {
    for (const bucket of ranked) order.push(...bucket.items.splice(0, perPillar))
  }

  return order.map((item, index) => ({ ...item, rank: index + 1, reason: reasonFor(item) }))
}

/** Primary keyword for a group: the keyword of its best-evidenced, highest-value prompt. */
export function primaryKeywordFor(prompts) {
  const sorted = [...prompts].sort(
    (a, b) =>
      (Number(b.gsc_impressions) || 0) - (Number(a.gsc_impressions) || 0) ||
      (Number(b.search_volume) || 0) - (Number(a.search_volume) || 0) ||
      (Number(b.business_value) || 0) - (Number(a.business_value) || 0)
  )
  return String(sorted[0]?.keyword || '').trim()
}

/** Default CTA by intent tier (playbook Step 5). */
export function defaultCta(tier) {
  if (tier === 'Buy') return { primary: 'consultation', tool: '' }
  if (tier === 'Problem') return { primary: 'tool', tool: '' }
  return { primary: 'newsletter', tool: '' }
}
