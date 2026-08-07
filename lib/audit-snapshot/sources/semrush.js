import { checkBotAccess } from '../robots.js'
import { apexDomain } from '../domain.js'

/**
 * "Semrush" slot in the sequential panel list.
 *
 * Domain Overview / organic traffic still live on Semrush API v3 only.
 * This project has no usable v3 key (and v4 does not expose domain_overview),
 * so we intentionally skip Semrush REST and only run the Site Audit–equivalent
 * AI/search bot-access check via robots.txt.
 */
export async function runSemrushPanel({ siteUrl, signal }) {
  const domain = apexDomain(siteUrl)
  if (!domain) {
    return { ok: false, error: 'Invalid domain for bot-access panel', panel: 'semrush' }
  }

  try {
    const botAccess = await checkBotAccess({ siteUrl, signal })
    if (!botAccess?.ok) {
      return {
        ok: false,
        error: botAccess?.error || 'robots.txt bot-access check failed',
        panel: 'semrush',
        domain,
        overviewAvailable: false,
        metrics: null,
        botAccess,
        source: 'robots.txt',
      }
    }

    return {
      ok: true,
      panel: 'semrush',
      domain,
      overviewAvailable: false,
      metrics: null,
      botAccess,
      source: 'robots.txt',
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Bot-access panel timed out', panel: 'semrush', domain }
    }
    return {
      ok: false,
      error: err?.message || 'Bot-access panel failed',
      panel: 'semrush',
      domain,
    }
  }
}
