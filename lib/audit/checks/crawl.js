// Crawl & Indexability: DataForSEO On-Page crawl results + first-party site checks → issues.

import { randomBytes } from 'node:crypto'
import { fetchPage } from '../fetchPage.js'
import { makeIssue, dedupeIssues } from '../issues.js'
import { normalizeUrl } from '../pageFacts.js'

const CATEGORY = 'crawl'
const LONG_TITLE = 65
const SHORT_DESCRIPTION = 50
const LONG_DESCRIPTION = 165
const MAX_DEPTH = 3

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * First-party checks the crawler can't make reliably:
 * soft 404, http → https, and alternate host (www ↔ apex) canonicalization.
 * @param {string} siteUrl  e.g. https://www.example.com
 */
export async function runSiteChecks(siteUrl) {
  const u = new URL(siteUrl)
  const mainHost = u.hostname.toLowerCase()
  const altHost = mainHost.startsWith('www.') ? mainHost.slice(4) : `www.${mainHost}`
  const probe = `tnv-audit-missing-${randomBytes(4).toString('hex')}`

  const [notFound, http, alt] = await Promise.all([
    fetchPage(`https://${mainHost}/${probe}/`, { timeoutMs: 12_000 }),
    fetchPage(`http://${mainHost}/`, { timeoutMs: 12_000 }),
    fetchPage(`https://${altHost}/`, { timeoutMs: 12_000 }),
  ])

  return {
    notFound: { status: notFound.status, error: notFound.error },
    httpRedirect: {
      status: http.status,
      finalUrl: http.finalUrl,
      endsHttps: String(http.finalUrl || '').startsWith('https://'),
      error: http.error,
    },
    altHost: {
      host: altHost,
      status: alt.status,
      finalHost: hostOf(alt.finalUrl),
      redirected: alt.redirected,
      error: alt.error,
    },
    mainHost,
  }
}

function inbound(item) {
  const v = item?.meta?.inbound_links_count ?? item?.inbound_links_count
  return Number.isFinite(Number(v)) ? Number(v) : null
}

function hasFileExtension(path) {
  return /\.[a-z0-9]{2,5}$/i.test(path)
}

function groupDuplicates(pages, pick) {
  const map = new Map()
  for (const page of pages) {
    const value = String(pick(page) || '').trim().toLowerCase()
    if (!value) continue
    const list = map.get(value) || []
    list.push(page.url)
    map.set(value, list)
  }
  return [...map.values()].filter((urls) => urls.length > 1)
}

/**
 * Build crawl issues + metrics.
 * @param {object} input
 * @param {string} input.siteUrl
 * @param {object | null} input.summary          on_page/summary result row
 * @param {any[]} input.pages                     on_page/pages items
 * @param {any[]} input.nonIndexable              on_page/non_indexable items
 * @param {any[]} input.redirectChains            on_page/redirect_chains items
 * @param {any[] | null} input.brokenLinks        on_page/links (is_broken) items, null if unavailable
 * @param {string[]} input.sitemapUrls            normalized sitemap URLs
 * @param {object | null} input.siteChecks        runSiteChecks() result
 */
