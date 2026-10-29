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
