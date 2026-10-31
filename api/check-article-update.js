import Anthropic from '@anthropic-ai/sdk'
import { handleScanLiveArticles } from '../lib/scan-live-articles/handler.js'
import { handlePublishToSite } from '../lib/publish-to-site/handler.js'
import { handleWireInternalLinks } from '../lib/wire-internal-links/handler.js'
import { handleProposeExternalLinks } from '../lib/external-links/handler.js'
import { handleCheckLinks } from '../lib/check-links/handler.js'
import { handleArticleUpdates } from '../lib/article-updates/handler.js'
import { handleCompanyDataImport } from '../lib/company-data-import/handler.js'
import { handleAuditSummary } from '../lib/audit-summary/handler.js'
import { handleCoreVersion } from '../lib/core-version/handler.js'
import { handleInstantly, handleInstantlyWebhook } from '../lib/instantly/handler.js'
import { handleIntegrations } from '../lib/integrations/handler.js'
import { handleSuggestTargetKeyword } from '../lib/suggest-target-keyword/handler.js'
import { handleSitePlaceholders } from '../lib/placeholders/handler.js'
import { handlePublishSchedule } from '../lib/publish-schedule/handler.js'
import { handleAudienceBuild } from '../lib/audience-build/handler.js'
import {
  MAX_TOKENS,
  MODEL,
  buildUserPrompt,
  extractTextContent,
  normalizeResult,
  parseUpdateFromContent,
} from '../lib/article-updates/wtsCheck.js'
import { handleAnalyzeWriterArticle } from '../lib/writer-intake/handler.js'

export const config = {
  // 300: the daily scheduled publisher (publish-schedule) commits, merges,
  // wires links and may refresh Where Things Stand in one run.
  maxDuration: 300,
}

function requestAction(req) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const fromQuery = url.searchParams.get('action')
    if (fromQuery) return String(fromQuery).trim()
    const path = url.pathname.replace(/\/$/, '')
    if (path.endsWith('/scan-live-articles')) {
      return 'scan-live'
    }
    if (path.endsWith('/publish-to-site')) {
      return 'publish-to-site'
    }
    if (path.endsWith('/wire-internal-links')) {
      return 'wire-internal-links'
    }
    if (path.endsWith('/propose-external-links')) {
      return 'propose-external-links'
    }
    if (path.endsWith('/check-links')) {
      return 'check-links'
    }
    if (path.endsWith('/article-updates')) {
      return 'article-updates'
    }
    if (path.endsWith('/company-data-import')) {
      return 'company-data-import'
    }
    if (path.endsWith('/audit-summary')) {
      return 'audit-summary'
    }
    if (path.endsWith('/integrations')) {
      return 'integrations'
    }
    if (path.endsWith('/suggest-target-keyword')) {
      return 'suggest-target-keyword'
    }
    if (path.endsWith('/site-placeholders')) {
      return 'site-placeholders'
    }
    if (path.endsWith('/publish-schedule')) {
      return 'publish-schedule'
    }
    if (path.endsWith('/analyze-writer-article')) {
      return 'analyze-writer-article'
    }
  } catch {
    // ignore
  }
  return ''
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const WTS_START = '<!-- WHERE-THINGS-STAND:START -->'
const WTS_END = '<!-- WHERE-THINGS-STAND:END -->'

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : ''
    })
}

