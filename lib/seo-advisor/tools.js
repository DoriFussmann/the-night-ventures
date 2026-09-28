import Anthropic from '@anthropic-ai/sdk'
import { getProviderHealth } from './health.js'
import { runDataRequest } from './router.js'
import {
  extractMetrics,
  getEndpoint,
  lookupMetrics,
  mergeMetrics,
  providerLabel,
} from './registry.js'
import { slugifyKeyword } from './pillars.js'

/** Advisor-level tool calls per user turn (each request_data may fan out to several endpoints). */
export const MAX_TOOL_CALLS_PER_TURN = 6

export const CORE_TARGET = { min: 5, max: 7 }
export const CLUSTERS_PER_CORE = 5

const KEYWORD_PROPOSAL_PROPS = {
  keyword: { type: 'string' },
  intent: {
    type: 'string',
    description: 'informational | commercial | transactional | navigational',
  },
  rationale: {
    type: 'string',
    description: '1–2 sentences: why this keyword, what the risk is.',
  },
}

export const TOOL_DEFINITIONS = [
  {
    name: 'request_data',
    description:
      'Get live SEO data. A data agent that knows every connected API endpoint (Semrush, DataForSEO, Moz) picks the right ones, calls them and returns compact results with provenance. Use whenever a number (volume, trend, organic difficulty, who ranks, domain authority, backlinks) would make your answer materially stronger. Batch all keywords you need into one request.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'Precise data question, e.g. "US monthly volume, 12-mo trend and organic KD for these 15 keywords".',
        },
        purpose: { type: 'string', description: 'What decision this data informs.' },
        keywords: { type: 'array', items: { type: 'string' } },
        domains: { type: 'array', items: { type: 'string' } },
        topic: { type: 'string' },
      },
      required: ['question'],
    },
  },
  {
    name: 'ideation_verdict',
    description:
      'Show the idea-check verdict card. Call once, after writing the answer in chat. Every field must reflect data you fetched; say "no data" where missing.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        demand: { type: 'string', description: 'One line: how much search demand, with the key numbers.' },
        trend: { type: 'string', description: 'One line: rising/flat/falling and by how much.' },
        competition: { type: 'string', description: 'One line: who ranks and how strong they are.' },
        path: { type: 'string', description: 'One line: the angle a new site could win first.' },
        verdict: { type: 'string', enum: ['go', 'cautious', 'pass'] },
        next_step: { type: 'string', description: 'The single next step.' },
      },
      required: ['topic', 'demand', 'trend', 'competition', 'path', 'verdict', 'next_step'],
    },
  },
  {
    name: 'propose_core_keyword',
    description:
      'Propose ONE core (pillar) keyword for the user to approve or skip via a button. Metrics are attached server-side from fetched data — fetch volume + KD for the keyword via request_data first. After calling this, stop and wait for the user.',
    input_schema: {
      type: 'object',
      properties: KEYWORD_PROPOSAL_PROPS,
      required: ['keyword', 'rationale'],
    },
  },
  {
    name: 'propose_cluster_keyword',
    description:
      'Propose ONE cluster keyword under the active core keyword for the user to approve or skip via a button. Metrics are attached server-side from fetched data — fetch volume + KD first. After calling this, stop and wait for the user.',
    input_schema: {
      type: 'object',
      properties: {
        core_keyword: { type: 'string', description: 'The approved core keyword this belongs to.' },
        ...KEYWORD_PROPOSAL_PROPS,
      },
      required: ['core_keyword', 'keyword', 'rationale'],
    },
  },
  {
    name: 'save_insight',
    description:
      'Persist a durable, actionable SEO insight for this company. Set conflicts_with_profile true if it contradicts the company profile; include profile_field + suggested_value to propose a profile update.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        insight_type: {
          type: 'string',
          description: 'Free-text label, e.g. competitor_gap, idea_verdict, technical_issue',
        },
        source_tool: { type: 'string', description: 'semrush | dataforseo | moz | null' },
        conflicts_with_profile: { type: 'boolean' },
        profile_field: {
          type: 'string',
          description:
            'Optional company_profiles field: competitors, abstract, short_description, medium_description, long_description, target_audience, services, domain',
        },
        suggested_value: {
          description: 'Value to apply to profile_field when user clicks Update Profile',
        },
      },
      required: ['title', 'body', 'insight_type'],
    },
  },
]

