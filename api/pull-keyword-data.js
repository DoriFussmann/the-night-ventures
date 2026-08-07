import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'
import { pullKeywordData } from '../lib/pull-keyword-data/run.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return

  res.setHeader('Access-Control-Allow-Origin', '*')

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, {
      error: err.message || 'Unauthorized',
    })
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const { supabase } = auth
  const body = parseBody(req)
  const companyId = String(body.companyId || '').trim()
  const keyword = String(body.keyword || '').trim()
  const pillarKeyword = String(body.pillarKeyword || '').trim()
  let audienceFilter = String(
    body.audienceFilter || body.audienceFilterDescription || ''
  ).trim()

  if (!companyId) {
    return json(res, 400, { error: 'companyId is required' })
  }
  if (!keyword) {
    return json(res, 400, { error: 'keyword is required' })
  }

  try {
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id')
      .eq('id', companyId)
      .maybeSingle()
    if (companyError) throw companyError
    if (!company) return json(res, 404, { error: 'Company not found' })

    if (!audienceFilter) {
      const { data: profile, error: profileError } = await supabase
        .from('company_profiles')
        .select('target_audience')
        .eq('company_id', companyId)
        .maybeSingle()
      if (profileError) throw profileError
      audienceFilter = String(profile?.target_audience || '').trim()
    }

    if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
      return json(res, 503, {
        error: 'DATAFORSEO_LOGIN/PASSWORD not configured',
      })
    }

    const result = await pullKeywordData({
      keyword,
      pillarKeyword,
      audienceFilter,
    })

    return json(res, 200, result)
  } catch (err) {
    console.error('pull-keyword-data failed:', err)
    return json(res, err.statusCode || 500, {
      error: err.message || 'Failed to pull keyword data',
      warnings: err.warnings || undefined,
    })
  }
}
