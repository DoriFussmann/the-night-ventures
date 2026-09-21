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

async function slGet(path) {
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
    const res = await fetch(url, { signal: controller.signal })
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
      default:
        return json(res, 400, { error: `Unknown resource "${resource}"` })
    }
    return json(res, 200, { ok: true, resource, data })
  } catch (err) {
    console.error('smartlead error:', err)
    return json(res, err.statusCode || 502, { ok: false, error: err.message || 'SmartLead request failed' })
  }
}
