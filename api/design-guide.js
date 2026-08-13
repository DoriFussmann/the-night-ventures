import Anthropic from '@anthropic-ai/sdk'

export const config = {
  maxDuration: 120,
}

const MODEL = 'claude-sonnet-4-6'

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

function textFromMessage(message) {
  const textBlock = Array.isArray(message?.content)
    ? message.content.find((block) => block?.type === 'text')
    : null
  return String(textBlock?.text || '').trim()
}

const ABSTRACT_SYSTEM =
  "Read this project's full Design Guide document. Produce a concise Design Guide Abstract (2-4 paragraphs) that captures: the brand's core visual identity (color palette — name actual hex/color values if present in the source, typography choices, and overall aesthetic/tone in a few descriptive words), and any distinctive visual patterns or motifs worth reusing in derivative brand assets (e.g. graphics, cards, social images). Write it for reuse as context in future AI generation tasks — specific and concrete (real color values, real font names), not vague marketing language. Respond with only the abstract text, no preamble, no markdown headers."

const GENERATE_SYSTEM = `You write a complete Design Guide.md for a real company website.

Output ONLY the markdown document. No preamble, no wrapping fences.

This is a working brand/design-system document a developer will drop at the project root and apply. It must be specific to THIS company — use the real product name, domain, positioning, services, and audience from the context. Do not write a generic SaaS/agency template. Do not leave placeholders, TODOs, or "_(not set)_" rows. Do not dump a field-by-field form.

Write in clear markdown with these sections (use these headings, expand with real guidance under each):

# Design Guide

## Brand identity
Name, tagline if implied, intended feel in one sentence, mission, values, emotional goal for visitors, and a few reference brands/anti-references that actually fit this business.

## Color palette
A concrete, named palette with real hex values you reason from the brand feel and category — not empty tokens. Include primary, secondary, accent, background, surface, border, muted text, heading, body, success, warning, error. State whether dark mode is required (default: no, light mode only, unless the vibe says otherwise). State a minimum contrast target (WCAG AA unless the vibe asks for more). Briefly justify the palette in one short paragraph so a designer can tell it belongs to this brand.

## Typography
Specific font families (prefer widely available web fonts). Heading vs body (and mono if useful). Type feel, a practical type scale with px sizes, line-height, and which weights to use or avoid.

## Spacing & layout
Base unit, max article width, max container width, breakpoints, and grid/spacing rhythm. Editorial/content sites should feel readable, not dashboard-dense.

## Imagery & photography
What photos should look like, subjects, how they are used, what to avoid, icon direction, image treatment.

## Tone, voice & motion
Tone adjectives, voice do/don't, motion level and ideas. Match the company's actual writing posture.

## Explicit anti-patterns
A concrete list of things this brand must not do (generic startup purple, heavy bold, dark-mode-for-its-own-sake, stock-handshake photography, etc. — only if they actually clash with THIS brand).

If the user left color/typography/tone as "no preference", choose confidently from the company context. Prefer restraint and specificity over decoration.`

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

async function handleGenerate(req, res, body, apiKey) {
  const company = body.company
  const vibe = body.vibe && typeof body.vibe === 'object' ? body.vibe : {}

  if (!company || typeof company !== 'object' || Array.isArray(company)) {
    return json(res, 400, { error: 'company must be an object' })
  }

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: GENERATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              'Write the Design Guide.md for this company.',
              '',
              'Company data:',
              JSON.stringify(company, null, 2),
              '',
              'Brand vibe inputs (empty means no preference — choose for them):',
              JSON.stringify(
                {
                  brandFeel: String(vibe.brandFeel || '').trim(),
                  colorPreference: String(vibe.colorPreference || '').trim(),
                  typographyPreference: String(vibe.typographyPreference || '').trim(),
                  toneAdjectives: String(vibe.toneAdjectives || '').trim(),
                  antiPatterns: String(vibe.antiPatterns || '').trim(),
                },
                null,
                2
              ),
            ].join('\n'),
          },
        ],
      },
    ],
  })

  if (message?.stop_reason === 'max_tokens') {
    console.error('design-guide generate truncated at max_tokens')
    return json(res, 502, {
      error: 'Model response was truncated. Try generating again.',
    })
  }

  const markdown = unwrapMarkdown(textFromMessage(message))
  if (!markdown) {
    return json(res, 502, { error: 'No text content in Anthropic response' })
  }

  return json(res, 200, { markdown })
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
