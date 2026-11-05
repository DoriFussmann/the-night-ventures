/**
 * AEO hero images: an art-director step. Claude writes one concrete scene for
 * the article (objects that show its subject), in the company's image style;
 * the image model then renders that scene.
 */
import Anthropic from '@anthropic-ai/sdk'
import { GENERATE_ARTICLE_MODEL } from '../generate-article/prompt.js'
import { handleOptions, json, parseBody, requireAuth } from '../seo-advisor/auth.js'

export const DEFAULT_IMAGE_STYLE = [
  'Photorealistic editorial still life, shot like a premium business magazine.',
  'A desk or work surface: warm natural window light, soft shadows, shallow depth of field, rich materials (dark wood, stone, paper, brass, ceramic).',
  'Objects that show the subject: open notebooks with hand-drawn sketches (funnels, timelines, pipelines, simple charts), printed one-page documents, cards, a pen, a coffee cup, a plant; sometimes a city skyline through the window.',
  'Calm, confident, uncluttered. One small cobalt-blue accent object at most.',
  'No people, hands or faces. No logos or brand names. Any writing is small, sketchy and not the focus; no headlines or big legible text.',
].join(' ')

const MAX_TOKENS = 700

export function buildScenePrompt({ title, description, angle, headings, imageStyle, note, avoid }) {
  return [
    'You are the art director for a blog hero image. Write the image prompt for ONE photograph.',
    '',
    `Article title: ${title}`,
    description ? `Summary: ${description}` : '',
    angle ? `Angle: ${angle}` : '',
    headings?.length ? `Sections: ${headings.join(' | ')}` : '',
    '',
    `House style (follow it): ${imageStyle || DEFAULT_IMAGE_STYLE}`,
    note ? `Direction from the editor for this image (takes priority): ${note}` : '',
    avoid?.length ? `Do not repeat these recent scenes: ${avoid.join(' | ')}` : '',
    '',
    'Rules:',
    '- Pick 3-5 specific physical objects that a reader would connect with THIS article, and arrange them in one believable scene. Say what any sketch or document on the desk depicts (e.g. "a notebook open to a hand-drawn funnel narrowing from many circles to a few").',
    '- Describe camera angle, light direction and time of day, materials and colour palette.',
    '- No abstract sculptures, floating cubes, empty rooms or generic office interiors.',
    '- Wide 3:2 landscape composition with the main subject slightly off-centre and clear space around it.',
    '',
    'Return only the image prompt, 90-140 words, no preamble.',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export async function handleHeroScene(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  try {
    await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }
  const body = parseBody(req)
  const title = String(body.title || '').trim()
  if (!title) return json(res, 400, { error: 'title is required' })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json(res, 500, { error: 'Server configuration error' })

  try {
    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: GENERATE_ARTICLE_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: buildScenePrompt({
            title,
            description: String(body.description || '').trim(),
            angle: String(body.angle || '').trim(),
            headings: Array.isArray(body.headings) ? body.headings.map(String).slice(0, 10) : [],
            imageStyle: String(body.imageStyle || '').trim(),
            note: String(body.note || '').trim(),
            avoid: Array.isArray(body.avoid) ? body.avoid.map(String).slice(0, 6) : [],
          }),
        },
      ],
    })
    const scene = (message.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!scene) throw new Error('No scene returned')
    return json(res, 200, { scene })
  } catch (err) {
    console.error('aeo-hero-scene failed:', err)
    return json(res, 502, { error: err?.message || 'Could not write the image scene' })
  }
}
