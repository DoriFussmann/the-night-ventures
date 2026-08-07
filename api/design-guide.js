import Anthropic from '@anthropic-ai/sdk'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
}

function parseModelJson(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return JSON.parse(cleaned)
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

const ABSTRACT_SYSTEM =
  "Read this project's full Design Guide document. Produce a concise Design Guide Abstract (2-4 paragraphs) that captures: the brand's core visual identity (color palette — name actual hex/color values if present in the source, typography choices, and overall aesthetic/tone in a few descriptive words), and any distinctive visual patterns or motifs worth reusing in derivative brand assets (e.g. graphics, cards, social images). Write it for reuse as context in future AI generation tasks — specific and concrete (real color values, real font names), not vague marketing language. Respond with only the abstract text, no preamble, no markdown headers."

const COMPLETE_SYSTEM =
  'You help complete a Design Guide document for a website build. You are given the fields already filled in ("context") and a list of missing field keys ("missingKeys"). Propose plausible, internally consistent suggested values for ONLY the keys in missingKeys — derive them from the context (match the stated brand feel, existing colors, typography, tone) using good design-system judgment. Return ONLY strict JSON mapping each missing key to a suggested string value, with no extra keys and no prose outside the JSON. Keep each value concise (under 20 words, except antiPatterns/toneAvoid/brandValues/homepageSections which can be a short list-style sentence). If context includes a "namedPalette" field describing colors by name rather than hex, and any color fields are in missingKeys, resolve each to a real, sensible hex value matching the named color as closely as possible — use your best judgment, staying true to the described mood. Color fields must always be valid hex strings in your output. If you have no reasonable basis for a specific key even given the context, omit that key rather than guessing wildly.'

const EXTRACT_SYSTEM =
  'You extract design-guide data points from uploaded brand material. Return ONLY strict JSON (no markdown fences, no prose) with any of these keys you find clear evidence for — omit keys you have no evidence for, never invent values: brandName, brandFeel, mission, brandValues, emotionalGoal, brandRefs, namedPalette, colorPrimary, colorSecondary, colorAccent, colorBg, colorSurface, colorBorder, colorTextMuted, colorHeading, colorBody, colorSuccess, colorWarning, colorError, fontHeading, fontBody, fontMono, typeFeel, typeScale, lineHeight, fontWeights, baseUnit, maxArticleWidth, maxContainerWidth, breakpoints, gridSystem, compButtons, compCards, compForms, compNav, compFooter, compLinks, photoStyle, photoSubjects, photoUse, photoAvoid, iconSet, imageTreatment, illustrationStyle, illustrationThemes, toneAdjectives, motionLevel, motionIdeas, toneAvoid, voiceTone, voiceAvoidWords, voicePreferredPhrases, homepageSections, heroHeadline, heroSubheadline, heroCTA, antiPatterns. If the source material gives named colors without hex codes, put that description in namedPalette as text — do NOT guess hex codes from this extraction step. Color values must be hex strings ONLY if the source gives an actual hex/RGB value directly. Keep text values concise (under 20 words each, except brandValues/homepageSections/voicePreferredPhrases which may be short lists).'

async function handleAbstract(req, res, body, apiKey) {
  const raw = String(body.raw || '').trim()
  if (!raw) {
    return json(res, 400, { error: 'raw is required' })
  }

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
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

  const textBlock = Array.isArray(message?.content)
    ? message.content.find((block) => block?.type === 'text')
    : null
  const abstract = String(textBlock?.text || '').trim()

  if (!abstract) {
    return json(res, 502, { error: 'No text content in Anthropic response' })
  }

  return json(res, 200, { abstract })
}

async function handleComplete(req, res, body, apiKey) {
  const context = body.context
  const missingKeys = body.missingKeys

  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return json(res, 400, { error: 'context must be an object' })
  }
  if (!Array.isArray(missingKeys) || missingKeys.length === 0) {
    return json(res, 400, { error: 'missingKeys must be a non-empty array' })
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: COMPLETE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify({ context, missingKeys }) }],
        },
      ],
    }),
  })

  const anthropicData = await anthropicRes.json().catch(() => null)

  if (!anthropicRes.ok) {
    const message =
      anthropicData?.error?.message ||
      anthropicData?.error ||
      `Anthropic API error (${anthropicRes.status})`
    console.error('design-guide complete Anthropic error:', message)
    return json(res, 502, { error: String(message) })
  }

  const textBlock = Array.isArray(anthropicData?.content)
    ? anthropicData.content.find((block) => block?.type === 'text')
    : null

  if (!textBlock?.text) {
    return json(res, 502, { error: 'No text content in Anthropic response' })
  }

  let parsed
  try {
    parsed = parseModelJson(textBlock.text)
  } catch (parseErr) {
    console.error('design-guide complete JSON parse failed:', parseErr)
    return json(res, 502, { error: 'Failed to parse model JSON response' })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json(res, 502, { error: 'Model response was not a JSON object' })
  }

  return json(res, 200, parsed)
}

async function handleExtract(req, res, body, apiKey) {
  const fileType = body.fileType
  const content = body.content

  if (fileType !== 'pdf' && fileType !== 'text') {
    return json(res, 400, { error: 'fileType must be "pdf" or "text"' })
  }
  if (typeof content !== 'string' || !content.trim()) {
    return json(res, 400, { error: 'content is required' })
  }

  let messageContent
  if (fileType === 'pdf') {
    messageContent = [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: content,
        },
      },
      {
        type: 'text',
        text: 'Extract design-guide data points from this document.',
      },
    ]
  } else {
    const text = content.length > 12000 ? content.slice(0, 12000) : content
    messageContent = [{ type: 'text', text }]
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: messageContent }],
    }),
  })

  const anthropicData = await anthropicRes.json().catch(() => null)

  if (!anthropicRes.ok) {
    const message =
      anthropicData?.error?.message ||
      anthropicData?.error ||
      `Anthropic API error (${anthropicRes.status})`
    console.error('design-guide extract Anthropic error:', message)
    return json(res, 502, { error: String(message) })
  }

  const textBlock = Array.isArray(anthropicData?.content)
    ? anthropicData.content.find((block) => block?.type === 'text')
    : null

  if (!textBlock?.text) {
    return json(res, 502, { error: 'No text content in Anthropic response' })
  }

  let parsed
  try {
    parsed = parseModelJson(textBlock.text)
  } catch (parseErr) {
    console.error('design-guide extract JSON parse failed:', parseErr)
    return json(res, 502, { error: 'Failed to parse model JSON response' })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json(res, 502, { error: 'Model response was not a JSON object' })
  }

  return json(res, 200, parsed)
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

    const body = parseBody(req)
    const action = resolveAction(req, body)

    if (action === 'abstract') {
      return await handleAbstract(req, res, body, apiKey)
    }
    if (action === 'complete') {
      return await handleComplete(req, res, body, apiKey)
    }
    if (action === 'extract') {
      return await handleExtract(req, res, body, apiKey)
    }

    return json(res, 400, {
      error: 'action is required (abstract | complete | extract)',
    })
  } catch (err) {
    console.error('design-guide error:', err)
    const message =
      err?.error?.message || err?.message || 'Unexpected server error'
    return json(res, 500, { error: String(message) })
  }
}
