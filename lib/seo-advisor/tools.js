import { semrushTools } from './providers/semrush.js'
import { dataforseoTools } from './providers/dataforseo.js'
import { mozTools } from './providers/moz.js'
import { getProviderHealth } from './health.js'
import {
  ARTICLE_FORMATS,
  MAX_CORE_KEYWORDS,
  MAX_SUPPORTING_PER_CORE,
  findCoveragePillar,
  keywordLabel,
  locateKeyword,
  normalizeSpec,
} from './pillars.js'
import { researchLocale } from './markets.js'

/**
 * Per user message: data lookups (Semrush, DataForSEO, Moz) and Add cards
 * are budgeted separately, so showing recommendations never eats the data
 * budget. MAX_TOOL_CALLS_PER_TURN is kept for older imports (= data budget).
 */
export const TOOL_BUDGET = { data: 16, cards: 12 }
export const MAX_TOOL_CALLS_PER_TURN = TOOL_BUDGET.data
export const MAX_OVERLAP_KEYWORDS = 7

export function budgetKind(name) {
  return name === 'recommend_keyword' ? 'cards' : 'data'
}

/**
 * Split one model turn's tool calls into those that fit the remaining
 * budget and those that don't. Pure; `used` is { data, cards } so far.
 */
export function planToolRun(toolUses, used = { data: 0, cards: 0 }, budget = TOOL_BUDGET) {
  const next = { data: used.data || 0, cards: used.cards || 0 }
  const toRun = []
  const skipped = []
  for (const toolUse of Array.isArray(toolUses) ? toolUses : []) {
    const kind = budgetKind(toolUse.name)
    if (next[kind] < budget[kind]) {
      next[kind] += 1
      toRun.push(toolUse)
    } else {
      skipped.push(toolUse)
    }
  }
  return {
    toRun,
    skipped,
    used: next,
    remaining: { data: budget.data - next.data, cards: budget.cards - next.cards },
  }
}

const keywordList = {
  type: 'array',
  items: { type: 'string' },
}

