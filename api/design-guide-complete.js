function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const SYSTEM_PROMPT =
  'You help complete a Design Guide document for a website build. You are given the fields already filled in ("context") and a list of missing field keys ("missingKeys"). Propose plausible, internally consistent suggested values for ONLY the keys in missingKeys — derive them from the context (match the stated brand feel, existing colors, typography, tone) using good design-system judgment. Return ONLY strict JSON mapping each missing key to a suggested string value, with no extra keys and no prose outside the JSON. Keep each value concise (under 20 words, except antiPatterns/toneAvoid/brandValues/homepageSections which can be a short list-style sentence). If context includes a "namedPalette" field describing colors by name rather than hex, and any color fields are in missingKeys, resolve each to a real, sensible hex value matching the named color as closely as possible — use your best judgment, staying true to the described mood. Color fields must always be valid hex strings in your output. If you have no reasonable basis for a specific key even given the context, omit that key rather than guessing wildly.'

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
    const context = body.context
    const missingKeys = body.missingKeys

    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      return json(res, 400, { error: 'context must be an object' })
    }
    if (!Array.isArray(missingKeys) || missingKeys.length === 0) {
      return json(res, 400, { error: 'missingKeys must be a non-empty array' })
    }

    const messageContent = [
      {
        type: 'text',
        text: JSON.stringify({ context, missingKeys }),
      },
    ]

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
      console.error('design-guide-complete Anthropic error:', message)
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
      console.error('design-guide-complete JSON parse failed:', parseErr)
      return json(res, 502, { error: 'Failed to parse model JSON response' })
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json(res, 502, { error: 'Model response was not a JSON object' })
    }

    return json(res, 200, parsed)
  } catch (err) {
    console.error('design-guide-complete error:', err)
    return json(res, 500, { error: 'Unexpected server error' })
  }
}
