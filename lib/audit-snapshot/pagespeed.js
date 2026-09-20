const PAGESPEED_ENDPOINT =
  'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

const CATEGORIES = [
  'performance',
  'accessibility',
  'best-practices',
  'seo',
]

const CATEGORY_KEYS = {
  performance: 'performance',
  accessibility: 'accessibility',
  'best-practices': 'bestPractices',
  seo: 'seo',
}

function scoreTo100(raw) {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return null
  return Math.round(raw * 100)
}

function extractCoreWebVitals(loadingExperience) {
  if (!loadingExperience || typeof loadingExperience !== 'object') return null

  const metrics = loadingExperience.metrics || {}
  const pick = (key) => {
    const m = metrics[key]
    if (!m) return null
    return {
      percentile: m.percentile ?? null,
      category: m.category || null,
    }
  }

  return {
    overallCategory: loadingExperience.overall_category || null,
    id: loadingExperience.id || null,
    metrics: {
      lcp: pick('LARGEST_CONTENTFUL_PAINT_MS'),
      cls: pick('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
      inp: pick('INTERACTION_TO_NEXT_PAINT'),
      fcp: pick('FIRST_CONTENTFUL_PAINT_MS'),
      ttfb: pick('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    },
  }
}

function extractLabVitals(audits) {
  const num = (id) => {
    const n = Number(audits?.[id]?.numericValue)
    return Number.isFinite(n) ? n : null
  }
  const lcpMs = num('largest-contentful-paint')
  const cls = num('cumulative-layout-shift')
  if (lcpMs == null && cls == null) return null
  return { lcpMs, cls }
}

/**
 * Run PageSpeed Insights for one strategy (mobile | desktop).
 * Soft-fails: returns { ok: false, error } instead of throwing.
 */
export async function runPagespeed({ url, strategy, apiKey, signal }) {
  if (!apiKey) {
    return { ok: false, error: 'GOOGLE_PAGESPEED_API_KEY is not configured', strategy }
  }

  const params = new URLSearchParams({
    url,
    strategy,
    key: apiKey,
  })
  for (const category of CATEGORIES) {
    params.append('category', category)
  }

  try {
    const res = await fetch(`${PAGESPEED_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      signal,
      headers: { Accept: 'application/json' },
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const message =
        data?.error?.message ||
        data?.error?.errors?.[0]?.message ||
        `PageSpeed API error (${res.status})`
      return { ok: false, error: message, strategy, status: res.status }
    }

    const lighthouse = data.lighthouseResult || {}
    const categories = lighthouse.categories || {}
    const scores = {}
    for (const cat of CATEGORIES) {
      const key = CATEGORY_KEYS[cat]
      scores[key] = scoreTo100(categories[cat]?.score)
    }

    return {
      ok: true,
      strategy,
      scores,
      coreWebVitals: {
        url: extractCoreWebVitals(data.loadingExperience),
        origin: extractCoreWebVitals(data.originLoadingExperience),
        lab: extractLabVitals(data?.lighthouseResult?.audits),
      },
      fetchTime: lighthouse.fetchTime || null,
      finalUrl: lighthouse.finalUrl || data.id || url,
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'PageSpeed request timed out', strategy }
    }
    return {
      ok: false,
      error: err?.message || 'PageSpeed request failed',
      strategy,
    }
  }
}
