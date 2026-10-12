import { requireAuth, handleOptions, parseBody, json } from '../lib/seo-advisor/auth.js'
import { healthSnapshot } from '../lib/seo-advisor/tools.js'

/**
 * Advisor chat sessions.
 *
 * GET    ?companyId=…               → { sessions }
 * GET    ?companyId=…&sessionId=…   → { session, messages }
 * DELETE { companyId, sessionId }   → { ok }
 *
 * Sessions are created by the first chat message (seo-advisor-chat).
 */

async function selectSession(supabase, sessionId) {
  const first = await supabase
    .from('chat_sessions')
    .select('id, company_id, title, market, language, created_at, updated_at')
    .eq('id', sessionId)
    .maybeSingle()
  if (!first.error) return first.data
  if (/market|language|column/i.test(first.error.message || '')) {
    const retry = await supabase
      .from('chat_sessions')
      .select('id, company_id, title, created_at, updated_at')
      .eq('id', sessionId)
      .maybeSingle()
    if (retry.error) throw retry.error
    return retry.data
  }
  throw first.error
}

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET, DELETE, OPTIONS')) return

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

      if (sessionId) {
        const session = await selectSession(supabase, sessionId)
        if (!session || session.company_id !== companyId) {
          return json(res, 404, { error: 'Session not found' })
        }
        const { data: messages, error } = await supabase
          .from('chat_messages')
          .select('id, role, content, created_at')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true })
        if (error) throw error
        return json(res, 200, { session, messages: messages || [] })
      }

      const { data: sessions, error } = await supabase
        .from('chat_sessions')
        .select('id, company_id, title, created_at, updated_at')
        .eq('company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return json(res, 200, { sessions: sessions || [], providerHealth: healthSnapshot() })
    }

    if (req.method === 'DELETE') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      const sessionId = String(body.sessionId || '').trim()
      if (!companyId || !sessionId) {
        return json(res, 400, { error: 'companyId and sessionId are required' })
      }
      const session = await selectSession(supabase, sessionId)
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
    return json(res, err.statusCode || 500, { error: err.message || 'Unexpected server error' })
  }
}