/** Tools whose results are UI cards, not data. */
export const UI_TOOLS = new Set([
  'ideation_verdict',
  'propose_core_keyword',
  'propose_cluster_keyword',
  'save_insight',
  // legacy (older sessions)
  'propose_audience',
  'propose_pillars',
  'propose_clusters',
])

export const KNOWN_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name))

export function providerLabelForTool(name) {
  if (String(name).startsWith('semrush_')) return 'Semrush'
  if (String(name).startsWith('dataforseo_')) return 'DataForSEO'
  if (String(name).startsWith('moz_')) return 'Moz'
  return null
}

export async function executeTool(name, input, context = {}) {
  const args = input && typeof input === 'object' ? input : {}

  switch (name) {
    case 'request_data':
      return requestData(args, context)
    case 'ideation_verdict':
      return ideationVerdict(args, context)
    case 'propose_core_keyword':
      return proposeCoreKeyword(args, context)
    case 'propose_cluster_keyword':
      return proposeClusterKeyword(args, context)
    case 'save_insight':
      return saveInsight(args, context)
    default:
      return { available: false, reason: `Unknown tool: ${name}` }
  }
}

// ---------------------------------------------------------------------------

async function requestData(args, context) {
  const question = String(args.question || '').trim()
  if (!question) return { available: false, reason: 'question is required' }
  const request = {
    question,
    purpose: String(args.purpose || '').trim() || undefined,
    keywords: Array.isArray(args.keywords)
      ? args.keywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 100)
      : undefined,
    domains: Array.isArray(args.domains)
      ? args.domains.map((d) => String(d || '').trim()).filter(Boolean).slice(0, 10)
      : undefined,
    topic: String(args.topic || '').trim() || undefined,
  }

  const anthropic =
    context.anthropic || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const { forAdvisor, calls, endpointResults } = await runDataRequest({
    anthropic,
    request,
    onEndpointStart: (e) => context.emit?.('tool_start', {
      id: e.id,
      name: e.endpoint,
      provider: e.provider,
      label: e.label,
    }),
    onEndpointEnd: (e) => {
      context.emit?.('tool_end', { id: e.id, name: e.endpoint, provider: e.provider, ok: e.ok })
      context.emit?.('tool_data', {
        id: e.id,
        name: e.endpoint,
        provider: e.provider,
        result: e.result,
      })
    },
  })

  if (context.metricsIndex) {
    for (const r of endpointResults) {
      mergeMetrics(context.metricsIndex, extractMetrics(r.name, r.result))
    }
  }

  // Persisted alongside the advisor-visible payload so data cards and the
  // metrics index can be rebuilt when a session is reopened.
  return {
    __forAdvisor: forAdvisor,
    __endpointResults: endpointResults,
    __calls: calls,
  }
}

async function ideationVerdict(args, context) {
  const card = {
    topic: String(args.topic || '').trim(),
    demand: String(args.demand || '').trim(),
    trend: String(args.trend || '').trim(),
    competition: String(args.competition || '').trim(),
    path: String(args.path || '').trim(),
    verdict: ['go', 'cautious', 'pass'].includes(args.verdict) ? args.verdict : 'cautious',
    next_step: String(args.next_step || '').trim(),
  }
  context.emit?.('ideation_verdict', card)
  if (context.supabase && context.companyId) {
    const label = { go: 'Go', cautious: 'Go with caution', pass: 'Pass' }[card.verdict]
    await saveInsight(
      {
        title: `Idea check: ${card.topic || 'topic'} — ${label}`,
        body: [
          `Demand: ${card.demand}`,
          `Trend: ${card.trend}`,
          `Competition: ${card.competition}`,
          `Clear path: ${card.path}`,
          `Next step: ${card.next_step}`,
        ].join('\n'),
        insight_type: 'idea_verdict',
      },
      context
    ).catch(() => null)
  }
  return {
    shown: true,
    card,
    instruction: 'Verdict card shown and saved as an insight. Stop here; the user decides whether to move to core keywords.',
  }
}

