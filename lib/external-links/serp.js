const TIMEOUT_MS = 30000
const LOCATION_CODE = 2840
const LANGUAGE_CODE = 'en'

function unavailable(reason) {
  return {
    available: false,
    provider: 'dataforseo',
    reason: String(reason || 'unavailable'),
  }
}

function authHeader() {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) {
    throw new Error('DATAFORSEO_LOGIN/PASSWORD not configured')
  }
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTransientSeError(reason) {
  const text = String(reason || '')
  return /internal se server error/i.test(text) || /\b40101\b/.test(text)
}

async function dfsPostWithRetry(path, task) {
  let last = await dfsPost(path, task)
  if (last.available || !isTransientSeError(last.reason)) return last
  await sleep(2000)
  last = await dfsPost(path, task)
  return last
}

async function dfsPost(path, task) {
  let auth
  try {
    auth = authHeader()
  } catch (err) {
    return unavailable(err.message)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.dataforseo.com${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify([task]),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return unavailable(`DataForSEO HTTP ${res.status}`)
    }
    if (!data || data.status_code !== 20000) {
      return unavailable(
        data?.status_message || `status_code ${data?.status_code}`
      )
    }
    const taskResult = Array.isArray(data.tasks) ? data.tasks[0] : null
    if (!taskResult || taskResult.status_code !== 20000) {
      return unavailable(
        taskResult?.status_message || `task status ${taskResult?.status_code}`
      )
    }
    return { available: true, provider: 'dataforseo', taskResult }
  } catch (err) {
    const msg =
      err?.name === 'AbortError' ? 'DataForSEO request timed out' : err?.message
    return unavailable(msg)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Live Google organic SERP via DataForSEO.
 * Same endpoint as the template CMS: /v3/serp/google/organic/live/regular.
 * Uses DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD — not the Advisor keyword-metrics path.
 */
export async function serpResults({ keyword, depth = 10 } = {}) {
  const phrase = String(keyword || '').trim()
  if (!phrase) return unavailable('keyword is required')

  const result = await dfsPostWithRetry('/v3/serp/google/organic/live/regular', {
    keyword: phrase,
    location_code: LOCATION_CODE,
    language_code: LANGUAGE_CODE,
    depth: Math.min(Number(depth) || 10, 50),
  })
  if (!result.available) return result

  const result0 = Array.isArray(result.taskResult.result)
    ? result.taskResult.result[0]
    : null
  const items = Array.isArray(result0?.items) ? result0.items : []

  return {
    available: true,
    provider: 'dataforseo',
    report: 'serp_results',
    keyword: phrase,
    items: items
      .filter((item) => item?.type === 'organic' || item?.url)
      .slice(0, 20)
      .map((item) => ({
        type: item.type || 'organic',
        rank: item.rank_absolute ?? item.rank_group ?? null,
        title: item.title ?? null,
        url: item.url ?? null,
        domain: item.domain ?? null,
        description: item.description ?? null,
      })),
  }
}
