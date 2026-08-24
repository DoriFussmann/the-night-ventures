import { originFromUrl, apexDomain } from '../audit-snapshot/domain.js'
import {
  extractUrlEntries,
  extractLocUrls,
  isXmlSitemap,
  isSitemapIndex,
  isRssOrAtom,
  parseArticleUrl,
  extractArticleEntriesFromHtml,
  extractListingPageUrls,
  extractRssArticleEntries,
  parseLiveArticlePage,
  mergeKeyword,
  resolvePlanFields,
  indexCoverageArticles,
  sortLiveArticles,
} from './parse.js'

const FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
  'User-Agent': 'TheNightVentures-ScanLive/1.0',
}

export const MAX_ARTICLES = 200
export const FETCH_CONCURRENCY = 6
const PAGE_TIMEOUT_MS = 15_000
const SITEMAP_TIMEOUT_MS = 12_000
const MAX_LISTING_PAGES = 20

async function fetchText(url, { timeoutMs = PAGE_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    })
    const text = await res.text()
    return {
      ok: res.ok,
      status: res.status,
      text,
      finalUrl: res.url || url,
    }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

function originCandidates(siteUrl) {
  const origin = originFromUrl(siteUrl)
  const apex = apexDomain(siteUrl)
  const list = []
  if (origin) list.push(origin)
  if (apex) {
    list.push(`https://www.${apex}`)
    list.push(`https://${apex}`)
  }
  return [...new Set(list.filter(Boolean))]
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index], index)
    }
  }
  const workers = Math.min(Math.max(1, limit), Math.max(items.length, 1))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

function addEntry(bySlug, entry) {
  if (!entry?.slug || !entry?.url) return
  const prev = bySlug.get(entry.slug)
  if (!prev) {
    bySlug.set(entry.slug, {
      slug: entry.slug,
      url: entry.url,
      lastmod: entry.lastmod || null,
    })
    return
  }
  if (!prev.lastmod && entry.lastmod) prev.lastmod = entry.lastmod
}

async function collectSitemapEntries(siteUrl, signal) {
  const origins = originCandidates(siteUrl)
  const tried = []
  const bySlug = new Map()
  let sitemapIndexUrl = null

  for (const origin of origins) {
    const indexCandidates = [
      `${origin}/sitemap-index.xml`,
      `${origin}/sitemap.xml`,
    ]
    for (const indexUrl of indexCandidates) {
      tried.push(indexUrl)
      let fetched
      try {
        fetched = await fetchText(indexUrl, { timeoutMs: SITEMAP_TIMEOUT_MS, signal })
      } catch {
        continue
      }
      if (!fetched.ok || !isXmlSitemap(fetched.text)) continue

      sitemapIndexUrl = fetched.finalUrl || indexUrl
      const childLocs = isSitemapIndex(fetched.text)
        ? extractLocUrls(fetched.text)
        : []

      const xmlDocs = childLocs.length > 0 ? [] : [fetched.text]
      if (childLocs.length > 0) {
        for (const child of childLocs) {
          try {
            const childFetch = await fetchText(child, {
              timeoutMs: SITEMAP_TIMEOUT_MS,
              signal,
            })
            if (childFetch.ok && isXmlSitemap(childFetch.text)) {
              xmlDocs.push(childFetch.text)
            }
          } catch {
            // skip child
          }
        }
      }

      for (const xml of xmlDocs) {
        for (const entry of extractUrlEntries(xml)) {
          const parsed = parseArticleUrl(entry.loc, origin)
          if (!parsed) continue
          addEntry(bySlug, {
            slug: parsed.slug,
            url: parsed.url,
            lastmod: entry.lastmod,
          })
        }
      }

      if (bySlug.size > 0 || sitemapIndexUrl) {
        return {
          bySlug,
          sitemapIndexUrl,
          tried,
        }
      }
    }
  }

  return { bySlug, sitemapIndexUrl, tried }
}

async function collectRssEntries(siteUrl, signal) {
  const bySlug = new Map()
  for (const origin of originCandidates(siteUrl)) {
    const rssUrl = `${origin}/rss.xml`
    try {
      const fetched = await fetchText(rssUrl, { timeoutMs: SITEMAP_TIMEOUT_MS, signal })
      if (!fetched.ok || !isRssOrAtom(fetched.text)) continue
      for (const entry of extractRssArticleEntries(fetched.text, origin)) {
        addEntry(bySlug, entry)
      }
      if (bySlug.size > 0) return bySlug
    } catch {
      // try next origin
    }
  }
  return bySlug
}

