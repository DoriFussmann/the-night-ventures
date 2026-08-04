import Anthropic from '@anthropic-ai/sdk'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 800

const SYSTEM_PROMPT =
  "Read this project's full Design Guide document. Produce a concise Design Guide Abstract (2-4 paragraphs) that captures: the brand's core visual identity (color palette — name actual hex/color values if present in the source, typography choices, and overall aesthetic/tone in a few descriptive words), and any distinctive visual patterns or motifs worth reusing in derivative brand assets (e.g. graphics, cards, social images). Write it for reuse as context in future AI generation tasks — specific and concrete (real color values, real font names), not vague marketing language. Respond with only the abstract text, no preamble, no markdown headers."

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
    const raw = String(body.raw || '').trim()

    if (!raw) {
      return json(res, 400, { error: 'raw is required' })
    }

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Design Guide document:\n\n${raw}`,
        },
      ],
    })

    if (message?.stop_reason === 'max_tokens') {
      console.error('design-guide-abstract truncated at max_tokens')
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
  } catch (err) {
    console.error('design-guide-abstract error:', err)
    const message =
      err?.error?.message || err?.message || 'Failed to generate design guide abstract'
    return json(res, 502, { error: String(message) })
  }
}
