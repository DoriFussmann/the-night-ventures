import { semrushTools } from './providers/semrush.js'
import { dataforseoTools } from './providers/dataforseo.js'
import { mozTools } from './providers/moz.js'
import { getProviderHealth } from './health.js'

export const MAX_TOOL_CALLS_PER_TURN = 6

export const EST_CREDITS = {
  semrush_domain_overview: 10,
  semrush_keyword_research: 10,
  semrush_organic_research: 14,
  semrush_competitors_research: 14,
  dataforseo_keyword_data: 12,
  dataforseo_serp_results: 8,
  dataforseo_backlinks_summary: 10,
  dataforseo_onpage_audit: 6,
  moz_domain_metrics: 8,
  moz_keyword_metrics: 8,
  moz_link_data: 10,
}

export function estCreditsForPlan(plan = []) {
  return (Array.isArray(plan) ? plan : []).reduce(
    (sum, step) => sum + (EST_CREDITS[step?.tool] || 10),
    0
  )
}

export const TOOL_DEFINITIONS = [
  {
    name: 'propose_data_pull',
    description:
      'Before calling any paid provider tool (semrush_*, dataforseo_*, moz_*), call this once to request the user\'s approval. Describe why the data helps, recommend the best provider, and list the exact tool calls you intend to make. Do NOT call provider tools until the user approves.',
    input_schema: {
      type: 'object',
      properties: {
        rationale: {
          type: 'string',
          description: 'Why this data is needed',
        },
        recommended_provider: {
          type: 'string',
          description: 'DataForSEO | Semrush | Moz | Both',
        },
        summary: {
          type: 'string',
          description: 'One line the UI shows',
        },
        plan: {
          type: 'array',
          description: 'The intended provider calls',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              input: { type: 'object' },
            },
            required: ['tool'],
          },
        },
      },
      required: ['rationale', 'recommended_provider', 'summary', 'plan'],
    },
  },
  {
    name: 'semrush_domain_overview',
    description:
      'Semrush domain overview: organic/paid keyword counts, traffic estimates, and rank for a domain.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain e.g. example.com' },
        database: { type: 'string', description: 'Semrush DB code, default us' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'semrush_keyword_research',
    description:
      'Semrush keyword research: volume, CPC, competition, and related keywords for a seed phrase.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        database: { type: 'string' },
        limit: { type: 'number', description: 'Max related keywords (default 20)' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'semrush_organic_research',
    description:
      'Semrush organic research: top organic keywords and ranking URLs driving traffic to a domain.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        database: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'semrush_competitors_research',
    description:
      'Semrush organic competitors: domains competing for similar organic keywords.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        database: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'dataforseo_keyword_data',
    description:
      'DataForSEO search volume and competition metrics for one or more keywords.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of keywords (max 20)',
        },
      },
    },
  },
  {
    name: 'dataforseo_serp_results',
    description: 'DataForSEO live Google organic SERP results for a keyword.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        depth: { type: 'number', description: 'Results depth, default 10' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'dataforseo_backlinks_summary',
    description: 'DataForSEO backlinks summary for a domain or URL target.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        target: { type: 'string', description: 'Domain or URL' },
      },
    },
  },
  {
    name: 'dataforseo_onpage_audit',
    description:
      'DataForSEO instant on-page / technical basics for a URL (title, meta, status, issues).',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        domain: { type: 'string' },
      },
    },
  },
  {
    name: 'moz_domain_metrics',
    description: 'Moz domain/page metrics: Domain Authority, Page Authority, spam score, link counts.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        url: { type: 'string' },
      },
    },
  },
  {
    name: 'moz_keyword_metrics',
    description: 'Moz keyword metrics (volume/difficulty) when available on the account plan.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'moz_link_data',
    description: 'Moz linking root domains for a target domain.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        url: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'save_insight',
    description:
      'Persist an actionable SEO insight for this company. Call whenever you find something worth keeping. Set conflicts_with_profile true if it contradicts existing company profile data (competitors, descriptions, audience, etc.). When suggesting a profile update, include profile_field and suggested_value.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        insight_type: {
          type: 'string',
          description: 'Free-text type label, e.g. competitor_gap, pillar_topic, technical_issue',
        },
        source_tool: {
          type: 'string',
          description: 'semrush | dataforseo | moz | null if synthesis-only',
        },
        conflicts_with_profile: { type: 'boolean' },
        profile_field: {
          type: 'string',
          description:
            'Optional company_profiles field to update: competitors, abstract, short_description, medium_description, long_description, target_audience, services, domain',
        },
        suggested_value: {
          description: 'Value to apply to profile_field when user clicks Update Profile',
        },
      },
      required: ['title', 'body', 'insight_type'],
    },
  },
]

