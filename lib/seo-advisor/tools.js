import { semrushTools } from './providers/semrush.js'
import { dataforseoTools } from './providers/dataforseo.js'
import { mozTools } from './providers/moz.js'
import { getProviderHealth } from './health.js'
import { locateKeyword, findCoveragePillar, keywordLabel } from './pillars.js'
import { researchLocale } from './markets.js'

export const MAX_TOOL_CALLS_PER_TURN = 8

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
      'Show the user an "Add Core Keyword" or "Add Supporting Keyword" button for ONE keyword you strongly recommend. Nothing is saved until the user clicks. Only use for a firm, data-backed recommendation, after explaining it in your reply. One call per keyword. For supporting, name the Core keyword it belongs under (an existing one, or one you are recommending in the same reply).',
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
      },
      required: ['type', 'keyword', 'reason'],
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
  const card = {
    type,
    keyword,
    core: parent ? keywordLabel(parent) : type === 'supporting' ? core : null,
    coreExists: type === 'supporting' ? Boolean(parent) : null,
    searchVolume: finiteOrNull(args.search_volume),
    difficulty: finiteOrNull(args.difficulty),
    reason: String(args.reason || '').trim(),
  }

  if (typeof context.onRecommendation === 'function') {
    try {
      context.onRecommendation(card)
    } catch (err) {
      console.error('onRecommendation callback failed:', err)
    }
  }

  return {
    shown: true,
    card,
    note:
      type === 'supporting' && !parent
        ? `Shown. "${core}" is not a Core keyword yet, so the user must add it first.`
        : 'Shown to the user as an Add button. The user decides; do not ask them to confirm in text.',
  }
}

export function healthSnapshot() {
  return getProviderHealth()
}
