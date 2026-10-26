/** Turn normalized provider tool results into small tables for the chat. */

const TOOL_TITLES = {
  semrush_domain_overview: 'Domain overview',
  semrush_keyword_research: 'Keyword research',
  semrush_organic_research: 'Organic keywords',
  semrush_competitors_research: 'Organic competitors',
  dataforseo_keyword_volume: 'Keyword volumes',
  dataforseo_serp_overlap: 'Same-results check',
  dataforseo_keyword_difficulty: 'Keyword difficulty',
  dataforseo_keyword_ideas: 'Keyword ideas',
  dataforseo_related_keywords: 'Related keywords',
  dataforseo_serp_results: 'SERP results',
  dataforseo_backlinks_summary: 'Backlinks summary',
  dataforseo_onpage_audit: 'On-page audit',
  moz_domain_metrics: 'Domain metrics',
  moz_keyword_metrics: 'Keyword metrics',
  moz_link_data: 'Linking domains',
}

function providerFromTool(name) {
  if (String(name).startsWith('semrush_')) return 'Semrush'
  if (String(name).startsWith('dataforseo_')) return 'DataForSEO'
  if (String(name).startsWith('moz_')) return 'Moz'
  return 'Tool'
}

function objectToRows(obj) {
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj).map(([key, value]) => ({
    metric: key,
    value: formatCell(value),
  }))
}

function formatCell(value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(formatCell).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function rowsFromArray(items, columnOrder) {
  if (!Array.isArray(items) || items.length === 0) return { columns: [], rows: [] }
  const keys =
    columnOrder?.filter((k) => items.some((r) => r?.[k] != null)) ||
    [...new Set(items.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : [])))]
  return {
    columns: keys,
    rows: items.slice(0, 40).map((item) => {
      const row = {}
      for (const k of keys) row[k] = formatCell(item?.[k])
      return row
    }),
  }
}

/**
 * @returns {null | { id: string, toolName: string, title: string, provider: string, subtitle?: string, columns: string[], rows: object[], available: boolean, reason?: string }}
 */
export function toolResultToDataCard(toolName, result, { id, createdAt } = {}) {
  if (!result || typeof result !== 'object') return null
  if (result.available === false) {
    return {
      id: id || `${toolName}-${Date.now()}`,
      toolName,
      title: TOOL_TITLES[toolName] || toolName,
      provider: providerFromTool(toolName),
      columns: ['status'],
      rows: [{ status: result.reason || 'Unavailable' }],
      available: false,
      reason: result.reason,
      createdAt: createdAt || new Date().toISOString(),
    }
  }

  let columns = []
  let rows = []
  let subtitle = result.domain || result.target || result.keyword || result.url || ''

  switch (toolName) {
    case 'semrush_domain_overview': {
      const table = rowsFromArray(objectToRows(result.metrics), ['metric', 'value'])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'semrush_keyword_research': {
      const related = result.related || []
      if (result.overview) {
        rows = [
          {
            keyword: formatCell(result.overview.keyword),
            searchVolume: formatCell(result.overview.searchVolume),
            cpc: formatCell(result.overview.cpc),
            competition: formatCell(result.overview.competition),
            type: 'seed',
          },
          ...related.slice(0, 25).map((r) => ({
            keyword: formatCell(r.keyword),
            searchVolume: formatCell(r.searchVolume),
            cpc: formatCell(r.cpc),
            competition: formatCell(r.competition),
            type: 'related',
          })),
        ]
        columns = ['keyword', 'searchVolume', 'cpc', 'competition', 'type']
      }
      break
    }
    case 'semrush_organic_research': {
      const table = rowsFromArray(result.keywords, [
        'keyword',
        'position',
        'searchVolume',
        'traffic',
        'keywordDifficulty',
        'url',
      ])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'semrush_competitors_research': {
      const table = rowsFromArray(result.competitors, [
        'domain',
        'competitionLevel',
        'commonKeywords',
        'organicKeywords',
        'organicTraffic',
      ])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'dataforseo_keyword_difficulty': {
      const table = rowsFromArray(result.keywords, ['keyword', 'keywordDifficulty'])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'dataforseo_keyword_ideas':
    case 'dataforseo_related_keywords': {
      const table = rowsFromArray(result.keywords, [
        'keyword',
        'searchVolume',
        'competitionIndex',
        'cpc',
      ])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'dataforseo_keyword_volume': {
      const table = rowsFromArray(result.keywords, [
        'keyword',
        'searchVolume',
        'cpc',
        'competition',
        'competitionIndex',
      ])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'dataforseo_serp_overlap': {
      rows = (result.matches || []).map((m) => ({
        keyword: m.keyword,
        core: m.core,
        shared: `${m.shared}/10`,
      }))
      columns = ['keyword', 'core', 'shared']
      if (rows.length === 0) {
        columns = ['result']
        rows = [{ result: result.message || 'No overlap' }]
      }
      break
    }
    case 'dataforseo_serp_results': {
      const table = rowsFromArray(result.items, [
        'rank',
        'title',
        'domain',
        'url',
        'description',
      ])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'dataforseo_backlinks_summary': {
      const table = rowsFromArray(objectToRows(result.summary), ['metric', 'value'])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'dataforseo_onpage_audit': {
      const metaRows = objectToRows({
        statusCode: result.statusCode,
        onpageScore: result.onpageScore,
        ...(result.meta || {}),
        ...(result.timing || {}),
      })
      const issueRows = (result.issues || []).map((i) => ({
        metric: i.severity || 'issue',
        value: i.issue,
      }))
      columns = ['metric', 'value']
      rows = [...metaRows, ...issueRows]
      break
    }
    case 'moz_domain_metrics': {
      const table = rowsFromArray(objectToRows(result.metrics), ['metric', 'value'])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'moz_keyword_metrics': {
      const table = rowsFromArray(objectToRows(result.metrics), ['metric', 'value'])
      columns = table.columns
      rows = table.rows
      break
    }
    case 'moz_link_data': {
      const table = rowsFromArray(result.linkingRootDomains, [
        'rootDomain',
        'domainAuthority',
        'pagesToTarget',
        'spamScore',
      ])
      columns = table.columns
      rows = table.rows
      break
    }
    default: {
      if (Array.isArray(result.keywords)) {
        const table = rowsFromArray(result.keywords)
        columns = table.columns
        rows = table.rows
      } else if (result.metrics) {
        const table = rowsFromArray(objectToRows(result.metrics), ['metric', 'value'])
        columns = table.columns
        rows = table.rows
      } else {
        return null
      }
    }
  }

  if (!columns.length || !rows.length) return null

  return {
    id: id || `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    toolName,
    title: TOOL_TITLES[toolName] || toolName,
    provider: result.provider || providerFromTool(toolName),
    subtitle: subtitle ? String(subtitle) : undefined,
    columns,
    rows,
    available: true,
    createdAt: createdAt || new Date().toISOString(),
  }
}

export function humanizeColumn(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
