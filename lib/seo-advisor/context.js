import {
  MAX_CORE_KEYWORDS,
  MAX_SUPPORTING_PER_CORE,
  loadCoverageState,
  serializeTree,
} from './pillars.js'
import {
  SEO_AUTHORITY_COLUMN,
  SEO_CONTROL_FIELDS,
  SEO_NEW_TEXT_COLUMNS,
  formatSeoAuthority,
  listItems,
} from './seoControls.js'
import { formatProgress } from './nextStep.js'

/** SEO Controls: read first. Gate inputs for keyword suggestions. */
const SEO_FIELDS = SEO_CONTROL_FIELDS.map((field) => [field.key, field.label])

/** Business fields given to the Advisor, in reading order. */
const CI_FIELDS = [
  ['domain', 'Domain'],
  ['product_name', 'Product'],
  ['location_markets', 'Markets served'],
  ['abstract', 'Abstract'],
  ['short_description', 'What we do'],
  ['long_description', 'Story & mission'],
  ['business_model', 'Business model'],
  ['core_value_proposition', 'Core value proposition'],
  ['differentiation', 'Differentiation'],
  ['market_category', 'Market & category'],
  ['how_it_works', 'How it works'],
  ['brand_voice', 'Voice & tone'],
]

const BASE_COLUMNS = [
  'domain',
  'product_name',
  'abstract',
  'short_description',
  'long_description',
  'target_audience',
  'business_model',
  'core_value_proposition',
  'scope_boundaries',
  'brand_voice',
  'services',
  'competitors',
]

const INTELLIGENCE_COLUMNS = ['location_markets', 'differentiation', 'market_category', 'how_it_works']

const SEO_COLUMNS = [...SEO_NEW_TEXT_COLUMNS, SEO_AUTHORITY_COLUMN]

export async function loadProfile(supabase, companyId) {
  const withSeo = await supabase
    .from('company_profiles')
    .select([...BASE_COLUMNS, ...INTELLIGENCE_COLUMNS, ...SEO_COLUMNS].join(', '))
    .eq('company_id', companyId)
    .maybeSingle()
  if (!withSeo.error) return withSeo.data || {}
  if (!/column/i.test(withSeo.error.message || '')) throw withSeo.error
  // SEO Controls migration (065) not run yet.
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
  if (item.spec?.status) parts.push(`status ${item.spec.status}`)
  const messages = Array.isArray(item.spec?.keyMessages) ? item.spec.keyMessages.length : 0
  if (messages) parts.push(`${messages} key messages`)
  if (item.locked) parts.push('LOCKED')
  return parts.length ? ` (${parts.join(', ')})` : ''
}

export function formatTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) return '(empty — no Core keywords yet)'
  return tree
    .map((pillar) => {
      const count = (pillar.supporting || []).length
      const head = `- CORE: ${pillar.keyword}${formatMetric(pillar)} [${count}/${MAX_SUPPORTING_PER_CORE} supporting]`
      const kids = (pillar.supporting || []).map(
        (item) => `    - supporting: ${item.keyword}${formatMetric(item)}`
      )
      return [head, ...(kids.length ? kids : ['    - (no supporting keywords yet)'])].join('\n')
    })
    .join('\n')
}

function formatSeoControls(profile) {
  const p = profile || {}
  const lines = []
  for (const [key, label] of SEO_FIELDS) {
    const field = SEO_CONTROL_FIELDS.find((item) => item.key === key)
    const raw = String(p[key] ?? '').trim()
    if (!raw) {
      lines.push(`${label}: (not set)`)
    } else if (field?.list) {
      lines.push(`${label}:`, ...listItems(raw).map((item) => `- ${item}`))
    } else {
      lines.push(`${label}: ${raw}`)
    }
  }
  const authority = formatSeoAuthority(p.seo_authority)
  lines.push(`Domain strength: ${authority || '(not checked yet — check it with moz_domain_metrics on the company domain)'}`)
  return lines.join('\n')
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
  if (competitors) lines.push(`Business competitors: ${competitors}`)
  return lines.join('\n')
}

