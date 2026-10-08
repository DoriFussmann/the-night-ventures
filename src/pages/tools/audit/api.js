import { supabase } from '@/lib/supabase'

const ENDPOINT = '/api/audit-snapshot'

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Not signed in')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * @param {string} action
 * @param {Record<string, string>} params
 */
async function get(action, params) {
  const headers = await authHeaders()
  const qs = new URLSearchParams({ action, ...params })
  const res = await fetch(`${ENDPOINT}?${qs}`, { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

/**
 * @param {string} action
 * @param {Record<string, unknown>} body
 */
async function post(action, body) {
  const headers = await authHeaders()
  const res = await fetch(`${ENDPOINT}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

/** @param {string} companyId */
export function getAuditState(companyId) {
  return get('audit.state', { companyId })
}

/**
 * @param {string} companyId
 * @param {string} check
 */
export function runConnectionCheck(companyId, check) {
  return post('audit.preflight', { companyId, check })
}

/**
 * @param {string} companyId
 * @param {string} category
 * @param {string} batchId
 */
export function startRun(companyId, category, batchId) {
  return post('audit.start', { companyId, category, batchId })
}

/**
 * @param {string} companyId
 * @param {string} runId
 * @param {number} expectedStep
 */
export function stepRun(companyId, runId, expectedStep) {
  return post('audit.step', { companyId, runId, expectedStep })
}

/**
 * @param {string} companyId
 * @param {string} runId
 */
export function getRun(companyId, runId) {
  return get('audit.run', { companyId, runId })
}

/**
 * @param {string} companyId
 * @param {string} runId
 */
export function cancelRun(companyId, runId) {
  return post('audit.cancel', { companyId, runId })
}

/**
 * Accept (exclude from scores) or restore issues.
 * @param {string} companyId
 * @param {Array<{ fingerprint: string, check_id: string }>} issues
 * @param {boolean} accepted
 */
export function setIssuesAccepted(companyId, issues, accepted) {
  return post('audit.override', {
    companyId,
    accepted,
    issues: issues.map((i) => ({ fingerprint: i.fingerprint, checkId: i.check_id })),
  })
}
