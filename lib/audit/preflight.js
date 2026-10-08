// Connection checks shown when the Audit page loads. One check per request so the
// UI can render each result as it lands. Every check resolves; none throw.

import { BATCH_BUDGET_USD, CONNECTION_IDS } from './categories.js'
import { userData } from './providers/dataforseo.js'
import { fetchPage, DATAFORSEO_CRAWLER_UA } from './fetchPage.js'
import { discoverSitemapUrls } from './urls.js'
import { originFromUrl } from '../audit-snapshot/domain.js'
import { testSupabase, testAnthropic, testMoz, testPageSpeed } from '../integrations/handler.js'

/** @typedef {{ id: string, status: string, detail: string, data?: object }} CheckResult  status: ok | warn | fail | info */

/**
 * Identify the host platform from response headers.
 * @param {Record<string, string>} headers  lowercase header map
 */
export function detectHosting(headers) {
  const h = headers || {}
  const server = String(h.server || '').toLowerCase()
  if (h['x-vercel-id'] || server.includes('vercel')) return 'Vercel'
  if (h['cf-ray'] || server.includes('cloudflare')) return 'Cloudflare'
  if (h['x-nf-request-id'] || server.includes('netlify')) return 'Netlify'
  if (server.includes('github.com')) return 'GitHub Pages'
  return h.server ? `Unknown (server: ${h.server})` : 'Unknown'
}

async function fromTester(id, tester) {
  try {
    const detail = await tester()
    return { id, status: 'ok', detail: String(detail || 'OK') }
  } catch (err) {
    return { id, status: 'fail', detail: err?.message || 'Check failed' }
  }
}

async function checkDataforseo() {
  const info = await userData()
  if (!info.ok) return { id: 'dataforseo', status: 'fail', detail: info.error || 'Unavailable' }
  if (info.balance == null) {
    return { id: 'dataforseo', status: 'ok', detail: 'Account reachable (balance not reported)' }
  }
  const balance = `$${info.balance.toFixed(2)} balance`
  if (info.balance < BATCH_BUDGET_USD) {
    return {
      id: 'dataforseo',
      status: 'warn',
      detail: `${balance} — below one full run budget ($${BATCH_BUDGET_USD.toFixed(2)})`,
      data: { balance: info.balance },
    }
  }
  return { id: 'dataforseo', status: 'ok', detail: balance, data: { balance: info.balance } }
}

