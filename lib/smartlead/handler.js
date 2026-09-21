import { requireAuth, handleOptions, parseBody, json } from '../seo-advisor/auth.js'

// Read-only SmartLead proxy. The API key never leaves the server. Only a fixed
// whitelist of GET resources is allowed — no arbitrary path passthrough, and
// nothing that mutates campaign state (no status changes, no sending).
// Docs: https://api.smartlead.ai  (base https://server.smartlead.ai/api/v1)

const BASE = 'https://server.smartlead.ai/api/v1'
const TIMEOUT_MS = 15000

function apiKey() {
  return String(process.env.SMARTLEAD_API_KEY || '').trim()
}

async function slFetch(path, { method = 'GET', body } = {}) {
  const key = apiKey()
  if (!key) {
    const err = new Error('SMARTLEAD_API_KEY is not set in the server environment')
    err.statusCode = 400
    throw err
  }
  const sep = path.includes('?') ? '&' : '?'
  const url = `${BASE}${path}${sep}api_key=${encodeURIComponent(key)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let data = text
    try {
      data = JSON.parse(text)
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `SmartLead HTTP ${res.status}`
      const err = new Error(msg)
      err.statusCode = res.status
      throw err
    }
    return data
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('SmartLead request timed out')
      e.statusCode = 504
      throw e
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const slGet = (path) => slFetch(path)

// Map a cleaned lead (compact shape from the CSV cleaner) to SmartLead's item.
function mapLead(c) {
  return {
    email: c.email,
    first_name: c.first_name,
    last_name: c.last_name,
    company_name: c.company_name,
    company_url: c.company_domain,
    linkedin_profile: c.linkedin_url,
    location: c.company_state,
    custom_fields: {
      job_title: c.job_title,
      headline: c.headline,
      industry: c.company_industry,
      company_size: c.company_employee_count,
      company_revenue: c.company_revenue,
    },
  }
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function requireCampaign(campaignId) {
  const id = String(campaignId || '').trim()
  if (!id) {
    const err = new Error('campaignId is required for this view')
    err.statusCode = 400
    throw err
  }
  return encodeURIComponent(id)
}

export async function handleSmartlead(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return

  try {
    await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const body = parseBody(req) || {}
  const resource = String(body.resource || '').trim()
  const campaignId = body.campaignId
  const offset = Number.isFinite(Number(body.offset)) ? Math.max(0, Number(body.offset)) : 0
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 100))

  try {
    let data
    switch (resource) {
      case 'campaigns':
        data = await slGet('/campaigns/')
        break
      case 'campaign':
        data = await slGet(`/campaigns/${requireCampaign(campaignId)}`)
        break
      case 'sequences':
        data = await slGet(`/campaigns/${requireCampaign(campaignId)}/sequences`)
        break
      case 'leads':
        data = await slGet(
          `/campaigns/${requireCampaign(campaignId)}/leads?offset=${offset}&limit=${limit}`
        )
        break
      case 'analytics':
        data = await slGet(`/campaigns/${requireCampaign(campaignId)}/analytics`)
        break
      case 'email-accounts':
        data = await slGet(`/campaigns/${requireCampaign(campaignId)}/email-accounts`)
        break
      case 'leads-import': {
        // WRITE: import leads into a campaign. Does NOT change campaign status,
        // so it never starts sending on its own. Batched at 400/request.
        const id = requireCampaign(campaignId)
        const leads = Array.isArray(body.leads) ? body.leads : []
        if (!leads.length) {
          return json(res, 400, { ok: false, error: 'No leads to import' })
        }
        const batches = chunk(leads, 400)
        const agg = { batches: batches.length, total: 0, added: 0, already_in_campaign: 0, duplicates: 0, invalid: 0 }
        for (const b of batches) {
          const resp = await slFetch(`/campaigns/${id}/leads`, {
            method: 'POST',
            body: {
              lead_list: b.map(mapLead),
              settings: {
                ignore_global_block_list: false,
                ignore_unsubscribe_list: false,
                ignore_duplicate_leads_in_other_campaign: false,
              },
            },
          })
          agg.total += Number(resp?.total_leads ?? b.length) || 0
          agg.added += Number(resp?.added_count ?? resp?.upload_count ?? 0) || 0
          agg.already_in_campaign += Number(resp?.already_added_to_campaign ?? 0) || 0
          agg.duplicates += Number(resp?.duplicate_count ?? 0) || 0
          agg.invalid += Number(resp?.invalid_email_count ?? 0) || 0
        }
        data = agg
        break
      }
      default:
        return json(res, 400, { error: `Unknown resource "${resource}"` })
    }
    return json(res, 200, { ok: true, resource, data })
  } catch (err) {
    console.error('smartlead error:', err)
    return json(res, err.statusCode || 502, { ok: false, error: err.message || 'SmartLead request failed' })
  }
}