export function buildCrawlIssues({
  siteUrl,
  summary,
  pages,
  nonIndexable,
  redirectChains,
  brokenLinks,
  sitemapUrls,
  siteChecks,
}) {
  const issues = []
  const add = (input) => issues.push(makeIssue({ category: CATEGORY, ...input }))
  const sitemap = new Set(sitemapUrls || [])
  const htmlPages = (pages || [])
    .filter((p) => !p?.resource_type || p.resource_type === 'html')
    .map((p) => ({ ...p, url: normalizeUrl(p.url) || p.url }))

  const okPages = htmlPages.filter((p) => Number(p.status_code) >= 200 && Number(p.status_code) < 300)
  const nonIndexableUrls = new Set(
    (nonIndexable || []).map((i) => normalizeUrl(i?.url)).filter(Boolean)
  )
  const indexable = okPages.filter((p) => !nonIndexableUrls.has(p.url))

  // Status codes
  for (const page of htmlPages) {
    const status = Number(page.status_code)
    if (status >= 400) {
      const inSitemap = sitemap.has(page.url)
      add({
        checkId: inSitemap ? 'sitemap_url_error' : 'page_error_status',
        severity: inSitemap || status >= 500 ? 'critical' : 'high',
        title: inSitemap ? 'Sitemap URL returns an error' : 'Page returns an error status',
        detail: `HTTP ${status}${inbound(page) ? ` — linked from ${inbound(page)} page(s)` : ''}`,
        url: page.url,
        evidence: { status, inbound: inbound(page) },
        fixHint: inSitemap
          ? 'Remove the URL from the sitemap or restore the page.'
          : 'Restore the page, or redirect it and update internal links pointing to it.',
      })
    } else if (status >= 300 && status < 400 && (inbound(page) || 0) > 0) {
      add({
        checkId: 'internal_link_to_redirect',
        severity: 'medium',
        title: 'Internal links point to a redirect',
        detail: `HTTP ${status} → ${page.location || 'unknown target'}; linked from ${inbound(page)} page(s)`,
        url: page.url,
        evidence: { status, location: page.location || null, inbound: inbound(page) },
        fixHint: 'Update internal links to point directly at the final URL.',
      })
    }
  }

  // Broken links (link-level, with sources)
  if (Array.isArray(brokenLinks)) {
    const byTarget = new Map()
    for (const link of brokenLinks) {
      const to = normalizeUrl(link?.link_to || link?.page_to)
      if (!to || hostOf(to).replace(/^www\./, '') !== hostOf(siteUrl).replace(/^www\./, '')) continue
      const from = normalizeUrl(link?.link_from || link?.page_from)
      const list = byTarget.get(to) || []
      if (from && list.length < 10) list.push(from)
      byTarget.set(to, list)
    }
    for (const [to, sources] of byTarget) {
      add({
        checkId: 'broken_internal_link',
        severity: 'high',
        title: 'Broken internal link',
        detail: `Linked from ${sources.length} page(s)`,
        url: to,
        evidence: { sources },
        fixHint: 'Fix or remove the links on the source pages, or redirect the target.',
      })
    }
  }

  // Redirect chains / loops
  for (const chainItem of redirectChains || []) {
    const chain = Array.isArray(chainItem?.chain) ? chainItem.chain : []
    const start = normalizeUrl(chain[0]?.from_url || chainItem?.url)
    if (!start) continue
    if (chainItem?.is_redirect_loop) {
      add({
        checkId: 'redirect_loop',
        severity: 'high',
        title: 'Redirect loop',
        url: start,
        evidence: { chain: chain.map((c) => c?.to_url).filter(Boolean).slice(0, 10) },
        fixHint: 'Break the loop so the URL resolves to a single 200 page.',
      })
    } else if (chain.length >= 2) {
      add({
        checkId: 'redirect_chain',
        severity: 'medium',
        title: 'Redirect chain (2+ hops)',
        detail: `${chain.length} hops`,
        url: start,
        evidence: { chain: chain.map((c) => c?.to_url).filter(Boolean).slice(0, 10) },
        fixHint: 'Redirect the first URL straight to the final destination.',
      })
    }
  }

  // Indexability of sitemap URLs
  for (const item of nonIndexable || []) {
    const url = normalizeUrl(item?.url)
    if (!url || !sitemap.has(url)) continue
    add({
      checkId: 'sitemap_url_non_indexable',
      severity: 'high',
      title: 'Sitemap URL is not indexable',
      detail: item?.reason ? `Reason: ${item.reason}` : '',
      url,
      evidence: { reason: item?.reason || null },
      fixHint: 'Either make the page indexable or remove it from the sitemap.',
    })
  }

  // Canonicals
  for (const page of okPages) {
    const canonical = normalizeUrl(page?.meta?.canonical, page.url)
    if (!canonical) {
      add({
        checkId: 'canonical_missing',
        severity: 'medium',
        title: 'Missing canonical tag',
        url: page.url,
        fixHint: 'Add a self-referencing <link rel="canonical"> in the layout head.',
      })
    } else if (canonical !== page.url && sitemap.has(page.url)) {
      add({
        checkId: 'sitemap_url_canonicalized',
        severity: 'high',
        title: 'Sitemap URL canonicalizes to a different URL',
        detail: `Canonical: ${canonical}`,
        url: page.url,
        evidence: { canonical },
        fixHint:
          'Make the canonical self-referencing, or list the canonical URL in the sitemap instead (check trailing slash and host).',
      })
    }
  }

  // Titles, descriptions, H1
  for (const page of indexable) {
    const title = String(page?.meta?.title || '').trim()
    const description = String(page?.meta?.description || '').trim()
    const h1 = Array.isArray(page?.meta?.htags?.h1) ? page.meta.htags.h1 : null
    if (!title) {
      add({ checkId: 'title_missing', severity: 'high', title: 'Missing <title>', url: page.url })
    } else if (title.length > LONG_TITLE) {
      add({
        checkId: 'title_too_long',
        severity: 'low',
        title: `Title longer than ${LONG_TITLE} characters`,
        detail: `${title.length} chars: "${title.slice(0, 90)}"`,
        url: page.url,
      })
    }
    if (!description) {
      add({
        checkId: 'description_missing',
        severity: 'medium',
        title: 'Missing meta description',
        url: page.url,
      })
    } else if (description.length < SHORT_DESCRIPTION || description.length > LONG_DESCRIPTION) {
      add({
        checkId: 'description_length',
        severity: 'low',
        title: `Meta description outside ${SHORT_DESCRIPTION}–${LONG_DESCRIPTION} characters`,
        detail: `${description.length} chars`,
        url: page.url,
      })
    }
    if (h1 && h1.length === 0) {
      add({ checkId: 'h1_missing', severity: 'medium', title: 'Missing H1', url: page.url })
    } else if (h1 && h1.length > 1) {
      add({
        checkId: 'h1_multiple',
        severity: 'low',
        title: 'Multiple H1 tags',
        detail: `${h1.length} H1s`,
        url: page.url,
      })
    }
  }
  for (const urls of groupDuplicates(indexable, (p) => p?.meta?.title)) {
    for (const url of urls) {
      add({
        checkId: 'title_duplicate',
        severity: 'medium',
        title: 'Duplicate title',
        detail: `Shared with ${urls.length - 1} other page(s)`,
        url,
        evidence: { duplicates: urls.filter((u) => u !== url).slice(0, 10) },
      })
    }
  }
  for (const urls of groupDuplicates(indexable, (p) => p?.meta?.description)) {
    for (const url of urls) {
      add({
        checkId: 'description_duplicate',
        severity: 'medium',
        title: 'Duplicate meta description',
        detail: `Shared with ${urls.length - 1} other page(s)`,
        url,
        evidence: { duplicates: urls.filter((u) => u !== url).slice(0, 10) },
      })
    }
  }

  // Orphans, sitemap coverage, depth
  const home = normalizeUrl(siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`)
  for (const page of indexable) {
    const links = inbound(page)
    if (page.url !== home && sitemap.has(page.url) && links === 0) {
      add({
        checkId: 'orphan_page',
        severity: 'medium',
        title: 'Orphan page (no internal links point to it)',
        url: page.url,
        fixHint: 'Link to it from its pillar, a related article, or a hub page.',
      })
    }
    if (sitemap.size > 0 && !sitemap.has(page.url)) {
      const canonical = normalizeUrl(page?.meta?.canonical, page.url)
      if (!canonical || canonical === page.url) {
        add({
          checkId: 'not_in_sitemap',
          severity: 'low',
          title: 'Indexable page missing from the sitemap',
          url: page.url,
        })
      }
    }
    const depth = Number(page?.click_depth)
    if (Number.isFinite(depth) && depth > MAX_DEPTH) {
      add({
        checkId: 'deep_page',
        severity: 'low',
        title: `Page is more than ${MAX_DEPTH} clicks from the homepage`,
        detail: `Click depth ${depth}`,
        url: page.url,
      })
    }
  }

  // Trailing-slash consistency across crawled 200 pages
  const withSlash = []
  const withoutSlash = []
  for (const page of okPages) {
    let path = '/'
    try {
      path = new URL(page.url).pathname
    } catch {
      continue
    }
    if (path === '/' || hasFileExtension(path)) continue
    if (path.endsWith('/')) withSlash.push(page.url)
    else withoutSlash.push(page.url)
  }
  if (withSlash.length && withoutSlash.length) {
    add({
      checkId: 'trailing_slash_inconsistent',
      severity: 'medium',
      title: 'Mixed trailing-slash URLs',
      detail: `${withSlash.length} with slash, ${withoutSlash.length} without`,
      evidence: { withSlash: withSlash.slice(0, 5), withoutSlash: withoutSlash.slice(0, 5) },
      fixHint:
        'Pick one style (Astro `trailingSlash` in astro.config) and make links, canonicals and the sitemap match it.',
    })
  }

  // SSL from crawler summary
  if (summary?.domain_info?.ssl_info?.valid_certificate === false) {
    add({
      checkId: 'ssl_invalid',
      severity: 'critical',
      title: 'Invalid SSL certificate',
      evidence: { issuer: summary.domain_info.ssl_info.certificate_issuer || null },
    })
  }

  // First-party site checks
  if (siteChecks) {
    const nf = siteChecks.notFound
    if (nf && nf.status >= 200 && nf.status < 300) {
      add({
        checkId: 'soft_404',
        severity: 'high',
        title: 'Missing pages return 200 (soft 404)',
        detail: `A random non-existent URL returned HTTP ${nf.status}`,
        fixHint: 'Ensure src/pages/404.astro exists and the host serves it with a 404 status.',
      })
    }
    const hr = siteChecks.httpRedirect
    if (hr && !hr.error && !hr.endsHttps) {
      add({
        checkId: 'http_not_redirected',
        severity: 'high',
        title: 'HTTP does not redirect to HTTPS',
        detail: `http:// ended at ${hr.finalUrl} (HTTP ${hr.status})`,
      })
    }
    const alt = siteChecks.altHost
    if (alt && !alt.error && alt.status >= 200 && alt.status < 300 && alt.finalHost === alt.host) {
      add({
        checkId: 'alternate_host_not_redirected',
        severity: 'medium',
        title: `${alt.host} serves content instead of redirecting`,
        detail: `Expected a redirect to ${siteChecks.mainHost}`,
        fixHint: 'Add a permanent redirect from the alternate host to the main host.',
      })
    }
  }

  const statusCounts = {}
  for (const page of htmlPages) {
    const key = String(page.status_code ?? 'unknown')
    statusCounts[key] = (statusCounts[key] || 0) + 1
  }
  const depths = htmlPages.map((p) => Number(p?.click_depth)).filter(Number.isFinite)

  return {
    issues: dedupeIssues(issues),
    metrics: {
      pagesChecked: indexable.length,
      htmlPages: htmlPages.length,
      okPages: okPages.length,
      indexablePages: indexable.length,
      nonIndexablePages: nonIndexableUrls.size,
      sitemapUrlCount: sitemap.size,
      statusCounts,
      maxClickDepth: depths.length ? Math.max(...depths) : null,
      onpageScore: summary?.page_metrics?.onpage_score ?? null,
      crawlStopReason: summary?.crawl_status?.crawl_stop_reason || null,
      pagesCrawled: summary?.crawl_status?.pages_crawled ?? htmlPages.length,
      brokenLinksAvailable: Array.isArray(brokenLinks),
    },
  }
}
