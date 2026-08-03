import Anthropic from '@anthropic-ai/sdk'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS_CLUSTER = 6000
const MAX_TOKENS_PILLAR = 3000

const TASK_INSTRUCTION = `Plan an SEO article cluster for the supporting keyword above, under the given pillar. Propose 3 to 6 articles — only as many as genuinely distinct search intents exist; state in clusterRationale why this count. Exactly one article must be type 'comprehensive'.

TYPE DEFINITIONS — assign the type that matches the article's actual structure: comprehensive = the definitive hub guide for this supporting keyword; howto = sequential process the reader executes; comparison = weighs two or more options/approaches against each other (X vs Y counts even if phrased as a question); faq = answers a set of related questions; flex = any other format (listicle, checklist, case study, cost breakdown) — name the format in the angle.

HARD CONSTRAINTS, in priority order:
(0) ANCHOR: The comprehensive article's targetKeyword MUST be exactly the current supporting keyword — no substitute, no variant. It is the hub that ranks for this territory; all sibling articles link to it.
(a) TERRITORY: Never set targetKeyword to any reserved keyword, or to a close variant or same-intent phrasing of one. If provided keyword data contains rows belonging to another territory (e.g. the pillar's own query family), EXCLUDE those rows entirely — high volume is not a reason to poach. Every targetKeyword must plausibly belong to the current supporting keyword's search-intent territory.
(b) COHERENCE: The targetKeyword must be a query that the article, as described by its title and keyMessages, directly and fully answers. If no provided keyword fits an article you want to write, use a realistic long-tail query in this territory and mark it '(no volume data)' — never attach a mismatched keyword just because it has volume. Prefer real rows from the provided keyword data over invented phrasings whenever a real row matches the article's intent; any invented targetKeyword must carry the literal suffix ' (no volume data)'.
(c) NO INTERNAL OVERLAP: No two proposed articles may share a search intent, and none may overlap with any existing planned/published article in the content map.
For each article provide: title (SEO title, targetKeyword phrasing near front), targetKeyword, type, searchIntent (one line), keyMessages (3-5 bullet strings), wordCount (2000 comprehensive, 1500 otherwise), internalLinks (sibling titles; every non-comprehensive links to the comprehensive; all reference the pillar), ctaAngle (one line bridging naturally to an expert-managed investor outreach service, without being an ad). Audience: startup founders raising capital.
In clusterRationale, briefly confirm the territory check: name which reserved territories appeared in the keyword data and were excluded.
Respond ONLY with valid JSON, no markdown fences: { "clusterRationale": "", "articles": [ { "title", "targetKeyword", "type", "searchIntent", "keyMessages": [], "wordCount", "internalLinks": [], "ctaAngle" } ] }`

const PILLAR_TASK_INSTRUCTION = `Plan the single comprehensive pillar article for the pillar keyword above. This is the hub page for its entire topic — the definitive, most complete resource a founder could find on this subject, that all of this pillar's supporting-keyword cluster articles will link into. It is NOT one of the supporting articles; do not narrow its scope to a single sub-intent.

Produce exactly one article with: title (SEO title, pillar keyword phrasing near front), targetKeyword (should be the pillar keyword itself, or its highest-volume close variant if keyword data shows one — never a narrower sub-topic), type ('comprehensive'), searchIntent (one line, describing the full topic this page must own), keyMessages (6-10 bullet strings — more than a supporting article, since this page must comprehensively cover the topic end to end), wordCount (2500-3000), internalLinks (leave as a placeholder note: 'links to all supporting cluster articles once they exist'), ctaAngle (one line — how this hub naturally bridges to an expert-managed investor outreach service).

If keyword data is provided, ground targetKeyword and any secondary phrasing coverage in real rows. If competitors are provided, you may search to check how they cover this topic and note gaps in pillarRationale.

Respond ONLY with valid JSON, no markdown fences:
{ "pillarRationale": "", "article": { "title", "targetKeyword", "type": "comprehensive", "searchIntent", "keyMessages": [], "wordCount", "internalLinks", "ctaAngle" } }`

const KEYWORD_DATA_INSTRUCTION =
  'When keyword data is provided, every article\'s targetKeyword MUST be selected from or directly grounded in these real queries — do not invent keyword phrasings. Use volume and difficulty to prioritize which intents deserve articles. Absorb near-duplicate variants into one article rather than splitting them.'

const WEB_SEARCH_INSTRUCTION =
  'Before finalizing, you may search to check what currently ranks for the main target queries; let the dominant content formats in real results inform each article\'s type and angle. Where relevant, check how the KNOWN COMPETITORS cover this supporting keyword and note gaps we can exploit — but never treat any other site as our competitor. Note SERP- or competitor-driven decisions in clusterRationale.'

const ALLOWED_TYPES = new Set(['comprehensive', 'howto', 'comparison', 'faq', 'flex'])

