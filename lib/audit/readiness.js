// Readiness: per-check results (pass / fail / warning / not tested / n/a) derived
// from the latest run of each runner, and the five readiness scores built from
// them. Pure — no I/O. Data collection (runners) and scoring stay separate.

import { CHECKS, SCORES, ISSUE_TO_CHECK } from './catalog.js'
import { categoryById } from './categories.js'

export const STATUS = ['fail', 'warning', 'pass', 'not_tested', 'na']

/** Points a check is worth, by its default severity. */
export const SEVERITY_WEIGHT = { critical: 10, high: 6, medium: 3, low: 1 }
/** Confidence / nature multiplier. Experimental and info checks are never scored. */
export const KIND_WEIGHT = { confirmed: 1, risk: 0.6, recommendation: 0.3, experimental: 0, info: 0 }
/** A confirmed critical failure caps its score and the overall score. */
export const CRITICAL_SCORE_CAP = 40
export const CRITICAL_OVERALL_CAP = 60

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 }
const MAX_URLS = 25
const CHECKS_BY_ID = new Map(CHECKS.map((c) => [c.id, c]))

/**
 * @param {Record<string, { run: any | null, issues: any[] }>} runners
 *   runner id → latest done run and its active issues (accepted overrides removed)
 * @returns {Array<object>} one result per catalog check
 */
export function evaluateChecks(runners) {
  const issuesByCheck = new Map()
  for (const [runner, entry] of Object.entries(runners || {})) {
    for (const issue of entry?.issues || []) {
      const checkId = ISSUE_TO_CHECK[issue.check_id]
      if (!checkId) continue
      const key = `${runner}|${checkId}`
      const list = issuesByCheck.get(key) || []
      list.push(issue)
      issuesByCheck.set(key, list)
    }
  }

  return CHECKS.map((def) => {
    const base = {
      id: def.id,
      label: def.label,
      section: def.section,
      score: def.score,
      kind: def.kind,
      severity: def.severity,
      effort: def.effort,
      why: def.why,
      verify: def.verify,
      runner: def.runner,
      runAt: null,
      affected: 0,
      share: 0,
      urls: [],
      title: null,
      fix: null,
      reason: null,
    }
    if (!def.runner) return { ...base, status: 'not_tested', reason: 'Not built yet' }
    const entry = runners?.[def.runner]
    const run = entry?.run
    const runnerLabel = categoryById(def.runner)?.label || def.runner
    if (!run) return { ...base, status: 'not_tested', reason: `Run ${runnerLabel} to test this` }
    const withRun = { ...base, runAt: run.finished_at || run.started_at }
    if (def.since && String(run.started_at || '') < def.since) {
      return { ...withRun, status: 'not_tested', reason: `Added after the last ${runnerLabel} run — re-run it` }
    }
    const metrics = run.metrics || {}
    const tested = def.tested ? def.tested(metrics) : true
    if (tested !== true) return { ...withRun, status: 'not_tested', reason: String(tested) }
    if (def.applies && !def.applies(metrics)) return { ...withRun, status: 'na', reason: 'Not applicable to this site' }

    const issues = issuesByCheck.get(`${def.runner}|${def.id}`) || []
    if (!issues.length) return { ...withRun, status: 'pass' }

    let severity = 'low'
    let siteWide = false
    const urls = new Set()
    for (const issue of issues) {
      if ((SEVERITY_RANK[issue.severity] || 0) > (SEVERITY_RANK[severity] || 0)) severity = issue.severity
      if (issue.scope === 'site' || !issue.url) siteWide = true
      else urls.add(issue.url)
    }
    const pagesChecked = Number(metrics.pagesChecked) || 0
    const share = siteWide || pagesChecked <= 0 ? 1 : Math.min(1, urls.size / pagesChecked)
    const scoredKind = def.kind === 'confirmed' || def.kind === 'risk'
    const status = scoredKind && SEVERITY_RANK[severity] >= SEVERITY_RANK.medium ? 'fail' : 'warning'
    const first = issues[0]
    return {
      ...withRun,
      status,
      severity,
      affected: siteWide ? Math.max(1, urls.size) : urls.size,
      siteWide,
      share,
      urls: [...urls].slice(0, MAX_URLS),
      title: first.title || null,
      detail: issues.length === 1 ? first.detail || null : null,
      fix: issues.find((i) => i.fix_hint)?.fix_hint || null,
    }
  })
}

/** Points a check is worth (0 when never scored). */
export function checkWeight(result) {
  if (!result.score) return 0
  return (SEVERITY_WEIGHT[CHECKS_BY_ID.get(result.id)?.severity || result.severity] || 0) * (KIND_WEIGHT[result.kind] ?? 0)
}

