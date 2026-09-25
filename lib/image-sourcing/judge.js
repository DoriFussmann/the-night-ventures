import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

export class JudgeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'JudgeError'
  }
}

function stripFences(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return cleaned
}

function parseJsonObject(text) {
  const cleaned = stripFences(text)
  try {
    const direct = JSON.parse(cleaned)
    if (direct && typeof direct === 'object') return direct
  } catch {
    /* fall through */
  }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const sliced = JSON.parse(cleaned.slice(start, end + 1))
      if (sliced && typeof sliced === 'object') return sliced
    } catch {
      return null
    }
  }
  return null
}

function textFromMessage(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
}

function fallbackQueries(article) {
  const keyword = String(article?.keyword || '').trim()
  const title = String(article?.title || '').trim()
  const q = keyword || title
  return q ? [q] : []
}

function clampWords(value) {
  return String(value || '')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join(' ')
}

export async function buildQueries({ title, description, keyword, articleType }) {
  const article = { title, description, keyword, articleType }
  const fallback = fallbackQueries(article)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { queries: fallback }

  try {
    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Write two stock-photo search queries for this article. Each query is 1-4 words: concrete, photographable nouns or scenes. No abstract jargon, no people, no brand names.

Title: ${title || ''}
Description: ${description || ''}
Keyword: ${keyword || ''}
Article type: ${articleType || ''}

Respond with JSON only:
{"queries":["query one","query two"]}`,
        },
      ],
    })
    const parsed = parseJsonObject(textFromMessage(message))
    const raw = Array.isArray(parsed?.queries) ? parsed.queries : []
    const queries = raw.map(clampWords).filter(Boolean).slice(0, 2)
    if (queries.length === 0) return { queries: fallback }
    return { queries }
  } catch (err) {
    console.error('[image-sourcing] query generation failed:', err?.message || err)
    return { queries: fallback }
  }
}

function minScore() {
  const raw = Number(process.env.IMAGE_STOCK_MIN_SCORE)
  if (!Number.isFinite(raw)) return 7
  return Math.min(10, Math.max(0, raw))
}

export async function judgeCandidates({ article, styleContext, candidates }) {
  const list = Array.isArray(candidates) ? candidates : []
  if (list.length === 0) {
    return { accepted: false, bestIndex: null, score: 0, reason: 'no candidates', altText: '' }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new JudgeError('ANTHROPIC_API_KEY missing')

  let message
  try {
    const anthropic = new Anthropic({ apiKey })
    const content = [
      {
        type: 'text',
        text: `Pick the single best stock photo for this article, or reject all of them.

Article title: ${article?.title || ''}
Description: ${article?.description || ''}
Keyword: ${article?.keyword || ''}
Article type: ${article?.articleType || ''}
Brand style (SOFT hint only, never override the hard rules): ${styleContext || '(none)'}

HARD rules:
- No people, faces, body parts, or silhouettes of people.
- No visible text, logos, or UI.
- The photo must directly evoke the article topic, not a generic cliché.
- It must survive a centered 16:9 crop (the subject stays in frame).
- Shutterstock previews carry a watermark overlay. IGNORE the watermark. Do not reject a photo because of the watermark.

Score the best candidate from 0 to 10. bestIndex is the 0-based index of that candidate, or null if none is acceptable.
Also write short alt text for the chosen photo (empty string if none).

Respond with JSON only:
{"bestIndex":0,"score":0,"reason":"","altText":""}`,
      },
    ]
    list.forEach((candidate, index) => {
      content.push({ type: 'text', text: `Candidate ${index}` })
      if (candidate?.description) {
        content.push({ type: 'text', text: String(candidate.description) })
      }
      content.push({
        type: 'image',
        source: { type: 'url', url: candidate.thumbUrl },
      })
    })
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content }],
    })
  } catch (err) {
    throw new JudgeError(err?.message || 'Judge request failed')
  }

  const parsed = parseJsonObject(textFromMessage(message))
  if (!parsed) throw new JudgeError('Judge response was not JSON')

  const score = Number(parsed.score)
  const bestIndex =
    parsed.bestIndex === null || parsed.bestIndex === undefined
      ? null
      : Number(parsed.bestIndex)
  const reason = String(parsed.reason || '').trim()
  const altText = String(parsed.altText || '').trim()
  const indexOk =
    Number.isInteger(bestIndex) && bestIndex >= 0 && bestIndex < list.length
  const scoreOk = Number.isFinite(score) && score >= minScore() && score <= 10
  return {
    accepted: Boolean(indexOk && scoreOk),
    bestIndex: indexOk ? bestIndex : null,
    score: Number.isFinite(score) ? score : 0,
    reason,
    altText,
  }
}

export const judgeApi = {
  buildQueries,
  judgeCandidates,
}