function stripMarkdownFences(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  // Also strip fences that appear mid-string (common after tool-use narration).
  cleaned = cleaned.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  return cleaned
}

function extractBalancedJsonObjects(text) {
  const source = String(text || '')
  const objects = []

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{') continue

    let depth = 0
    let inString = false
    let escaped = false

    for (let j = i; j < source.length; j++) {
      const ch = source[j]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (ch === '\\') {
          escaped = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }

      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') depth += 1
      if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          objects.push(source.slice(i, j + 1))
          i = j
          break
        }
      }
    }
  }

  return objects
}

function looksLikeProposal(value, mode = 'cluster') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (mode === 'pillar') {
    return (
      typeof value.pillarRationale === 'string' ||
      (value.article && typeof value.article === 'object')
    )
  }
  return Array.isArray(value.articles) || typeof value.clusterRationale === 'string'
}

function parseModelJson(text, mode = 'cluster') {
  const cleaned = stripMarkdownFences(text)

  try {
    const direct = JSON.parse(cleaned)
    if (looksLikeProposal(direct, mode)) return direct
  } catch {
    // Fall through to object extraction.
  }

  const objects = extractBalancedJsonObjects(cleaned)
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(objects[i])
      if (looksLikeProposal(parsed, mode)) return parsed
    } catch {
      // Try earlier candidates.
    }
  }

  throw new Error('No valid proposal JSON found in model response')
}

function extractTextBlocks(content) {
  if (!Array.isArray(content)) return []
  return content
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => String(block.text))
}

function extractTextContent(content) {
  return extractTextBlocks(content).join('\n').trim()
}

function parseProposalFromContent(content, mode = 'cluster') {
  const texts = extractTextBlocks(content)
  if (!texts.length) {
    throw new Error('No text content in Anthropic response')
  }

  // Prefer the final text block (usual place for the JSON after tool use),
  // then fall back to the full joined narration + JSON payload.
  const candidates = [texts[texts.length - 1], texts.join('\n')]
  let lastError = null

  for (const candidate of candidates) {
    try {
      return parseModelJson(candidate, mode)
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('Failed to parse model response as JSON')
}

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function normalizeCompetitors(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || '').trim(),
      url: String(item.url || '').trim(),
    }))
    .filter((item) => item.name || item.url)
}

function normalizeInternalLinks(value) {
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }
  return asStringArray(value)
}

function normalizeArticleFields(item, { defaultWordCount, forceType } = {}) {
  const type = forceType || (ALLOWED_TYPES.has(item.type) ? item.type : 'flex')
  const wordCountRaw = Number(item.wordCount)
  const wordCount = Number.isFinite(wordCountRaw)
    ? wordCountRaw
    : defaultWordCount ?? (type === 'comprehensive' ? 2000 : 1500)

  return {
    title: String(item.title || '').trim(),
    targetKeyword: String(item.targetKeyword || '').trim(),
    type,
    searchIntent: String(item.searchIntent || '').trim(),
    keyMessages: asStringArray(item.keyMessages),
    wordCount,
    internalLinks: normalizeInternalLinks(item.internalLinks),
    ctaAngle: String(item.ctaAngle || '').trim(),
  }
}

function normalizeProposal(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid proposal shape')
  }

  const articlesRaw = Array.isArray(parsed.articles) ? parsed.articles : []
  const articles = articlesRaw
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeArticleFields(item))
    .filter((item) => item.title && item.targetKeyword)

  if (!articles.length) {
    throw new Error('Proposal contained no usable articles')
  }

  return {
    clusterRationale: String(parsed.clusterRationale || '').trim(),
    articles,
  }
}

function normalizePillarProposal(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid proposal shape')
  }

  const articleRaw =
    parsed.article && typeof parsed.article === 'object' ? parsed.article : null
  if (!articleRaw) {
    throw new Error('Proposal contained no usable pillar article')
  }

  const article = normalizeArticleFields(articleRaw, {
    defaultWordCount: 2750,
    forceType: 'comprehensive',
  })

  if (!article.title || !article.targetKeyword) {
    throw new Error('Proposal contained no usable pillar article')
  }

  return {
    pillarRationale: String(parsed.pillarRationale || '').trim(),
    article,
  }
}

function buildReservedKeywordSection(contentMap, supportingKeyword) {
  const lines = [
    'RESERVED KEYWORD TERRITORIES — every keyword below is claimed by another part of the site architecture, whether or not its articles exist yet:',
  ]

  const pillars = Array.isArray(contentMap) ? contentMap : []
  for (const pillar of pillars) {
    const pillarKw = String(pillar?.keyword || '').trim()
    if (pillarKw) {
      lines.push(`[pillar] ${pillarKw}`)
    }
    const supporting = Array.isArray(pillar?.supporting) ? pillar.supporting : []
    for (const sup of supporting) {
      const supportingKw = String(sup?.keyword || '').trim()
      if (!supportingKw) continue
      lines.push(`[supporting] ${supportingKw} (under ${pillarKw || '(unknown pillar)'})`)
    }
  }

  lines.push(
    `The ONLY territory available to you is the current supporting keyword: ${supportingKeyword}.`
  )
  return lines.join('\n')
}