function htmlFragmentToText(fragment) {
  let text = String(fragment || '')
  // Preserve paragraph boundaries before stripping tags.
  text = text.replace(/<\/p\s*>/gi, '\n\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeBasicEntities(text)
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return text
}

function extractWhereThingsStand(html) {
  const source = String(html || '')
  const startIdx = source.indexOf(WTS_START)
  const endIdx = source.indexOf(WTS_END)

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null
  }

  const fragment = source.slice(startIdx + WTS_START.length, endIdx)
  const text = htmlFragmentToText(fragment)
  return text || null
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export {
  extractWhereThingsStand,
  htmlFragmentToText,
  normalizeResult,
  parseUpdateFromContent,
}

export default async function handler(req, res) {
  // Hobby is capped at 12 functions; extra public URLs are mounted here
  // instead of adding more api/*.js files.
  // Public: POST /api/scan-live-articles, POST /api/publish-to-site,
  // POST /api/wire-internal-links, POST /api/propose-external-links,
  // POST /api/check-links, POST /api/article-updates,
  // POST /api/company-data-import, POST /api/audit-summary,
  // POST /api/suggest-target-keyword, POST /api/site-placeholders,
  // GET|POST /api/publish-schedule (also the daily publishing cron).
  const action = requestAction(req)
  if (action === 'scan-live') {
    return handleScanLiveArticles(req, res)
  }
  if (action === 'publish-to-site') {
    return handlePublishToSite(req, res)
  }
  if (action === 'wire-internal-links') {
    return handleWireInternalLinks(req, res)
  }
  if (action === 'propose-external-links') {
    return handleProposeExternalLinks(req, res)
  }
  if (action === 'check-links') {
    return handleCheckLinks(req, res)
  }
  if (action === 'article-updates') {
    return handleArticleUpdates(req, res)
  }
  if (action === 'company-data-import') {
    return handleCompanyDataImport(req, res)
  }
  if (action === 'audit-summary') {
    return handleAuditSummary(req, res)
  }
  if (action === 'core-version') {
    return handleCoreVersion(req, res)
  }
  if (action === 'instantly') {
    return handleInstantly(req, res)
  }
  if (action === 'instantly-webhook') {
    return handleInstantlyWebhook(req, res)
  }
  if (action === 'integrations') {
    return handleIntegrations(req, res)
  }
  if (action === 'suggest-target-keyword') {
    return handleSuggestTargetKeyword(req, res)
  }
  if (action === 'site-placeholders') {
    return handleSitePlaceholders(req, res)
  }
  if (action === 'publish-schedule') {
    return handlePublishSchedule(req, res)
  }
  if (action === 'audience-build') {
    return handleAudienceBuild(req, res)
  }
  if (action === 'analyze-writer-article') {
    return handleAnalyzeWriterArticle(req, res)
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('Missing ANTHROPIC_API_KEY')
      return json(res, 500, { error: 'Server configuration error' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const publishedUrl = String(body.publishedUrl || body.published_url || '').trim()
    const targetKeyword = String(body.targetKeyword || body.target_keyword || '').trim()
    const pillarKeyword = String(body.pillarKeyword || body.pillar_keyword || '').trim()

    if (!publishedUrl || !isHttpUrl(publishedUrl)) {
      return json(res, 400, { error: 'publishedUrl must be a valid http(s) URL' })
    }
    if (!targetKeyword) {
      return json(res, 400, { error: 'targetKeyword is required' })
    }
    if (!pillarKeyword) {
      return json(res, 400, { error: 'pillarKeyword is required' })
    }

    let liveHtml
    try {
      const liveRes = await fetch(publishedUrl, {
        headers: {
          'User-Agent': 'TheNightVentures-ArticlesUpdate/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      })
      if (!liveRes.ok) {
        return json(res, 502, {
          error: `Failed to fetch published URL (HTTP ${liveRes.status}). Check that published_url is correct.`,
        })
      }
      liveHtml = await liveRes.text()
    } catch (err) {
      console.error('check-article-update fetch failed:', err)
      return json(res, 502, {
        error: `Failed to fetch published URL: ${err?.message || 'network error'}`,
      })
    }

    const currentParagraph = extractWhereThingsStand(liveHtml)
    if (!currentParagraph) {
      return json(res, 422, {
        error:
          'Could not find <!-- WHERE-THINGS-STAND:START --> / <!-- WHERE-THINGS-STAND:END --> markers in the live page HTML. The article may not have this section, or the published_url may be wrong.',
      })
    }

    const anthropic = new Anthropic({ apiKey })
    const prompt = buildUserPrompt({
      publishedUrl,
      targetKeyword,
      pillarKeyword,
      currentParagraph,
    })

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    })

    if (message?.stop_reason === 'max_tokens') {
      console.error('check-article-update truncated at max_tokens')
      return json(res, 502, {
        error: 'Model response was truncated before finishing JSON. Try again.',
      })
    }

    let parsed
    try {
      parsed = parseUpdateFromContent(message?.content)
    } catch (err) {
      const preview = extractTextContent(message?.content).slice(0, 500)
      console.error('check-article-update JSON parse failed:', err, preview)
      return json(res, 502, { error: 'Failed to parse model response as JSON' })
    }

    const result = normalizeResult(parsed, currentParagraph)
    // Always return the live-extracted paragraph as the source of truth.
    result.currentParagraph = currentParagraph

    if (result.updateWarranted && !result.proposedParagraph) {
      return json(res, 502, {
        error: 'Model marked update warranted but returned no proposed paragraph',
      })
    }

    return json(res, 200, result)
  } catch (err) {
    console.error('check-article-update error:', err)
    const message = err?.error?.message || err?.message || 'Failed to check article update'
    return json(res, 502, { error: String(message) })
  }
}
