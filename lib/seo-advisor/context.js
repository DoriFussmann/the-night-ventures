import {
  keywordLabel,
  loadCoverageState,
  serializeCoverageState,
  slugifyKeyword,
} from './pillars.js'
import { KNOWN_TOOL_NAMES } from './tools.js'

export async function loadCompanyContext(supabase, companyId) {
  const [companyRes, profileRes, industriesRes, coverage] = await Promise.all([
    supabase.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
    supabase
      .from('company_profiles')
      .select(
        'domain, abstract, short_description, medium_description, long_description, services, competitors, target_audience, core_keywords, supporting_keywords, product_name'
      )
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('company_industries')
      .select('industry_id, industries(name)')
      .eq('company_id', companyId),
    loadCoverageState(supabase, companyId).catch((err) => {
      console.error('Failed to load content coverage for advisor:', err)
      return { pillars: [], lockedSlugs: [], articles: [] }
    }),
  ])

  if (companyRes.error) throw companyRes.error
  if (!companyRes.data) {
    const err = new Error('Company not found')
    err.statusCode = 404
    throw err
  }
  if (profileRes.error) throw profileRes.error
  if (industriesRes.error) throw industriesRes.error

  const industries = (industriesRes.data || [])
    .map((row) => row.industries?.name)
    .filter(Boolean)

  const coverageState = serializeCoverageState(coverage)
  return {
    company: companyRes.data,
    profile: profileRes.data || {},
    industries,
    coveragePillars: coverageState.pillars,
    lockedSlugs: coverageState.lockedSlugs,
  }
}

function formatKeywordList(value) {
  if (!Array.isArray(value) || value.length === 0) return '(not set)'
  const labels = value
    .map((item) => {
      if (!item) return null
      if (typeof item === 'string') return item.trim() || null
      if (typeof item === 'object') {
        const label = item.keyword || item.term || item.name
        return typeof label === 'string' && label.trim() ? label.trim() : null
      }
      return null
    })
    .filter(Boolean)
  return labels.length ? labels.join(', ') : '(not set)'
}

/**
 * Stage aliases: older clients send the v2 mode names.
 */
const MODE_ALIASES = {
  seo_approach: 'ideation',
  pillar_advisory: 'core_keywords',
  cluster_advisory: 'clusters',
}

export function normalizeMode(mode) {
  const m = String(mode || '').trim()
  return MODE_ALIASES[m] || m
}

// No persona line on purpose. "You are an SEO master" adds ~nothing; what
// changes output is the job, the decision criteria, the process and the
// constraints. That is what this prompt spends its words on.
const BASE = [
  'Job: help this team decide what to build for organic search and which keywords to build it on. Talk like a sharp senior colleague: direct, short, opinionated, no filler, no generic SEO lectures.',
  '',
  'LIVE DATA',
  '- You cannot call SEO APIs directly. request_data hands a data question to a data agent that knows every connected endpoint (Semrush, DataForSEO, Moz), picks the right ones, calls them and returns compact results.',
  '- Before answering, ask: would a real number (volume, trend, organic difficulty, who ranks, domain authority) make this answer materially stronger or change the recommendation? If yes, call request_data first. If the question is conceptual (what a pillar page is, how intent works), just answer.',
  '- Make requests precise and batched: one request can carry up to ~20 keywords for volume/trend and 100 for difficulty. 1–2 good requests beat many small ones.',
  '- Only cite numbers that request_data returned. If data is missing or a provider failed, say so in one line and keep going.',
  '- "Difficulty"/"KD" means organic keyword difficulty (0–100). Ads competition is not difficulty — never present it as such.',
  '- The UI shows full data tables in a side panel. Do not paste big tables; cite the few numbers that matter.',
  '',
  'Saves are add-only here. Editing or removing saved keywords is done in Company Intelligence.',
]

