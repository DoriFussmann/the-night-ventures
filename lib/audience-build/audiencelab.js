// AudienceLab API client (server only). The key never leaves the server.
// Docs: https://audiolab.mintlify.app/  ·  spec: https://audiolab.mintlify.app/openapi.yaml
// Base https://api.audiencelab.io, auth header X-Api-Key.
//
// Rate limits that matter here: /insights 30 req/min, /scored-segments
// 20 req/min. Both answer 429 with Retry-After; we honour it once.

const BASE = 'https://api.audiencelab.io'
const DEFAULT_TIMEOUT_MS = 90000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function httpError(message, statusCode) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function apiKey() {
  return String(process.env.AUDIENCELAB_API_KEY || '').trim()
}

export function hasAudienceLabKey() {
  return Boolean(apiKey())
}

export async function alFetch(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}, attempt = 0) {
  const key = apiKey()
  if (!key) throw httpError('AUDIENCELAB_API_KEY is not set in the server environment', 400)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'X-Api-Key': key,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    if (res.status === 429 && attempt < 1) {
      clearTimeout(timer)
      const wait = Math.min(60, Math.max(1, Number(res.headers.get('retry-after')) || 10))
      await sleep(wait * 1000)
      return alFetch(path, { method, body, timeoutMs }, attempt + 1)
    }
    const text = await res.text()
    let data = text
    try {
      data = JSON.parse(text)
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && (data.message || data.error)) || `AudienceLab HTTP ${res.status}`
      throw httpError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status === 401 ? 502 : res.status)
    }
    return data
  } catch (err) {
    if (err?.name === 'AbortError') throw httpError('AudienceLab request timed out', 504)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** All pre-made segments (~45k): [{ topic_id, topic, topic_category, ... }]. */
export async function fetchSegments() {
  const data = await alFetch('/audiences/attributes/segments', { timeoutMs: 120000 })
  const list = data?.attributes?.segments?.data
  if (!Array.isArray(list)) throw httpError('Unexpected AudienceLab segments response', 502)
  return list
}

/** Counts only, no contacts. Returns the raw InsightsResponse. */
export function insights(body) {
  return alFetch('/insights', { method: 'POST', body })
}

/** Values AudienceLab accepts for a filter: seniority | departments | industries | sic. */
export async function fetchAttribute(name) {
  const data = await alFetch(`/audiences/attributes/${encodeURIComponent(name)}`)
  const list = data?.attributes?.[name]?.data
  if (!Array.isArray(list)) throw httpError(`Unexpected AudienceLab ${name} response`, 502)
  return list.map((v) => String(v))
}

const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms))

/** POST /audiences → audienceId. body = AudienceCreateRequest. */
export async function createAudience(body) {
  const data = await alFetch('/audiences', { method: 'POST', body })
  const id = data?.audienceId || data?.id
  if (!id) throw httpError('AudienceLab did not return an audience id', 502)
  return String(id)
}

/**
 * Wait until the audience's first generation completes (export returns 200).
 * Generation took ~4 s in testing; gives up after maxWaitMs.
 */
export async function waitForAudience(id, { maxWaitMs = 120000, intervalMs = 3000 } = {}) {
  const started = Date.now()
  for (;;) {
    try {
      const data = await alFetch(`/audiences/${encodeURIComponent(id)}/export`, { timeoutMs: 30000 })
      if (data && typeof data === 'object' && (data.status === 'COMPLETED' || data.url)) {
        return { record_count: Number(data.record_count) || 0, generated_at: data.generated_at || null }
      }
    } catch (err) {
      if (err.statusCode !== 202 && err.statusCode !== 404) throw err
    }
    if (Date.now() - started > maxWaitMs) throw httpError('AudienceLab is still generating the audience; try again in a minute', 504)
    await sleep2(intervalMs)
  }
}

/** All records of the latest snapshot via paged lookup (JSON). */
export async function fetchAudienceRecords(id, { maxPages = 10 } = {}) {
  const rows = []
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await alFetch(`/audiences/${encodeURIComponent(id)}?page=${page}&page_size=1000`)
    const list = Array.isArray(data?.data) ? data.data : []
    rows.push(...list)
    const totalPages = Number(data?.total_pages) || 1
    if (page >= totalPages || !list.length) break
  }
  return rows
}

export async function deleteAudience(id) {
  try {
    await alFetch(`/audiences/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 20000 })
    return true
  } catch {
    return false
  }
}
