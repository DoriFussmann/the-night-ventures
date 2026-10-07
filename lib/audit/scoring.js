// Pure scoring + diff helpers. No I/O.

import { CATEGORIES } from './categories.js'

/** Penalty per failing check (not per URL), before scaling by affected share. */
export const SEVERITY_PENALTY = {
  critical: 30,
  high: 12,
  medium: 5,
  low: 1.5,
}

/**
 * Score one category 0–100.
 * Issues are grouped by check_id; each check costs its severity penalty scaled by
 * the share of checked pages it affects: penalty × (0.5 + 0.5 × share).
 * Site-scoped checks always count as share = 1.
 *
 * @param {any[]} issues  active issues ({ check_id, severity, scope, url }); accepted overrides already removed
 * @param {{ pagesChecked?: number }} [context]
 * @returns {number}
 */
export function scoreCategory(issues, context = {}) {
  const pagesChecked = Number(context.pagesChecked) || 0
  const byCheck = new Map()
  for (const issue of issues || []) {
    const group = byCheck.get(issue.check_id) || { severity: issue.severity, urls: new Set(), site: false }
    if ((SEVERITY_PENALTY[issue.severity] || 0) > (SEVERITY_PENALTY[group.severity] || 0)) {
      group.severity = issue.severity
    }
    if (issue.scope === 'page' && issue.url) group.urls.add(issue.url)
    else group.site = true
    byCheck.set(issue.check_id, group)
  }

  let penalty = 0
  for (const group of byCheck.values()) {
    const base = SEVERITY_PENALTY[group.severity] || 0
    const share =
      group.site || pagesChecked <= 0 ? 1 : Math.min(1, group.urls.size / pagesChecked)
    penalty += base * (0.5 + 0.5 * share)
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

/**
 * Weighted overall score across categories that have a score.
 * @param {Record<string, any>} scores  categoryId -> score (non-numbers ignored)
 * @returns {number | null}
 */
export function overallScore(scores) {
  let weighted = 0
  let weights = 0
  for (const category of CATEGORIES) {
    const score = scores?.[category.id]
    if (typeof score !== 'number' || Number.isNaN(score)) continue
    weighted += score * category.weight
    weights += category.weight
  }
  return weights > 0 ? Math.round(weighted / weights) : null
}

/**
 * Compare two issue lists by fingerprint.
 * @template {{ fingerprint: string }} T
 * @param {T[]} current
 * @param {T[] | null} previous  null when there is no previous run
 * @returns {{ current: Array<T & { diff: 'new' | 'persisting' | 'baseline' }>, fixed: T[] }}
 */
export function diffIssues(current, previous) {
  if (!previous) {
    return {
      current: (current || []).map((i) => ({ ...i, diff: 'baseline' })),
      fixed: [],
    }
  }
  const prev = new Set(previous.map((i) => i.fingerprint))
  const curr = new Set((current || []).map((i) => i.fingerprint))
  return {
    current: (current || []).map((i) => ({ ...i, diff: prev.has(i.fingerprint) ? 'persisting' : 'new' })),
    fixed: previous.filter((i) => !curr.has(i.fingerprint)),
  }
}

/**
 * Split issues into active vs accepted using the company's overrides.
 * @template {{ fingerprint: string }} T
 * @param {T[]} issues
 * @param {Set<string>} acceptedFingerprints
 */
export function partitionAccepted(issues, acceptedFingerprints) {
  const active = []
  const accepted = []
  for (const issue of issues || []) {
    if (acceptedFingerprints.has(issue.fingerprint)) accepted.push(issue)
    else active.push(issue)
  }
  return { active, accepted }
}
