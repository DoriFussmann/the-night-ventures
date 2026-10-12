import { loadCoverageState, serializeTree } from './pillars.js'

/** Company Intelligence fields given to the Advisor, in reading order. */
const CI_FIELDS = [
  ['domain', 'Domain'],
  ['product_name', 'Product'],
  ['legal_name', 'Legal name'],
  ['location_markets', 'Location / markets'],
  ['company_stage', 'Company stage'],
  ['abstract', 'Abstract'],
  ['short_description', 'Short description'],
  ['medium_description', 'Medium description'],
  ['long_description', 'Long description'],
  ['target_audience', 'Target audience'],
  ['customer_problem', 'Customer problem'],
  ['trigger_moment', 'Trigger moment'],
  ['buying_criteria', 'Buying criteria'],
  ['how_it_works', 'How it works'],
  ['customer_outcome', 'Customer outcome'],
  ['business_model', 'Business model'],
  ['commercial_model', 'Commercial model'],
  ['core_value_proposition', 'Core value proposition'],
  ['differentiation', 'Differentiation'],
  ['scope_boundaries', 'Scope boundaries'],
  ['market_category', 'Market category'],
  ['competitive_position', 'Competitive position'],
  ['market_dynamics', 'Market dynamics'],
  ['messaging_hierarchy', 'Messaging hierarchy'],
  ['reasons_to_believe', 'Reasons to believe'],
  ['results_proof', 'Results / proof'],
  ['trust_signals', 'Trust signals'],
  ['brand_voice', 'Brand voice'],
  ['marketing_objectives', 'Marketing objectives'],
  ['growth_priorities', 'Growth priorities'],
  ['customer_acquisition', 'Customer acquisition'],
  ['learnings_constraints', 'Learnings / constraints'],
]

const BASE_COLUMNS = [
  'domain',
  'product_name',
  'abstract',
  'short_description',
  'medium_description',
  'long_description',
  'target_audience',
  'business_model',
  'core_value_proposition',
  'scope_boundaries',
  'brand_voice',
  'services',
  'competitors',
]

const INTELLIGENCE_COLUMNS = CI_FIELDS.map(([key]) => key).filter(
  (key) => !BASE_COLUMNS.includes(key)
)

async function loadProfile(supabase, companyId) {
  const full = await supabase
    .from('company_profiles')
    .select([...BASE_COLUMNS, ...INTELLIGENCE_COLUMNS].join(', '))
    .eq('company_id', companyId)
    .maybeSingle()
  if (!full.error) return full.data || {}
  // Older schema without the Company Intelligence columns.
  if (/column/i.test(full.error.message || '')) {
    const base = await supabase
      .from('company_profiles')
      .select(BASE_COLUMNS.join(', '))
      .eq('company_id', companyId)
      .maybeSingle()
    if (base.error) throw base.error
    return base.data || {}
  }
  throw full.error
}

export async function loadCompanyContext(supabase, companyId) {
  const [companyRes, profile, industriesRes, coverage] = await Promise.all([
    supabase.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
    loadProfile(supabase, companyId),
    supabase
      .from('company_industries')
      .select('industry_id, industries(name)')
      .eq('company_id', companyId),
    loadCoverageState(supabase, companyId),
  ])

  if (companyRes.error) throw companyRes.error
  if (!companyRes.data) {
    const err = new Error('Company not found')
    err.statusCode = 404
    throw err
  }
  if (industriesRes.error) throw industriesRes.error

  return {
    company: companyRes.data,
    profile,
    industries: (industriesRes.data || []).map((row) => row.industries?.name).filter(Boolean),
    pillars: coverage.pillars,
    tree: serializeTree(coverage.pillars, coverage.articles),
  }
}

function listOf(value, format) {
  if (!Array.isArray(value)) return typeof value === 'string' ? value.trim() : ''
  return value.map(format).filter(Boolean).join('; ')
}

function formatCompetitor(c) {
  if (!c) return null
  if (typeof c === 'string') return c.trim() || null
  return [c.name, c.url].filter(Boolean).join(' — ') || null
}

function formatService(s) {
  if (!s) return null
  if (typeof s === 'string') return s.trim() || null
  const name = s.name || s.title || ''
  const desc = s.description || s.summary || ''
  return [name, desc].filter(Boolean).join(': ') || null
}

function formatMetric(item) {
  const parts = []
  if (item.searchVolume != null) parts.push(`vol ${item.searchVolume}`)
  if (item.difficulty != null) parts.push(`KD ${item.difficulty}`)
  if (item.locked) parts.push('LOCKED')
  return parts.length ? ` (${parts.join(', ')})` : ''
}

export function formatTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return '(empty — no Core keywords yet)'
  return tree
    .map((pillar) => {
      const head = `- CORE: ${pillar.keyword}${formatMetric(pillar)}`
      const kids = (pillar.supporting || []).map(
        (item) => `    - supporting: ${item.keyword}${formatMetric(item)}`
      )
      return [head, ...(kids.length ? kids : ['    - (no supporting keywords yet)'])].join('\n')
    })
    .join('\n')
}

function formatCompanyIntelligence({ company, profile, industries }) {
  const p = profile || {}
  const lines = [`Company: ${company?.name || 'Unknown'}`]
  if (industries?.length) lines.push(`Industries: ${industries.join(', ')}`)
  for (const [key, label] of CI_FIELDS) {
    const value = String(p[key] ?? '').trim()
    if (value) lines.push(`${label}: ${value}`)
  }
  const services = listOf(p.services, formatService)
  if (services) lines.push(`Services: ${services}`)
  const competitors = listOf(p.competitors, formatCompetitor)
  if (competitors) lines.push(`Competitors: ${competitors}`)
  return lines.join('\n')
}

