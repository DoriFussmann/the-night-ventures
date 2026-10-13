import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../seo-advisor/auth.js'
import { readServiceAccount } from '../analytics/google.js'
import { listGscSites } from '../analytics/gsc.js'
import { listGa4Properties } from '../analytics/ga4.js'
import { bingApiKey, listBingSites } from '../analytics/bing.js'

const TIMEOUT_MS = 12000
const PLACEHOLDER_RE = /your-|YOUR_|placeholder|change-me|here$/i

function looksSet(value) {
  const v = String(value || '').trim()
  if (!v) return false
  if (PLACEHOLDER_RE.test(v)) return false
  return v.length >= 8
}

function envVal(key) {
  return String(process.env[key] || '').trim()
}

function githubTokenKeys() {
  return Object.keys(process.env)
    .filter((key) => /^GITHUB_TOKEN_[A-Z0-9_]+$/.test(key) && looksSet(process.env[key]))
    .map((key) => key.replace(/^GITHUB_TOKEN_/, ''))
    .sort()
}

async function timedFetch(url, options = {}, ms = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    const text = await res.text()
    let data = text
    try {
      data = JSON.parse(text)
    } catch {
      // keep text
    }
    return { res, data, text }
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Timed out')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function loadCompanyGithub(supabase, companyId) {
  const id = String(companyId || '').trim()
  if (!id) return null
  const { data, error } = await supabase
    .from('companies')
    .select('github_owner, github_repo, github_token_key')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    owner: String(data.github_owner || '').trim(),
    repo: String(data.github_repo || '').trim(),
    tokenKey: String(data.github_token_key || '').trim().toUpperCase(),
  }
}

async function loadCompanyAnalytics(supabase, companyId) {
  const id = String(companyId || '').trim()
  if (!id) return null
  const { data, error } = await supabase
    .from('analytics_settings')
    .select('gsc_property, ga4_property, bing_site, status')
    .eq('company_id', id)
    .maybeSingle()
  // Table missing (migration not applied yet) must not break the Integrations page.
  if (error) return null
  return data || null
}

function analyticsDetail(base, property, sourceStatus) {
  const parts = [base]
  if (property) parts.push(`This company: ${property}`)
  if (sourceStatus && sourceStatus.ok === false && sourceStatus.message) {
    parts.push(`Last sync: ${sourceStatus.message}`)
  }
  return parts.filter(Boolean).join(' · ')
}