/**
 * Market and language are set per chat by the user and injected here,
 * so data tools take no locale parameters.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'semrush_keyword_research',
    description:
      'Semrush: search volume, CPC and competition for a seed keyword plus related keywords sorted by volume. Good first call when exploring a topic.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        limit: { type: 'number', description: 'Max related keywords (default 20, max 50)' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'semrush_domain_overview',
    description: 'Semrush: organic keyword count, traffic estimate and rank for a domain.',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'e.g. example.com' } },
      required: ['domain'],
    },
  },
  {
    name: 'semrush_organic_research',
    description:
      'Semrush: top organic keywords a domain ranks for, with position, volume, traffic and keyword difficulty. Use on competitors to find proven keywords.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        limit: { type: 'number', description: 'Default 20, max 50' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'semrush_competitors_research',
    description: 'Semrush: domains competing for the same organic keywords as a domain.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'dataforseo_keyword_volume',
    description: 'DataForSEO (Google Ads): search volume, CPC and competition for up to 20 keywords.',
    input_schema: {
      type: 'object',
      properties: { keywords: { ...keywordList, description: 'Up to 20 keywords' } },
      required: ['keywords'],
    },
  },
  {
    name: 'dataforseo_keyword_difficulty',
    description:
      'DataForSEO: keyword difficulty (0–100) for up to 100 keywords. Use to get difficulty for candidates before recommending them.',
    input_schema: {
      type: 'object',
      properties: { keywords: { ...keywordList, description: 'Up to 100 keywords' } },
      required: ['keywords'],
    },
  },
  {
    name: 'dataforseo_keyword_ideas',
    description:
      'DataForSEO: keyword ideas that contain the seed phrase, sorted by volume. Good for finding long-tail Supporting keywords under a Core keyword.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        limit: { type: 'number', description: 'Default 50, max 200' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'dataforseo_related_keywords',
    description:
      'DataForSEO: keywords from Google "searches related to" for a seed, sorted by volume. Good for adjacent topics.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        limit: { type: 'number', description: 'Default 40, max 200' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'dataforseo_serp_results',
    description: 'DataForSEO: live Google top results for a keyword — who ranks and with what kind of page.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        depth: { type: 'number', description: 'Default 10' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'dataforseo_serp_overlap',
    description:
      "Same-results check: compares candidate keywords' Google top 10 with every keyword already in the map. 4+ shared URLs = same intent (do not recommend it; suggest it as a secondary keyword of that article). 2-3 = close (fine, but keep angles distinct). Check ALL your candidates in ONE call (up to 7) before recommending them.",
    input_schema: {
      type: 'object',
      properties: {
        keywords: { ...keywordList, description: 'Up to 7 candidate keywords, checked together' },
        keyword: { type: 'string', description: 'Single keyword (prefer keywords)' },
      },
    },
  },
  {
    name: 'dataforseo_backlinks_summary',
    description: 'DataForSEO: backlinks and referring domains for a domain.',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
    },
  },
  {
    name: 'dataforseo_onpage_audit',
    description: 'DataForSEO: on-page basics for one URL (title, meta, status code, issues).',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'moz_domain_metrics',
    description: 'Moz: Domain Authority, Page Authority, spam score and link counts for a domain.',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
    },
  },
  {
    name: 'moz_keyword_metrics',
    description: 'Moz: volume and difficulty for one keyword (if the Moz plan includes it).',
    input_schema: {
      type: 'object',
      properties: { keyword: { type: 'string' } },
      required: ['keyword'],
    },
  },
  {
    name: 'moz_link_data',
    description: 'Moz: top linking root domains for a domain.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'recommend_keyword',
    description:
      'Show the user an "Add Core Keyword" or "Add Supporting Keyword" button for ONE keyword you strongly recommend, with a draft article spec. Nothing is saved until the user clicks; they can edit the spec first. Only use for a firm, data-backed recommendation, after explaining it in your reply. One call per keyword. For supporting, name the Core keyword it belongs under (an existing one, or one you are recommending in the same reply).',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['core', 'supporting'] },
        keyword: { type: 'string' },
        core: {
          type: 'string',
          description: 'Required for supporting: the Core keyword it sits under',
        },
        search_volume: {
          type: 'number',
          description: 'Monthly volume from a tool result. Omit if no tool returned it.',
        },
        difficulty: {
          type: 'number',
          description: 'Difficulty 0–100 from a tool result. Omit if no tool returned it.',
        },
        reason: { type: 'string', description: 'One sentence: why this keyword' },
        angle: {
          type: 'string',
          description: 'One sentence: what the article argues or answers, and for whom',
        },
        key_messages: {
          type: 'array',
          items: { type: 'string' },
          description:
            '3 to 5 points the article must make, based on SEO Controls and Company Intelligence. No invented facts or numbers.',
        },
        format: {
          type: 'string',
          enum: ARTICLE_FORMATS,
          description: 'Supporting only: the article format that fits the search intent',
        },
        secondary_keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Supporting only: close variants the article should also cover (no separate article)',
        },
      },
      required: ['type', 'keyword', 'reason', 'angle', 'key_messages'],
    },
  },
]

const PROVIDER_BY_PREFIX = [
  ['semrush_', 'Semrush'],
  ['dataforseo_', 'DataForSEO'],
  ['moz_', 'Moz'],
]

export function providerLabelForTool(name) {
  const hit = PROVIDER_BY_PREFIX.find(([prefix]) => String(name).startsWith(prefix))
  return hit ? hit[1] : null
}

function clampLimit(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.round(n), max)
}

export async function executeTool(name, input, context = {}) {
  const args = input && typeof input === 'object' ? input : {}
  const locale = context.locale || researchLocale()
  const db = locale.semrushDatabase
  const dfs = { locationCode: locale.dfsLocationCode, languageCode: locale.dfsLanguageCode }

  switch (name) {
    case 'semrush_keyword_research':
      return semrushTools.keywordResearch({
        keyword: args.keyword,
        database: db,
        limit: clampLimit(args.limit, 20, 50),
      })
    case 'semrush_domain_overview':
      return semrushTools.domainOverview({ domain: args.domain, database: db })
    case 'semrush_organic_research':
      return semrushTools.organicResearch({
        domain: args.domain,
        database: db,
        limit: clampLimit(args.limit, 20, 50),
      })
    case 'semrush_competitors_research':
      return semrushTools.competitorsResearch({
        domain: args.domain,
        database: db,
        limit: clampLimit(args.limit, 15, 40),
      })
    case 'dataforseo_keyword_volume':
      return dataforseoTools.keywordData({ keywords: args.keywords, keyword: args.keyword, ...dfs })
    case 'dataforseo_keyword_difficulty':
      return dataforseoTools.keywordDifficulty({
        keywords: args.keywords,
        keyword: args.keyword,
        ...dfs,
      })
    case 'dataforseo_keyword_ideas':
      return trimKeywords(
        await dataforseoTools.keywordSuggestions({
          keyword: args.keyword,
          limit: clampLimit(args.limit, 50, 200),
          ...dfs,
        })
      )
    case 'dataforseo_related_keywords':
      return trimKeywords(
        await dataforseoTools.relatedKeywords({
          keyword: args.keyword,
          limit: clampLimit(args.limit, 40, 200),
          ...dfs,
        })
      )
    case 'dataforseo_serp_results':
      return dataforseoTools.serpResults({
        keyword: args.keyword,
        depth: clampLimit(args.depth, 10, 50),
        ...dfs,
      })
    case 'dataforseo_serp_overlap':
      if (typeof context.checkOverlap !== 'function') {
        return { available: false, reason: 'Same-results check is not available here' }
      }
      return checkOverlapBatch(args, context.checkOverlap)
    case 'dataforseo_backlinks_summary':
      return dataforseoTools.backlinksSummary({ domain: args.domain })
    case 'dataforseo_onpage_audit':
      return dataforseoTools.onPageAudit({ url: args.url, domain: args.domain })
    case 'moz_domain_metrics':
      return mozTools.domainMetrics({ domain: args.domain, url: args.url })
    case 'moz_keyword_metrics':
      return mozTools.keywordMetrics({ keyword: args.keyword, locale: locale.mozLocale })
    case 'moz_link_data':
      return mozTools.linkData({ domain: args.domain, limit: clampLimit(args.limit, 10, 50) })
    case 'recommend_keyword':
      return recommendKeyword(args, context)
    default:
      return { available: false, reason: `Unknown tool: ${name}` }
  }
}

/** Same-results check for several candidates in one tool call. */
export async function checkOverlapBatch(args, checkOverlap) {
  const list = [
    ...(Array.isArray(args?.keywords) ? args.keywords : []),
    ...(args?.keyword ? [args.keyword] : []),
  ]
    .map((k) => String(k || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const keywords = [...new Set(list.map((k) => k.toLowerCase()))]
    .map((lower) => list.find((k) => k.toLowerCase() === lower))
    .slice(0, MAX_OVERLAP_KEYWORDS)
  if (keywords.length === 0) return { available: false, reason: 'keywords is required' }
  // One at a time: each check reuses the top-10s the previous one cached.
  const results = []
  for (const keyword of keywords) results.push({ keyword, ...(await checkOverlap(keyword)) })
  const truncated = list.length > keywords.length
  return {
    available: results.some((r) => r.available !== false),
    results,
    ...(truncated ? { note: `Only the first ${MAX_OVERLAP_KEYWORDS} distinct keywords were checked.` } : {}),
  }
}

/** Keep large keyword lists compact for the model. */
function trimKeywords(result, max = 60) {
  if (!result?.available || !Array.isArray(result.keywords)) return result
  return { ...result, keywords: result.keywords.slice(0, max) }
}

function finiteOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Validate a recommendation against the current tree and, if valid, emit a
 * card to the UI. The tool result tells the model what happened.
 */
export function recommendKeyword(args, context = {}) {
  const type = args.type === 'supporting' ? 'supporting' : 'core'
  const keyword = String(args.keyword || '').replace(/\s+/g, ' ').trim()
  const core = String(args.core || '').trim()
  if (!keyword) return { shown: false, reason: 'keyword is required' }
  if (type === 'supporting' && !core) {
    return { shown: false, reason: 'core is required for a supporting keyword' }
  }

  const tree = Array.isArray(context.pillars) ? context.pillars : []
  const existing = locateKeyword(tree, keyword)
  if (existing) {
    return {
      shown: false,
      reason:
        existing.type === 'core'
          ? `"${keyword}" is already a Core keyword. Do not recommend it again.`
          : `"${keyword}" is already a Supporting keyword under "${existing.core}". Do not recommend it again.`,
    }
  }

  const parent = type === 'supporting' ? findCoveragePillar(tree, core) : null
  if (type === 'core' && tree.length >= MAX_CORE_KEYWORDS) {
    return {
      shown: false,
      reason: `The map already has ${MAX_CORE_KEYWORDS} Core keywords, the maximum. Suggest replacing one instead, and say which.`,
    }
  }
  const siblings = Array.isArray(parent?.supporting) ? parent.supporting.length : 0
  if (type === 'supporting' && parent && siblings >= MAX_SUPPORTING_PER_CORE) {
    return {
      shown: false,
      reason: `"${keywordLabel(parent)}" already has ${MAX_SUPPORTING_PER_CORE} Supporting keywords, the maximum. Suggest it for the backlog instead.`,
    }
  }
  const spec = normalizeSpec(
    {
      angle: args.angle,
      keyMessages: args.key_messages,
      format: args.format,
      secondaryKeywords: args.secondary_keywords,
      status: 'approved',
    },
    { type }
  )
  const card = {
    type,
    keyword,
    core: parent ? keywordLabel(parent) : type === 'supporting' ? core : null,
    coreExists: type === 'supporting' ? Boolean(parent) : null,
    searchVolume: finiteOrNull(args.search_volume),
    difficulty: finiteOrNull(args.difficulty),
    reason: String(args.reason || '').trim(),
    spec,
  }

  if (typeof context.onRecommendation === 'function') {
    try {
      context.onRecommendation(card)
    } catch (err) {
      console.error('onRecommendation callback failed:', err)
    }
  }

  const thin = spec.keyMessages.length < 3
  return {
    shown: true,
    card,
    ...(thin ? { warning: 'Fewer than 3 key messages; give 3 to 5 next time.' } : {}),
    note:
      type === 'supporting' && !parent
        ? `Shown. "${core}" is not a Core keyword yet, so the user must add it first.`
        : 'Shown to the user as an Add button. The user decides; do not ask them to confirm in text.',
  }
}

export function healthSnapshot() {
  return getProviderHealth()
}
