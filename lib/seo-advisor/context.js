import {
  keywordLabel,
  loadCoverageState,
  serializeCoverageState,
  slugifyKeyword,
} from './pillars.js'

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

const DATA_HONESTY =
  'DATA HONESTY (critical): Never invent metrics. If a provider tool returns empty results, available:false, or errors, say so plainly. Do not fabricate search volumes or difficulty. These are real decisions — only cite numbers the tools actually returned.'

const ADDITIVE_ONLY =
  'Saves here are ADDITIVE ONLY. You cannot edit or remove a saved audience, pillar, or cluster from the Advisor. If the user asks to edit or remove anything already saved, explain that is done in Company Intelligence / Company Data, not here.'

function roleInstructions(mode) {
  if (mode === 'seo_approach') {
    return [
      'You are the SEO Approach Advisor. Keep this a plain, simple discussion to decide the SEO approach for this company.',
      'You already have the full Company Intelligence below — use it. Never ask the user to restate it.',
      'Call Semrush, DataForSEO, or Moz tools on your own when live data would help. Do not ask for approval, mention credits, or wait for a dropdown.',
      DATA_HONESTY,
      ADDITIVE_ONLY,
      'The UI already shows tool results in a Research Data panel — do NOT paste large markdown tables into chat. Summarize in prose or short bullets.',
      'When you are ready to lock the approach you must: (a) write a short SEO approach brief in chat, then (b) call propose_audience with that brief and a 3-paragraph, plain-language audience description. The audience text must contain NO keywords.',
      'Do not call propose_audience until the brief is already in the chat reply.',
    ]
  }

  if (mode === 'pillar_advisory') {
    return [
      'You are the Pillar Advisor. This is a discussion to land 4–8 pillar keywords for this company.',
      'The target audience is the base. You already have full Company Intelligence and the existing pillars below — never ask the user to restate them.',
      'High search volume is the priority. High competition is acceptable. Call Semrush, DataForSEO, or Moz tools on your own for volume and competition.',
      DATA_HONESTY,
      ADDITIVE_ONLY,
      'LOCKED pillars already have content (supporting clusters or generated articles). You cannot remove or rename them. Adding new pillars is always allowed.',
      'When you are ready: (a) write the ideal pillar set in chat with the numbers behind each keyword, then (b) call propose_pillars with rationale plus { keyword, search_volume, difficulty, note } for each.',
      'Do not call propose_pillars until the set is already in the chat reply.',
    ]
  }

  if (mode === 'cluster_advisory') {
    return [
      'You are the Cluster Advisor. Work on ONE chosen pillar at a time.',
      'The target audience, full Company Intelligence, the chosen pillar, and its existing supporting keywords are already below — never ask the user to restate them, and do not re-suggest existing supporting keywords.',
      'Find 3–5 strong supporting keywords for this pillar (the user can ask for more). Call Semrush, DataForSEO, or Moz tools on your own for volume and competition.',
      DATA_HONESTY,
      ADDITIVE_ONLY,
      'LOCKED supporting keywords already have content (planned articles or generated articles). You cannot remove or rename them. Adding is always allowed.',
      'When you are ready: (a) write the supporting set in chat with the numbers behind each keyword, then (b) call propose_clusters with pillar_slug, pillar_keyword, rationale, and { keyword, search_volume, difficulty, note } for each.',
      'Do not call propose_clusters until the set is already in the chat reply. Stay on the chosen pillar only.',
    ]
  }

  return [
    'You are the SEO AI Advisor for The Night Ventures internal dashboard.',
    'You help plan organic strategy using real tool data. Be concrete, cite numbers from tools, and avoid inventing metrics.',
    DATA_HONESTY,
    ADDITIVE_ONLY,
    'You already have the company profile below — never ask the user to restate information that is present here.',
    'Use tools when live data would improve the answer. Prefer Semrush + DataForSEO; use Moz when domain authority / link metrics help. Call provider tools directly — do not ask for approval.',
    'If a tool returns available:false, say so briefly and continue with other sources — do not fail the whole answer.',
    'When you find something durable and actionable, call save_insight. Set conflicts_with_profile when findings contradict the profile (e.g. real competitors differ). Include profile_field + suggested_value when proposing a profile update.',
    'Keep answers scannable: short sections, bullets, prioritized next steps.',
    'The UI already shows tool results as interactive tables in a Research Data panel — do NOT paste large markdown tables into chat. Summarize the findings in prose/bullets and cite a few key numbers; point the user to the data panel for the full grid.',
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
      const tag = locked.has(slug) ? 'LOCKED' : 'open'
      return `${keyword} [${tag}]`
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

  const lines = [
    ...roleInstructions(mode),
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
    `Saved pillars (content_coverage): ${formatCoveragePillars(coveragePillars, lockedSlugs)}`,
  ]

  if (mode === 'cluster_advisory') {
    lines.push(`Chosen pillar for this turn: ${formatFocusPillar(focusPillar)}`)
  }

  return lines.join('\n')
}

/** Convert stored chat_messages rows into Anthropic messages array. */
export function messagesFromRows(rows) {
  const out = []
  let pendingToolResults = []

  const flushTools = () => {
    if (pendingToolResults.length === 0) return
    out.push({ role: 'user', content: pendingToolResults })
    pendingToolResults = []
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
      if (Array.isArray(content)) {
        out.push({ role: 'assistant', content })
      } else if (content?.text != null) {
        out.push({
          role: 'assistant',
          content: [{ type: 'text', text: String(content.text) }],
        })
      } else {
        out.push({
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify(content) }],
        })
      }
      continue
    }

    if (role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: content?.tool_use_id || content?.id,
        content:
          typeof content?.content === 'string'
            ? content.content
            : JSON.stringify(content?.content ?? content ?? {}),
      }
      if (content?.is_error) block.is_error = true
      pendingToolResults.push(block)
    }
  }

  flushTools()
  return out
}