function buildUserPrompt({
  mode,
  pillarKeyword,
  supportingKeyword,
  abstract,
  shortDescription,
  contentMap,
  competitors,
  keywordData,
  steeringNotes,
  previousProposal,
}) {
  const parts = [
    'Company positioning:',
    `Abstract: ${abstract || '(not set)'}`,
    `Short Description: ${shortDescription || '(not set)'}`,
    '',
    `Pillar keyword: ${pillarKeyword}`,
  ]

  if (mode === 'cluster') {
    parts.push(`Supporting keyword: ${supportingKeyword}`)
  }

  parts.push(
    '',
    'Full content map (all pillars, supporting keywords, and planned/published articles):',
    JSON.stringify(contentMap, null, 2)
  )

  if (mode === 'cluster') {
    parts.push('', buildReservedKeywordSection(contentMap, supportingKeyword))
  }

  if (competitors.length > 0) {
    parts.push(
      '',
      'KNOWN COMPETITORS (use ONLY these as the competitor set — do not research, invent, or add other competitors):'
    )
    for (const competitor of competitors) {
      const label = competitor.name || '(unnamed)'
      const url = competitor.url || '(no url)'
      parts.push(`- ${label}: ${url}`)
    }
  }

  if (keywordData) {
    parts.push(
      '',
      'REAL KEYWORD DATA (from Semrush — volumes and difficulty):',
      keywordData
    )
  }

  if (mode === 'pillar') {
    parts.push('', PILLAR_TASK_INSTRUCTION)
  } else {
    const taskParts = [TASK_INSTRUCTION]
    if (keywordData) {
      taskParts.push(KEYWORD_DATA_INSTRUCTION)
    }
    taskParts.push(WEB_SEARCH_INSTRUCTION)
    parts.push('', taskParts.join(' '))
  }

  if (steeringNotes) {
    parts.push('', 'Steering notes from the editor (apply these):', steeringNotes)
  }

  if (previousProposal) {
    parts.push(
      '',
      'Previous proposal (rejected — do not repeat overlapping intents; improve based on steering notes):',
      JSON.stringify(previousProposal, null, 2)
    )
  }

  return parts.join('\n')
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
    const mode = body.mode === 'pillar' ? 'pillar' : 'cluster'
    const pillarKeyword = String(body.pillarKeyword || '').trim()
    const supportingKeyword = String(body.supportingKeyword || '').trim()
    const abstract = String(body.abstract || '').trim()
    const shortDescription = String(body.shortDescription || '').trim()
    const contentMap = body.contentMap
    const competitors = normalizeCompetitors(body.competitors)
    const keywordData = String(body.keywordData || '').trim()
    const steeringNotes = String(body.steeringNotes || '').trim()
    const previousProposal =
      body.previousProposal && typeof body.previousProposal === 'object'
        ? body.previousProposal
        : null

    if (!pillarKeyword) {
      return json(res, 400, { error: 'pillarKeyword is required' })
    }
    if (mode === 'cluster' && !supportingKeyword) {
      return json(res, 400, { error: 'supportingKeyword is required' })
    }
    if (contentMap == null) {
      return json(res, 400, { error: 'contentMap is required' })
    }

    const anthropic = new Anthropic({ apiKey })
    const prompt = buildUserPrompt({
      mode,
      pillarKeyword,
      supportingKeyword,
      abstract,
      shortDescription,
      contentMap,
      competitors,
      keywordData,
      steeringNotes,
      previousProposal,
    })

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: mode === 'pillar' ? MAX_TOKENS_PILLAR : MAX_TOKENS_CLUSTER,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    })

    if (message?.stop_reason === 'max_tokens') {
      console.error('plan-cluster truncated at max_tokens')
      return json(res, 502, {
        error:
          'Model response was truncated before finishing JSON. Try again, or shorten keyword data.',
      })
    }

    let parsed
    try {
      parsed = parseProposalFromContent(message?.content, mode)
    } catch (err) {
      const preview = extractTextContent(message?.content).slice(0, 500)
      console.error('plan-cluster JSON parse failed:', err, preview)
      return json(res, 502, { error: 'Failed to parse model response as JSON' })
    }

    let proposal
    try {
      proposal =
        mode === 'pillar' ? normalizePillarProposal(parsed) : normalizeProposal(parsed)
    } catch (err) {
      console.error('plan-cluster normalize failed:', err)
      return json(res, 502, { error: err.message || 'Invalid proposal from model' })
    }

    return json(res, 200, proposal)
  } catch (err) {
    console.error('plan-cluster error:', err)
    const message =
      err?.error?.message || err?.message || 'Failed to plan cluster'
    return json(res, 502, { error: String(message) })
  }
}