function metricsFor(context, keyword) {
  const m = context.metricsIndex ? lookupMetrics(context.metricsIndex, keyword) : null
  return {
    search_volume: m?.searchVolume ?? null,
    difficulty: m?.keywordDifficulty ?? null,
    trend: m?.trend ?? null,
    sources: (m?.sources || []).map((id) => {
      const e = getEndpoint(id)
      return e ? `${providerLabel(e.provider)} ${e.label.toLowerCase()}` : id
    }),
    verified: Boolean(m && (m.searchVolume != null || m.keywordDifficulty != null)),
  }
}

function oneProposalPerTurn(context) {
  if (context.proposalsThisTurn >= 1) {
    return 'Rejected: one proposal at a time. Wait for the user to approve or skip the card already shown.'
  }
  context.proposalsThisTurn = (context.proposalsThisTurn || 0) + 1
  return null
}

function proposeCoreKeyword(args, context) {
  const keyword = String(args.keyword || '').trim()
  if (!keyword) return { available: false, reason: 'keyword is required' }
  const pillars = context.coveragePillars || []
  const slug = slugifyKeyword(keyword)
  if (pillars.some((p) => slugifyKeyword(p.slug || p.keyword) === slug)) {
    return `"${keyword}" is already an approved core keyword. Propose a different one.`
  }
  const metrics = metricsFor(context, keyword)
  if (!metrics.verified) {
    return `No fetched volume/KD for "${keyword}" yet. Call request_data for it first, then propose again.`
  }
  const blocked = oneProposalPerTurn(context)
  if (blocked) return blocked

  const card = {
    kind: 'core',
    keyword,
    intent: String(args.intent || '').trim() || null,
    rationale: String(args.rationale || '').trim(),
    ...metrics,
    approvedCount: pillars.length,
    target: CORE_TARGET,
  }
  context.emit?.('keyword_proposal', card)
  return { shown: true, card, instruction: 'Card shown. Stop and wait for Approve/Skip.' }
}

function proposeClusterKeyword(args, context) {
  const keyword = String(args.keyword || '').trim()
  if (!keyword) return { available: false, reason: 'keyword is required' }
  const pillars = context.coveragePillars || []
  const coreSlug = slugifyKeyword(args.core_keyword || context.focusPillar?.keyword)
  const core = pillars.find(
    (p) => slugifyKeyword(p.slug || p.keyword) === coreSlug || slugifyKeyword(p.keyword) === coreSlug
  )
  if (!core) {
    return `"${args.core_keyword}" is not an approved core keyword. Clusters must sit under an approved core.`
  }
  const supporting = Array.isArray(core.supporting) ? core.supporting : []
  const slug = slugifyKeyword(keyword)
  if (supporting.some((s) => slugifyKeyword(s.slug || s.keyword) === slug)) {
    return `"${keyword}" is already a cluster under "${core.keyword}". Propose a different one.`
  }
  if (supporting.length >= CLUSTERS_PER_CORE) {
    return `"${core.keyword}" already has ${supporting.length} clusters (target ${CLUSTERS_PER_CORE}). Tell the user and suggest the core with the fewest clusters.`
  }
  const metrics = metricsFor(context, keyword)
  if (!metrics.verified) {
    return `No fetched volume/KD for "${keyword}" yet. Call request_data for it first, then propose again.`
  }
  const blocked = oneProposalPerTurn(context)
  if (blocked) return blocked

  const card = {
    kind: 'cluster',
    keyword,
    core_keyword: core.keyword,
    core_slug: core.slug || slugifyKeyword(core.keyword),
    intent: String(args.intent || '').trim() || null,
    rationale: String(args.rationale || '').trim(),
    ...metrics,
    approvedCount: supporting.length,
    target: { min: CLUSTERS_PER_CORE, max: CLUSTERS_PER_CORE },
  }
  context.emit?.('keyword_proposal', card)
  return { shown: true, card, instruction: 'Card shown. Stop and wait for Approve/Skip.' }
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
