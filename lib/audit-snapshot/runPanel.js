import { runSemrushPanel } from './sources/semrush.js'
import { runPagespeedPanel } from './sources/pagespeed.js'
import { runMozPanel } from './sources/moz.js'
import { runDataforseoPanel } from './sources/dataforseo.js'
import { runTechnicalPanel } from './sources/technical.js'
import {
  mostRecentPublishedUrl,
  normalizeSiteUrl,
} from './sampleUrl.js'
import { wwwSiteUrl, apexDomain } from './domain.js'

export const PANEL_IDS = [
  'semrush',
  'pagespeed',
  'moz',
  'dataforseo',
  'technical',
]

export const PANEL_META = [
  {
    id: 'semrush',
    label: 'AI Bot Access',
    description: 'robots.txt allow/block (Semrush Domain Overview needs v3 API)',
  },
  { id: 'pagespeed', label: 'PageSpeed Insights', description: 'Mobile + desktop scores' },
  { id: 'moz', label: 'Moz', description: 'Authority metrics + crawl freshness' },
  {
    id: 'dataforseo',
    label: 'DataForSEO',
    description: 'Domain visibility + pillar keyword volumes',
  },
  { id: 'technical', label: 'Technical Checks', description: 'Meta, sitemap, robots, JSON-LD' },
]

const PANEL_TIMEOUT_MS = {
  semrush: 45_000,
  pagespeed: 120_000,
  moz: 45_000,
  dataforseo: 45_000,
  technical: 60_000,
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

export async function resolveSiteUrl(supabase, companyId, explicitUrl) {
  const fromBody = normalizeSiteUrl(explicitUrl)
  if (fromBody) {
    // Prefer www host pattern used throughout this build.
    const www = wwwSiteUrl(fromBody)
    return {
      siteUrl: www || fromBody,
      siteSource: 'explicit',
      apex: apexDomain(fromBody),
    }
  }

  const { data, error } = await supabase
    .from('company_profiles')
    .select('domain')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) throw error

  const www = wwwSiteUrl(data?.domain)
  const normalized = normalizeSiteUrl(data?.domain)
  const siteUrl = www || normalized
  if (!siteUrl) {
    return { siteUrl: null, siteSource: null, apex: null }
  }
  return {
    siteUrl,
    siteSource: 'company_profiles.domain',
    apex: apexDomain(siteUrl),
  }
}

export async function resolveCompanyContext(supabase, companyId) {
  const [profileRes, coverageRes] = await Promise.all([
    supabase
      .from('company_profiles')
      .select('domain, product_name, core_keywords')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('content_coverage')
      .select('pillars')
      .eq('company_id', companyId)
      .maybeSingle(),
  ])

  if (profileRes.error) throw profileRes.error
  if (coverageRes.error) throw coverageRes.error
  const data = profileRes.data
  // content_coverage is the source of truth; the profile column is a mirror.
  const fromCoverage = (Array.isArray(coverageRes.data?.pillars) ? coverageRes.data.pillars : [])
    .map((pillar) => String(pillar?.keyword || '').trim())
    .filter(Boolean)
  return {
    domain: data?.domain || null,
    productName: data?.product_name || null,
    coreKeywords:
      fromCoverage.length > 0
        ? fromCoverage
        : Array.isArray(data?.core_keywords)
          ? data.core_keywords
          : [],
  }
}

export async function resolveSampleUrl(supabase, companyId, explicitUrl) {
  const trimmed = String(explicitUrl || '').trim()
  if (trimmed) {
    return { sampleUrl: trimmed, sampleSource: 'explicit' }
  }

  // Prefer generated_articles library (most recent published, with URL).
  const { data: article, error: articleError } = await supabase
    .from('generated_articles')
    .select('id, title, slug, published_url, published_at')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .not('published_url', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (articleError) throw articleError

  if (article?.published_url) {
    return {
      sampleUrl: article.published_url,
      sampleSource: 'generated_articles',
      sampleTitle: article.title || null,
    }
  }

  // Fallback: content_coverage planned/published URLs.
  const { data: coverage, error: coverageError } = await supabase
    .from('content_coverage')
    .select('pillars')
    .eq('company_id', companyId)
    .maybeSingle()

  if (coverageError) throw coverageError

  const recent = mostRecentPublishedUrl(coverage?.pillars)
  if (!recent) {
    return { sampleUrl: null, sampleSource: null }
  }
  return {
    sampleUrl: recent.url,
    sampleSource: 'content_coverage',
    sampleTitle: recent.title,
  }
}

/**
 * Run a single audit panel. Soft-fails into { ok: false, error }.
 */
export async function runAuditPanel({
  panel,
  siteUrl,
  sampleUrl,
  productName,
  companyName,
  coreKeywords,
}) {
  if (!PANEL_IDS.includes(panel)) {
    return { ok: false, error: `Unknown panel: ${panel}`, panel }
  }

  const timeout = withTimeout(PANEL_TIMEOUT_MS[panel] || 60_000)
  try {
    switch (panel) {
      case 'semrush':
        return await runSemrushPanel({ siteUrl, signal: timeout.signal })
      case 'pagespeed':
        return await runPagespeedPanel({ siteUrl, signal: timeout.signal })
      case 'moz':
        return await runMozPanel({ siteUrl, productName, companyName })
      case 'dataforseo':
        return await runDataforseoPanel({ siteUrl, coreKeywords })
      case 'technical':
        return await runTechnicalPanel({
          siteUrl,
          sampleUrl,
          signal: timeout.signal,
        })
      default:
        return { ok: false, error: `Unhandled panel: ${panel}`, panel }
    }
  } finally {
    timeout.clear()
  }
}

/** Normalize a stored/legacy snapshot into the unified results shape. */
export function normalizeSnapshotResults(row) {
  if (!row) return null
  if (row.results && typeof row.results === 'object') {
    return row.results
  }

  // Legacy shape (pre-multi-source).
  return {
    semrush: row.bot_access
      ? {
          ok: Boolean(row.bot_access?.ok),
          metrics: null,
          botAccess: row.bot_access,
          overviewAvailable: false,
          legacy: true,
        }
      : null,
    pagespeed: {
      ok: Boolean(row.pagespeed_mobile?.ok || row.pagespeed_desktop?.ok),
      mobile: row.pagespeed_mobile || null,
      desktop: row.pagespeed_desktop || null,
      legacy: true,
    },
    moz: null,
    dataforseo: null,
    technical: row.jsonld_check
      ? {
          ok: Boolean(row.jsonld_check?.ok),
          checks: [],
          jsonld: row.jsonld_check,
          legacy: true,
        }
      : null,
  }
}
