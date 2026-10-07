import { createHash } from 'node:crypto'
import { SEVERITIES } from './categories.js'

/**
 * Stable key for comparing the same finding across runs.
 * @param {string} category
 * @param {string} checkId
 * @param {string | null} target URL or other target ('' for site-level)
 */
export function fingerprint(category, checkId, target) {
  let key = String(target || '')
  try {
    if (key) {
      const u = new URL(key)
      u.hash = ''
      u.hostname = u.hostname.toLowerCase()
      key = u.href
    }
  } catch {
    // not a URL — use the raw target
  }
  return createHash('sha1').update(`${category}|${checkId}|${key}`).digest('hex').slice(0, 24)
}

/**
 * Build one issue row (minus run/company ids, which the writer adds).
 * @param {object} input
 * @param {string} input.category
 * @param {string} input.checkId
 * @param {'critical'|'high'|'medium'|'low'} input.severity
 * @param {string} input.title  check-level title, identical for every URL of that check
 * @param {string} [input.detail]  instance-specific detail
 * @param {string | null} [input.url]
 * @param {string} [input.target]  non-URL target (bot name, keyword) when url is null
 * @param {'page'|'site'} [input.scope]
 * @param {object} [input.evidence]
 * @param {string} [input.fixHint]
 */
export function makeIssue({
  category,
  checkId,
  severity,
  title,
  detail = '',
  url = null,
  target = '',
  scope = url ? 'page' : 'site',
  evidence = {},
  fixHint = '',
}) {
  if (!SEVERITIES.includes(severity)) throw new Error(`Invalid severity: ${severity}`)
  return {
    category,
    check_id: checkId,
    fingerprint: fingerprint(category, checkId, url || target),
    severity,
    scope,
    title,
    detail: String(detail || '').slice(0, 1000),
    url: url || null,
    evidence: evidence && typeof evidence === 'object' ? evidence : {},
    fix_hint: String(fixHint || '').slice(0, 1000),
  }
}

/** Drop duplicate fingerprints (first wins). */
export function dedupeIssues(issues) {
  const seen = new Set()
  const out = []
  for (const issue of issues) {
    if (seen.has(issue.fingerprint)) continue
    seen.add(issue.fingerprint)
    out.push(issue)
  }
  return out
}
