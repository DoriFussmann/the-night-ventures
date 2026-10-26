import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'
import { keywordStore } from '../lib/seo-advisor/pillars.js'
import { loadProfile } from '../lib/seo-advisor/context.js'
import { seoControlsStatus } from '../lib/seo-advisor/seoControls.js'

/**
 * Core / Supporting keyword tree (content_coverage) for a company.
 *
 * GET  ?companyId=…                       → { pillars, seoControls }
 * POST { companyId, action, … }           → { pillars, … }
 *   add_core          { keyword, searchVolume?, difficulty?, spec? }
 *   add_supporting    { core, keyword, searchVolume?, difficulty?, spec? }
 *   update_spec       { core, keyword?, spec }   (no keyword = the Core's own article)
 *   add_backlog       { core, keyword, note? }
 *   remove_backlog    { core, keyword }
 *   remove_core       { core }
 *   remove_supporting { core, keyword }
 *   replace_tree      { pillars: [{ keyword, supporting: [string] }], expected? }
 */
export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return

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
      if (!companyId) return json(res, 400, { error: 'companyId is required' })
      const [pillars, profile] = await Promise.all([
        keywordStore.load(supabase, companyId),
        loadProfile(supabase, companyId),
      ])
      return json(res, 200, { pillars, seoControls: seoControlsStatus(profile) })
    }

    if (req.method === 'POST') {
      const body = parseBody(req)
      const companyId = String(body.companyId || '').trim()
      const action = String(body.action || '').trim()
      if (!companyId) return json(res, 400, { error: 'companyId is required' })

      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle()
      if (companyError) throw companyError
      if (!company) return json(res, 404, { error: 'Company not found' })

      let result
      switch (action) {
        case 'add_core':
          result = await keywordStore.addCore(supabase, companyId, body, {
            source: body.source || 'advisor',
          })
          break
        case 'add_supporting':
          result = await keywordStore.addSupporting(supabase, companyId, body, {
            source: body.source || 'advisor',
          })
          break
        case 'update_spec':
          result = await keywordStore.updateSpec(supabase, companyId, body)
          break
        case 'add_backlog':
          result = await keywordStore.addBacklog(supabase, companyId, body)
          break
        case 'remove_backlog':
          result = await keywordStore.removeBacklog(supabase, companyId, body)
          break
        case 'remove_core':
          result = await keywordStore.removeCore(supabase, companyId, body)
          break
        case 'remove_supporting':
          result = await keywordStore.removeSupporting(supabase, companyId, body)
          break
        case 'replace_tree':
          if (!Array.isArray(body.pillars)) {
            return json(res, 400, { error: 'pillars array is required' })
          }
          result = await keywordStore.replaceTree(supabase, companyId, body.pillars, {
            source: 'company_data',
            expected: Array.isArray(body.expected) ? body.expected : undefined,
          })
          break
        default:
          return json(res, 400, { error: `Unknown action: ${action || '(none)'}` })
      }

      return json(res, 200, {
        pillars: result.tree,
        added: result.added ? result.added.keyword : undefined,
        removed: result.removed,
        keptLocked: result.keptLocked,
        skipped: result.skipped,
      })
    }

    return json(res, 405, { error: 'Method not allowed' })
  } catch (err) {
    if (!err.statusCode || err.statusCode >= 500) {
      console.error('seo-advisor-keywords error:', err)
    }
    return json(res, err.statusCode || 500, {
      error: err.message || 'Unexpected server error',
      code: err.code,
      existing: err.existing,
    })
  }
}