function stageInstructions(mode, { coveragePillars = [], focusPillar }) {
  if (mode === 'ideation') {
    return [
      'STAGE 1 — IDEA CHECK: "is there something here?"',
      'The user brings a topic or a site idea (e.g. a site about beards, marathon training, going off-grid). Answer five questions, each grounded in data:',
      '1. Demand — how many people search this space (head terms + combined volume of the top related terms)?',
      '2. Trend — rising, flat or falling over 12 months?',
      '3. Competition — who ranks today, how strong are they (authority), are there weak results (forums, thin pages) in the top 10?',
      '4. Clear path — which angle or sub-niche could a new/small site realistically win first?',
      '5. Verdict — go / go with caution / pass, and the single next step.',
      'Process: expand the idea yourself into 10–20 candidate head terms; request volume + trend + KD for them in one request; then SERP + domain authority for the 1–3 biggest terms.',
      '"Not much here" is a valid, useful answer. Do not oversell.',
      'Finish: write the answer in chat (one short section per question), then call ideation_verdict with the same content. If go/cautious, offer to move to core keywords.',
    ]
  }

  if (mode === 'core_keywords') {
    const n = coveragePillars.length
    return [
      `STAGE 2 — CORE KEYWORDS (pillars). Goal: 5–7. Approved so far: ${n}.`,
      'A core keyword anchors one pillar article and ~5 cluster articles under it.',
      'Criteria, in order: (1) meaningful volume; (2) a distinct sub-topic — two cores must not compete for the same SERP; (3) intent fits the business/audience; (4) difficulty realistic for this domain — a high-KD core is fine only if its clusters are winnable.',
      'Work ONE keyword at a time:',
      '- if you have no candidate pool yet, request volume + KD for 15–25 candidates in one go, then pick the best not-yet-approved one;',
      '- write 2–4 lines in chat: why this one, the numbers, the risk;',
      '- call propose_core_keyword and STOP. The user approves or skips with a button.',
      'When the user approves or skips, propose the next. At 5–7 approved, say the set is solid and suggest moving to clusters. Beyond 7 only if the user asks.',
    ]
  }

  if (mode === 'clusters') {
    const core = focusPillar
    const have = Array.isArray(core?.supporting) ? core.supporting.length : 0
    return [
      `STAGE 3 — CLUSTERS for core keyword "${keywordLabel(core) || '(none chosen)'}". Goal: 5. Approved so far: ${have}.`,
      'Each cluster = one supporting article that links up to the pillar.',
      'Criteria: clearly a sub-question of the core; distinct intent from the pillar and from sibling clusters (no cannibalization); lower KD than the core preferred; verified volume > 0.',
      'Same flow: if no candidate pool yet, request volume + KD for 15–25 candidates in one go; pick the best; 2–3 lines in chat; call propose_cluster_keyword and STOP.',
      `At ${5} approved, say so and suggest the core keyword with the fewest clusters. Only work on the core named above; the user switches cores in the UI.`,
    ]
  }

  return [
    'No stage active — open conversation. Answer the question. Use request_data when numbers would strengthen the answer.',
    'Call save_insight for durable, actionable findings. Set conflicts_with_profile when data contradicts the profile, with profile_field + suggested_value.',
  ]
}

function formatCoveragePillars(pillars, lockedSlugs = []) {
  const list = Array.isArray(pillars) ? pillars : []
  if (list.length === 0) return '(none saved)'
  const locked = new Set(lockedSlugs)
  return list
    .map((pillar) => {
      const keyword = keywordLabel(pillar) || '(unnamed)'
      const slug = slugifyKeyword(pillar.slug || pillar.keyword)
      const tag = locked.has(slug) ? ', has content' : ''
      const n = Array.isArray(pillar.supporting) ? pillar.supporting.length : 0
      return `${keyword} [${n}/5 clusters${tag}]`
    })
    .join('; ')
}

function formatFocusPillar(pillar) {
  if (!pillar) return '(none chosen — ask the user to pick a pillar first)'
  const keyword = keywordLabel(pillar) || '(unnamed)'
  const slug = pillar.slug || slugifyKeyword(pillar.keyword)
  const supporting = Array.isArray(pillar.supporting) ? pillar.supporting : []
  if (supporting.length === 0) {
    return `${keyword} [${slug}] — existing supporting: (none)`
  }
  const items = supporting
    .map((item) => {
      const label = keywordLabel(item) || '(unnamed)'
      return item.locked ? `${label} [LOCKED]` : label
    })
    .join('; ')
  return `${keyword} [${slug}] — existing supporting: ${items}`
}

