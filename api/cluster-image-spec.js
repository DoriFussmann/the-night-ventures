import Anthropic from '@anthropic-ai/sdk'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 500

const ALLOWED_STYLES = new Set(['minimal', 'bold', 'editorial'])

const SYSTEM_PROMPT = `You turn a Design Guide Abstract into a small style spec for a branded topic-card graphic (SVG/canvas, not a photo).

Respond ONLY with valid JSON, no markdown fences, no preamble:
{
  "backgroundColor": "#rrggbb",
  "accentColor": "#rrggbb",
  "textColor": "#rrggbb",
  "fontFamily": "A real web-safe or Google Font name matching the aesthetic",
  "style": "minimal" | "bold" | "editorial"
}

Rules:
- Prefer exact hex values from the abstract when present; otherwise choose close matches.
- backgroundColor and textColor must contrast enough for large readable type (WCAG-ish).
- fontFamily: a single primary family name (e.g. "Inter", "Georgia", "IBM Plex Sans", "Source Serif 4") — no CSS stacks.
- style picks a layout variant: minimal = quiet/restrained; bold = high-contrast strong blocks; editorial = publication-like topic card.
- Do not invent photography or illustration instructions — colors, type, and style only.`

function stripMarkdownFences(text) {
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

  for (let i = start; i < source.length; i++) {
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

function normalizeHex(value, fallback) {
  const raw = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, r, g, b] = raw
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return fallback
}

function normalizeSpec(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const styleRaw = String(parsed.style || '')
    .trim()
    .toLowerCase()
  const style = ALLOWED_STYLES.has(styleRaw) ? styleRaw : 'minimal'

  const fontFamily = String(parsed.fontFamily || '')
    .trim()
    .replace(/["']/g, '')
    .split(',')[0]
    .trim()

  if (!fontFamily) return null

  return {
    backgroundColor: normalizeHex(parsed.backgroundColor, '#111827'),
    accentColor: normalizeHex(parsed.accentColor, '#6b7280'),
    textColor: normalizeHex(parsed.textColor, '#f9fafb'),
    fontFamily,
    style,
  }
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
    if (!apiKey) {
      console.error('Missing ANTHROPIC_API_KEY')
      return json(res, 500, { error: 'Server configuration error' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const abstract = String(body.abstract || body.design_guide_abstract || '').trim()

    if (!abstract) {
      return json(res, 400, { error: 'abstract is required' })
    }

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Design Guide Abstract:\n\n${abstract}`,
        },
      ],
    })

    if (message?.stop_reason === 'max_tokens') {
      console.error('cluster-image-spec truncated at max_tokens')
      return json(res, 502, {
        error: 'Model response was truncated. Try again.',
      })
    }

    const textBlock = Array.isArray(message?.content)
      ? message.content.find((block) => block?.type === 'text')
      : null
    const rawText = stripMarkdownFences(textBlock?.text || '')
    const jsonText = extractFirstJsonObject(rawText) || rawText

    let parsed
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      console.error('cluster-image-spec JSON parse failed:', rawText.slice(0, 400))
      return json(res, 502, { error: 'Could not parse style spec from model response' })
    }

    const spec = normalizeSpec(parsed)
    if (!spec) {
      return json(res, 502, { error: 'Invalid style spec from model response' })
    }

    return json(res, 200, { spec })
  } catch (err) {
    console.error('cluster-image-spec error:', err)
    const message =
      err?.error?.message || err?.message || 'Failed to generate cluster image style spec'
    return json(res, 502, { error: String(message) })
  }
}
