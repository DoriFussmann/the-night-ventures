import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'
import { runPagespeed } from '../lib/audit-snapshot/pagespeed.js'
import { checkBotAccess } from '../lib/audit-snapshot/robots.js'
import { checkJsonLd } from '../lib/audit-snapshot/jsonld.js'
import {
  mostRecentPublishedUrl,
  normalizeSiteUrl,
} from '../lib/audit-snapshot/sampleUrl.js'

const FETCH_TIMEOUT_MS = 60_000

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function resolveSampleUrl(supabase, companyId, explicitUrl) {
  const trimmed = String(explicitUrl || '').trim()
  if (trimmed) {
    return { sampleUrl: trimmed, sampleSource: 'explicit' }
  }

  const { data, error } = await supabase
    .from('content_coverage')
    .select('pillars')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw error

  const recent = mostRecentPublishedUrl(data?.pillars)
  if (!recent) {
    return { sampleUrl: null, sampleSource: null }
  }
  return {
    sampleUrl: recent.url,
    sampleSource: 'content_coverage',
    sampleTitle: recent.title,
  }
}

async function resolveSiteUrl(supabase, companyId, explicitUrl) {
  const fromBody = normalizeSiteUrl(explicitUrl)
  if (fromBody) return { siteUrl: fromBody, siteSource: 'explicit' }

  const { data, error } = await supabase
    .from('company_profiles')
    .select('domain')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw error

  const fromDomain = normalizeSiteUrl(data?.domain)
  if (!fromDomain) {
    return { siteUrl: null, siteSource: null }
  }
  return { siteUrl: fromDomain, siteSource: 'company_profiles.domain' }
}

export default async function handler(req, res) {
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

  const { supabase } = auth

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const companyId = String(url.searchParams.get('companyId') || '').trim()
      if (!companyId) {
        return json(res, 400, { error: 'companyId is required' })
      }

      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle()
      if (companyError) throw companyError
      if (!company) return json(res, 404, { error: 'Company not found' })

      const { data: snapshots, error } = await supabase
        .from('audit_snapshots')
        .select(
          'id, company_id, run_at, pagespeed_mobile, pagespeed_desktop, bot_access, jsonld_check, sample_url'
        )
        .eq('company_id', companyId)
        .order('run_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return json(res, 200, { snapshots: snapshots || [] })
    }

    if (req.method === 'POST') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      if (!companyId) {
        return json(res, 400, { error: 'companyId is required' })
      }

      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id, name')
        .eq('id', companyId)
        .maybeSingle()
      if (companyError) throw companyError
      if (!company) return json(res, 404, { error: 'Company not found' })

      const { siteUrl, siteSource } = await resolveSiteUrl(
        supabase,
        companyId,
        body.siteUrl || body.url
      )
      if (!siteUrl) {
        return json(res, 400, {
          error:
            'siteUrl is required (or set company domain in Company Data)',
        })
      }

      const sampleMeta = await resolveSampleUrl(
        supabase,
        companyId,
        body.sampleUrl
      )

      const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY || ''
      const timeout = withTimeout(FETCH_TIMEOUT_MS)

      try {
        const [pagespeedMobile, pagespeedDesktop, botAccess, jsonldCheck] =
          await Promise.all([
            runPagespeed({
              url: siteUrl,
              strategy: 'mobile',
              apiKey,
              signal: timeout.signal,
            }),
            runPagespeed({
              url: siteUrl,
              strategy: 'desktop',
              apiKey,
              signal: timeout.signal,
            }),
            checkBotAccess({ siteUrl, signal: timeout.signal }),
            checkJsonLd({
              sampleUrl: sampleMeta.sampleUrl,
              signal: timeout.signal,
            }),
          ])

        const row = {
          company_id: companyId,
          run_at: new Date().toISOString(),
          pagespeed_mobile: pagespeedMobile,
          pagespeed_desktop: pagespeedDesktop,
          bot_access: botAccess,
          jsonld_check: jsonldCheck,
          sample_url: sampleMeta.sampleUrl,
        }

        const { data: inserted, error: insertError } = await supabase
          .from('audit_snapshots')
          .insert(row)
          .select(
            'id, company_id, run_at, pagespeed_mobile, pagespeed_desktop, bot_access, jsonld_check, sample_url'
          )
          .single()

        if (insertError) throw insertError

        return json(res, 200, {
          snapshot: inserted,
          meta: {
            siteUrl,
            siteSource,
            sampleSource: sampleMeta.sampleSource,
            sampleTitle: sampleMeta.sampleTitle || null,
            companyName: company.name || null,
          },
        })
      } finally {
        timeout.clear()
      }
    }

    return json(res, 405, { error: 'Method not allowed' })
  } catch (err) {
    console.error('[audit-snapshot]', err)
    return json(res, 500, {
      error: err?.message || 'Internal server error',
    })
  }
}
