import { runPagespeed } from '../pagespeed.js'

/**
 * PageSpeed panel: mobile + desktop category scores for the homepage.
 */
export async function runPagespeedPanel({ siteUrl, signal }) {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY || ''
  if (!apiKey) {
    return {
      ok: false,
      error: 'GOOGLE_PAGESPEED_API_KEY is not configured',
      panel: 'pagespeed',
    }
  }

  try {
    // Sequential within the panel so we don't hammer the API / hit rate limits.
    const mobile = await runPagespeed({
      url: siteUrl,
      strategy: 'mobile',
      apiKey,
      signal,
    })
    const desktop = await runPagespeed({
      url: siteUrl,
      strategy: 'desktop',
      apiKey,
      signal,
    })

    const ok = Boolean(mobile?.ok || desktop?.ok)
    return {
      ok,
      panel: 'pagespeed',
      siteUrl,
      mobile,
      desktop,
      error: ok
        ? null
        : mobile?.error || desktop?.error || 'PageSpeed checks failed',
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'PageSpeed panel timed out', panel: 'pagespeed' }
    }
    return {
      ok: false,
      error: err?.message || 'PageSpeed panel failed',
      panel: 'pagespeed',
    }
  }
}
