// DataForSEO client for the Audit tool. Unlike lib/seo-advisor/providers/dataforseo.js
// it returns the recorded `cost` of every call so runs can enforce the batch budget.

const BASE = 'https://api.dataforseo.com'
const DEFAULT_TIMEOUT_MS = 60_000

/** Task-level success codes: 20000 = OK, 20100 = Task Created (task_post). */
const TASK_OK = new Set([20000, 20100])

function authHeader() {
  const login = String(process.env.DATAFORSEO_LOGIN || '').trim()
  const password = String(process.env.DATAFORSEO_PASSWORD || '').trim()
  if (!login || !password) return null
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

/**
 * One DataForSEO call holding a single task. Never throws.
 * @param {string} path  e.g. '/v3/on_page/task_post'
 * @param {{ method?: 'GET' | 'POST', task?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, cost: number, taskId: string | null, result: any[], error: string | null }>}
 */
export async function dfsCall(path, { method = 'POST', task, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const auth = authHeader()
  if (!auth) {
    return { ok: false, cost: 0, taskId: null, result: [], error: 'DATAFORSEO_LOGIN/PASSWORD not configured' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify([task || {}]) : undefined,
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    const cost = Number(data?.cost) || 0
    if (!res.ok || !data) {
      return { ok: false, cost, taskId: null, result: [], error: `DataForSEO HTTP ${res.status}` }
    }
    if (data.status_code !== 20000) {
      return {
        ok: false,
        cost,
        taskId: null,
        result: [],
        error: data.status_message || `DataForSEO status ${data.status_code}`,
      }
    }
    const t = Array.isArray(data.tasks) ? data.tasks[0] : null
    if (!t || !TASK_OK.has(t.status_code)) {
      return {
        ok: false,
        cost,
        taskId: t?.id || null,
        result: [],
        error: t?.status_message || `DataForSEO task status ${t?.status_code}`,
      }
    }
    return {
      ok: true,
      cost,
      taskId: t.id || null,
      result: Array.isArray(t.result) ? t.result : [],
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      cost: 0,
      taskId: null,
      result: [],
      error: err?.name === 'AbortError' ? 'DataForSEO request timed out' : err?.message || 'DataForSEO request failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Account info. Balance lives at result[0].money.balance (USD). */
export async function userData() {
  const res = await dfsCall('/v3/appendix/user_data', { method: 'GET', timeoutMs: 15_000 })
  if (!res.ok) return { ok: false, error: res.error, balance: null, login: null }
  const row = res.result[0] || {}
  const balance = Number(row?.money?.balance)
  return {
    ok: true,
    error: null,
    balance: Number.isFinite(balance) ? balance : null,
    login: row?.login || null,
  }
}

/**
 * Start an On-Page crawl. Static HTML only (Astro): no JS, no resources.
 * @param {{ target: string, startUrl: string, maxCrawlPages: number, tag?: string }} input
 */
export function onPageTaskPost({ target, startUrl, maxCrawlPages, tag }) {
  return dfsCall('/v3/on_page/task_post', {
    task: {
      target,
      start_url: startUrl,
      max_crawl_pages: maxCrawlPages,
      enable_javascript: false,
      load_resources: false,
      respect_sitemap: true,
      tag: tag ? String(tag).slice(0, 255) : undefined,
    },
  })
}

export function onPageSummary(taskId) {
  return dfsCall(`/v3/on_page/summary/${encodeURIComponent(taskId)}`, { method: 'GET', timeoutMs: 30_000 })
}

/** Crawled HTML pages (up to 1000 — the audit caps crawls at 150). */
export async function onPagePages(taskId) {
  const filtered = await dfsCall('/v3/on_page/pages', {
    task: { id: taskId, limit: 1000, filters: [['resource_type', '=', 'html']] },
  })
  if (filtered.ok) return filtered
  // Fall back to unfiltered if the filter is rejected; callers filter by resource_type.
  const plain = await dfsCall('/v3/on_page/pages', { task: { id: taskId, limit: 1000 } })
  return { ...plain, cost: plain.cost + filtered.cost }
}

export function onPageNonIndexable(taskId) {
  return dfsCall('/v3/on_page/non_indexable', { task: { id: taskId, limit: 1000 } })
}

export function onPageRedirectChains(taskId) {
  return dfsCall('/v3/on_page/redirect_chains', { task: { id: taskId, limit: 1000 } })
}

/** Broken links only. */
export function onPageBrokenLinks(taskId) {
  return dfsCall('/v3/on_page/links', {
    task: { id: taskId, limit: 1000, filters: [['is_broken', '=', true]] },
  })
}

/** Items array from a result row, tolerant of missing fields. */
export function itemsOf(res) {
  const row = res?.result?.[0]
  return Array.isArray(row?.items) ? row.items : []
}
