export const PROMPTS = [
  {
    id: 'seo_approach',
    title: 'SEO Approach',
    desc: 'Discuss the overall SEO approach and lock a plain-language audience.',
    badge: 'Tool 1',
    mode: 'seo_approach',
    fields: [],
    template: () =>
      `Grab everything you know about this company from Company Intelligence and let's discuss the SEO approach. Use live data tools when they help. If a tool returns empty, unavailable, or errors, say so plainly — never invent metrics. When we agree, give a short approach brief and propose a 3-paragraph audience description (no keywords). Editing or removing a saved audience is done in Company Data, not here.`,
  },
  {
    id: 'general_research',
    title: 'General SEO Research',
    desc: 'Open-ended discovery for a topic — landscape, demand, and where the wins are.',
    fields: [
      {
        key: 'seed_topic',
        label: 'Seed topic',
        ci: false,
        type: 'input',
        placeholder: 'e.g. email marketing',
      },
      { key: 'domain', label: 'Domain', ci: true, type: 'input' },
      { key: 'market', label: 'Target market', ci: true, type: 'input' },
      { key: 'language', label: 'Language', ci: true, type: 'input' },
      { key: 'goal', label: 'Business goal', ci: true, type: 'textarea' },
    ],
    template: (v) =>
      `Run general SEO research for the topic ${v.seed_topic || '(topic)'} on ${v.domain || '(domain)'}, targeting ${v.market || 'United States'} in ${v.language || 'English'}.

Goal: ${v.goal || '(not set)'}

Map the demand landscape, classify search intent, and surface the highest-opportunity keywords we should build around. Flag anything that overlaps our existing pillars.`,
  },
  {
    id: 'pillar_advisory',
    title: 'Pillar Advisory',
    desc: 'Land 4–8 high-volume pillar keywords from the target audience.',
    badge: 'Tool 2',
    mode: 'pillar_advisory',
    requiresAudience: true,
    fields: [
      {
        key: 'target_audience',
        label: 'Target audience',
        ci: true,
        type: 'textarea',
        readOnly: true,
      },
      {
        key: 'existing_pillars',
        label: 'Existing pillars',
        ci: true,
        type: 'textarea',
        readOnly: true,
      },
    ],
    template: (v) =>
      `Using this company's target audience and Company Intelligence, help us land 4–8 pillar keywords. High search volume is the priority; high competition is acceptable. Pull live volume and difficulty. If a tool returns empty, unavailable, or errors, say so plainly — never invent volumes or difficulty. Saves are add-only; editing or removing pillars is done in Company Data.

Target audience:
${v.target_audience || '(not set)'}

Existing pillars (locked ones already have content and cannot be removed or renamed):
${v.existing_pillars || '(none saved)'}`,
  },
  {
    id: 'cluster_advisory',
    title: 'Cluster Advisory',
    desc: 'Find 3–5 supporting keywords under one saved pillar.',
    badge: 'Tool 3',
    mode: 'cluster_advisory',
    requiresMinPillars: 4,
    fields: [
      {
        key: 'target_audience',
        label: 'Target audience',
        ci: true,
        type: 'textarea',
        readOnly: true,
      },
      {
        key: 'parent_pillar',
        label: 'Chosen pillar',
        ci: true,
        type: 'input',
        readOnly: true,
      },
      {
        key: 'existing_supporting',
        label: 'Existing supporting keywords',
        ci: true,
        type: 'textarea',
        readOnly: true,
      },
    ],
    template: (v) =>
      `Focus only on the pillar “${v.parent_pillar || '(pick a pillar)'}”. Using the target audience and Company Intelligence, find 3–5 strong supporting keywords for this pillar. Pull live volume and difficulty. If a tool returns empty, unavailable, or errors, say so plainly — never invent volumes or difficulty. Do not re-suggest keywords already under it. Saves are add-only; editing or removing clusters is done in Company Data.

Target audience:
${v.target_audience || '(not set)'}

Existing supporting keywords (locked ones already have content and cannot be removed or renamed):
${v.existing_supporting || '(none yet)'}`,
  },
]

function formatExistingPillars(ci) {
  const pillars = Array.isArray(ci?.pillars) ? ci.pillars : []
  if (pillars.length === 0) return ''
  return pillars
    .map((pillar) => {
      const keyword = pillar.keyword || pillar.slug || ''
      return pillar.locked ? `${keyword} (locked)` : keyword
    })
    .filter(Boolean)
    .join('\n')
}

export function defaultPromptValues(prompt, ci) {
  const profile = ci || {}
  const pillars = Array.isArray(profile.core_keywords)
    ? profile.core_keywords.filter(Boolean).join(', ')
    : ''
  const goal =
    String(profile.growth_priorities || '').trim() ||
    String(profile.marketing_objectives || '').trim()
  const defaults = {
    seed_topic: '',
    domain: profile.domain || '',
    market: profile.location_markets || 'United States',
    language: 'English',
    goal,
    theme: '',
    exclude_pillars: pillars,
    parent_pillar: '',
    cluster_size: '10–15',
    target_audience: profile.target_audience || '',
    existing_pillars: formatExistingPillars(profile),
    parent_pillar: profile.parent_pillar || '',
    existing_supporting: profile.existing_supporting || '',
  }
  const values = {}
  for (const field of prompt.fields || []) {
    values[field.key] = defaults[field.key] ?? ''
  }
  return values
}

export const KEYWORD_STAR_TOOLS = new Set([
  'semrush_keyword_research',
  'semrush_organic_research',
  'dataforseo_keyword_data',
  'moz_keyword_metrics',
])

export const NUMERIC_SORT_COLUMNS = new Set([
  'searchVolume',
  'keywordDifficulty',
  'traffic',
  'position',
  'cpc',
  'competition',
  'competitionIndex',
])
