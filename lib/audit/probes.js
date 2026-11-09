// Network probes for the Technical & Infrastructure category: TLS certificate,
// time to first byte, and asset cache headers. Never throw.

import { connect } from 'node:tls'
import { AUDIT_USER_AGENT } from './fetchPage.js'

const TIMEOUT_MS = 10_000

/**
 * Read the TLS certificate of a host.
 * @param {string} host
 * @returns {Promise<{ ok: boolean, validTo?: string, daysLeft?: number, issuer?: string|null, authorized?: boolean, error?: string }>}
 */
export function probeTls(host) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: TIMEOUT_MS }, () => {
        const cert = socket.getPeerCertificate()
        const authorized = socket.authorized
        socket.end()
        if (!cert || !cert.valid_to) return done({ ok: false, error: 'No certificate returned' })
        const validTo = new Date(cert.valid_to)
        done({
          ok: true,
          validTo: validTo.toISOString().slice(0, 10),
          daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86_400_000),
          issuer: cert.issuer?.O || cert.issuer?.CN || null,
          authorized,
        })
      })
      socket.on('timeout', () => {
        socket.destroy()
        done({ ok: false, error: 'Timed out' })
      })
      socket.on('error', (err) => done({ ok: false, error: err?.message || 'TLS error' }))
    } catch (err) {
      done({ ok: false, error: err?.message || 'TLS error' })
    }
  })
}

async function timeToHeaders(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = performance.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': AUDIT_USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
      signal: controller.signal,
    })
    const ms = Math.round(performance.now() - started)
    await res.body?.cancel().catch(() => {})
    return res.ok ? ms : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Median time to response headers over a few sequential requests (the first
 * warms DNS/TLS and is discarded). Measured from our server's region.
 * @param {string} url
 * @param {number} [samples]
 */
export async function measureTtfb(url, samples = 3) {
  await timeToHeaders(url)
  const times = []
  for (let i = 0; i < samples; i += 1) {
    const ms = await timeToHeaders(url)
    if (ms != null) times.push(ms)
  }
  if (!times.length) return { ms: null, samples: 0 }
  times.sort((a, b) => a - b)
  return { ms: times[Math.floor(times.length / 2)], samples: times.length }
}

/**
 * Cache-Control of a few same-site static assets.
 * @param {string[]} urls
 */
export async function probeAssets(urls) {
  const out = []
  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': AUDIT_USER_AGENT }, signal: controller.signal })
      out.push({ url, ok: res.ok, status: res.status, cacheControl: res.headers.get('cache-control') || '' })
      await res.body?.cancel().catch(() => {})
    } catch (err) {
      out.push({ url, ok: false, status: 0, cacheControl: '', error: err?.message || 'Fetch failed' })
    } finally {
      clearTimeout(timer)
    }
  }
  return out
}
