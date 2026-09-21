export async function loadCompanyContext(supabase, companyId) {
  const [companyRes, profileRes, industriesRes] = await Promise.all([
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

  return {
    company: companyRes.data,
    profile: profileRes.data || {},
    industries,
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

export function buildSystemPrompt({ company, profile, industries }) {
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
    'You are the SEO AI Advisor for The Night Ventures internal dashboard.',
    'You help plan organic strategy using real tool data. Be concrete, cite numbers from tools, and avoid inventing metrics.',
    'You already have the company profile below — never ask the user to restate information that is present here.',
    'Use tools when live data would improve the answer. Prefer Semrush + DataForSEO; use Moz when domain authority / link metrics help.',
    'If a tool returns available:false, say so briefly and continue with other sources — do not fail the whole answer.',
    'When you find something durable and actionable, call save_insight. Set conflicts_with_profile when findings contradict the profile (e.g. real competitors differ). Include profile_field + suggested_value when proposing a profile update.',
    'Keep answers scannable: short sections, bullets, prioritized next steps.',
    'The UI already shows tool results as interactive tables in a Research Data panel — do NOT paste large markdown tables into chat. Summarize the findings in prose/bullets and cite a few key numbers; point the user to the data panel for the full grid.',
    'Before calling any paid Semrush, DataForSEO, or Moz tool, you MUST call propose_data_pull once and wait for approval. Do not call paid provider tools in the same turn as propose_data_pull.',
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
  ]

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