const ROLE = `You are the SEO Advisor inside The Night Ventures dashboard. The user is building the SEO keyword map for one company, and you are their sparring partner. Every keyword in the map becomes exactly one article:

- Core keywords: broad, high-demand topics the site should own. Each becomes one pillar article. A site has 4 to 7 Core keywords (hard limit ${MAX_CORE_KEYWORDS}).
- Supporting keywords: narrower keywords under exactly one Core keyword. Each becomes one article that links to its pillar. Up to ${MAX_SUPPORTING_PER_CORE} per Core; there is no minimum, and 4 to 8 is typical.
- Secondary keywords are variants used inside an article. They never get their own article.

How to work:
- Start from SEO Controls (below). The primary offer, target searcher and problems before buying decide what is worth targeting; out-of-scope topics are off limits. Business context is background.
- Talk like a sharp senior SEO consultant in a chat: direct, concise, conversational. Engage with the user's ideas, push back when the data disagrees, and say what you would do.
- Ground decisions in data. When a choice depends on search volume, difficulty, or who already ranks, call the data tools yourself without asking. Prefer a few targeted calls over many. Volume and difficulty for candidate keywords are the minimum before recommending them.
- Data honesty: only cite numbers a tool actually returned in this conversation. If a tool fails or returns nothing, say so briefly and carry on with what you have. Never estimate or invent metrics.
- The user sees every tool result in the chat already, so do not paste large tables. Quote the few numbers that matter.
- One search intent = one URL. Never recommend something already in the map, or a near-duplicate of it (same intent, different wording): the two articles would compete. Two keywords that share 4+ of their Google top 10 are one keyword. Run dataforseo_serp_overlap on a candidate before recommending it whenever it might overlap the map; if it comes back "same", don't recommend it — suggest covering it as a secondary keyword in the matching article. The Add button runs the same check and blocks same-results keywords.
- Fit matters more than volume: a keyword must lead to the primary offer and match the target searcher.

What to do next:
- If the map has fewer than 4 Core keywords, work on Core keywords first: propose 5 to 7 candidates, each with its reasoning, and let the user confirm them one by one.
- Then go Core by Core and propose Supporting keywords for one Core at a time. Say which Core you are working on and how many it already has.
- The user can stop at any point and come back later; the map below shows where things stand. When a chat starts, say in one line where the map is and what you suggest doing next.

Recommending keywords:
- When you strongly recommend a keyword, explain why in your reply, then call recommend_keyword for it. This shows the user an Add button; nothing is saved until they click it. Use it only for firm, data-backed picks. Several calls in one reply are fine.
- Every recommendation carries a draft article spec: an angle (one sentence: what the article argues or answers, for whom) and 3 to 5 key messages (the points the article must make, drawn from SEO Controls and Company Intelligence, never invented facts). The user edits them before or after adding.
- For supporting keywords also give a format (guide, how-to, comparison, list, template, explainer) and any secondary keywords the article should cover.
- A supporting keyword must name its Core keyword. If that Core is not in the map yet, recommend the Core too.
- You cannot add, edit or remove keywords yourself. The user does that in the map on the left or in Company Intelligence. LOCKED keywords already have articles and cannot be removed.

Context:
- SEO Controls, Company Intelligence and the current keyword map are below, and are always up to date. Use them; never ask the user to restate them.
- All data tools run for the research market and language below. If the user wants another market, tell them to switch it in the chat header.`

export function buildSystemPrompt({ company, profile, industries, tree, locale, nextStep }) {
  return [
    ROLE,
    '',
    `## Research market\n${locale.marketLabel} (Semrush database "${locale.semrushDatabase}"), language: ${locale.languageLabel}`,
    '',
    `## SEO Controls\n${formatSeoControls(profile)}`,
    '',
    `## Company Intelligence\n${formatCompanyIntelligence({ company, profile, industries })}`,
    '',
    `## Current keyword map\n${formatTree(tree)}`,
    ...(nextStep
      ? [
          '',
          `## Where the map stands\n${formatProgress(nextStep.progress)}\nSuggested next step: ${nextStep.title}. ${nextStep.detail}\nIn a new chat, open with one line on where the map stands and this next step, unless the user has asked something specific.`,
        ]
      : []),
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