const PROVIDER_LABELS = {
  semrush_domain_overview: 'Semrush',
  semrush_keyword_research: 'Semrush',
  semrush_organic_research: 'Semrush',
  semrush_competitors_research: 'Semrush',
  dataforseo_keyword_data: 'DataForSEO',
  dataforseo_serp_results: 'DataForSEO',
  dataforseo_backlinks_summary: 'DataForSEO',
  dataforseo_onpage_audit: 'DataForSEO',
  moz_domain_metrics: 'Moz',
  moz_keyword_metrics: 'Moz',
  moz_link_data: 'Moz',
  save_insight: null,
  propose_data_pull: null,
}

export function providerLabelForTool(name) {
  return PROVIDER_LABELS[name] || null
}

export async function executeTool(name, input, context) {
  const args = input && typeof input === 'object' ? input : {}

  switch (name) {
    case 'semrush_domain_overview':
      return semrushTools.domainOverview(args)
    case 'semrush_keyword_research':
      return semrushTools.keywordResearch(args)
    case 'semrush_organic_research':
      return semrushTools.organicResearch(args)
    case 'semrush_competitors_research':
      return semrushTools.competitorsResearch(args)
    case 'dataforseo_keyword_data':
      return dataforseoTools.keywordData(args)
    case 'dataforseo_serp_results':
      return dataforseoTools.serpResults(args)
    case 'dataforseo_backlinks_summary':
      return dataforseoTools.backlinksSummary(args)
    case 'dataforseo_onpage_audit':
      return dataforseoTools.onPageAudit(args)
    case 'moz_domain_metrics':
      return mozTools.domainMetrics(args)
    case 'moz_keyword_metrics':
      return mozTools.keywordMetrics(args)
    case 'moz_link_data':
      return mozTools.linkData(args)
    case 'save_insight':
      return saveInsight(args, context)
    case 'propose_data_pull':
      return { status: 'awaiting_approval' }
    default:
      return { available: false, reason: `Unknown tool: ${name}` }
  }
}

const PROFILE_FIELDS = new Set([
  'competitors',
  'abstract',
  'short_description',
  'medium_description',
  'long_description',
  'target_audience',
  'services',
  'domain',
])

async function saveInsight(args, context) {
  const { supabase, companyId, sessionId, onInsight } = context || {}
  if (!supabase || !companyId) {
    return { available: false, reason: 'Missing save context' }
  }

  const title = String(args.title || '').trim()
  const body = String(args.body || '').trim()
  const insightType = String(args.insight_type || 'general').trim() || 'general'
  if (!title || !body) {
    return { available: false, reason: 'title and body are required' }
  }

  let profilePatch = null
  const field = args.profile_field ? String(args.profile_field).trim() : ''
  if (field && PROFILE_FIELDS.has(field) && args.suggested_value !== undefined) {
    profilePatch = { field, value: args.suggested_value }
  }

  const row = {
    company_id: companyId,
    session_id: sessionId || null,
    title,
    body,
    insight_type: insightType,
    source_tool: args.source_tool ? String(args.source_tool).trim() : null,
    conflicts_with_profile: Boolean(args.conflicts_with_profile),
    status: 'new',
    profile_patch: profilePatch,
  }

  let { data, error } = await supabase.from('insights').insert(row).select('*').single()

  // Fallback if migration 019 (profile_patch) is not applied yet.
  if (error && /profile_patch/i.test(error.message || '')) {
    const { profile_patch: _omit, ...withoutPatch } = row
    ;({ data, error } = await supabase
      .from('insights')
      .insert(withoutPatch)
      .select('*')
      .single())
  }

  if (error) {
    console.error('save_insight failed:', error)
    return { available: false, reason: error.message || 'Failed to save insight' }
  }

  if (typeof onInsight === 'function') {
    try {
      onInsight(data)
    } catch (err) {
      console.error('onInsight callback failed:', err)
    }
  }

  return {
    available: true,
    saved: true,
    insight: data,
  }
}

export function healthSnapshot() {
  return getProviderHealth()
}
