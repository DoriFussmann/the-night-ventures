import Anthropic from '@anthropic-ai/sdk'
import { GENERATE_ARTICLE_MODEL } from '../generate-article/prompt.js'
import {
  handleOptions,
  json,
  parseBody,
  requireAuth,
} from '../seo-advisor/auth.js'

const MAX_TOKENS = 500

function extractText(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return ''
  return contentBlocks
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => block.text)
    .join('')
}

function stripJsonFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function parseSuggestions(text) {
  const cleaned = stripJsonFences(text)
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) {
      const err = new Error('Failed to parse keyword suggestions')
      err.statusCode = 502
      throw err
    }
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      const err = new Error('Failed to parse keyword suggestions')
      err.statusCode = 502
      throw err
    }
  }

  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (suggestions.length !== 3) {
    const err = new Error('Failed to parse keyword suggestions')
    err.statusCode = 502
    throw err
  }
  return suggestions
}

function buildPrompt({ text, pillarKeyword, supportingKeyword }) {
  return [
    'Suggest exactly 3 long-tail target keywords for a new article.',
    'Rules:',
    '- Each suggestion is 2–6 words, lowercase, and a realistic search query.',
    '- Each suggestion should support the cluster keyword.',
    '- Do not repeat the pillar keyword or the cluster keyword.',
    '- Return JSON only, with no markdown fences:',
    '{"suggestions":["...","...","..."]}',
    '',
    `Pillar keyword: ${pillarKeyword}`,
    `Cluster keyword: ${supportingKeyword}`,
    '',
    'Source text (may be empty):',
    text || '(none)',
  ].join('\n')
}

export async function handleSuggestTargetKeyword(req, res) {
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
  const pillarKeyword = String(body.pillarKeyword || '').trim()
  const supportingKeyword = String(body.supportingKeyword || '').trim()
  const text = String(body.text || '').slice(0, 6000)

  if (!pillarKeyword || !supportingKeyword) {
    return json(res, 400, {
      error: 'pillarKeyword and supportingKeyword are required',
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY')
    return json(res, 500, { error: 'Server configuration error' })
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: GENERATE_ARTICLE_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: buildPrompt({ text, pillarKeyword, supportingKeyword }),
        },
      ],
    })
    const suggestions = parseSuggestions(extractText(message.content))
    return json(res, 200, { suggestions })
  } catch (err) {
    console.error('suggest-target-keyword failed:', err)
    return json(res, 502, {
      error: err?.message || 'Failed to parse keyword suggestions',
    })
  }
}
