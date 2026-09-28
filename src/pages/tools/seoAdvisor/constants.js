export const PROMPTS = [
  {
    id: 'ideation',
    title: 'Idea check',
    desc: 'Is there something here? Demand, trend, competition, path, verdict.',
    badge: '1',
    mode: 'ideation',
    fields: [
      {
        key: 'seed_topic',
        label: 'Topic or idea',
        ci: false,
        type: 'input',
        placeholder: 'e.g. going off-grid, growing a beard, first marathon',
      },
    ],
    template: (v) =>
      `Idea check: ${v.seed_topic || '(topic)'}.\n\nIs there something here? Give me demand, trend, what we're up against, a clear path in, and a go / cautious / pass verdict.`,
  },
  {
    id: 'core_keywords',
    title: 'Core keywords',
    desc: 'Lock 5–7 pillar keywords, one at a time. Approve each with a button.',
    badge: '2',
    mode: 'core_keywords',
    fields: [
      {
        key: 'seed_topic',
        label: 'Space we are building in',
        ci: false,
        type: 'input',
        placeholder: 'e.g. off-grid living',
      },
      {
        key: 'existing_pillars',
        label: 'Already approved',
        ci: true,
        type: 'textarea',
        readOnly: true,
      },
    ],
    template: (v) =>
      `Let's pick core keywords${v.seed_topic ? ` for ${v.seed_topic}` : ''}. Target 5–7. Propose them one at a time.${v.existing_pillars ? `\n\nAlready approved:\n${v.existing_pillars}` : ''}`,
  },
  {
    id: 'clusters',
    title: 'Clusters',
    desc: 'Up to 5 cluster keywords per core keyword. Pick a core below.',
    badge: '3',
    mode: 'clusters',
    requiresMinPillars: 1,
    fields: [
      {
        key: 'parent_pillar',
        label: 'Core keyword',
        ci: true,
        type: 'input',
        readOnly: true,
      },
      {
        key: 'existing_supporting',
        label: 'Clusters already approved',
        ci: true,
        type: 'textarea',
        readOnly: true,
      },
    ],
    template: (v) =>
      `Clusters for "${v.parent_pillar || '(pick a core keyword)'}". Target 5. Propose them one at a time.${v.existing_supporting ? `\n\nAlready approved:\n${v.existing_supporting}` : ''}`,
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
  'dataforseo_keyword_suggestions',
  'dataforseo_related_keywords',
  'dataforseo_keyword_difficulty',
  'semrush_keyword_difficulty',
  'semrush_keyword_research',
  'semrush_organic_research',
  'dataforseo_keyword_data',
  'moz_keyword_metrics',
])

export const NUMERIC_SORT_COLUMNS = new Set([
  'searchVolume',
  'keywordDifficulty',
  'kd',
  'traffic',
  'position',
  'cpc',
  'competition',
  'competitionIndex',
])