function catalog(github, analytics) {
  const ghKeys = githubTokenKeys()
  const companyKey = github?.tokenKey || ''
  const companyTokenSet = companyKey ? looksSet(process.env[`GITHUB_TOKEN_${companyKey}`]) : false
  const serviceEmail = readServiceAccount()?.client_email || ''
  const googleConfigured = Boolean(serviceEmail)
  const dest =
    github?.owner && github?.repo
      ? `${github.owner}/${github.repo}`
      : ''

  return [
    {
      id: 'supabase',
      name: 'Supabase',
      operates: 'Login, company data, articles library, coverage, hero storage',
      configured: looksSet(envVal('VITE_SUPABASE_URL') || envVal('SUPABASE_URL')) &&
        looksSet(envVal('VITE_SUPABASE_ANON_KEY')),
      testable: true,
      detail: looksSet(envVal('SUPABASE_SERVICE_ROLE_KEY'))
        ? 'Anon + service role present'
        : 'Anon present; service role missing or placeholder',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      operates: 'Plans, articles, advisor, updates, audit summaries',
      configured: looksSet(envVal('ANTHROPIC_API_KEY')),
      testable: true,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      operates: 'Hero images and Image Generation',
      configured: looksSet(envVal('OPENAI_API_KEY')),
      testable: true,
    },
    {
      id: 'resend',
      name: 'Resend',
      operates: 'Inquiry form emails',
      configured: looksSet(envVal('RESEND_API_KEY')),
      testable: true,
    },
    {
      id: 'dataforseo',
      name: 'DataForSEO',
      operates: 'Keywords, rankings, SERP, external-link suggestions',
      configured:
        looksSet(envVal('DATAFORSEO_LOGIN')) && looksSet(envVal('DATAFORSEO_PASSWORD')),
      testable: true,
    },
    {
      id: 'semrush',
      name: 'Semrush',
      operates: 'Analytics bot access (AI + crawlability) and Advisor domain data',
      configured: looksSet(envVal('SEMRUSH_API_KEY')),
      testable: true,
    },
    {
      id: 'moz',
      name: 'Moz',
      operates: 'Domain authority and backlinks in Analytics',
      configured:
        looksSet(envVal('MOZ_API_TOKEN')) ||
        (looksSet(envVal('MOZ_ACCESS_ID')) && looksSet(envVal('MOZ_SECRET_KEY'))),
      testable: true,
    },
    {
      id: 'pagespeed',
      name: 'Google PageSpeed Insights',
      operates: 'Speed and Core Web Vitals in Analytics',
      configured: looksSet(envVal('GOOGLE_PAGESPEED_API_KEY')),
      testable: true,
    },
    {
      id: 'github',
      name: 'GitHub',
      operates: dest
        ? `Publish articles and wire links to ${dest}`
        : 'Publish articles and wire links to the destination repo',
      configured: companyKey ? companyTokenSet : ghKeys.length > 0,
      testable: companyKey ? companyTokenSet : ghKeys.length > 0,
      detail: companyKey
        ? companyTokenSet
          ? `This company uses GITHUB_TOKEN_${companyKey}`
          : `GITHUB_TOKEN_${companyKey} is not set`
        : ghKeys.length
          ? `Configured keys: ${ghKeys.join(', ')}`
          : 'No GITHUB_TOKEN_<LABEL> env vars',
    },
    {
      id: 'instantly',
      name: 'Instantly',
      operates: 'Email outreach campaigns (EPIC)',
      configured: looksSet(envVal('INSTANTLY_API_KEY')),
      testable: false,
      detail: looksSet(envVal('INSTANTLY_API_KEY'))
        ? 'INSTANTLY_API_KEY present'
        : 'Set INSTANTLY_API_KEY in Vercel to enable',
    },
    {
      id: 'smartlead',
      name: 'SmartLead',
      operates: 'Email outreach campaigns (EPIC)',
      configured: looksSet(envVal('SMARTLEAD_API_KEY')),
      testable: false,
      detail: looksSet(envVal('SMARTLEAD_API_KEY'))
        ? 'SMARTLEAD_API_KEY present'
        : 'Set SMARTLEAD_API_KEY in Vercel to enable',
    },
    {
      id: 'gsc',
      name: 'Google Search Console',
      operates: 'Analytics: Google clicks, impressions, pages, queries, opportunities',
      configured: googleConfigured,
      testable: googleConfigured,
      detail: analyticsDetail(
        googleConfigured
          ? `Share each property with ${serviceEmail}`
          : 'Set GOOGLE_SERVICE_ACCOUNT_JSON in Vercel',
        analytics?.gsc_property,
        analytics?.status?.gsc
      ),
    },
    {
      id: 'ga4',
      name: 'Google Analytics 4',
      operates: 'Analytics: traffic sources and AI-assistant visits',
      configured: googleConfigured,
      testable: googleConfigured,
      detail: analyticsDetail(
        googleConfigured
          ? `Add ${serviceEmail} as Viewer on each GA4 property`
          : 'Set GOOGLE_SERVICE_ACCOUNT_JSON in Vercel',
        analytics?.ga4_property,
        analytics?.status?.ga4
      ),
    },
    {
      id: 'bing',
      name: 'Bing Webmaster Tools',
      operates: 'Analytics: Bing clicks, impressions, pages, queries',
      configured: Boolean(bingApiKey()),
      testable: Boolean(bingApiKey()),
      detail: analyticsDetail(
        bingApiKey() ? 'API key present' : 'Set BING_WEBMASTER_API_KEY in Vercel',
        analytics?.bing_site,
        analytics?.status?.bing
      ),
    },
  ]
}

