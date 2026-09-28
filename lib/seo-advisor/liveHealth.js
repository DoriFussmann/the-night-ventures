/**
 * Live health for the Advisor intro strip. Uses account/usage endpoints only,
 * so opening the page costs no data credits. Results cached 60s per instance.
 *
 * Feeds health.js so the data agent routes around a provider that is down.
 */
import {
  PROVIDERS,
  endpointsForProvider,
  docsAgeDays,
  isDocsStale,
  DOCS_STALE_AFTER_DAYS,
} from './registry.js'
import { markProviderFailure, markProviderSuccess } from './health.js'
import { ROUTER_MODEL } from './router.js'

const TIMEOUT_MS = 8000
const CACHE_MS = 60000
let cache = { at: 0, data: null }

const PLACEHOLDER_RE = /your-|YOUR_|placeholder|change-me/i
const env = (k) => String(process.env[k] || '').trim()
const looksSet = (v) => Boolean(v) && !PLACEHOLDER_RE.test(v) && v.length >= 8

async function timed(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    const text = await res.text()
    let data = text
    try {
      data = JSON.parse(text)
    } catch {
      // keep text
    }
    return { res, data, text, ms: Date.now() - started }
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? 'Timed out' : err?.message || 'Network error')
  } finally {
    clearTimeout(timer)
  }
}

async function probeSemrush() {
  const key = env('SEMRUSH_API_KEY')
  if (!looksSet(key)) throw new Error('SEMRUSH_API_KEY not set')
  // Free: returns remaining API units as a plain number.
  const url = `https://www.semrush.com/users/countapiunits.html?key=${encodeURIComponent(key)}`
  const { res, text, ms } = await timed(url)
  const body = String(text || '').trim()
  if (res.ok && /^\d+$/.test(body)) {
    const units = Number(body)
    if (units <= 0) throw new Error('0 API units left')
    return { ms, detail: `${units.toLocaleString()} API units left` }
  }
  if (/ERROR\s+13\d/i.test(body) || /invalid|wrong key/i.test(body)) {
    throw new Error(body.slice(0, 120) || 'Invalid key')
  }
  // Unknown shape — treat reachable but say so.
  return { ms, detail: 'Key accepted (unit balance unavailable)' }
}

async function probeDataForSEO() {
  const login = env('DATAFORSEO_LOGIN')
  const password = env('DATAFORSEO_PASSWORD')
  if (!looksSet(login) || !looksSet(password)) throw new Error('DATAFORSEO credentials not set')
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
  const { res, data, ms } = await timed('https://api.dataforseo.com/v3/appendix/user_data', {
    headers: { Authorization: auth },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (data?.status_code !== 20000) throw new Error(data?.status_message || 'API error')
  const balance = data?.tasks?.[0]?.result?.[0]?.money?.balance
  if (typeof balance === 'number' && balance <= 0) throw new Error('Balance is $0')
  return {
    ms,
    detail: typeof balance === 'number' ? `$${balance.toFixed(2)} balance` : 'Account reachable',
  }
}

async function probeMoz() {
  const token = env('MOZ_API_TOKEN')
  const accessId = env('MOZ_ACCESS_ID')
  const secret = env('MOZ_SECRET_KEY')
  if (!looksSet(token) && !(looksSet(accessId) && looksSet(secret))) {
    throw new Error('MOZ_API_TOKEN not set')
  }
  // Usage endpoint is free. Falls back to a 1-row url_metrics call if the
  // account can't use it.
  const headers =
    accessId && secret
      ? { Authorization: `Basic ${Buffer.from(`${accessId}:${secret}`).toString('base64')}` }
      : token.includes(':')
        ? { Authorization: `Basic ${Buffer.from(token).toString('base64')}` }
        : { 'x-moz-token': token }
  const { res, data, ms } = await timed('https://lsapi.seomoz.com/v2/usage_data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({}),
  })
  if (res.status === 401 || res.status === 403) throw new Error('Auth rejected')
  if (res.ok) {
    const used = data?.rows_consumed
    return { ms, detail: used != null ? `${Number(used).toLocaleString()} rows used this period` : 'Reachable' }
  }
  const { domainMetrics } = await import('./providers/moz.js')
  const started = Date.now()
  const r = await domainMetrics({ domain: 'moz.com' })
  if (!r.available) throw new Error(r.reason || 'Unavailable')
  return { ms: Date.now() - started, detail: 'URL metrics reachable' }
}

async function probeAnthropic() {
  const key = env('ANTHROPIC_API_KEY')
  if (!looksSet(key)) throw new Error('ANTHROPIC_API_KEY not set')
  const { res, data, ms } = await timed('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  })
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)
  return { ms, detail: `Advisor + data agent (${ROUTER_MODEL})` }
}

const PROBES = {
  semrush: probeSemrush,
  dataforseo: probeDataForSEO,
  moz: probeMoz,
}

async function runProbe(id, fn) {
  try {
    const out = await fn()
    if (PROVIDERS[id]) markProviderSuccess(id)
    return { ok: true, latencyMs: out.ms, detail: out.detail }
  } catch (err) {
    if (PROVIDERS[id]) markProviderFailure(id, err)
    return { ok: false, latencyMs: null, detail: err?.message || 'Failed' }
  }
}

export async function getLiveHealth({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.data, cached: true }
  }

  const providerIds = Object.keys(PROVIDERS)
  const [anthropic, ...providerResults] = await Promise.all([
    runProbe('anthropic', probeAnthropic),
    ...providerIds.map((id) => runProbe(id, PROBES[id])),
  ])

  const now = Date.now()
  const providers = providerIds.map((id, i) => {
    const p = PROVIDERS[id]
    const endpoints = endpointsForProvider(id)
    return {
      id,
      name: p.name,
      ...providerResults[i],
      endpointCount: endpoints.length,
      endpoints: endpoints.map((e) => ({ id: e.id, label: e.label, answers: e.answers })),
      docsUrl: p.docsUrl,
      docsVerifiedAt: p.docsVerifiedAt,
      docsAgeDays: docsAgeDays(p, now),
      docsStale: isDocsStale(p, now),
    }
  })

  const data = {
    checkedAt: new Date(now).toISOString(),
    docsStaleAfterDays: DOCS_STALE_AFTER_DAYS,
    services: [
      { id: 'anthropic', name: 'Anthropic', ...anthropic, endpointCount: null, endpoints: [] },
      ...providers,
    ],
  }
  cache = { at: now, data }
  return data
}
