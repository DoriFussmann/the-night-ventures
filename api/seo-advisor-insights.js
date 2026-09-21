import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'
import {
  appendProposedClusters,
  appendProposedPillars,
} from '../lib/seo-advisor/pillars.js'

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
  if (handleOptions(req, res, 'GET, POST, PATCH, OPTIONS')) return

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

    if (req.method === 'POST') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      const action = String(body.action || '').trim()
      if (!companyId) return json(res, 400, { error: 'companyId is required' })

      if (action === 'save_audience') {
        const audienceText = String(body.audience_text || '').trim()
        const override = body.override === true
        if (!audienceText) {
          return json(res, 400, { error: 'audience_text is required' })
        }

        const { data: profile, error: profileError } = await supabase
          .from('company_profiles')
          .select('target_audience')
          .eq('company_id', companyId)
          .maybeSingle()
        if (profileError) throw profileError

        const current = String(profile?.target_audience || '').trim()
        if (current && !override) {
          return json(res, 200, { needsOverride: true, current })
        }

        if (profile) {
          const { error: updateError } = await supabase
            .from('company_profiles')
            .update({ target_audience: audienceText })
            .eq('company_id', companyId)
          if (updateError) throw updateError
        } else {
          const { error: insertError } = await supabase
            .from('company_profiles')
            .insert({ company_id: companyId, target_audience: audienceText })
          if (insertError) throw insertError
        }

        return json(res, 200, { ok: true })
      }

      if (action === 'save_pillars') {
        const pillars = Array.isArray(body.pillars) ? body.pillars : []
        const cleaned = pillars
          .map((item) => ({
            keyword: String(item?.keyword || '').trim(),
            search_volume:
              item?.search_volume == null ? null : Number(item.search_volume),
            difficulty: item?.difficulty == null ? null : Number(item.difficulty),
          }))
          .filter((item) => item.keyword)
        if (cleaned.length === 0) {
          return json(res, 400, { error: 'pillars is required' })
        }
        const saved = await appendProposedPillars(supabase, companyId, cleaned)
        return json(res, 200, saved)
      }

      if (action === 'save_clusters') {
        const pillarSlug = String(body.pillarSlug || body.pillar_slug || '').trim()
        const clusters = Array.isArray(body.clusters) ? body.clusters : []
        const cleaned = clusters
          .map((item) => ({
            keyword: String(item?.keyword || '').trim(),
            search_volume:
              item?.search_volume == null ? null : Number(item.search_volume),
            difficulty: item?.difficulty == null ? null : Number(item.difficulty),
          }))
          .filter((item) => item.keyword)
        if (!pillarSlug) {
          return json(res, 400, { error: 'pillarSlug is required' })
        }
        if (cleaned.length === 0) {
          return json(res, 400, { error: 'clusters is required' })
        }
        const saved = await appendProposedClusters(
          supabase,
          companyId,
          pillarSlug,
          cleaned
        )
        return json(res, 200, saved)
      }

      if (action === 'save_shortlist') {
        const sessionId = body.sessionId ? String(body.sessionId).trim() : null
        const items = Array.isArray(body.items) ? body.items : []
        const title = String(body.title || '').trim() || 'Shortlist'
        const lines = items
          .map((item) => {
            const keyword = String(item?.keyword || '').trim()
            if (!keyword) return null
            const vol = item.search_volume != null ? ` vol ${item.search_volume}` : ''
            const kd = item.difficulty != null ? ` kd ${item.difficulty}` : ''
            const intent = item.intent ? ` (${item.intent})` : ''
            return `- ${keyword}${vol}${kd}${intent}`
          })
          .filter(Boolean)
        if (lines.length === 0) {
          return json(res, 400, { error: 'shortlist is empty' })
        }
        const providers = [
          ...new Set(
            items.map((item) => String(item?.source || '').trim()).filter(Boolean)
          ),
        ]
        const row = {
          company_id: companyId,
          session_id: sessionId,
          title,
          body: lines.join('\n'),
          insight_type: 'keyword_set',
          source_tool: providers.join(', ') || null,
          conflicts_with_profile: false,
          status: 'new',
        }
        const { data, error } = await supabase
          .from('insights')
          .insert(row)
          .select('*')
          .single()
        if (error) throw error
        return json(res, 200, { insight: data })
      }

      if (action === 'push_keywords') {
        const items = Array.isArray(body.items) ? body.items : []
        const { data: profile, error: profileError } = await supabase
          .from('company_profiles')
          .select('core_keywords, supporting_keywords')
          .eq('company_id', companyId)
          .maybeSingle()
        if (profileError) throw profileError

        const pillars = Array.isArray(profile?.core_keywords)
          ? profile.core_keywords
              .map((item) => (typeof item === 'string' ? item.trim() : ''))
              .filter(Boolean)
          : []
        const supporting = Array.isArray(profile?.supporting_keywords)
          ? [...profile.supporting_keywords]
          : []

        const pillarKey = (value) => String(value || '').trim().toLowerCase()
        const existingPillars = new Set(pillars.map(pillarKey))
        const supportingKey = (row) =>
          pillarKey(typeof row === 'string' ? row : row?.keyword)

        let pushed = 0
        for (const item of items) {
          const keyword = String(item?.keyword || '').trim()
          const role = String(item?.role || '').trim().toLowerCase()
          if (!keyword || role === 'skip') continue

          if (role === 'pillar') {
            if (!existingPillars.has(pillarKey(keyword))) {
              pillars.push(keyword)
              existingPillars.add(pillarKey(keyword))
              pushed += 1
            }
            continue
          }

          if (role === 'supporting') {
            const idx = supporting.findIndex(
              (row) => supportingKey(row) === pillarKey(keyword)
            )
            const next = {
              keyword,
              search_volume: item.search_volume ?? null,
              difficulty: item.difficulty ?? null,
              intent: item.intent || null,
              source: item.source || null,
              added_at: new Date().toISOString(),
            }
            if (idx >= 0) supporting[idx] = { ...supporting[idx], ...next }
            else supporting.push(next)
            pushed += 1
          }
        }

        const { error: updateError } = await supabase
          .from('company_profiles')
          .update({
            core_keywords: pillars,
            supporting_keywords: supporting,
          })
          .eq('company_id', companyId)
        if (updateError) throw updateError

        const payload = {
          core_keywords: pillars,
          supporting_keywords: supporting,
          pushed,
        }
        if (pillars.length > 5) {
          payload.warning = `core_keywords now has ${pillars.length} (design target is 5)`
        }
        return json(res, 200, payload)
      }

      return json(res, 400, { error: 'Unknown action' })
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
