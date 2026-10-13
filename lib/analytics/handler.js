// HTTP entry for Analytics. Mounted on api/audit-snapshot.js (300s budget):
//   GET  ?action=analytics.summary&companyId=&days=     signed-in user
//   POST { action: 'analytics.refresh', companyId, ai }  signed-in user
//   POST { action: 'analytics.settings', companyId, gsc, ga4, bing }  signed-in user
//   POST ?action=analytics.ingest { token, ua, path }    destination-site middleware (token)
//   GET  (Vercel cron, x-vercel-cron-schedule header)    Authorization: Bearer CRON_SECRET

import { timingSafeEqual } from 'node:crypto'
import { requireAuth, createServiceClient, handleOptions, parseBody, json } from '../seo-advisor/auth.js'
import { buildSummary } from './summary.js'
import { AnalyticsError, ensureSettings, runAnalyticsCron, syncCompany } from './sync.js'
import { normalizeGa4Property } from './ga4.js'
import { classifyBot } from './aiSources.js'
import { RANGE_DAYS } from './dates.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[0-9a-f]{64}$/

/** The analytics action from ?action= or the JSON body ('' when not an analytics call). */
export function analyticsAction(req) {
  let action = ''
  try {
    action = new URL(req.url || '/', 'http://localhost').searchParams.get('action') || ''
  } catch {
    action = ''
  }
  if (!action) action = String(parseBody(req)?.action || '')
  return action.startsWith('analytics.') ? action : ''
}

/** True for a Vercel cron invocation (it always sends this header). */
export function isCronRequest(req) {
  return Boolean(req.headers?.['x-vercel-cron-schedule'])
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function requireCompanyId(value) {
  const id = String(value || '').trim()
  if (!UUID_RE.test(id)) throw new AnalyticsError('companyId must be a UUID')
  return id
}

async function assertCompany(supabase, companyId) {
  const { data, error } = await supabase.from('companies').select('id').eq('id', companyId).maybeSingle()
  if (error) throw error
  if (!data) throw new AnalyticsError('Company not found', 404)
}

/** Validate override inputs. Empty string clears an override. */
export function normalizeOverrides(body) {
  const gsc = String(body.gsc ?? '').trim()
  const ga4 = String(body.ga4 ?? '').trim()
  const bing = String(body.bing ?? '').trim()
  if (gsc && !/^sc-domain:[a-z0-9.-]+$/i.test(gsc) && !/^https?:\/\/[^\s/]+\/$/i.test(gsc)) {
    throw new AnalyticsError('Search Console property must look like sc-domain:example.com or https://www.example.com/')
  }
  const ga4Property = ga4 ? normalizeGa4Property(ga4) : ''
  if (ga4 && !ga4Property) throw new AnalyticsError('GA4 property must be a numeric property ID')
  if (bing && !/^https?:\/\/[^\s/]+\/?$/i.test(bing)) {
    throw new AnalyticsError('Bing site must look like https://www.example.com/')
  }
  return {
    gsc_property_override: gsc || null,
    ga4_property_override: ga4Property || null,
    bing_site_override: bing || null,
  }
}

async function handleIngest(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const body = parseBody(req)
  const token = String(body.token || '').trim().toLowerCase()
  if (!TOKEN_RE.test(token)) return json(res, 401, { error: 'Invalid token' })
  const match = classifyBot(String(body.ua || '').slice(0, 500))
  if (!match) {
    res.statusCode = 204
    return res.end()
  }
  let path = String(body.path || '/').split('?')[0].split('#')[0].trim()
  if (!path.startsWith('/')) path = `/${path}`
  path = path.slice(0, 300)

  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('analytics_record_bot_hit', {
    p_token: token,
    p_bot: match.bot,
    p_kind: match.kind,
    p_path: path,
  })
  if (error) throw error
  if (data !== true) return json(res, 401, { error: 'Invalid token' })
  res.statusCode = 204
  return res.end()
}

async function handleCron(req, res) {
  const secret = String(process.env.CRON_SECRET || '').trim()
  const header = String(req.headers?.authorization || '')
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return json(res, 401, { error: 'Unauthorized' })
  }
  const result = await runAnalyticsCron(createServiceClient())
  console.log('analytics cron:', JSON.stringify({ processed: result.processed, ms: result.ms }))
  return json(res, 200, result)
}

export async function handleAnalytics(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return
  const action = analyticsAction(req)

  try {
    if (action === 'analytics.ingest') return await handleIngest(req, res)
    if (!action && isCronRequest(req)) return await handleCron(req, res)

    let auth
    try {
      auth = await requireAuth(req)
    } catch (err) {
      return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
    }
    const { supabase } = auth
    const body = parseBody(req)
    const url = new URL(req.url || '/', 'http://localhost')

    if (action === 'analytics.summary') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
      const companyId = requireCompanyId(url.searchParams.get('companyId'))
      const days = Number(url.searchParams.get('days')) || 28
      if (!RANGE_DAYS.includes(days)) throw new AnalyticsError(`days must be one of ${RANGE_DAYS.join(', ')}`)
      await assertCompany(supabase, companyId)
      return json(res, 200, await buildSummary(supabase, companyId, days))
    }

    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    const companyId = requireCompanyId(body.companyId)
    await assertCompany(supabase, companyId)

    if (action === 'analytics.refresh') {
      const result = await syncCompany(supabase, companyId, { ai: body.ai === true })
      return json(res, 200, result)
    }

    if (action === 'analytics.settings') {
      const patch = normalizeOverrides(body)
      await ensureSettings(supabase, companyId)
      const { error } = await supabase
        .from('analytics_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
      if (error) throw error
      return json(res, 200, { ok: true, overrides: patch })
    }

    return json(res, 400, { error: 'Unknown analytics action' })
  } catch (err) {
    const status = err instanceof AnalyticsError ? err.statusCode : err?.statusCode || 500
    if (status >= 500) console.error('analytics error:', err)
    return json(res, status, { error: err?.message || 'Analytics request failed' })
  }
}