export async function testSupabase(supabase) {
  const { error, count } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  return `Companies table reachable${count != null ? ` (${count} rows)` : ''}`
}

export async function testAnthropic() {
  const key = envVal('ANTHROPIC_API_KEY')
  if (!looksSet(key)) throw new Error('ANTHROPIC_API_KEY not configured')
  const { res, data } = await timedFetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  })
  if (res.ok) {
    const n = Array.isArray(data?.data) ? data.data.length : 0
    return n ? `Models reachable (${n})` : 'Models endpoint reachable'
  }
  if (res.status !== 404) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`)
  }
  const ping = await timedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  })
  if (!ping.res.ok) {
    throw new Error(ping.data?.error?.message || `HTTP ${ping.res.status}`)
  }
  return 'Messages API reachable'
}

async function testOpenAI() {
  const key = envVal('OPENAI_API_KEY')
  if (!looksSet(key)) throw new Error('OPENAI_API_KEY not configured')
  const { res, data } = await timedFetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`)
  }
  const n = Array.isArray(data?.data) ? data.data.length : 0
  return n ? `Models reachable (${n})` : 'Models endpoint reachable'
}

async function testResend() {
  const key = envVal('RESEND_API_KEY')
  if (!looksSet(key)) throw new Error('RESEND_API_KEY not configured')
  const { res, data } = await timedFetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`)
  }
  const n = Array.isArray(data?.data) ? data.data.length : 0
  return n ? `API reachable (${n} domain${n === 1 ? '' : 's'})` : 'API reachable'
}

async function testDataForSEO() {
  const login = envVal('DATAFORSEO_LOGIN')
  const password = envVal('DATAFORSEO_PASSWORD')
  if (!looksSet(login) || !looksSet(password)) {
    throw new Error('DATAFORSEO_LOGIN/PASSWORD not configured')
  }
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
  const { res, data } = await timedFetch(
    'https://api.dataforseo.com/v3/appendix/user_data',
    { headers: { Authorization: auth } }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (data?.status_code && data.status_code !== 20000) {
    throw new Error(data.status_message || `status_code ${data.status_code}`)
  }
  return data?.tasks?.[0]?.result?.[0]?.login
    ? `Account reachable (${data.tasks[0].result[0].login})`
    : 'Account reachable'
}

async function testSemrush() {
  const key = envVal('SEMRUSH_API_KEY')
  if (!looksSet(key)) throw new Error('SEMRUSH_API_KEY not configured')
  const url = new URL('https://api.semrush.com/')
  url.searchParams.set('key', key)
  const { text } = await timedFetch(url.toString())
  const line = String(text || '').trim()
  if (/ERROR\s+13\d/i.test(line) || /invalid/i.test(line)) {
    throw new Error(line.slice(0, 160) || 'Invalid API key')
  }
  if (/^ERROR\s+\d+/i.test(line)) {
    return 'Key accepted (API responded)'
  }
  return 'API reachable'
}

export async function testMoz() {
  const { domainMetrics } = await import('../seo-advisor/providers/moz.js')
  const result = await domainMetrics({ domain: 'moz.com' })
  if (!result.available) throw new Error(result.reason || 'Moz unavailable')
  const da = result.metrics?.domainAuthority
  return da != null ? `URL metrics reachable (moz.com DA ${da})` : 'URL metrics reachable'
}

export async function testPageSpeed() {
  const key = envVal('GOOGLE_PAGESPEED_API_KEY')
  if (!looksSet(key)) throw new Error('GOOGLE_PAGESPEED_API_KEY not configured')
  const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed')
  url.searchParams.set('key', key)
  const { data } = await timedFetch(url.toString())
  const message = String(data?.error?.message || '')
  if (/API key not valid/i.test(message) || /keyInvalid/i.test(message)) {
    throw new Error('API key not valid')
  }
  if (/Required parameter: url/i.test(message) || data?.error?.code === 400) {
    return 'Key accepted (API responded)'
  }
  if (data?.error) throw new Error(message || 'PageSpeed error')
  return 'API reachable'
}

async function testGsc() {
  const sites = await listGscSites()
  const readable = sites.filter((site) => site.permissionLevel !== 'siteUnverifiedUser')
  return `Service account reads ${readable.length} Search Console propert${readable.length === 1 ? 'y' : 'ies'}`
}

async function testGa4() {
  const properties = await listGa4Properties()
  return `Service account reads ${properties.length} GA4 propert${properties.length === 1 ? 'y' : 'ies'}`
}

async function testBing() {
  const sites = await listBingSites()
  const verified = sites.filter((site) => site.IsVerified !== false)
  return `API key reads ${verified.length} verified Bing site${verified.length === 1 ? '' : 's'}`
}

async function testGitHub(github) {
  const keys = githubTokenKeys()
  const preferred = github?.tokenKey && keys.includes(github.tokenKey)
    ? github.tokenKey
    : keys[0]
  if (!preferred) throw new Error('No GITHUB_TOKEN_<LABEL> configured')
  const token = envVal(`GITHUB_TOKEN_${preferred}`)
  const { res, data } = await timedFetch('https://api.github.com/rate_limit', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'the-night-ventures',
    },
  })
  if (!res.ok) {
    throw new Error(data?.message || `HTTP ${res.status}`)
  }
  const remaining = data?.rate?.remaining
  return remaining != null
    ? `GITHUB_TOKEN_${preferred} accepted (rate limit ${remaining})`
    : `GITHUB_TOKEN_${preferred} accepted`
}

const TESTERS = {
  supabase: (ctx) => testSupabase(ctx.supabase),
  anthropic: () => testAnthropic(),
  openai: () => testOpenAI(),
  resend: () => testResend(),
  dataforseo: () => testDataForSEO(),
  semrush: () => testSemrush(),
  moz: () => testMoz(),
  pagespeed: () => testPageSpeed(),
  github: (ctx) => testGitHub(ctx.github),
  gsc: () => testGsc(),
  ga4: () => testGa4(),
  bing: () => testBing(),
}

export async function handleIntegrations(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return
  res.setHeader('Access-Control-Allow-Origin', '*')

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, {
      error: err.message || 'Unauthorized',
    })
  }

  const body = parseBody(req)
  const url = new URL(req.url || '/', 'http://localhost')
  const companyId = String(
    body.companyId || url.searchParams.get('companyId') || ''
  ).trim()

  try {
    const [github, analytics] = await Promise.all([
      loadCompanyGithub(auth.supabase, companyId),
      loadCompanyAnalytics(auth.supabase, companyId),
    ])

    if (req.method === 'GET') {
      return json(res, 200, { integrations: catalog(github, analytics) })
    }

    if (req.method !== 'POST') {
      return json(res, 405, { error: 'Method not allowed' })
    }

    const id = String(body.id || '').trim()
    const item = catalog(github, analytics).find((row) => row.id === id)
    if (!item) return json(res, 400, { error: 'Unknown integration' })
    if (item.notWired || !item.testable) {
      return json(res, 200, {
        id,
        ok: false,
        detail: item.detail || 'Not wired yet',
      })
    }

    const tester = TESTERS[id]
    if (!tester) return json(res, 400, { error: 'No test for this integration' })

    const started = Date.now()
    try {
      const detail = await tester({ supabase: auth.supabase, github })
      return json(res, 200, {
        id,
        ok: true,
        detail: String(detail || 'OK'),
        ms: Date.now() - started,
      })
    } catch (err) {
      return json(res, 200, {
        id,
        ok: false,
        detail: err?.message || 'Test failed',
        ms: Date.now() - started,
      })
    }
  } catch (err) {
    return json(res, err.statusCode || 500, {
      error: err.message || 'Integrations request failed',
    })
  }
}
