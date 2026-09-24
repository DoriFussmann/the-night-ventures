import Anthropic from '@anthropic-ai/sdk'
import { pullKeywordData } from '../lib/pull-keyword-data/run.js'
import { serpResults } from '../lib/seo-advisor/providers/dataforseo.js'
import { slugify } from '../lib/slugify.js'
import { stripNoVolumeTag } from '../lib/stripNoVolumeTag.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS_CLUSTER = 6000
const MAX_TOKENS_PILLAR = 3000

const TYPE_ORDER = ['comprehensive', 'howto', 'comparison', 'faq', 'flex']
const ALLOWED_TYPES = new Set(TYPE_ORDER)

const PILLAR_TASK_INSTRUCTION = `Plan the single comprehensive pillar article for the pillar keyword above. This is the hub page for its entire topic — the definitive, most complete resource a founder could find on this subject, that all of this pillar's supporting-keyword cluster articles will link into. It is NOT one of the supporting articles; do not narrow its scope to a single sub-intent.

Produce exactly one article with: title (SEO title, pillar keyword phrasing near front), targetKeyword (should be the pillar keyword itself, or its highest-volume close variant if keyword data shows one — never a narrower sub-topic), type ('comprehensive'), searchIntent (one line, describing the full topic this page must own), keyMessages (6-10 bullet strings — more than a supporting article, since this page must comprehensively cover the topic end to end), wordCount (2500-3000), internalLinks (leave as a placeholder note: 'links to all supporting cluster articles once they exist'), ctaAngle (one line — how this hub naturally bridges to an expert-managed investor outreach service).

If keyword data is provided, ground targetKeyword and any secondary phrasing coverage in real rows. If competitors are provided, you may search to check how they cover this topic and note gaps in pillarRationale.

Respond ONLY with valid JSON, no markdown fences:
{ "pillarRationale": "", "article": { "title", "targetKeyword", "type": "comprehensive", "searchIntent", "keyMessages": [], "wordCount", "internalLinks", "ctaAngle" } }`

const KEYWORD_DATA_INSTRUCTION =
  'When keyword data is provided, every article\'s targetKeyword MUST be selected from or directly grounded in these real queries — do not invent keyword phrasings. Use volume and the third-column competition/difficulty metric to prioritize which intents deserve articles. If the header says "DFS Comp Index", that is DataForSEO paid competition (0–100), NOT Semrush KD — still use higher volume + lower competition as a relative priority signal. Absorb near-duplicate variants into one article rather than splitting them.'

const WEB_SEARCH_INSTRUCTION =
  'Before finalizing, you may search to check what currently ranks for the main target queries; let the dominant content formats in real results inform each article\'s type and angle. Where relevant, check how the KNOWN COMPETITORS cover this topic and note gaps we can exploit — but never treat any other site as our competitor. Note SERP- or competitor-driven decisions in clusterRationale.'

/**
 * Validate cluster articleTypeCounts from the request body.
 * @returns {Record<string, number>|null} normalized counts, or null if empty/invalid shape
 */
function normalizeArticleTypeCounts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const out = {}
  for (const type of TYPE_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(raw, type)) continue
    const n = Number(raw[type])
    if (!Number.isInteger(n) || n < 1) continue
    out[type] = n
  }
  return Object.keys(out).length > 0 ? out : null
}

function countArticlesByType(articles) {
  const counts = {}
  for (const article of Array.isArray(articles) ? articles : []) {
    const type = article?.type || 'flex'
    counts[type] = (counts[type] || 0) + 1
  }
  return counts
}

/**
 * Truncate excess types to requested counts; error if any requested type is short.
 */
function enforceArticleTypeCounts(proposal, articleTypeCounts) {
  const before = countArticlesByType(proposal.articles)
  console.log('plan-cluster type counts before enforce:', {
    before,
    requested: articleTypeCounts,
  })

  const buckets = Object.fromEntries(TYPE_ORDER.map((t) => [t, []]))
  for (const article of proposal.articles) {
    const type = ALLOWED_TYPES.has(article.type) ? article.type : 'flex'
    buckets[type].push(article)
  }

  const kept = []
  for (const type of TYPE_ORDER) {
    const requested = articleTypeCounts[type] || 0
    const got = buckets[type]
    if (requested === 0) continue
    if (got.length < requested) {
      throw new Error(
        `Proposal incomplete: requested ${requested} ${type} article${
          requested === 1 ? '' : 's'
        }, got ${got.length}`
      )
    }
    // Keep first N in model order; drop extras (and any unrequested types via requested===0).
    kept.push(...got.slice(0, requested))
  }

  const after = countArticlesByType(kept)
  console.log('plan-cluster type counts after enforce:', {
    after,
    requested: articleTypeCounts,
  })

  return {
    ...proposal,
    articles: kept,
  }
}

