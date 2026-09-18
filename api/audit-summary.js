import Anthropic from '@anthropic-ai/sdk'
import {
  requireAuth,
  json,
  handleOptions,
  parseBody,
} from '../lib/seo-advisor/auth.js'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 800

const SYSTEM_PROMPT =
  "You are an SEO analyst. Given this technical audit JSON (keyword rank, crawlability, technical checks, PageSpeed, Moz authority), write a tight summary: 1) one-line overall health, 2) what's broken or at-risk, 3) the top 3 prioritized actions. Be specific, no fluff."

function extractText(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return ''
  return contentBlocks
    .filter((b) => b?.type === 'text' && b.text)
    .map((b) => b.text)
    .join('')
}

export default async function handler(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }

  const body = parseBody(req)
  const companyId = String(body.companyId || '').trim()
  const results = body.results

  if (!companyId) return json(res, 400, { error: 'companyId is required' })
  if (results == null || typeof results !== 'object') {
    return json(res, 400, { error: 'results is required' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY')
    return json(res, 500, { error: 'Server configuration error' })
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify(results),
        },
      ],
    })
    const summary = extractText(msg.content).trim()
    return json(res, 200, { summary })
  } catch (err) {
    console.error('audit-summary failed:', err)
    return json(res, 500, { error: err.message || 'Summary failed' })
  }
}
