// Audit categories + connection ids. Shared by the server (lib/audit/*) and the
// Audit page (src/pages/tools/audit/*). Plain data only — no Node or DOM APIs.

/** Hard cap on recorded DataForSEO spend per batch (Run all, or a single category run). */
export const BATCH_BUDGET_USD = 2

/**
 * Connection checks shown on page load, in display order.
 * `blocking: false` checks never disable a category (informational only).
 */
export const CONNECTIONS = [
  { id: 'supabase', label: 'Supabase', group: 'API connections', blocking: true },
  { id: 'dataforseo', label: 'DataForSEO', group: 'API connections', blocking: true },
  { id: 'moz', label: 'Moz', group: 'API connections', blocking: true },
  { id: 'pagespeed', label: 'PageSpeed Insights', group: 'API connections', blocking: true },
  { id: 'anthropic', label: 'Anthropic', group: 'API connections', blocking: true },
  { id: 'gsc', label: 'Google Search Console', group: 'API connections', blocking: false },
  { id: 'github', label: 'GitHub repo', group: 'Site connection', blocking: false },
  { id: 'site_home', label: 'Homepage', group: 'Site connection', blocking: true },
  { id: 'site_robots', label: 'robots.txt', group: 'Site connection', blocking: false },
  { id: 'site_sitemap', label: 'Sitemap', group: 'Site connection', blocking: false },
  { id: 'crawler_access', label: 'Crawler access', group: 'Site connection', blocking: true },
  { id: 'hosting', label: 'Hosting', group: 'Site connection', blocking: false },
]

export const CONNECTION_IDS = CONNECTIONS.map((c) => c.id)

/**
 * Scored audit categories, in display order.
 * `needs`: connection ids that must not be failing for the category to run.
 * `implemented`: false until the category ships (shown as "coming next").
 */
export const CATEGORIES = [
  {
    id: 'crawl',
    label: 'Crawl & Indexability',
    short: 'Crawl',
    weight: 20,
    paid: true,
    implemented: true,
    needs: ['dataforseo', 'site_home', 'crawler_access'],
    description:
      'Site-wide crawl: status codes, redirects, canonicals, indexability, duplicates, orphans, sitemap hygiene.',
  },
  {
    id: 'schema',
    label: 'Structured Data',
    short: 'Schema',
    weight: 15,
    paid: false,
    implemented: true,
    needs: ['site_home'],
    description:
      'JSON-LD on every page: Article, author Person, Organization, Breadcrumbs, FAQ, date consistency.',
  },
  {
    id: 'clusters',
    label: 'Cluster Integrity',
    short: 'Clusters',
    weight: 15,
    paid: false,
    implemented: false,
    needs: ['site_home'],
    description: 'Pillar ↔ supporting links, anchors, coverage gaps.',
  },
  {
    id: 'aeo_readiness',
    label: 'AEO Readiness',
    short: 'AEO',
    weight: 15,
    paid: false,
    implemented: false,
    needs: ['site_home'],
    description: 'AI crawler access, extractability, answer-first structure, entity signals.',
  },
  {
    id: 'ai_visibility',
    label: 'AI Visibility',
    short: 'AI Visibility',
    weight: 15,
    paid: true,
    implemented: false,
    needs: ['dataforseo'],
    description: 'AI Overview / AI Mode citations, LLM mentions, share of voice.',
  },
  {
    id: 'speed',
    label: 'Speed',
    short: 'Speed',
    weight: 10,
    paid: false,
    implemented: false,
    needs: ['pagespeed', 'site_home'],
    description: 'Core Web Vitals per template (home, pillar, article).',
  },
  {
    id: 'authority',
    label: 'Authority',
    short: 'Authority',
    weight: 10,
    paid: true,
    implemented: false,
    needs: ['moz'],
    description: 'Domain authority, referring domains, broken backlinks vs competitors.',
  },
]

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id)

export const SEVERITIES = ['critical', 'high', 'medium', 'low']

export const SEVERITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/** @param {string} id */
export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) || null
}

/**
 * Connection ids that are failing and block this category.
 * @param {string} categoryId
 * @param {Record<string, { status?: string }>} connectionResults
 * @returns {string[]}
 */
export function blockingFailures(categoryId, connectionResults) {
  const category = categoryById(categoryId)
  if (!category) return []
  return category.needs.filter((id) => connectionResults?.[id]?.status === 'fail')
}
