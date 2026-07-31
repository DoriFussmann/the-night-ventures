function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const SYSTEM_PROMPT =
  'You extract design-guide data points from uploaded brand material. Return ONLY strict JSON (no markdown fences, no prose) with any of these keys you find clear evidence for — omit keys you have no evidence for, never invent values: brandName, brandFeel, mission, brandValues, emotionalGoal, brandRefs, namedPalette, colorPrimary, colorSecondary, colorAccent, colorBg, colorSurface, colorBorder, colorTextMuted, colorHeading, colorBody, colorSuccess, colorWarning, colorError, fontHeading, fontBody, fontMono, typeFeel, typeScale, lineHeight, fontWeights, baseUnit, maxArticleWidth, maxContainerWidth, breakpoints, gridSystem, compButtons, compCards, compForms, compNav, compFooter, compLinks, photoStyle, photoSubjects, photoUse, photoAvoid, iconSet, imageTreatment, illustrationStyle, illustrationThemes, toneAdjectives, motionLevel, motionIdeas, toneAvoid, voiceTone, voiceAvoidWords, voicePreferredPhrases, homepageSections, heroHeadline, heroSubheadline, heroCTA, antiPatterns. If the source material gives named colors without hex codes, put that description in namedPalette as text — do NOT guess hex codes from this extraction step. Color values must be hex strings ONLY if the source gives an actual hex/RGB value directly. Keep text values concise (under 20 words each, except brandValues/homepageSections/voicePreferredPhrases which may be short lists).'

function parseModelJson(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return JSON.parse(cleaned)
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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: messageContent }],
      }),
    })

    const anthropicData = await anthropicRes.json().catch(() => null)

    if (!anthropicRes.ok) {
      const message =
        anthropicData?.error?.message ||
        anthropicData?.error ||
        `Anthropic API error (${anthropicRes.status})`
      console.error('design-guide-extract Anthropic error:', message)
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
      console.error('design-guide-extract JSON parse failed:', parseErr)
      return json(res, 502, { error: 'Failed to parse model JSON response' })
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json(res, 502, { error: 'Model response was not a JSON object' })
    }

    return json(res, 200, parsed)
  } catch (err) {
    console.error('design-guide-extract error:', err)
    return json(res, 500, { error: 'Unexpected server error' })
  }
}
