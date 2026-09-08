import Anthropic from '@anthropic-ai/sdk'
import { renderDesignGuide } from './_designGuideTemplate.js'

export const config = {
  maxDuration: 120,
}

const MODEL = 'claude-sonnet-4-6'
const HEX_RE = /^#[0-9A-Fa-f]{6}$/

const TOKEN_DEFS = [
  { posted: 'brand_feel', json: 'feel', required: true },
  { posted: 'brand_accent', json: 'accent', required: true, hex: true },
  { posted: 'brand_band', json: 'band', required: true, hex: true },
  { posted: 'brand_positive', json: 'positive', required: true, hex: true },
  { posted: 'wordmark_primary', json: 'wordmark_primary', required: true },
  { posted: 'wordmark_accent', json: 'wordmark_accent', required: false },
  { posted: 'brand_voice', json: 'voice', required: true },
]

const SUGGEST_SYSTEM = `You propose brand tokens for a fixed marketing-site design system. The palette, type scale, spacing, motion, and photography rules are already locked. You only fill missing brand tokens.

Return ONLY a JSON object. No preamble, no markdown, no keys other than the ones the user listed as missing.

Constraints:
- feel: one sentence.
- accent, band, positive: 6-digit hex strings starting with # (e.g. "#3A7D5E").
- band must be dark enough for white text at WCAG AA.
- accent must not be purple or electric blue. One restrained color for links, focus, and the nav underline only.
- positive is a muted green for "gain / included" marks — not neon, not the accent.
- wordmark_primary / wordmark_accent: split the brand name into two natural parts. If it cannot be split naturally, wordmark_primary is the full name and wordmark_accent is "".
- voice: at most 120 words of do/don't in this register — measured, precise, candid; short declaratives; "you"; specifics over superlatives. Never exclamation marks, hype, emoji, urgency/scarcity, a hero headline that opens with "We", empty mission-speak, or AI-forward framing when the product is human.

Do not invent a palette, type scale, spacing system, or motion language.`

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
}

function resolveAction(req, body) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const fromQuery = url.searchParams.get('action')
    if (fromQuery) return String(fromQuery).trim()
  } catch {
    // ignore
  }
  if (body?.action) return String(body.action).trim()
  return ''
}

function unwrapMarkdown(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return cleaned
}

function unwrapJson(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  cleaned = cleaned.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  return cleaned
}

function extractFirstJsonObject(text) {
  const source = String(text || '')
  const start = source.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

const TOKEN_JSON_PROPERTIES = {
  feel: { type: 'string', description: 'One sentence.' },
  accent: { type: 'string', description: '6-digit hex starting with #, e.g. #3A7D5E' },
  band: { type: 'string', description: 'Dark 6-digit hex starting with #, e.g. #1A1A2E' },
  positive: { type: 'string', description: 'Muted green 6-digit hex starting with #' },
  wordmark_primary: { type: 'string', description: 'First part of the brand name, or the full name' },
  wordmark_accent: { type: 'string', description: 'Second part of the brand name, or empty string' },
  voice: { type: 'string', description: 'At most 120 words of do/don\'t voice notes' },
}

function tokenFillTool(missingKeys) {
  const keys = missingKeys.filter((key) => TOKEN_JSON_PROPERTIES[key])
  return {
    name: 'set_brand_tokens',
    description: 'Set the missing brand tokens for the design system.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(keys.map((key) => [key, TOKEN_JSON_PROPERTIES[key]])),
      required: keys,
    },
  }
}

