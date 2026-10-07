export const AUDIT_USER_AGENT =
  'Mozilla/5.0 (compatible; TheNightVentures-Audit/1.0; +https://thenightventures.com)'

/** DataForSEO On-Page crawler default user agent (per their task_post docs). */
export const DATAFORSEO_CRAWLER_UA = 'Mozilla/5.0 (compatible; RSiteAuditor)'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 3_000_000

const KEPT_HEADERS = [
  'content-type',
  'x-robots-tag',
  'server',
  'x-vercel-id',
  'x-vercel-cache',
  'cf-ray',
  'x-nf-request-id',
  'x-served-by',
  'location',
  'strict-transport-security',
  'cache-control',
]

/**
 * Fetch a URL with a timeout and body size cap. Never throws.
 * @param {string} url
 * @param {{ userAgent?: string, timeoutMs?: number, maxBytes?: number, redirect?: 'follow' | 'manual', accept?: string }} [options]
 */
export async function fetchPage(url, options = {}) {
  const {
    userAgent = AUDIT_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    redirect = 'follow',
    accept = 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
  } = options

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect,
      signal: controller.signal,
      headers: { 'User-Agent': userAgent, Accept: accept },
    })
    const buffer = Buffer.from(await res.arrayBuffer())
    const truncated = buffer.length > maxBytes
    const text = (truncated ? buffer.subarray(0, maxBytes) : buffer).toString('utf8')
    const headers = {}
    for (const name of KEPT_HEADERS) {
      const value = res.headers.get(name)
      if (value != null) headers[name] = value
    }
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      redirected: Boolean(res.redirected),
      headers,
      text,
      truncated,
      ms: Date.now() - started,
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      redirected: false,
      headers: {},
      text: '',
      truncated: false,
      ms: Date.now() - started,
      error: err?.name === 'AbortError' ? 'Timed out' : err?.message || 'Fetch failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Preserves order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Math.min(Math.max(1, limit), Math.max(items.length, 1))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}
