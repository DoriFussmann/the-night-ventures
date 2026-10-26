/**
 * SEO Controls: the inputs the SEO Advisor needs before it suggests Core
 * keywords. Shared by the Company Intelligence form, the Advisor gate
 * (browser and server) and the SEO brief export/import.
 *
 * Pure module: no I/O, safe in the browser bundle and in API routes.
 */

export const SEO_BRIEF_MARKER = '<!-- tnv-seo-brief v1 -->'
export const MIN_BUYER_PROBLEMS = 4
export const MAX_BUYER_PROBLEMS = 7

/** Text columns on company_profiles that SEO Controls edits. */
export const SEO_CONTROL_FIELDS = [
  {
    key: 'seo_primary_offer',
    label: 'Primary offer',
    required: true,
    rows: 2,
    hint: 'The one thing the content exists to sell. Example: “Done-for-you investor outreach for seed and Series A founders.”',
  },
  {
    key: 'target_audience',
    label: 'Target searcher',
    required: true,
    rows: 3,
    hint: 'Who types the searches: role, stage, situation. Example: “First-time founders raising a seed round, usually without a network of investors.”',
  },
  {
    key: 'seo_buyer_problems',
    label: 'Problems before buying',
    required: true,
    list: true,
    rows: 6,
    hint: `${MIN_BUYER_PROBLEMS}–${MAX_BUYER_PROBLEMS} problems, one per line, in the buyer’s words. Each one is a likely search. Example: “I don’t know which investors fund my stage.”`,
  },
  {
    key: 'seo_conversion_action',
    label: 'Conversion action',
    required: true,
    rows: 1,
    hint: 'What a reader should do after an article. Example: “Book a call.”',
  },
  {
    key: 'seo_commercial_url',
    label: 'Commercial page URL',
    required: true,
    rows: 1,
    hint: 'The page every article links to once. Example: https://www.heyrupert.com/book-call/',
  },
  {
    key: 'seo_content_edge',
    label: 'Content edge',
    required: true,
    rows: 4,
    hint: 'What you know first-hand that competitors can’t copy: experience, data, cases. Articles lean on this.',
  },
  {
    key: 'seo_market',
    label: 'Search market',
    required: true,
    rows: 1,
    hint: 'Country or region you want traffic from. Example: “United States”.',
  },
  {
    key: 'seo_language',
    label: 'Language',
    required: true,
    rows: 1,
    hint: 'Language the articles are written in. Example: “English”.',
  },
  {
    key: 'seo_search_competitors',
    label: 'Search competitors',
    required: false,
    list: true,
    rows: 4,
    hint: 'Sites that rank for your topics, one per line. Often different from business competitors. Leave empty and the Advisor will find them.',
  },
  {
    key: 'scope_boundaries',
    label: 'Out-of-scope topics',
    required: false,
    rows: 3,
    hint: 'Topics you will not write about, even if they get traffic.',
  },
  {
    key: 'seo_publishing_pace',
    label: 'Publishing pace',
    required: false,
    rows: 1,
    hint: 'Realistic articles per month. Example: “4 per month”.',
  },
]

export const SEO_CONTROL_KEYS = SEO_CONTROL_FIELDS.map((field) => field.key)

/** Columns new in migration 065 (target_audience and scope_boundaries already exist). */
export const SEO_NEW_TEXT_COLUMNS = SEO_CONTROL_KEYS.filter(
  (key) => key.startsWith('seo_')
)
export const SEO_AUTHORITY_COLUMN = 'seo_authority'

function text(value) {
  return String(value ?? '').trim()
}

export function listItems(value) {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
}

/** Whether one SEO Controls field counts as done. */
export function seoFieldComplete(field, profile) {
  const value = profile?.[field.key]
  if (field.key === 'seo_buyer_problems') {
    return listItems(value).length >= MIN_BUYER_PROBLEMS
  }
  return Boolean(text(value))
}

/** Gate status for the Advisor. */
export function seoControlsStatus(profile) {
  const required = SEO_CONTROL_FIELDS.filter((field) => field.required)
  const missing = required.filter((field) => !seoFieldComplete(field, profile))
  const filled = SEO_CONTROL_FIELDS.filter((field) => seoFieldComplete(field, profile)).length
  return {
    ready: missing.length === 0,
    requiredTotal: required.length,
    requiredDone: required.length - missing.length,
    filled,
    total: SEO_CONTROL_FIELDS.length,
    missing: missing.map((field) => ({
      key: field.key,
      label: field.label,
      reason:
        field.key === 'seo_buyer_problems' && text(profile?.[field.key])
          ? `Needs at least ${MIN_BUYER_PROBLEMS}, one per line (has ${listItems(profile?.[field.key]).length}).`
          : 'Empty.',
    })),
  }
}