function assertUniqueTargetSlugs(proposal) {
  const seen = new Map()
  for (const article of proposal.articles) {
    const slug = slugify(article.targetKeyword)
    const first = seen.get(slug)
    if (first) {
      throw new Error(
        `Two topics share the target keyword "${article.targetKeyword}" ("${first.title}" and "${article.title}"). Regenerate topics.`
      )
    }
    seen.set(slug, article)
  }
  return proposal
}

function buildClusterTaskInstruction(articleTypeCounts) {
  const countsJson = JSON.stringify(articleTypeCounts)
  const hasComprehensive = (articleTypeCounts.comprehensive || 0) >= 1

  const constraints = []
  if (hasComprehensive) {
    constraints.push(
      "(0) ANCHOR: The comprehensive article's targetKeyword MUST be exactly the current supporting keyword — no substitute, no variant. It is the hub that ranks for this territory; all sibling articles link to it."
    )
  }
  constraints.push(
    '(a) TERRITORY: Never set targetKeyword to any reserved keyword, or to a close variant or same-intent phrasing of one. If provided keyword data contains rows belonging to another territory (e.g. the pillar\'s own query family), EXCLUDE those rows entirely — high volume is not a reason to poach. Every targetKeyword must plausibly belong to the current supporting keyword\'s search-intent territory.'
  )
  constraints.push(
    "(b) COHERENCE: The targetKeyword must be a query that the article, as described by its title and keyMessages, directly and fully answers. If no provided keyword fits an article you want to write, use a realistic long-tail query in this territory — never attach a mismatched keyword just because it has volume. Prefer real rows from the provided keyword data over invented phrasings whenever a real row matches the article's intent."
  )
  constraints.push(
    '(c) NO INTERNAL OVERLAP: No two proposed articles may share a search intent, and none may overlap with any existing planned/published article in the content map.'
  )

  const internalLinksGuidance = hasComprehensive
    ? 'sibling titles; every non-comprehensive links to the comprehensive; all reference the pillar'
    : 'sibling titles where relevant; all articles reference and link toward the pillar page'

  return [
    `Plan an SEO article cluster for the supporting keyword above, under the given pillar. Produce EXACTLY the following set of articles, no more, no fewer, no other types: ${countsJson}. For each requested type, produce that many distinct articles of that type, each covering a genuinely different search intent within the type — if the count requested for a type exceeds the number of genuinely distinct intents you can identify, still produce the requested count but note in clusterRationale which ones are the weakest/most stretched.`,
    '',
    "TYPE DEFINITIONS — assign the type that matches the article's actual structure: comprehensive = the definitive hub guide for this supporting keyword; howto = sequential process the reader executes; comparison = weighs two or more options/approaches against each other (X vs Y counts even if phrased as a question); faq = answers a set of related questions; flex = any other format (listicle, checklist, case study, cost breakdown) — name the format in the angle.",
    '',
    'HARD CONSTRAINTS, in priority order:',
    ...constraints,
    `For each article provide: title (SEO title, targetKeyword phrasing near front), targetKeyword, type, searchIntent (one line), keyMessages (3-5 bullet strings), wordCount (2000 comprehensive, 1500 otherwise), internalLinks (${internalLinksGuidance}), ctaAngle (one line bridging naturally to an expert-managed investor outreach service, without being an ad).`,
    'In clusterRationale, briefly confirm the territory check: name which reserved territories appeared in the keyword data and were excluded.',
    'Respond ONLY with valid JSON, no markdown fences: { "clusterRationale": "", "articles": [ { "title", "targetKeyword", "type", "searchIntent", "keyMessages": [], "wordCount", "internalLinks": [], "ctaAngle" } ] }',
  ].join('\n')
}

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

