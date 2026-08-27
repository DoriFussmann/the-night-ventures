import { requireAuth } from '../seo-advisor/auth.js'
import { searchExternalLinks } from './search.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function asArticleList(body) {
  if (Array.isArray(body.articles) && body.articles.length) return body.articles
  if (body.article && typeof body.article === 'object') return [body.article]
  return []
}

export async function handleProposeExternalLinks(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, {
      error: err.message || 'Unauthorized',
    })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const articles = asArticleList(body)
  if (articles.length === 0) {
    return json(res, 400, {
      error: 'article or articles is required',
    })
  }
  if (articles.some((item) => !String(item?.slug || '').trim())) {
    return json(res, 400, { error: 'each article needs a slug' })
  }

  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    return json(res, 503, {
      error: 'DATAFORSEO_LOGIN/PASSWORD not configured',
    })
  }

  try {
    const result = await searchExternalLinks({
      articles,
      siteUrl: String(body.siteUrl || body.ownHost || '').trim(),
      sources: body.sources,
      limit: body.limit,
    })
    return json(res, 200, { ok: true, ...result })
  } catch (err) {
    console.error('propose-external-links error:', err)
    return json(res, 502, {
      ok: false,
      error: err.message || 'Failed to propose external links',
    })
  }
}
