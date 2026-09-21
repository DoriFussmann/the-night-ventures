import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'
import { healthSnapshot } from '../lib/seo-advisor/tools.js'
import { loadCoverageState, serializeCoverageState } from '../lib/seo-advisor/pillars.js'

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET, POST, PATCH, DELETE, OPTIONS')) return

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

      if (!companyId) return json(res, 400, { error: 'companyId is required' })

      if (url.searchParams.get('pillars') === '1') {
        const coverage = await loadCoverageState(supabase, companyId)
        return json(res, 200, serializeCoverageState(coverage))
      }

      if (url.searchParams.get('composer') === '1') {
        const [profileRes, industriesRes, coverage] = await Promise.all([
          supabase
            .from('company_profiles')
            .select(
              'domain, product_name, target_audience, location_markets, core_keywords, supporting_keywords, competitors, growth_priorities, marketing_objectives'
            )
            .eq('company_id', companyId)
            .maybeSingle(),
          supabase
            .from('company_industries')
            .select('industry_id, industries(name)')
            .eq('company_id', companyId),
          loadCoverageState(supabase, companyId),
        ])
        if (profileRes.error) throw profileRes.error
        if (industriesRes.error) throw industriesRes.error
        const industries = (industriesRes.data || [])
          .map((row) => row.industries?.name)
          .filter(Boolean)
        const coverageState = serializeCoverageState(coverage)
        return json(res, 200, {
          ...(profileRes.data || {}),
          industries,
          pillars: coverageState.pillars,
          lockedSlugs: coverageState.lockedSlugs,
          pillarCount: coverageState.count,
        })
      }

      if (sessionId) {
        let session
        const first = await supabase
          .from('chat_sessions')
          .select('id, company_id, title, created_at, updated_at, shortlist')
          .eq('id', sessionId)
          .maybeSingle()
        if (first.error && /shortlist/i.test(first.error.message || '')) {
          const retry = await supabase
            .from('chat_sessions')
            .select('id, company_id, title, created_at, updated_at')
            .eq('id', sessionId)
            .maybeSingle()
          if (retry.error) throw retry.error
          session = retry.data
        } else if (first.error) {
          throw first.error
        } else {
          session = first.data
        }
        if (!session || session.company_id !== companyId) {
          return json(res, 404, { error: 'Session not found' })
        }

        const { data: messages, error: messagesError } = await supabase
          .from('chat_messages')
          .select('id, role, content, created_at')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true })
        if (messagesError) throw messagesError

        const { data: insights, error: insightsError } = await supabase
          .from('insights')
          .select('*')
          .eq('session_id', sessionId)
          .eq('company_id', companyId)
          .neq('status', 'dismissed')
          .order('created_at', { ascending: true })
        if (insightsError) throw insightsError

        return json(res, 200, {
          session,
          messages: messages || [],
          insights: insights || [],
          providerHealth: healthSnapshot(),
        })
      }

      const { data: sessions, error } = await supabase
        .from('chat_sessions')
        .select('id, company_id, title, created_at, updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(50)
      if (error) throw error

      return json(res, 200, {
        sessions: sessions || [],
        providerHealth: healthSnapshot(),
      })
    }

    if (req.method === 'POST') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      if (!companyId) return json(res, 400, { error: 'companyId is required' })

      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle()
      if (companyError) throw companyError
      if (!company) return json(res, 404, { error: 'Company not found' })

      const { data, error } = await supabase
        .from('chat_sessions')
        .insert({ company_id: companyId, title: null })
        .select('id, company_id, title, created_at, updated_at')
        .single()
      if (error) throw error

      return json(res, 200, { session: data })
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      const sessionId = String(body.sessionId || '').trim()
      if (!companyId || !sessionId) {
        return json(res, 400, { error: 'companyId and sessionId are required' })
      }

      const { data: session, error: sessionError } = await supabase
        .from('chat_sessions')
        .select('id, company_id')
        .eq('id', sessionId)
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!session || session.company_id !== companyId) {
        return json(res, 404, { error: 'Session not found' })
      }

      const shortlist = Array.isArray(body.shortlist) ? body.shortlist : []
      const { data, error } = await supabase
        .from('chat_sessions')
        .update({
          shortlist,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId)
        .select('id, company_id, title, created_at, updated_at, shortlist')
        .single()
      if (error) throw error
      return json(res, 200, { session: data })
    }

    if (req.method === 'DELETE') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      const sessionId = String(body.sessionId || '').trim()
      if (!companyId || !sessionId) {
        return json(res, 400, { error: 'companyId and sessionId are required' })
      }

      const { data: session, error: sessionError } = await supabase
        .from('chat_sessions')
        .select('id, company_id')
        .eq('id', sessionId)
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!session || session.company_id !== companyId) {
        return json(res, 404, { error: 'Session not found' })
      }

      const { error } = await supabase.from('chat_sessions').delete().eq('id', sessionId)
      if (error) throw error
      return json(res, 200, { ok: true })
    }

    return json(res, 405, { error: 'Method not allowed' })
  } catch (err) {
    console.error('seo-advisor-sessions error:', err)
    return json(res, err.statusCode || 500, {
      error: err.message || 'Unexpected server error',
    })
  }
}