/** Strip protocol/www/path for host comparison. */
function normalizeHost(value) {
  let d = String(value || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  return d.replace(/\.$/, '')
}

function hostsMatch(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

function findMatchingCompetitor(itemDomain, competitors) {
  const host = normalizeHost(itemDomain)
  if (!host) return null
  for (const competitor of competitors) {
    const competitorHost = normalizeHost(competitor.url)
    if (competitorHost && hostsMatch(host, competitorHost)) {
      return competitor
    }
  }
  return null
}

/**
 * Cross-reference SERP items against known competitors.
 * @returns {{ matchedCompetitors: object[], otherRankingDomains: object[] }|null}
 */
function buildCompetitorSerpGrounding(items, competitors) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return null

  const matchedCompetitors = []
  const otherRankingDomains = []

  for (const item of list) {
    const domain = item.domain || normalizeHost(item.url)
    const competitor = findMatchingCompetitor(domain, competitors)
    if (competitor) {
      matchedCompetitors.push({
        name: competitor.name || '(unnamed)',
        rank: item.rank ?? null,
        title: item.title || '(no title)',
        url: item.url || '',
        domain: domain || '',
      })
    } else if (otherRankingDomains.length < 5) {
      otherRankingDomains.push({
        rank: item.rank ?? null,
        title: item.title || '(no title)',
        domain: domain || normalizeHost(item.url) || '(unknown)',
      })
    }
  }

  return { matchedCompetitors, otherRankingDomains }
}

function buildCompetitorSerpSection(grounding) {
  if (!grounding) return null

  const lines = [
    'COMPETITOR SERP CHECK (real ranking data for the target keyword, pulled just now):',
    'Known competitors currently ranking for this exact keyword:',
  ]

  if (!grounding.matchedCompetitors.length) {
    lines.push(
      'None of the known competitors currently rank for this keyword — this is a gap.'
    )
  } else {
    for (const match of grounding.matchedCompetitors) {
      lines.push(
        `- ${match.name} | rank ${match.rank ?? '?'} | ${match.title} | ${match.url}`
      )
    }
  }

  lines.push(
    '',
    'Other domains currently ranking (not in known competitor list, for context on SERP intent/format only — do not treat these as competitors):'
  )
  if (!grounding.otherRankingDomains.length) {
    lines.push('- (none in top results outside the known competitor set)')
  } else {
    for (const other of grounding.otherRankingDomains) {
      lines.push(
        `- rank ${other.rank ?? '?'} | ${other.title} | ${other.domain}`
      )
    }
  }

  lines.push(
    '',
    "Use this real ranking data, together with any further web_search you do, to inform each article's type and angle — prioritizing intents where known competitors are weak or absent, and matching the content format that is actually winning in these results."
  )

  return lines.join('\n')
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
    title: stripNoVolumeTag(item.title),
    targetKeyword: stripNoVolumeTag(item.targetKeyword),
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

/**
 * @param {unknown} contentMap
 * @param {string} currentKeyword - the territory being planned (excluded from reserved list)
 * @param {'supporting'|'pillar'} kind
 */
function buildReservedKeywordSection(contentMap, currentKeyword, kind = 'supporting') {
  const currentNorm = String(currentKeyword || '')
    .trim()
    .toLowerCase()
  const lines = [
    'RESERVED KEYWORD TERRITORIES — every keyword below is claimed by another part of the site architecture, whether or not its articles exist yet:',
  ]

  const pillars = Array.isArray(contentMap) ? contentMap : []
  for (const pillar of pillars) {
    const pillarKw = String(pillar?.keyword || '').trim()
    if (pillarKw && pillarKw.toLowerCase() !== currentNorm) {
      lines.push(`[pillar] ${pillarKw}`)
    }
    const supporting = Array.isArray(pillar?.supporting) ? pillar.supporting : []
    for (const sup of supporting) {
      const supportingKw = String(sup?.keyword || '').trim()
      if (!supportingKw) continue
      if (supportingKw.toLowerCase() === currentNorm) continue
      lines.push(`[supporting] ${supportingKw} (under ${pillarKw || '(unknown pillar)'})`)
    }
  }

  if (kind === 'pillar') {
    lines.push(
      `The ONLY territory available to you is the current pillar keyword: ${currentKeyword}.`
    )
  } else {
    lines.push(
      `The ONLY territory available to you is the current supporting keyword: ${currentKeyword}.`
    )
  }
  return lines.join('\n')
}

function audienceInstructionLine(audience) {
  if (audience) return `Audience: ${audience}.`
  return 'Audience: infer the likely audience from the company positioning above.'
}

function buildUserPrompt({
  mode,
  pillarKeyword,
  supportingKeyword,
  abstract,
  shortDescription,
  audience,
  contentMap,
  competitors,
  keywordData,
  competitorSerpGrounding,
  steeringNotes,
  previousProposal,
  articleTypeCounts,
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
    parts.push(
      '',
      buildReservedKeywordSection(contentMap, supportingKeyword, 'supporting')
    )
  } else {
    parts.push(
      '',
      buildReservedKeywordSection(contentMap, pillarKeyword, 'pillar')
    )
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

  const serpSection = buildCompetitorSerpSection(competitorSerpGrounding)
  if (serpSection) {
    parts.push('', serpSection)
  }

  if (keywordData) {
    parts.push(
      '',
      'REAL KEYWORD DATA (Keyword;Volume;competition-or-difficulty — may be Semrush KD or DataForSEO DFS Comp Index):',
      keywordData
    )
  }

  if (mode === 'pillar') {
    const taskParts = [PILLAR_TASK_INSTRUCTION]
    if (keywordData) {
      taskParts.push(KEYWORD_DATA_INSTRUCTION)
    }
    taskParts.push(WEB_SEARCH_INSTRUCTION)
    parts.push('', taskParts.join(' '))
  } else {
    const taskParts = [buildClusterTaskInstruction(articleTypeCounts)]
    if (keywordData) {
      taskParts.push(KEYWORD_DATA_INSTRUCTION)
    }
    taskParts.push(WEB_SEARCH_INSTRUCTION)
    parts.push('', taskParts.join(' '))
  }

  parts.push('', audienceInstructionLine(audience))

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
    const pillarKeyword = stripNoVolumeTag(body.pillarKeyword)
    const supportingKeyword = stripNoVolumeTag(body.supportingKeyword)
    const abstract = String(body.abstract || '').trim()
    const shortDescription = String(body.shortDescription || '').trim()
    const audience = String(body.audience || '').trim()
    const contentMap = body.contentMap
    const competitors = normalizeCompetitors(body.competitors)
    const steeringNotes = String(body.steeringNotes || '').trim()
    const previousProposal =
      body.previousProposal && typeof body.previousProposal === 'object'
        ? body.previousProposal
        : null
    const articleTypeCounts =
      mode === 'cluster' ? normalizeArticleTypeCounts(body.articleTypeCounts) : null

    if (!pillarKeyword) {
      return json(res, 400, { error: 'pillarKeyword is required' })
    }
    if (mode === 'cluster' && !supportingKeyword) {
      return json(res, 400, { error: 'supportingKeyword is required' })
    }
    if (
      mode === 'cluster' &&
      (!articleTypeCounts || Object.keys(articleTypeCounts).length === 0)
    ) {
      return json(res, 400, {
        error:
          'articleTypeCounts is required for cluster mode with at least one type',
      })
    }
    if (contentMap == null) {
      return json(res, 400, { error: 'contentMap is required' })
    }

    const targetKeyword =
      mode === 'cluster' ? supportingKeyword : pillarKeyword

    const [keywordData, competitorSerpGrounding] = await Promise.all([
      (async () => {
        try {
          const pulled = await pullKeywordData({
            keyword: targetKeyword,
            pillarKeyword,
            audienceFilter: audience,
            anthropicApiKey: apiKey,
          })
          const text = String(pulled?.text || '').trim()
          if (text) return text
          console.warn(
            'plan-cluster keyword pull returned no usable text; continuing without keyword data'
          )
          return ''
        } catch (err) {
          console.warn(
            'plan-cluster keyword pull failed; continuing without keyword data:',
            err?.message || err
          )
          return ''
        }
      })(),
      (async () => {
        if (competitors.length === 0) return null
        try {
          const result = await serpResults({
            keyword: targetKeyword,
            depth: 20,
          })
          if (!result?.available) {
            console.warn(
              'plan-cluster SERP grounding skipped:',
              result?.reason || 'unavailable'
            )
            return null
          }
          const items = Array.isArray(result.items) ? result.items : []
          if (!items.length) {
            console.warn(
              'plan-cluster SERP grounding returned no items; continuing without SERP section'
            )
            return null
          }
          return buildCompetitorSerpGrounding(items, competitors)
        } catch (err) {
          console.warn(
            'plan-cluster SERP grounding failed; continuing without SERP section:',
            err?.message || err
          )
          return null
        }
      })(),
    ])

    const anthropic = new Anthropic({ apiKey })
    const prompt = buildUserPrompt({
      mode,
      pillarKeyword,
      supportingKeyword,
      abstract,
      shortDescription,
      audience,
      contentMap,
      competitors,
      keywordData,
      competitorSerpGrounding,
      steeringNotes,
      previousProposal,
      articleTypeCounts,
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
      if (mode === 'pillar') {
        proposal = normalizePillarProposal(parsed)
      } else {
        proposal = assertUniqueTargetSlugs(
          enforceArticleTypeCounts(normalizeProposal(parsed), articleTypeCounts)
        )
      }
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
