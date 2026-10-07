// Site URL discovery for page-level audits: sitemap (via robots.txt or Astro
// defaults) + the article library, same-origin only, classified by page kind.

import { extractLocUrls, isXmlSitemap, isSitemapIndex } from '../scan-live-articles/parse.js'
import { originFromUrl } from '../audit-snapshot/domain.js'
import { fetchPage } from './fetchPage.js'
import { normalizeUrl } from './pageFacts.js'

export const MAX_AUDIT_URLS = 150
const MAX_CHILD_SITEMAPS = 10
const MAX_SITEMAP_URLS = 1000

/** Sitemap: directives from a robots.txt body. */
export function sitemapDirectives(robotsText) {
  return String(robotsText || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => /^sitemap\s*:/i.test(l))
    .map((l) => l.replace(/^sitemap\s*:\s*/i, '').trim())
    .filter(Boolean)
}

/**
 * Find and read the site's sitemap(s). Never throws.
 * @param {string} siteUrl
 * @param {{ robotsText?: string }} [options]
 * @returns {Promise<{ sitemapUrl: string | null, urls: string[], childCount: number, errors: string[] }>}
 */
export async function discoverSitemapUrls(siteUrl, options = {}) {
  const origin = originFromUrl(siteUrl)
  const errors = []
  if (!origin) return { sitemapUrl: null, urls: [], childCount: 0, errors: ['Invalid site URL'] }

  let robotsText = options.robotsText
  if (robotsText == null) {
    const robots = await fetchPage(`${origin}/robots.txt`, { accept: 'text/plain,*/*' })
    robotsText = robots.ok ? robots.text : ''
  }
  const candidates = [
    ...sitemapDirectives(robotsText),
    `${origin}/sitemap-index.xml`,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap-0.xml`,
  ]

  for (const candidate of [...new Set(candidates)]) {
    const res = await fetchPage(candidate, { accept: 'application/xml,text/xml,*/*' })
    if (!res.ok || !isXmlSitemap(res.text)) {
      errors.push(`${candidate}: ${res.ok ? 'not a sitemap' : res.error || `HTTP ${res.status}`}`)
      continue
    }
    if (!isSitemapIndex(res.text)) {
      return {
        sitemapUrl: candidate,
        urls: extractLocUrls(res.text).slice(0, MAX_SITEMAP_URLS),
        childCount: 0,
        errors,
      }
    }
    const children = extractLocUrls(res.text).slice(0, MAX_CHILD_SITEMAPS)
    const urls = []
    for (const child of children) {
      const childRes = await fetchPage(child, { accept: 'application/xml,text/xml,*/*' })
      if (!childRes.ok || !isXmlSitemap(childRes.text)) {
        errors.push(`${child}: ${childRes.ok ? 'not a sitemap' : childRes.error || `HTTP ${childRes.status}`}`)
        continue
      }
      urls.push(...extractLocUrls(childRes.text))
      if (urls.length >= MAX_SITEMAP_URLS) break
    }
    return { sitemapUrl: candidate, urls: urls.slice(0, MAX_SITEMAP_URLS), childCount: children.length, errors }
  }

  return { sitemapUrl: null, urls: [], childCount: 0, errors }
}

function collectCoverageUrls(pillars) {
  const pillarUrls = []
  const articleUrls = []
  for (const pillar of Array.isArray(pillars) ? pillars : []) {
    const p = String(pillar?.pillarArticle?.publishedUrl || '').trim()
    if (p) pillarUrls.push(p)
    for (const supporting of Array.isArray(pillar?.supporting) ? pillar.supporting : []) {
      for (const article of Array.isArray(supporting?.plannedArticles) ? supporting.plannedArticles : []) {
        const u = String(article?.publishedUrl || '').trim()
        if (u) articleUrls.push(u)
      }
    }
  }
  return { pillarUrls, articleUrls }
}

/**
 * Classify a URL by path: home, article (/articles/<slug>/), listing (/articles/…), or page.
 * Pillars are identified from content_coverage.
 */
export function classifyUrl(url, pillarSet) {
  if (pillarSet.has(url)) return 'pillar'
  let path = '/'
  try {
    path = new URL(url).pathname
  } catch {
    return 'page'
  }
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length === 0) return 'home'
  if (parts[0] === 'articles') {
    if (parts.length === 1 || /^\d+$/.test(parts[1] || '')) return 'listing'
    if (parts.length === 2) return 'article'
  }
  return 'page'
}

const KIND_ORDER = { home: 0, pillar: 1, page: 2, listing: 3, article: 4 }

/**
 * Build the URL set for page-level audits.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} companyId
 * @param {string} siteUrl
 */
export async function listAuditUrls(supabase, companyId, siteUrl) {
  const origin = originFromUrl(siteUrl)
  const host = origin ? new URL(origin).hostname.replace(/^www\./, '') : ''

  const [sitemap, libraryResult, coverageResult] = await Promise.all([
    discoverSitemapUrls(siteUrl),
    supabase
      .from('generated_articles')
      .select('published_url')
      .eq('company_id', companyId)
      .eq('status', 'published')
      .not('published_url', 'is', null),
    supabase.from('content_coverage').select('pillars').eq('company_id', companyId).maybeSingle(),
  ])
  if (libraryResult.error) throw libraryResult.error
  if (coverageResult.error) throw coverageResult.error

  const { pillarUrls, articleUrls } = collectCoverageUrls(coverageResult.data?.pillars)
  const libraryUrls = (libraryResult.data || []).map((r) => r.published_url)
  const pillarSet = new Set(pillarUrls.map((u) => normalizeUrl(u)).filter(Boolean))

  const sameSite = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '') === host
    } catch {
      return false
    }
  }

  const seen = new Set()
  const entries = []
  const add = (raw, source) => {
    const url = normalizeUrl(raw)
    if (!url || seen.has(url) || !sameSite(url)) return
    seen.add(url)
    entries.push({ url, kind: classifyUrl(url, pillarSet), source })
  }
  if (origin) add(`${origin}/`, 'home')
  for (const u of sitemap.urls) add(u, 'sitemap')
  for (const u of [...pillarUrls, ...libraryUrls, ...articleUrls]) add(u, 'library')

  entries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  return {
    urls: entries.slice(0, MAX_AUDIT_URLS),
    totalFound: entries.length,
    capped: entries.length > MAX_AUDIT_URLS,
    sitemap: {
      url: sitemap.sitemapUrl,
      urls: sitemap.urls.map((u) => normalizeUrl(u)).filter(Boolean),
      errors: sitemap.errors,
    },
  }
}
