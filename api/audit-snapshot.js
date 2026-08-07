import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'
import {
  PANEL_IDS,
  PANEL_META,
  resolveSiteUrl,
  resolveSampleUrl,
  resolveCompanyContext,
  runAuditPanel,
  normalizeSnapshotResults,
} from '../lib/audit-snapshot/runPanel.js'

export const config = { maxDuration: 300 }

function selectColumns() {
  return 'id, company_id, run_at, site_url, sample_url, results, pagespeed_mobile, pagespeed_desktop, bot_access, jsonld_check'
}

function shapeSnapshot(row) {
  if (!row) return null
  return {
    ...row,
    results: normalizeSnapshotResults(row),
  }
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
        .select(selectColumns())
        .eq('company_id', companyId)
        .order('run_at', { ascending: false })
        .limit(50)

      if (error) {
        // Table not migrated yet — allow the tool UI to load and run panels.
        if (error.code === 'PGRST205' || /audit_snapshots/i.test(error.message || '')) {
          return json(res, 200, {
            snapshots: [],
            panels: PANEL_META,
            warning:
              'audit_snapshots table missing — apply supabase/migrations/028_audit_snapshots_results.sql to enable history persistence',
          })
        }
        throw error
      }
      return json(res, 200, {
        snapshots: (snapshots || []).map(shapeSnapshot),
        panels: PANEL_META,
      })
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

      const action = String(body.action || 'runPanel').trim()

      if (action === 'persist') {
        const results = body.results
        if (!results || typeof results !== 'object') {
          return json(res, 400, { error: 'results object is required' })
        }

        const { siteUrl, siteSource } = await resolveSiteUrl(
          supabase,
          companyId,
          body.siteUrl || body.url
        )
        if (!siteUrl && !body.siteUrl) {
          return json(res, 400, {
            error:
              'siteUrl is required (or set company domain in Company Data)',
          })
        }

        const resolvedSiteUrl = siteUrl || String(body.siteUrl || '').trim()
        const sampleMeta = await resolveSampleUrl(
          supabase,
          companyId,
          body.sampleUrl
        )

        // Mirror key panels into legacy columns for older history UI / charts.
        const pagespeedMobile = results.pagespeed?.mobile || null
        const pagespeedDesktop = results.pagespeed?.desktop || null
        const botAccess = results.semrush?.botAccess || null
        const jsonldCheck =
          results.technical?.jsonld ||
          results.technical?.jsonld?.jsonld ||
          null

        const row = {
          company_id: companyId,
          run_at: new Date().toISOString(),
          site_url: resolvedSiteUrl,
          sample_url: sampleMeta.sampleUrl || body.sampleUrl || null,
          results,
          pagespeed_mobile: pagespeedMobile,
          pagespeed_desktop: pagespeedDesktop,
          bot_access: botAccess,
          jsonld_check: jsonldCheck,
        }

        const { data: inserted, error: insertError } = await supabase
          .from('audit_snapshots')
          .insert(row)
          .select(selectColumns())
          .single()

        if (insertError) {
          if (
            insertError.code === 'PGRST205' ||
            /audit_snapshots/i.test(insertError.message || '')
          ) {
            return json(res, 200, {
              snapshot: {
                id: null,
                company_id: companyId,
                run_at: row.run_at,
                site_url: resolvedSiteUrl,
                sample_url: row.sample_url,
                results,
              },
              meta: {
                siteUrl: resolvedSiteUrl,
                siteSource,
                sampleSource: sampleMeta.sampleSource,
                sampleTitle: sampleMeta.sampleTitle || null,
                companyName: company.name || null,
                persisted: false,
                warning:
                  'Results computed but not saved — apply supabase/migrations/028_audit_snapshots_results.sql',
              },
            })
          }
          throw insertError
        }

        return json(res, 200, {
          snapshot: shapeSnapshot(inserted),
          meta: {
            siteUrl: resolvedSiteUrl,
            siteSource,
            sampleSource: sampleMeta.sampleSource,
            sampleTitle: sampleMeta.sampleTitle || null,
            companyName: company.name || null,
            persisted: true,
          },
        })
      }

      // Default: run a single panel (progressive sequential orchestration).
      const panel = String(body.panel || body.source || '').trim()
      if (!PANEL_IDS.includes(panel)) {
        return json(res, 400, {
          error: `panel must be one of: ${PANEL_IDS.join(', ')}`,
          panels: PANEL_META,
        })
      }

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

      const context = await resolveCompanyContext(supabase, companyId)
      const sampleMeta = await resolveSampleUrl(
        supabase,
        companyId,
        body.sampleUrl
      )

      const result = await runAuditPanel({
        panel,
        siteUrl,
        sampleUrl: sampleMeta.sampleUrl,
        productName: context.productName,
        companyName: company.name || null,
        coreKeywords: context.coreKeywords,
      })

      return json(res, 200, {
        panel,
        result,
        meta: {
          siteUrl,
          siteSource,
          sampleSource: sampleMeta.sampleSource,
          sampleTitle: sampleMeta.sampleTitle || null,
          sampleUrl: sampleMeta.sampleUrl,
          productName: context.productName,
          coreKeywords: context.coreKeywords,
          companyName: company.name || null,
        },
      })
    }

    return json(res, 405, { error: 'Method not allowed' })
  } catch (err) {
    console.error('[audit-snapshot]', err)
    return json(res, 500, {
      error: err?.message || 'Internal server error',
    })
  }
}