/** Human summary of seo_authority for display and for the Advisor. */
export function formatSeoAuthority(value) {
  const a = value && typeof value === 'object' ? value : null
  if (!a) return ''
  const parts = []
  if (a.domainAuthority != null) parts.push(`Moz Domain Authority ${a.domainAuthority}`)
  if (a.referringDomains != null) parts.push(`${a.referringDomains} linking root domains`)
  if (a.organicKeywords != null) parts.push(`${a.organicKeywords} ranking keywords (Semrush)`)
  if (a.organicTraffic != null) parts.push(`~${a.organicTraffic} organic visits/month (Semrush)`)
  if (!parts.length) return ''
  const when = a.checkedAt ? String(a.checkedAt).slice(0, 10) : ''
  return when ? `${parts.join(', ')} — checked ${when}` : parts.join(', ')
}

function bareDomain(value) {
  return text(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
}

/**
 * Merge a domain-metrics tool result into seo_authority when it is about the
 * company's own domain. Returns the new object, or null when nothing applies.
 */
export function authorityFromToolResult(toolName, result, ownDomain, previous) {
  const own = bareDomain(ownDomain)
  if (!own || !result || result.available === false) return null
  const target = bareDomain(result.target || result.domain)
  if (target !== own) return null
  const m = result.metrics || {}
  const next = { ...(previous && typeof previous === 'object' ? previous : {}) }
  if (toolName === 'moz_domain_metrics') {
    if (m.domainAuthority == null && m.rootDomainsToRootDomain == null) return null
    if (m.domainAuthority != null) next.domainAuthority = m.domainAuthority
    if (m.rootDomainsToRootDomain != null) next.referringDomains = m.rootDomainsToRootDomain
  } else if (toolName === 'semrush_domain_overview') {
    if (m.organicKeywords == null && m.organicTraffic == null) return null
    if (m.organicKeywords != null) next.organicKeywords = Number(m.organicKeywords)
    if (m.organicTraffic != null) next.organicTraffic = Number(m.organicTraffic)
  } else {
    return null
  }
  next.domain = own
  next.checkedAt = new Date().toISOString()
  return next
}

/* ------------------------------------------------------------------ */
/* SEO brief (markdown export / import)                                */
/* ------------------------------------------------------------------ */

const EMPTY_LINE = '_Empty — fill this in._'

/** Business fields included in the brief; text ones can be imported back. */
export const SEO_BRIEF_CONTEXT_FIELDS = [
  { key: 'short_description', label: 'What we do' },
  { key: 'core_value_proposition', label: 'Core value proposition' },
  { key: 'differentiation', label: 'Differentiation' },
  { key: 'how_it_works', label: 'How it works' },
  { key: 'market_category', label: 'Market & category' },
  { key: 'services', label: 'Products & services', readOnly: true },
  { key: 'competitors', label: 'Business competitors', readOnly: true },
]

function formatList(items, format) {
  return (Array.isArray(items) ? items : []).map(format).filter(Boolean).join('\n')
}

function contextValue(field, profile) {
  const value = profile?.[field.key]
  if (field.key === 'services') {
    return formatList(value, (s) => {
      const title = text(s?.title || s?.name)
      const summary = text(s?.summary || s?.description)
      if (!title && !summary) return ''
      return `- ${[title, summary].filter(Boolean).join(': ')}`
    })
  }
  if (field.key === 'competitors') {
    return formatList(value, (c) => {
      const name = text(c?.name)
      const url = text(c?.url)
      if (!name && !url) return ''
      return `- ${[name, url].filter(Boolean).join(' — ')}`
    })
  }
  return text(value)
}

function fieldValue(field, profile) {
  const value = text(profile?.[field.key])
  if (!value) return ''
  return field.list ? listItems(value).map((item) => `- ${item}`).join('\n') : value
}

/**
 * Build the SEO brief markdown: every SEO-relevant field, filled or empty,
 * with instructions for the AI that helps complete it.
 */
export function buildSeoBriefMarkdown({ companyName, domain, profile, keywordTree } = {}) {
  const name = text(companyName) || 'Company'
  const lines = [
    SEO_BRIEF_MARKER,
    `# ${name} — SEO brief`,
    '',
    '## Instructions for the AI helping complete this brief',
    '',
    `You are helping ${name}${text(domain) ? ` (${text(domain)})` : ''} complete its SEO Controls. These inputs decide which keywords the company targets and what its articles say.`,
    '',
    '1. Read the business context first.',
    '2. Ask me questions until you can fill every field marked *required*. Do not invent facts, numbers, customers or results; if you don’t know, ask.',
    `3. "Problems before buying" needs ${MIN_BUYER_PROBLEMS}–${MAX_BUYER_PROBLEMS} lines, one problem per line, in the buyer’s own words.`,
    '4. "Content edge" must be first-hand: experience, data or cases this company really has.',
    '5. Return the whole file in the same format: keep the first line, keep every `###` heading exactly as written, and put the answer directly under its heading. Leave a field as it is if you have nothing better.',
    '',
    'When done, I will upload the file back into Company Intelligence. Every change is shown to me for approval before it is saved.',
    '',
    '## SEO Controls',
    '',
  ]

  for (const field of SEO_CONTROL_FIELDS) {
    lines.push(`### ${field.label}${field.required ? ' *required*' : ''}`)
    lines.push(`> ${field.hint}`)
    lines.push('')
    lines.push(fieldValue(field, profile) || EMPTY_LINE)
    lines.push('')
  }

  lines.push('## Business context', '')
  for (const field of SEO_BRIEF_CONTEXT_FIELDS) {
    lines.push(`### ${field.label}${field.readOnly ? ' (reference only)' : ''}`)
    lines.push('')
    lines.push(contextValue(field, profile) || EMPTY_LINE)
    lines.push('')
  }

  const authority = formatSeoAuthority(profile?.seo_authority)
  lines.push('### Domain strength (reference only)', '')
  lines.push(authority || 'Not checked yet. The SEO Advisor fills this in automatically.')
  lines.push('')

  const tree = Array.isArray(keywordTree) ? keywordTree : []
  lines.push('### Current keyword map (reference only)', '')
  if (tree.length === 0) {
    lines.push('No Core keywords yet.')
  } else {
    for (const pillar of tree) {
      lines.push(`- ${pillar.keyword}`)
      for (const item of pillar.supporting || []) lines.push(`  - ${item.keyword}`)
    }
  }
  lines.push('')

  return lines.join('\n').trim() + '\n'
}

export function isSeoBriefMarkdown(source) {
  return String(source || '').includes(SEO_BRIEF_MARKER)
}

function normalizeHeading(value) {
  return String(value || '')
    .replace(/\*required\*/i, '')
    .replace(/\(reference only\)/i, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const IMPORTABLE = [
  ...SEO_CONTROL_FIELDS.map((field) => ({ ...field, section: 'seo' })),
  ...SEO_BRIEF_CONTEXT_FIELDS.filter((field) => !field.readOnly).map((field) => ({
    ...field,
    section: 'business',
  })),
]

const BY_HEADING = new Map(IMPORTABLE.map((field) => [normalizeHeading(field.label), field]))

function cleanBody(lines, field) {
  const body = lines
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim()
  if (!body) return ''
  if (body.replace(/[_*]/g, '').trim().toLowerCase().startsWith('empty — fill this in')) return ''
  if (field.list) return listItems(body).join('\n')
  return body
}

/**
 * Parse an SEO brief. Returns { values: { key: text } } for every importable
 * field that has a non-empty answer. Empty answers are omitted, so they can
 * never overwrite a filled field.
 */
export function parseSeoBriefMarkdown(source) {
  const values = {}
  let current = null
  let buffer = []
  const flush = () => {
    if (current) {
      const value = cleanBody(buffer, current)
      if (value) values[current.key] = value
    }
    current = null
    buffer = []
  }
  for (const line of String(source || '').replace(/\r\n/g, '\n').split('\n')) {
    const h3 = line.match(/^###\s+(.+?)\s*$/)
    if (h3) {
      flush()
      current = BY_HEADING.get(normalizeHeading(h3[1])) || null
      continue
    }
    if (/^#{1,2}\s/.test(line)) {
      flush()
      continue
    }
    if (current) buffer.push(line)
  }
  flush()
  return { values }
}

/**
 * Field-by-field preview of an import against the current profile.
 * Only fields whose new value differs are returned.
 */
export function seoBriefImportPreview(parsedValues, profile) {
  return IMPORTABLE.filter((field) => parsedValues[field.key] != null)
    .map((field) => {
      const current = text(profile?.[field.key])
      const next = text(parsedValues[field.key])
      const same = field.list
        ? listItems(current).join('\n') === listItems(next).join('\n')
        : current === next
      return {
        key: field.key,
        label: field.label,
        section: field.section,
        current,
        next,
        change: current ? 'replace' : 'fill',
        same,
      }
    })
    .filter((row) => !row.same)
}
