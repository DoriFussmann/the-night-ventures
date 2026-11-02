import { requireAuth } from '../seo-advisor/auth.js'

/**
 * Reject the request unless it carries a valid Supabase user token.
 * Returns true when a response was already sent (caller should return).
 *
 *   if (await rejectUnlessUser(req, res)) return
 */
export async function rejectUnlessUser(req, res) {
  try {
    await requireAuth(req)
    return false
  } catch (err) {
    res.statusCode = err?.statusCode || 401
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: err?.message || 'Unauthorized' }))
    return true
  }
}
