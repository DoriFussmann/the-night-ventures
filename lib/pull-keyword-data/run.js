import {
  keywordSuggestions,
  relatedKeywords,
} from '../seo-advisor/providers/dataforseo.js'
import { applyHeuristicFilters, applyAudienceFilter } from './filter.js'
import { formatKeywordBlock, mergeKeywordRows } from './format.js'

const SUGGESTIONS_LIMIT = 80
const RELATED_LIMIT = 60
const MAX_OUTPUT_ROWS = 80

/**
 * Pull + filter keyword data for Topic Generator Plan Cluster / Plan Pillar.
 */
export async function pullKeywordData({
  keyword,
  pillarKeyword = '',
  audienceFilter = '',
  anthropicApiKey = process.env.ANTHROPIC_API_KEY,
}) {
  const seed = String(keyword || '').trim()
  if (!seed) {
    const err = new Error('keyword is required')
    err.statusCode = 400
    throw err
  }

  const warnings = []
  const [suggestionsResult, relatedResult] = await Promise.all([
    keywordSuggestions({ keyword: seed, limit: SUGGESTIONS_LIMIT }),
    relatedKeywords({ keyword: seed, limit: RELATED_LIMIT, depth: 2 }),
  ])

  if (!suggestionsResult.available) {
    warnings.push(`keyword_suggestions: ${suggestionsResult.reason}`)
  }
  if (!relatedResult.available) {
    warnings.push(`related_keywords: ${relatedResult.reason}`)
  }

  const merged = mergeKeywordRows([
    suggestionsResult.available ? suggestionsResult.keywords : [],
    relatedResult.available ? relatedResult.keywords : [],
  ])

  if (merged.length === 0) {
    const err = new Error(
      warnings.length
        ? `DataForSEO returned no keywords (${warnings.join('; ')})`
        : 'DataForSEO returned no keywords for this seed'
    )
    err.statusCode = 502
    err.warnings = warnings
    throw err
  }

  const heuristic = applyHeuristicFilters(merged)
  const audience = await applyAudienceFilter(heuristic.keep, {
    keyword: seed,
    pillarKeyword,
    audienceFilter,
    apiKey: anthropicApiKey,
  })
  if (audience.warning) warnings.push(audience.warning)

  const filtered = audience.keep.slice(0, MAX_OUTPUT_ROWS)
  const text = formatKeywordBlock(filtered)

  return {
    keyword: seed,
    pillarKeyword: String(pillarKeyword || '').trim() || null,
    audienceFilter: String(audienceFilter || '').trim() || null,
    text,
    rows: filtered.map((row) => ({
      keyword: row.keyword,
      searchVolume: row.searchVolume,
      competition: row.competition,
      competitionLevel: row.competitionLevel,
      competitionIndex: row.competitionIndex,
      cpc: row.cpc,
      dfsCompIndex: (() => {
        if (
          typeof row.competitionIndex === 'number' &&
          Number.isFinite(row.competitionIndex)
        ) {
          return Math.round(row.competitionIndex)
        }
        if (typeof row.competition === 'number' && Number.isFinite(row.competition)) {
          return Math.round(row.competition * 100)
        }
        return null
      })(),
    })),
    meta: {
      sourceCounts: {
        suggestions: suggestionsResult.available
          ? suggestionsResult.keywords.length
          : 0,
        related: relatedResult.available ? relatedResult.keywords.length : 0,
        merged: merged.length,
        afterHeuristics: heuristic.keep.length,
        afterAudience: filtered.length,
      },
      droppedSample: [...heuristic.dropped, ...audience.dropped].slice(0, 25),
      usedLlmFilter: Boolean(audience.usedLlm),
      warnings,
      competitionColumn:
        'DFS Comp Index — DataForSEO competition_index (0–100) or competition×100; not Semrush KD',
    },
  }
}
