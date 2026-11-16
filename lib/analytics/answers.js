// "Named and cited in AI answers": the own brand and its competitors over the
// Prompt Tests runs. Pure.
//   named — the answer text names the brand (a mention)
//   cited — the answer lists one of the brand's pages as a source (a citation)
// Counts are prompts, not runs: a prompt counts when any run of its cycle did it,
// the same rule as AEO Playbook → Prompt Tests, so the two pages agree.

import { ACTIVE_ENGINE_IDS, ENGINES, cleanUrl, outcomeFor } from '../prompt-tests/derive.js'

const OUTCOMES = ['Named', 'Cited, not named', 'Retrieved, not cited', 'Absent', 'No search']

/** "Baseline", or the Decision Moment code (DM1 …) of a prompt. */
function setOf(prompt) {
  if (!prompt?.moment_id) return 'Baseline'
  return String(prompt.source_set || '').replace(/^moment:/, '') || 'Decision Moment'
}

const anyOk = (runs, f) => runs.some((r) => r.status === 'ok' && f(r))

/**
 * @param {{
 *   prompts: Array<{ id: string, prompt: string, status: string, moment_id?: string|null, source_set?: string }>,
 *   cycles: Array<{ id: string, created_at: string }>,
 *   runs: Array<{ cycle_id: string, prompt_id: string, engine: string, status: string, searched: boolean|null, brands: object, own_cited_urls: string[], ran_at: string }>,
 *   brands: Array<{ id: string, name: string, is_own: boolean }>,
 * }} input
 * @returns {null | object} null when nothing has been tested
 */
export function buildAnswerStats({ prompts, cycles, runs, brands }) {
  const own = (brands || []).find((b) => b.is_own)
  const byId = new Map((prompts || []).map((p) => [p.id, p]))
  const counted = new Set((prompts || []).filter((p) => p.status === 'Approved').map((p) => p.id))
  const cycleAt = new Map((cycles || []).map((c) => [c.id, c.created_at]))
  const engine = ACTIVE_ENGINE_IDS.find((e) => (runs || []).some((r) => r.engine === e && counted.has(r.prompt_id)))
  if (!engine || !own) return null

  // prompt → cycle → runs
  const byPrompt = new Map()
  for (const r of runs) {
    if (r.engine !== engine || !counted.has(r.prompt_id)) continue
    if (!byPrompt.has(r.prompt_id)) byPrompt.set(r.prompt_id, new Map())
    const perCycle = byPrompt.get(r.prompt_id)
    if (!perCycle.has(r.cycle_id)) perCycle.set(r.cycle_id, [])
    perCycle.get(r.cycle_id).push(r)
  }

  const ownOf = (r) => (r.brands && r.brands[own.id]) || {}
  const named = (rs) => anyOk(rs, (r) => ownOf(r).named)
  const cited = (rs) => anyOk(rs, (r) => ownOf(r).cited)

  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0]))
  const brandCounts = new Map((brands || []).map((b) => [b.id, { named: 0, cited: 0 }]))
  const perCycleStats = new Map()
  const compare = { prompts: 0, named: { now: 0, before: 0 }, cited: { now: 0, before: 0 } }
  const citedPages = []
  let tested = 0
  let namedCount = 0
  let citedCount = 0
  let lastRun = ''

  for (const [promptId, perCycle] of byPrompt) {
    const ordered = [...perCycle.entries()]
      .map(([cycleId, rs]) => ({ cycleId, rs, at: cycleAt.get(cycleId) || rs[0].ran_at }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))

    for (const c of ordered) {
      if (!anyOk(c.rs, () => true)) continue
      const s = perCycleStats.get(c.cycleId) || { id: c.cycleId, at: c.at, prompts: 0, named: 0, cited: 0, sets: new Set() }
      s.prompts += 1
      if (named(c.rs)) s.named += 1
      if (cited(c.rs)) s.cited += 1
      s.sets.add(setOf(byId.get(promptId)))
      perCycleStats.set(c.cycleId, s)
    }

    // The prompt's latest cycle is what counts now, as in Prompt Tests.
    const latest = ordered[0]
    if (!anyOk(latest.rs, () => true)) continue
    tested += 1
    const isNamed = named(latest.rs)
    const isCited = cited(latest.rs)
    if (isNamed) namedCount += 1
    if (isCited) citedCount += 1
    const label = outcomeFor(latest.rs, own.id).label
    if (label in outcomes) outcomes[label] += 1
    for (const b of brands) {
      const counts = brandCounts.get(b.id)
      if (anyOk(latest.rs, (r) => r.brands?.[b.id]?.named)) counts.named += 1
      if (anyOk(latest.rs, (r) => r.brands?.[b.id]?.cited)) counts.cited += 1
    }
    const urls = new Set()
    let ranAt = ''
    for (const r of latest.rs) {
      if (r.status !== 'ok') continue
      if (r.ran_at > lastRun) lastRun = r.ran_at
      if (r.ran_at > ranAt) ranAt = r.ran_at
      for (const u of r.own_cited_urls || []) urls.add(cleanUrl(u))
    }
    if (urls.size) citedPages.push({ question: byId.get(promptId)?.prompt || '', urls: [...urls], ranAt })

    // Like for like: only prompts that were also tested in an earlier cycle.
    const earlier = ordered.slice(1).find((c) => anyOk(c.rs, () => true))
    if (earlier) {
      compare.prompts += 1
      if (isNamed) compare.named.now += 1
      if (isCited) compare.cited.now += 1
      if (named(earlier.rs)) compare.named.before += 1
      if (cited(earlier.rs)) compare.cited.before += 1
    }
  }
  if (!tested) return null

  return {
    engine: ENGINES[engine].label,
    ownBrand: own.name,
    lastRun: lastRun || null,
    tested,
    named: namedCount,
    cited: citedCount,
    outcomes: OUTCOMES.map((label) => ({ label, prompts: outcomes[label] })),
    compare: compare.prompts ? compare : null,
    brands: brands
      .map((b) => ({ name: b.name, own: Boolean(b.is_own), ...brandCounts.get(b.id) }))
      .sort((a, b) => b.named - a.named || b.cited - a.cited || a.name.localeCompare(b.name)),
    cycles: [...perCycleStats.values()]
      .map((s) => ({ id: s.id, at: s.at, set: [...s.sets].sort().join(', '), prompts: s.prompts, named: s.named, cited: s.cited }))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 8),
    // Own pages cited, with the prompt that got them cited; feeds "Where AI cites you".
    citedPages,
  }
}