/** Points earned by one tested check. */
export function earnedPoints(result) {
  const weight = checkWeight(result)
  if (result.status === 'pass') return weight
  const impact = 0.5 + 0.5 * (Number(result.share) || 0)
  if (result.status === 'fail') return weight * (1 - impact)
  if (result.status === 'warning') return weight * (1 - 0.5 * impact)
  return 0
}

const TESTED = new Set(['pass', 'fail', 'warning'])

/**
 * Five readiness scores + overall. A score uses only checks that were tested;
 * checks not tested earn nothing and count only in coverage.
 * @param {Array<object>} results from evaluateChecks
 */
export function scoreReadiness(results) {
  const scores = SCORES.map((s) => {
    const mine = results.filter((r) => r.score === s.id && checkWeight(r) > 0)
    const tested = mine.filter((r) => TESTED.has(r.status))
    const possible = tested.reduce((n, r) => n + checkWeight(r), 0)
    const earned = tested.reduce((n, r) => n + earnedPoints(r), 0)
    const applicable = mine.filter((r) => r.status !== 'na')
    const criticalFail = tested.some((r) => r.status === 'fail' && r.severity === 'critical' && r.kind === 'confirmed')
    let score = possible > 0 ? Math.round((earned / possible) * 100) : null
    if (score != null && criticalFail) score = Math.min(score, CRITICAL_SCORE_CAP)
    return {
      id: s.id,
      label: s.label,
      short: s.short,
      weight: s.weight,
      score,
      capped: criticalFail,
      checksTested: tested.length,
      checksTotal: applicable.length,
      coverage: applicable.length ? tested.length / applicable.length : 0,
      fails: tested.filter((r) => r.status === 'fail').length,
      warnings: tested.filter((r) => r.status === 'warning').length,
    }
  })

  let weighted = 0
  let weights = 0
  for (const s of scores) {
    if (s.score == null) continue
    weighted += s.score * s.weight
    weights += s.weight
  }
  let overall = weights > 0 ? Math.round(weighted / weights) : null
  const capped = scores.some((s) => s.capped)
  if (overall != null && capped) overall = Math.min(overall, CRITICAL_OVERALL_CAP)

  const scored = results.filter((r) => checkWeight(r) > 0 && r.status !== 'na')
  return {
    overall,
    overallCapped: capped,
    scores,
    checksTested: scored.filter((r) => TESTED.has(r.status)).length,
    checksTotal: scored.length,
    critical: results.filter((r) => r.status === 'fail' && r.severity === 'critical').length,
  }
}

const KIND_RANK = { confirmed: 4, risk: 3, recommendation: 2, experimental: 1, info: 0 }
const EFFORT_RANK = { low: 1, medium: 2, high: 3 }

/**
 * Prioritized remediation list: failing and warning checks (scored ones first),
 * critical first, then by confidence, reach and effort.
 */
export function recommendedActions(results) {
  const actionable = results.filter(
    (r) => (r.status === 'fail' || r.status === 'warning') && r.kind !== 'info'
  )
  const ranked = actionable.sort(
    (a, b) =>
      Number(Boolean(b.score)) - Number(Boolean(a.score)) ||
      (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) ||
      (KIND_RANK[b.kind] || 0) - (KIND_RANK[a.kind] || 0) ||
      (b.share || 0) - (a.share || 0) ||
      (EFFORT_RANK[a.effort] || 2) - (EFFORT_RANK[b.effort] || 2)
  )
  return ranked.map((r, i) => ({
    ...r,
    priority: i + 1,
    tier:
      r.score && (r.severity === 'critical' || r.severity === 'high') && r.status === 'fail'
        ? 'fix_first'
        : r.score && r.status === 'fail'
          ? 'next'
          : 'improve',
  }))
}

/**
 * Check-level changes between two evaluations.
 * @returns {{ resolved: string[], introduced: string[] }} check ids
 */
export function diffChecks(current, previous) {
  if (!previous) return { resolved: [], introduced: [] }
  const bad = (list) => new Set(list.filter((r) => r.status === 'fail' || r.status === 'warning').map((r) => r.id))
  const testedPrev = new Set(previous.filter((r) => TESTED.has(r.status)).map((r) => r.id))
  const now = bad(current)
  const before = bad(previous)
  return {
    resolved: [...before].filter((id) => !now.has(id) && current.find((r) => r.id === id)?.status === 'pass'),
    introduced: [...now].filter((id) => !before.has(id) && testedPrev.has(id)),
  }
}
