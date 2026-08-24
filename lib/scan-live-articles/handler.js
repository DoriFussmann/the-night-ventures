import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../seo-advisor/auth.js'
import { resolveSiteUrl } from '../audit-snapshot/runPanel.js'
import { scanLiveArticles } from './run.js'

export async function handleScanLiveArticles(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return

  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

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
    const body = parseBody(req)
    const companyId = String(body.companyId || '').trim()
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

    const { siteUrl } = await resolveSiteUrl(supabase, companyId, body.siteUrl)
    if (!siteUrl) {
      return json(res, 400, {
        error: 'No site URL configured. Add a domain in Company Data first.',
      })
    }

    const { data: libraryRows, error: libraryError } = await supabase
      .from('generated_articles')
      .select(
        'slug, title, target_keyword, pillar_keyword, supporting_keyword, type'
      )
      .eq('company_id', companyId)

    if (libraryError) throw libraryError

    const { data: coverage, error: coverageError } = await supabase
      .from('content_coverage')
      .select('pillars')
      .eq('company_id', companyId)
      .maybeSingle()

    if (coverageError) throw coverageError

    const result = await scanLiveArticles({
      siteUrl,
      libraryRows: libraryRows || [],
      coveragePillars: Array.isArray(coverage?.pillars) ? coverage.pillars : [],
    })

    return json(res, 200, result)
  } catch (err) {
    console.error('[scan-live-articles]', err)
    return json(res, err.statusCode || 502, {
      error: err.message || 'Failed to scan live articles',
    })
  }
}
