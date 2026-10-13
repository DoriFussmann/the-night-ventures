// Google service-account auth (JWT bearer grant) with Node's crypto — no SDK.
// One service account reads both Search Console and GA4.

import { createSign } from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TIMEOUT_MS = 30000

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
]

/** @type {{ token: string, expiresAt: number, email: string } | null} */
let cached = null

export class GoogleApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/**
 * Parse GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64 of it).
 * @returns {{ client_email: string, private_key: string } | null}
 */
export function readServiceAccount(raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  const value = String(raw || '').trim()
  if (!value) return null
  const candidates = [value]
  if (!value.startsWith('{')) {
    try {
      candidates.push(Buffer.from(value, 'base64').toString('utf8'))
    } catch {
      // not base64
    }
  }
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text)
      if (parsed?.client_email && parsed?.private_key) {
        return {
          client_email: String(parsed.client_email),
          private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
        }
      }
    } catch {
      // try next
    }
  }
  return null
}

export function serviceAccountEmail() {
  return readServiceAccount()?.client_email || null
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function timedFetch(url, { timeoutMs, ...options } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') throw new GoogleApiError('Google API request timed out', 504)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function accessToken() {
  const account = readServiceAccount()
  if (!account) {
    throw new GoogleApiError('GOOGLE_SERVICE_ACCOUNT_JSON is not set or not valid JSON', 500)
  }
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.email === account.client_email && cached.expiresAt - 60 > now) {
    return cached.token
  }

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: GOOGLE_SCOPES.join(' '),
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  let signature
  try {
    signature = signer.sign(account.private_key, 'base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  } catch {
    throw new GoogleApiError('Service account private_key could not sign — check GOOGLE_SERVICE_ACCOUNT_JSON', 500)
  }

  const res = await timedFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new GoogleApiError(
      `Google auth failed: ${data.error_description || data.error || `HTTP ${res.status}`}`,
      res.status
    )
  }
  cached = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600),
    email: account.client_email,
  }
  return cached.token
}

/**
 * Authenticated JSON request to a Google API.
 * @param {string} url
 * @param {{ method?: string, body?: unknown, timeoutMs?: number }} [options]
 */
export async function googleJson(url, options = {}) {
  const token = await accessToken()
  const res = await timedFetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeoutMs: options.timeoutMs,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new GoogleApiError(data?.error?.message || `Google API HTTP ${res.status}`, res.status)
  }
  return data
}
