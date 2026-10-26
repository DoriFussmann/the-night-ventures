import Anthropic from '@anthropic-ai/sdk'
import { GENERATE_ARTICLE_MODEL } from '../generate-article/prompt.js'
import { handleOptions, json, parseBody, requireAuth } from '../seo-advisor/auth.js'
import {
  MAX_BLOCKS,
  MAX_IMAGES,
  buildAnalyzePrompt,
  checkKeyword,
  fetchSitePages,
  normalizeBrief,
  normalizeBriefBlocks,
  normalizeExistingArticles,
  normalizeImages,
  normalizeKeywordMap,
  parseAnalysisJson,
  rankOptions,
  sanitizeOptions,
  sitePageUrls,
} from './analyze.js'
import { writerImageNumbers } from './markdown.js'

const MAX_TOKENS = 4000
const MAX_IMAGE_B64 = 700 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function readImages(value, knownNumbers) {
  const known = new Set(knownNumbers)
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      n: Number(item?.n),
      mediaType: String(item?.mediaType || 'image/jpeg').toLowerCase(),
      data: String(item?.data || '').replace(/^data:[^,]+,/, '').replace(/\s+/g, ''),
    }))
    .filter(
      (item) =>
        known.has(item.n) &&
        IMAGE_TYPES.has(item.mediaType) &&
        item.data &&
        item.data.length <= MAX_IMAGE_B64
    )
    .slice(0, MAX_IMAGES)
}

function messageContent(prompt, images) {
  const content = [{ type: 'text', text: prompt }]
  for (const image of images) {
    content.push({ type: 'text', text: `Image #${image.n}:` })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data },
    })
  }
  return content
}

function extractText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => block.text)
    .join('')
}

/**
 * POST /api/analyze-writer-article
 * body: { domain, commercialUrl, positioning, blocks: string[], images: [{ n, mediaType, data }],
 *         keywordMap: [{ keyword, supporting: string[] }], existing: [{ slug, title, targetKeyword, … }] }
 */
export async function handleAnalyzeWriterArticle(req, res, deps = {}) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  try {
    await (deps.requireAuth || requireAuth)(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }

  const body = parseBody(req)
  const blocks = (Array.isArray(body.blocks) ? body.blocks : [])
    .map((block) => String(block || ''))
    .slice(0, MAX_BLOCKS)
  if (blocks.length === 0) return json(res, 400, { error: 'blocks are required' })

  const keywordMap = normalizeKeywordMap(body.keywordMap)
  if (keywordMap.every((pillar) => pillar.supporting.length === 0)) {
    return json(res, 400, {
      error: 'No supporting keywords in Company Intelligence yet. Add pillars and supporting keywords first.',
    })
  }

  const domain = String(body.domain || '').trim()
  const existing = normalizeExistingArticles(body.existing)
  const imageNumbers = writerImageNumbers(blocks.join('\n\n'))
  const images = readImages(body.images, imageNumbers)
  const fetchImpl = deps.fetch || fetch

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey && !deps.callModel) {
    console.error('Missing ANTHROPIC_API_KEY')
    return json(res, 500, { error: 'Server configuration error' })
  }

  try {
    const sitePages = domain
      ? await fetchSitePages(
          sitePageUrls(blocks.join('\n'), domain, [body.commercialUrl].filter(Boolean)),
          fetchImpl
        )
      : []

    const prompt = buildAnalyzePrompt({
      domain,
      blocks,
      keywordMap,
      existing,
      sitePages,
      positioning: String(body.positioning || '').slice(0, 2000),
      imageNumbers,
    })
    const callModel =
      deps.callModel ||
      (async (content) => {
        const anthropic = new Anthropic({ apiKey })
        const message = await anthropic.messages.create({
          model: GENERATE_ARTICLE_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content }],
        })
        return extractText(message.content)
      })
    const parsed = parseAnalysisJson(await callModel(messageContent(prompt, images)))
    if (!parsed) return json(res, 502, { error: 'Could not read the analysis. Try again.' })

    const brief = normalizeBrief(parsed.brief)
    const checkOpts = { existing, sitePages, domain, fetchImpl }
    const options = rankOptions(
      await Promise.all(
        sanitizeOptions(parsed.keywordOptions, keywordMap).map((option) => checkKeyword(option, checkOpts))
      )
    )
    const writerKeyword = brief.keyword
      ? {
          ...(await checkKeyword(
            { targetKeyword: brief.keyword, pillarKeyword: '', supportingKeyword: '', articleType: '' },
            checkOpts
          )),
          verdict: String(parsed?.writerKeyword?.verdict || '').trim(),
          inMap: keywordMap.some((pillar) =>
            [pillar.keyword, ...pillar.supporting].some((k) => k.toLowerCase() === brief.keyword)
          ),
        }
      : null

    return json(res, 200, {
      briefBlocks: normalizeBriefBlocks(parsed.briefBlocks, blocks),
      brief,
      images: normalizeImages(parsed.images, imageNumbers),
      options,
      writerKeyword,
      sitePages,
    })
  } catch (err) {
    console.error('analyze-writer-article failed:', err)
    return json(res, 502, { error: err?.message || 'Analysis failed' })
  }
}
