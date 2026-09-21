export const PROMPTS = [
  {
    id: 'general_research',
    title: 'General SEO Research',
    desc: 'Open-ended discovery for a topic — landscape, demand, and where the wins are.',
    badge: 'Start here',
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
    id: 'pillar_selection',
    title: 'Pillar keyword selection',
    desc: 'Find the 1–3 broad, high-authority terms a new content pillar should own.',
    fields: [
      {
        key: 'theme',
        label: 'Pillar theme',
        ci: false,
        type: 'input',
        placeholder: 'broad theme',
      },
      { key: 'domain', label: 'Domain', ci: true, type: 'input' },
      { key: 'market', label: 'Target market', ci: true, type: 'input' },
      {
        key: 'exclude_pillars',
        label: 'Existing pillars (exclude)',
        ci: true,
        type: 'input',
        readOnly: true,
      },
    ],
    template: (v) =>
      `Recommend pillar keywords for a new content pillar around ${v.theme || '(theme)'} on ${v.domain || '(domain)'} in ${v.market || 'United States'}.

We already own these pillars — do not re-suggest them: ${v.exclude_pillars || '(none)'}.

Prioritise broad terms with enough authority headroom that we can realistically rank, and explain the trade-off between volume and difficulty for each.`,
  },
  {
    id: 'cluster_selection',
    title: 'Cluster keyword selection',
    desc: 'Build the supporting cluster of mid- and long-tail terms under a chosen pillar.',
    fields: [
      {
        key: 'parent_pillar',
        label: 'Parent pillar',
        ci: false,
        type: 'input',
        placeholder: 'chosen pillar',
      },
      { key: 'domain', label: 'Domain', ci: true, type: 'input' },
      {
        key: 'cluster_size',
        label: 'Cluster size',
        ci: false,
        type: 'select',
        options: ['6–10', '10–15', '15–25'],
      },
    ],
    template: (v) =>
      `Build a supporting keyword cluster under the pillar ${v.parent_pillar || '(pillar)'} for ${v.domain || '(domain)'}.

Return roughly ${v.cluster_size || '10–15'} mid- and long-tail terms grouped by sub-intent, each mapped to a content angle. Note where a term could cannibalise an existing page.`,
  },
]

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