export function buildSystemPrompt({
  company,
  profile,
  industries,
  mode,
  coveragePillars,
  lockedSlugs,
  focusPillar,
}) {
  const p = profile || {}
  const competitors = Array.isArray(p.competitors)
    ? p.competitors
        .map((c) => {
          if (!c) return null
          if (typeof c === 'string') return c
          const name = c.name || ''
          const url = c.url || ''
          return [name, url].filter(Boolean).join(' — ')
        })
        .filter(Boolean)
    : []

  const services = Array.isArray(p.services)
    ? p.services
        .map((s) => {
          if (!s) return null
          if (typeof s === 'string') return s
          return s.name || s.title || JSON.stringify(s)
        })
        .filter(Boolean)
    : typeof p.services === 'string'
      ? [p.services]
      : []

  const stage = normalizeMode(mode)
  const lines = [
    ...BASE,
    '',
    ...stageInstructions(stage, { coveragePillars, focusPillar }),
    '',
    '## Company context',
    `Name: ${company?.name || 'Unknown'}`,
    `Domain: ${p.domain || '(not set)'}`,
    `Product: ${p.product_name || '(not set)'}`,
    `Industries: ${industries?.length ? industries.join(', ') : '(none tagged)'}`,
    `Target audience: ${p.target_audience || '(not set)'}`,
    `Abstract: ${p.abstract || '(not set)'}`,
    `Short description: ${p.short_description || '(not set)'}`,
    `Medium description: ${p.medium_description || '(not set)'}`,
    `Long description: ${p.long_description || '(not set)'}`,
    `Services: ${services.length ? services.join('; ') : '(not set)'}`,
    `Competitors (profile): ${competitors.length ? competitors.join('; ') : '(not set)'}`,
    `Core keywords: ${formatKeywordList(p.core_keywords)}`,
    `Supporting keywords: ${formatKeywordList(p.supporting_keywords)}`,
    `Approved core keywords (with cluster counts): ${formatCoveragePillars(coveragePillars, lockedSlugs)}`,
  ]

  if (stage === 'clusters') {
    lines.push(`Active core keyword: ${formatFocusPillar(focusPillar)}`)
  }

  return lines.join('\n')
}

/**
 * Convert stored chat_messages rows into an Anthropic messages array.
 * Tool calls to tools that no longer exist (older sessions used raw provider
 * tools) are replayed as plain text so reopened sessions keep working.
 */
export function messagesFromRows(rows, knownTools = KNOWN_TOOL_NAMES) {
  const out = []
  let pendingToolResults = []
  let pendingText = []
  const legacy = new Map()

  const flushTools = () => {
    if (pendingToolResults.length === 0 && pendingText.length === 0) return
    out.push({ role: 'user', content: [...pendingToolResults, ...pendingText] })
    pendingToolResults = []
    pendingText = []
  }

  const clip = (v, n) => {
    const t = typeof v === 'string' ? v : JSON.stringify(v ?? {})
    return t.length > n ? `${t.slice(0, n)}…` : t
  }

  for (const row of rows || []) {
    const role = row.role
    const content = row.content

    if (role === 'user') {
      flushTools()
      if (typeof content === 'string') {
        out.push({ role: 'user', content })
      } else if (content?.text != null) {
        out.push({ role: 'user', content: String(content.text) })
      } else if (Array.isArray(content)) {
        out.push({ role: 'user', content })
      } else {
        out.push({ role: 'user', content: JSON.stringify(content) })
      }
      continue
    }

    if (role === 'assistant') {
      flushTools()
      let blocks
      if (Array.isArray(content)) blocks = content
      else if (content?.text != null) blocks = [{ type: 'text', text: String(content.text) }]
      else blocks = [{ type: 'text', text: JSON.stringify(content) }]

      blocks = blocks.map((b) => {
        if (b?.type !== 'tool_use' || knownTools.has(b.name)) return b
        legacy.set(b.id, b.name)
        return { type: 'text', text: `[Earlier data call: ${b.name} ${clip(b.input, 200)}]` }
      })
      blocks = blocks.filter((b) => b.type !== 'text' || String(b.text || '').trim())
      if (blocks.length === 0) blocks = [{ type: 'text', text: '(no content)' }]
      out.push({ role: 'assistant', content: blocks })
      continue
    }

    if (role === 'tool') {
      const id = content?.tool_use_id || content?.id
      const payload = content?.content ?? content ?? {}
      if (legacy.has(id)) {
        pendingText.push({
          type: 'text',
          text: `[Result of earlier ${legacy.get(id)}: ${clip(payload, 1500)}]`,
        })
        continue
      }
      const block = {
        type: 'tool_result',
        tool_use_id: id,
        content: typeof payload === 'string' ? payload : JSON.stringify(payload),
      }
      if (content?.is_error) block.is_error = true
      pendingToolResults.push(block)
    }
  }

  flushTools()
  return out
}