async function checkGithub(supabase, companyId) {
  const { data, error } = await supabase
    .from('companies')
    .select('github_owner, github_repo, github_token_key')
    .eq('id', companyId)
    .maybeSingle()
  if (error) return { id: 'github', status: 'fail', detail: error.message }
  const owner = String(data?.github_owner || '').trim()
  const repo = String(data?.github_repo || '').trim()
  const key = String(data?.github_token_key || '').trim().toUpperCase()
  if (!owner || !repo || !key) {
    return { id: 'github', status: 'warn', detail: 'No destination repo configured for this company' }
  }
  const token = String(process.env[`GITHUB_TOKEN_${key}`] || '').trim()
  if (!token) return { id: 'github', status: 'warn', detail: `GITHUB_TOKEN_${key} is not set` }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'the-night-ventures',
      },
      signal: controller.signal,
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { id: 'github', status: 'warn', detail: `${owner}/${repo}: ${body?.message || `HTTP ${res.status}`}` }
    }
    return {
      id: 'github',
      status: 'ok',
      detail: `${owner}/${repo} reachable (default branch ${body?.default_branch || 'unknown'})`,
    }
  } catch (err) {
    return {
      id: 'github',
      status: 'warn',
      detail: err?.name === 'AbortError' ? 'GitHub timed out' : err?.message || 'GitHub check failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

async function checkHome(siteUrl) {
  const res = await fetchPage(siteUrl)
  if (res.error) return { id: 'site_home', status: 'fail', detail: res.error }
  if (!res.ok) return { id: 'site_home', status: 'fail', detail: `HTTP ${res.status} from ${siteUrl}` }
  const redirect = res.finalUrl && res.finalUrl.replace(/\/$/, '') !== siteUrl.replace(/\/$/, '')
  return {
    id: 'site_home',
    status: 'ok',
    detail: `HTTP ${res.status} in ${res.ms} ms${redirect ? ` → ${res.finalUrl}` : ''}`,
    data: { finalUrl: res.finalUrl },
  }
}

async function checkRobots(siteUrl) {
  const origin = originFromUrl(siteUrl)
  const res = await fetchPage(`${origin}/robots.txt`, { accept: 'text/plain,*/*' })
  if (res.error) return { id: 'site_robots', status: 'warn', detail: res.error }
  if (res.status === 404) {
    return { id: 'site_robots', status: 'warn', detail: 'No robots.txt (crawlers treat this as allow-all)' }
  }
  if (!res.ok) return { id: 'site_robots', status: 'warn', detail: `HTTP ${res.status}` }
  return { id: 'site_robots', status: 'ok', detail: `Found (${res.text.length} bytes)` }
}

async function checkSitemap(siteUrl) {
  const sitemap = await discoverSitemapUrls(siteUrl)
  if (!sitemap.sitemapUrl) {
    return { id: 'site_sitemap', status: 'warn', detail: 'No sitemap found via robots.txt or Astro defaults' }
  }
  return {
    id: 'site_sitemap',
    status: sitemap.urls.length ? 'ok' : 'warn',
    detail: `${sitemap.urls.length} URL(s) in ${sitemap.sitemapUrl.replace(/^https?:\/\/[^/]+/, '')}`,
  }
}

async function checkCrawlerAccess(siteUrl) {
  const res = await fetchPage(siteUrl, { userAgent: DATAFORSEO_CRAWLER_UA })
  if (res.error) return { id: 'crawler_access', status: 'fail', detail: res.error }
  if (!res.ok) {
    return {
      id: 'crawler_access',
      status: 'fail',
      detail: `HTTP ${res.status} for the DataForSEO crawler user agent (tested from our server)`,
    }
  }
  return { id: 'crawler_access', status: 'ok', detail: 'Crawler user agent receives HTTP 200' }
}

async function checkHosting(siteUrl) {
  const res = await fetchPage(siteUrl)
  if (res.error) return { id: 'hosting', status: 'info', detail: 'Unknown (homepage unreachable)' }
  const platform = detectHosting(res.headers)
  return { id: 'hosting', status: 'info', detail: platform, data: { platform } }
}

/**
 * Run one connection check.
 * @param {string} id
 * @param {{ supabase: any, companyId: string, siteUrl: string | null }} ctx
 * @returns {Promise<CheckResult>}
 */
export async function runConnectionCheck(id, { supabase, companyId, siteUrl }) {
  if (!CONNECTION_IDS.includes(id)) return { id, status: 'fail', detail: 'Unknown check' }
  const needsSite = id.startsWith('site_') || id === 'crawler_access' || id === 'hosting'
  if (needsSite && !siteUrl) {
    return { id, status: 'fail', detail: 'No domain set — add it in Company Intelligence' }
  }
  switch (id) {
    case 'supabase':
      return fromTester(id, () => testSupabase(supabase))
    case 'dataforseo':
      return checkDataforseo()
    case 'moz':
      return fromTester(id, () => testMoz())
    case 'pagespeed':
      return fromTester(id, () => testPageSpeed())
    case 'anthropic':
      return fromTester(id, () => testAnthropic())
    case 'gsc':
      return { id, status: 'info', detail: 'Planned for V2 (index coverage + performance)' }
    case 'github':
      return checkGithub(supabase, companyId)
    case 'site_home':
      return checkHome(siteUrl)
    case 'site_robots':
      return checkRobots(siteUrl)
    case 'site_sitemap':
      return checkSitemap(siteUrl)
    case 'crawler_access':
      return checkCrawlerAccess(siteUrl)
    case 'hosting':
      return checkHosting(siteUrl)
    default:
      return { id, status: 'fail', detail: 'Unknown check' }
  }
}