function parseSuggestedTokens(message) {
  const toolBlock = Array.isArray(message?.content)
    ? message.content.find(
        (block) => block?.type === 'tool_use' && block?.name === 'set_brand_tokens'
      )
    : null
  if (toolBlock && toolBlock.input && typeof toolBlock.input === 'object') {
    return toolBlock.input
  }

  const raw = unwrapJson(unwrapMarkdown(textFromMessage(message)))
  const extracted = extractFirstJsonObject(raw) || raw
  if (!extracted) return null
  try {
    const parsed = JSON.parse(extracted)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function textFromMessage(message) {
  const textBlock = Array.isArray(message?.content)
    ? message.content.find((block) => block?.type === 'text')
    : null
  return String(textBlock?.text || '').trim()
}

const ABSTRACT_SYSTEM =
  "Read this project's full Design Guide document. Produce a concise Design Guide Abstract (2-4 paragraphs) that captures: the brand's core visual identity (color palette — name actual hex/color values if present in the source, typography choices, and overall aesthetic/tone in a few descriptive words), and any distinctive visual patterns or motifs worth reusing in derivative brand assets (e.g. graphics, cards, social images). Write it for reuse as context in future AI generation tasks — specific and concrete (real color values, real font names), not vague marketing language. Respond with only the abstract text, no preamble, no markdown headers."

function asText(value) {
  return String(value ?? '').trim()
}

export function stripDomain(domain) {
  let host = asText(domain)
  host = host.replace(/^https?:\/\//i, '')
  host = host.replace(/^www\./i, '')
  host = host.replace(/\/.*$/, '')
  return host
}

export function isHexColor(value) {
  return HEX_RE.test(asText(value))
}

function postedTokens(company) {
  return {
    brand_feel: asText(company.brand_feel),
    brand_accent: asText(company.brand_accent),
    brand_band: asText(company.brand_band),
    brand_positive: asText(company.brand_positive),
    wordmark_primary: asText(company.wordmark_primary),
    wordmark_accent: asText(company.wordmark_accent),
    brand_voice: asText(company.brand_voice),
  }
}

function missingTokenKeys(tokens) {
  return TOKEN_DEFS.filter((def) => {
    if (def.posted === 'brand_feel') return false
    if (def.posted === 'wordmark_accent') {
      return !tokens.wordmark_primary
    }
    return !tokens[def.posted]
  }).map((def) => def.json)
}

function applySuggested(tokens, suggested) {
  const next = { ...tokens }
  if (!suggested || typeof suggested !== 'object' || Array.isArray(suggested)) {
    return next
  }
  for (const def of TOKEN_DEFS) {
    const incoming = suggested[def.json]
    if (incoming == null) continue
    if (def.posted === 'brand_feel') continue
    if (def.posted === 'wordmark_accent') {
      if (tokens.wordmark_primary) continue
      next.wordmark_accent = asText(incoming)
      continue
    }
    if (tokens[def.posted]) continue
    next[def.posted] = asText(incoming)
  }
  return next
}

function invalidHexFields(tokens) {
  return TOKEN_DEFS.filter((def) => def.hex && tokens[def.posted] && !isHexColor(tokens[def.posted]))
    .map((def) => def.posted)
}

function toRenderTokens(company, tokens) {
  const brandName = asText(company.product_name) || asText(company.name)
  return {
    BRAND_NAME: brandName,
    DOMAIN: stripDomain(company.domain),
    FEEL: tokens.brand_feel,
    ACCENT: tokens.brand_accent,
    BAND: tokens.brand_band,
    POSITIVE: tokens.brand_positive,
    WORDMARK_PRIMARY: tokens.wordmark_primary,
    WORDMARK_ACCENT: tokens.wordmark_accent,
    VOICE: tokens.brand_voice,
  }
}

function responseTokens(company, tokens) {
  const rendered = toRenderTokens(company, tokens)
  return {
    brand_name: rendered.BRAND_NAME,
    domain: rendered.DOMAIN,
    brand_feel: tokens.brand_feel,
    brand_accent: tokens.brand_accent,
    brand_band: tokens.brand_band,
    brand_positive: tokens.brand_positive,
    wordmark_primary: tokens.wordmark_primary,
    wordmark_accent: tokens.wordmark_accent,
    brand_voice: tokens.brand_voice,
  }
}

function companyContext(company) {
  return {
    name: asText(company.name),
    product_name: asText(company.product_name),
    domain: stripDomain(company.domain),
    abstract: asText(company.abstract),
    short_description: asText(company.short_description),
    medium_description: asText(company.medium_description),
    long_description: asText(company.long_description),
    target_audience: asText(company.target_audience),
    business_model: asText(company.business_model),
    core_value_proposition: asText(company.core_value_proposition),
    scope_boundaries: asText(company.scope_boundaries),
    services: company.services,
    team_members: company.team_members,
    competitors: company.competitors,
  }
}

async function handleAbstract(req, res, body, apiKey) {
  const raw = String(body.raw || '').trim()
  if (!raw) {
    return json(res, 400, { error: 'raw is required' })
  }

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: ABSTRACT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Design Guide document:\n\n${raw}`,
      },
    ],
  })

  if (message?.stop_reason === 'max_tokens') {
    console.error('design-guide abstract truncated at max_tokens')
    return json(res, 502, {
      error: 'Model response was truncated. Try again with a shorter Design Guide.',
    })
  }

  const abstract = textFromMessage(message)
  if (!abstract) {
    return json(res, 502, { error: 'No text content in Anthropic response' })
  }

  return json(res, 200, { abstract })
}

async function suggestMissingTokens(apiKey, company, tokens, missingKeys) {
  const anthropic = new Anthropic({ apiKey })
  const alreadySet = {}
  for (const def of TOKEN_DEFS) {
    if (!missingKeys.includes(def.json) && (def.posted !== 'wordmark_accent' || tokens.wordmark_primary)) {
      alreadySet[def.json] = tokens[def.posted]
    }
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.3,
    system: SUGGEST_SYSTEM,
    tools: [tokenFillTool(missingKeys)],
    tool_choice: { type: 'tool', name: 'set_brand_tokens' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              'Propose brand tokens for this company.',
              `Fill these missing keys: ${missingKeys.join(', ')}.`,
              '',
              'Company data:',
              JSON.stringify(companyContext(company), null, 2),
              '',
              'Already set (do not repeat or change):',
              JSON.stringify(alreadySet, null, 2),
            ].join('\n'),
          },
        ],
      },
    ],
  })

  if (message?.stop_reason === 'max_tokens') {
    console.error('design-guide generate truncated at max_tokens')
    throw Object.assign(new Error('Model response was truncated. Try generating again.'), {
      statusCode: 502,
    })
  }

  const parsed = parseSuggestedTokens(message)
  if (!parsed) {
    console.error('design-guide generate: unusable token payload', textFromMessage(message))
    throw Object.assign(new Error('Model did not return valid brand tokens. Try generating again.'), {
      statusCode: 502,
    })
  }

  const merged = applySuggested(tokens, parsed)
  const stillMissing = missingTokenKeys(merged)
  if (stillMissing.length > 0) {
    console.error('design-guide generate: omitted tokens', stillMissing)
    throw Object.assign(
      new Error(`Model omitted required tokens: ${stillMissing.join(', ')}`),
      { statusCode: 502 }
    )
  }
  return merged
}

async function handleGenerate(req, res, body, apiKey) {
  const company = body.company

  if (!company || typeof company !== 'object' || Array.isArray(company)) {
    return json(res, 400, { error: 'company must be an object' })
  }

  let tokens = postedTokens(company)
  const missingKeys = missingTokenKeys(tokens)

  if (missingKeys.length === 0) {
    console.log('design-guide generate: skipped LLM (all tokens set)')
  } else {
    console.log('design-guide generate: calling LLM for missing tokens', missingKeys)
    if (!apiKey) {
      console.error('Missing ANTHROPIC_API_KEY')
      return json(res, 500, { error: 'Server configuration error' })
    }
    try {
      tokens = await suggestMissingTokens(apiKey, company, tokens, missingKeys)
    } catch (err) {
      const status = err.statusCode || 500
      return json(res, status, { error: err.message || 'Failed to suggest tokens' })
    }
  }

  const badHex = invalidHexFields(tokens)
  if (badHex.length > 0) {
    console.error(
      'design-guide generate: invalid hex',
      badHex.map((key) => ({ key, value: tokens[key] }))
    )
    return json(res, 502, {
      error: `Invalid hex token (expected #RRGGBB): ${badHex.join(', ')}`,
    })
  }

  const markdown = renderDesignGuide(toRenderTokens(company, tokens))
  return json(res, 200, {
    markdown,
    tokens: responseTokens(company, tokens),
  })
}

export default async function handler(req, res) {
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
    const body = parseBody(req)
    const action = resolveAction(req, body)

    if (action === 'abstract') {
      if (!apiKey) {
        console.error('Missing ANTHROPIC_API_KEY')
        return json(res, 500, { error: 'Server configuration error' })
      }
      return await handleAbstract(req, res, body, apiKey)
    }
    if (action === 'generate') {
      return await handleGenerate(req, res, body, apiKey)
    }

    return json(res, 400, {
      error: 'action is required (abstract | generate)',
    })
  } catch (err) {
    console.error('design-guide error:', err)
    const message =
      err?.error?.message || err?.message || 'Unexpected server error'
    return json(res, 500, { error: String(message) })
  }
}