async function collectListingEntries(siteUrl, signal) {
  const bySlug = new Map()
  const origins = originCandidates(siteUrl)
  for (const origin of origins) {
    const start = `${origin}/articles/`
    const queue = [start]
    const seenPages = new Set()
    while (queue.length && seenPages.size < MAX_LISTING_PAGES) {
      const pageUrl = queue.shift()
      if (!pageUrl || seenPages.has(pageUrl)) continue
      seenPages.add(pageUrl)
      let fetched
      try {
        fetched = await fetchText(pageUrl, { timeoutMs: PAGE_TIMEOUT_MS, signal })
      } catch {
        continue
      }
      if (!fetched.ok) continue
      const html = fetched.text
      const base = fetched.finalUrl || pageUrl
      for (const entry of extractArticleEntriesFromHtml(html, base)) {
        addEntry(bySlug, entry)
      }
      for (const next of extractListingPageUrls(html, base)) {
        if (!seenPages.has(next)) queue.push(next)
      }
    }
    if (bySlug.size > 0) return bySlug
  }
  return bySlug
}

function libraryMap(rows) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const slug = String(row?.slug || '').trim()
    if (slug) map.set(slug, row)
  }
  return map
}

export async function scanLiveArticles({
  siteUrl,
  libraryRows = [],
  coveragePillars = [],
  signal,
} = {}) {
  if (!siteUrl) {
    const err = new Error('No site URL configured. Add a domain in Company Data.')
    err.statusCode = 400
    throw err
  }

  const discovery = {
    sitemap: 0,
    rss: 0,
    listing: 0,
    sitemapIndexUrl: null,
  }

  const sitemap = await collectSitemapEntries(siteUrl, signal)
  discovery.sitemapIndexUrl = sitemap.sitemapIndexUrl
  discovery.sitemap = sitemap.bySlug.size

  const bySlug = new Map(sitemap.bySlug)

  if (bySlug.size === 0) {
    const rss = await collectRssEntries(siteUrl, signal)
    discovery.rss = rss.size
    for (const [slug, entry] of rss) addEntry(bySlug, entry)
  }

  if (bySlug.size === 0) {
    const listing = await collectListingEntries(siteUrl, signal)
    discovery.listing = listing.size
    for (const [slug, entry] of listing) addEntry(bySlug, entry)
  }

  const discovered = [...bySlug.values()].slice(0, MAX_ARTICLES)
  const library = libraryMap(libraryRows)
  const coverageBySlug = indexCoverageArticles(coveragePillars)
  const articlesIndexUrl = `${originCandidates(siteUrl)[0] || originFromUrl(siteUrl)}/articles/`

  const scanned = await mapPool(discovered, FETCH_CONCURRENCY, async (entry) => {
    const libraryRow = library.get(entry.slug)
    const plan = resolvePlanFields({
      slug: entry.slug,
      libraryRow,
      coverageBySlug,
    })
    const keyword = mergeKeyword('', libraryRow, plan.coverage)

    const base = {
      slug: entry.slug,
      url: entry.url,
      title: libraryRow?.title || plan.coverage?.title || '',
      keyword,
      keywordRole: plan.keywordRole,
      articleType: plan.articleType,
      pillarKeyword: plan.pillarKeyword,
      cluster: plan.cluster,
      lastDate: entry.lastmod || '',
      internalLinks: null,
      externalLinks: null,
    }

    try {
      const fetched = await fetchText(entry.url, { signal })
      if (!fetched.ok) {
        return {
          ...base,
          error: `HTTP ${fetched.status}`,
        }
      }
      const parsed = parseLiveArticlePage(fetched.text, fetched.finalUrl || entry.url)
      return {
        ...base,
        slug: parsed.slug || entry.slug,
        url: parsed.url || entry.url,
        title: parsed.title || base.title,
        keyword: mergeKeyword(parsed.keyword, libraryRow, plan.coverage),
        pillarKeyword: plan.pillarKeyword || parsed.pillarKeyword || '',
        lastDate: parsed.lastDate || entry.lastmod || '',
        internalLinks: parsed.internalLinks,
        externalLinks: parsed.externalLinks,
        error: null,
      }
    } catch (err) {
      return {
        ...base,
        error: err?.name === 'AbortError' ? 'Timed out' : err?.message || 'Fetch failed',
      }
    }
  })

  return {
    siteUrl,
    articlesIndexUrl,
    scannedAt: new Date().toISOString(),
    discovery,
    articleCount: scanned.length,
    articles: sortLiveArticles(scanned),
  }
}
