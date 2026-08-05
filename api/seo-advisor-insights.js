import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'

const PROFILE_FIELDS = new Set([
  'competitors',
  'abstract',
  'short_description',
  'medium_description',
  'long_description',
  'target_audience',
  'services',
  'domain',
])

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET, PATCH, OPTIONS')) return

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }

  const { supabase } = auth

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost')
      const companyId = String(url.searchParams.get('companyId') || '').trim()
      const sessionId = String(url.searchParams.get('sessionId') || '').trim()
      const includeDismissed = url.searchParams.get('includeDismissed') === '1'

      if (!companyId) return json(res, 400, { error: 'companyId is required' })

      let query = supabase
        .from('insights')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100)

      if (sessionId) query = query.eq('session_id', sessionId)
      if (!includeDismissed) query = query.neq('status', 'dismissed')

      const { data, error } = await query
      if (error) throw error
      return json(res, 200, { insights: data || [] })
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      const insightId = String(body.insightId || '').trim()
      const action = String(body.action || '').trim()

      if (!companyId || !insightId) {
        return json(res, 400, { error: 'companyId and insightId are required' })
      }

      const { data: insight, error: loadError } = await supabase
        .from('insights')
        .select('*')
        .eq('id', insightId)
        .maybeSingle()
      if (loadError) throw loadError
      if (!insight || insight.company_id !== companyId) {
        return json(res, 404, { error: 'Insight not found' })
      }

      if (action === 'dismiss') {
        const { data, error } = await supabase
          .from('insights')
          .update({ status: 'dismissed' })
          .eq('id', insightId)
          .select('*')
          .single()
        if (error) throw error
        return json(res, 200, { insight: data })
      }

      if (action === 'apply_profile') {
        const patch = insight.profile_patch
        if (!patch || !PROFILE_FIELDS.has(patch.field)) {
          return json(res, 400, {
            error:
              'This insight has no applyable profile_patch. Ask the advisor to include a suggested profile update.',
          })
        }

        const updates = { [patch.field]: patch.value }
        const { error: profileError } = await supabase
          .from('company_profiles')
          .update(updates)
          .eq('company_id', companyId)
        if (profileError) throw profileError

        const { data, error } = await supabase
          .from('insights')
          .update({ status: 'applied' })
          .eq('id', insightId)
          .select('*')
          .single()
        if (error) throw error

        return json(res, 200, { insight: data, appliedField: patch.field })
      }

      if (action === 'set_status') {
        const status = String(body.status || '').trim()
        if (!['new', 'applied', 'dismissed'].includes(status)) {
          return json(res, 400, { error: 'Invalid status' })
        }
        const { data, error } = await supabase
          .from('insights')
          .update({ status })
          .eq('id', insightId)
          .select('*')
          .single()
        if (error) throw error
        return json(res, 200, { insight: data })
      }

      return json(res, 400, { error: 'Unknown action' })
    }

    return json(res, 405, { error: 'Method not allowed' })
  } catch (err) {
    console.error('seo-advisor-insights error:', err)
    return json(res, err.statusCode || 500, {
      error: err.message || 'Unexpected server error',
    })
  }
}