const ROLE = `You are the SEO Advisor inside The Night Ventures dashboard. The user is thinking through the SEO keyword strategy for one company, and you are their sparring partner. Your shared goal is to decide which keywords go into the company's keyword tree:

- Core keywords: broad, high-demand topics the site should own. Each becomes a pillar page.
- Supporting keywords: narrower keywords that sit under exactly one Core keyword. Each becomes an article that links to its pillar.

How to work:
- Talk like a sharp senior SEO consultant in a chat: direct, concise, conversational. Engage with the user's ideas and theories, push back when the data disagrees, and say what you would do.
- Ground decisions in data. When a choice depends on search volume, difficulty, or who already ranks, call the data tools yourself without asking. Prefer a few targeted calls over many. Volume and difficulty for candidate keywords are the minimum before recommending them.
- Data honesty: only cite numbers a tool actually returned in this conversation. If a tool fails or returns nothing, say so briefly and carry on with what you have. Never estimate or invent metrics.
- The user sees every tool result in the chat already, so do not paste large tables. Quote the few numbers that matter.
- Each keyword lives in exactly one place in the tree. Never recommend something already in the tree, or a near-duplicate of it (same intent, different wording), because they would compete with each other.
- Fit matters more than volume: a keyword must match what the company actually sells and who it sells to (see Company Intelligence).

Recommending keywords:
- When you strongly recommend a keyword, explain why in your reply, then call recommend_keyword for it. This shows the user an Add button; nothing is saved until they click it. Use it only for firm, data-backed picks, not for every idea you mention. Several calls in one reply are fine, for example 3 to 5 supporting keywords for one Core.
- A supporting keyword must name its Core keyword. If that Core is not in the tree yet, recommend the Core too.
- You cannot add, edit or remove keywords yourself. The user removes keywords in the tree on the left or in Company Intelligence. LOCKED keywords already have articles or planned articles and cannot be removed.

Context:
- Company Intelligence and the current keyword tree are below, and are always up to date. Use them; never ask the user to restate them.
- All data tools run for the research market and language below. If the user wants another market, tell them to switch it in the chat header.`

export function buildSystemPrompt({ company, profile, industries, tree, locale }) {
  return [
    ROLE,
    '',
    `## Research market\n${locale.marketLabel} (Semrush database "${locale.semrushDatabase}"), language: ${locale.languageLabel}`,
    '',
    `## Company Intelligence\n${formatCompanyIntelligence({ company, profile, industries })}`,
    '',
    `## Current keyword tree\n${formatTree(tree)}`,
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* Chat history                                                        */
/* ------------------------------------------------------------------ */

const HISTORY_TOOL_RESULT_CHARS = 3000
const INTERRUPTED = 'Tool call was interrupted; no result is available.'

function userContent(content) {
  if (typeof content === 'string') return content
  if (content?.text != null) return String(content.text)
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

function assistantBlocks(content) {
  if (Array.isArray(content)) {
    return content.filter(
      (b) => b && (b.type !== 'text' || (typeof b.text === 'string' && b.text.length > 0))
    )
  }
  if (content?.text) return [{ type: 'text', text: String(content.text) }]
  return []
}

function compactResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {})
  if (text.length <= HISTORY_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, HISTORY_TOOL_RESULT_CHARS)}… [truncated from an earlier turn]`
}

function pushMessage(out, role, blocks) {
  if (!blocks.length) return
  const last = out[out.length - 1]
  if (last && last.role === role) {
    last.content = [...last.content, ...blocks]
  } else {
    out.push({ role, content: blocks })
  }
}

/**
 * Convert stored chat_messages rows into a valid Anthropic messages array.
 *
 * Repairs history so one bad turn can't break a session: every tool_use gets
 * a tool_result (a synthetic error if it was interrupted), orphan results are
 * dropped, and consecutive same-role messages are merged. Tool results from
 * earlier turns are truncated to keep requests small.
 */
export function messagesFromRows(rows) {
  const out = []
  let pending = [] // tool_use ids awaiting results, in order
  let results = new Map()

  const flush = () => {
    if (pending.length === 0) return
    const blocks = pending.map(
      (id) =>
        results.get(id) || {
          type: 'tool_result',
          tool_use_id: id,
          content: INTERRUPTED,
          is_error: true,
        }
    )
    pushMessage(out, 'user', blocks)
    pending = []
    results = new Map()
  }

  for (const row of rows || []) {
    if (row.role === 'tool') {
      const c = row.content || {}
      const id = c.tool_use_id || c.id
      if (!id || !pending.includes(id)) continue
      const block = {
        type: 'tool_result',
        tool_use_id: id,
        content: compactResult(c.content ?? c),
      }
      if (c.is_error) block.is_error = true
      results.set(id, block)
      continue
    }

    flush()

    if (row.role === 'user') {
      const text = userContent(row.content)
      if (text) pushMessage(out, 'user', [{ type: 'text', text }])
      continue
    }

    if (row.role === 'assistant') {
      const blocks = assistantBlocks(row.content)
      pushMessage(out, 'assistant', blocks)
      pending = blocks.filter((b) => b.type === 'tool_use').map((b) => b.id)
    }
  }
  flush()

  // The API requires the conversation to start with a user turn.
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

