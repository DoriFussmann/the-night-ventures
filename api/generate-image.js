export const config = {
  maxDuration: 60,
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MODEL = 'gpt-image-2'
const ALLOWED_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536'])

function assemblePrompt(prompt, styleContext) {
  const style = String(styleContext || '').trim()
  if (!style) return prompt
  return `${prompt}\n\nStyle and brand direction (follow closely, do not deviate): ${style}`
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
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.error('Missing OPENAI_API_KEY')
      return json(res, 500, { error: 'Server configuration error' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const prompt = String(body.prompt || '').trim()
    const size = String(body.size || '').trim()
    const styleContext = String(body.styleContext || '').trim()

    if (!prompt) {
      return json(res, 400, { error: 'prompt is required' })
    }
    if (!ALLOWED_SIZES.has(size)) {
      return json(res, 400, {
        error: 'size must be one of 1024x1024, 1536x1024, 1024x1536',
      })
    }

    const assembledPrompt = assemblePrompt(prompt, styleContext)

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: assembledPrompt,
        size,
        n: 1,
      }),
    })

    const openaiData = await openaiRes.json().catch(() => ({}))

    if (!openaiRes.ok) {
      const message =
        openaiData?.error?.message ||
        openaiData?.error ||
        `OpenAI image generation failed (${openaiRes.status})`
      console.error('generate-image OpenAI error:', message)
      return json(res, 502, { error: String(message) })
    }

    const image = Array.isArray(openaiData?.data) ? openaiData.data[0] : null
    const b64_json = image?.b64_json ? String(image.b64_json) : null
    const url = image?.url ? String(image.url) : null

    if (!b64_json && !url) {
      return json(res, 502, { error: 'No image data in OpenAI response' })
    }

    return json(res, 200, { b64_json, url })
  } catch (err) {
    console.error('generate-image error:', err)
    const message = err?.message || 'Failed to generate image'
    return json(res, 502, { error: String(message) })
  }
}
