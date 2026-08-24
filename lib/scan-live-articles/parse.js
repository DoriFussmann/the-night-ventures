const ARTICLE_TYPES = new Set([
  'Article',
  'BlogPosting',
  'TechArticle',
  'NewsArticle',
  'ScholarlyArticle',
])

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) ? String.fromCharCode(code) : ''
    })
}

export function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function toDateOnly(value) {
  const match = String(value || '').trim().match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

export function extractLocUrls(xml) {
  const urls = []
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi
  let match
  while ((match = re.exec(xml)) !== null) {
    const url = decodeEntities(String(match[1] || '').trim())
    if (url) urls.push(url)
  }
  return urls
}

export function extractUrlEntries(xml) {
  const entries = []
  const re = /<url\b[^>]*>([\s\S]*?)<\/url>/gi
  let match
  while ((match = re.exec(xml)) !== null) {
    const block = match[1]
    const loc = decodeEntities(tagText(block, 'loc'))
    const lastmod = toDateOnly(tagText(block, 'lastmod'))
    if (loc) entries.push({ loc, lastmod: lastmod || null })
  }
  if (entries.length === 0) {
    for (const loc of extractLocUrls(xml)) {
      entries.push({ loc, lastmod: null })
    }
  }
  return entries
}

function tagText(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = String(xml || '').match(re)
  return match ? String(match[1] || '').trim() : ''
}

export function isXmlSitemap(text) {
  return /<(sitemapindex|urlset)\b/i.test(String(text || ''))
}

export function isSitemapIndex(text) {
  return /<sitemapindex\b/i.test(String(text || ''))
}

export function isRssOrAtom(text) {
  return /<(rss|feed)\b/i.test(String(text || ''))
}

export function parseArticleUrl(value, baseUrl) {
  try {
    const parsed = new URL(String(value || '').trim(), baseUrl || undefined)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    if (parts.length !== 2) return null
    if (parts[0].toLowerCase() !== 'articles') return null
    const slug = decodeURIComponent(parts[1]).trim()
    if (!slug || /^\d+$/.test(slug)) return null
    if (/\.md$/i.test(slug)) return null
    return {
      slug,
      origin: parsed.origin,
      url: `${parsed.origin}/articles/${slug}/`,
    }
  } catch {
    return null
  }
}

export function extractArticleEntriesFromHtml(html, baseUrl) {
  const seen = new Set()
  const entries = []
  for (const href of extractHrefs(html)) {
    const parsed = parseArticleUrl(href, baseUrl)
    if (!parsed || seen.has(parsed.slug)) continue
    seen.add(parsed.slug)
    entries.push({ slug: parsed.slug, url: parsed.url, lastmod: null })
  }
  return entries
}

export function extractListingPageUrls(html, baseUrl) {
  const origin = (() => {
    try {
      return new URL(baseUrl).origin
    } catch {
      return ''
    }
  })()
  const pages = new Set()
  for (const href of extractHrefs(html)) {
    try {
      const parsed = new URL(href, baseUrl)
      const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
      if (parts.length === 2 && parts[0] === 'articles' && /^\d+$/.test(parts[1])) {
        pages.add(`${parsed.origin}/articles/${parts[1]}/`)
      }
    } catch {
      // skip
    }
  }
  if (origin) pages.add(`${origin}/articles/`)
  return [...pages]
}

export function extractRssArticleEntries(xml, baseUrl) {
  const seen = new Set()
  const entries = []
  const itemRe = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi
  let match
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1]
    const link =
      tagText(block, 'link') ||
      attrValue(block.match(/<link\b[^>]*>/i)?.[0] || '', 'href')
    const parsed = parseArticleUrl(decodeEntities(link), baseUrl)
    if (!parsed || seen.has(parsed.slug)) continue
    seen.add(parsed.slug)
    const lastmod =
      toDateOnly(tagText(block, 'pubDate')) ||
      toDateOnly(tagText(block, 'updated')) ||
      toDateOnly(tagText(block, 'published')) ||
      rfcDateToIso(tagText(block, 'pubDate'))
    entries.push({
      slug: parsed.slug,
      url: parsed.url,
      lastmod: lastmod || null,
    })
  }
  return entries
}

function rfcDateToIso(value) {
  const parsed = Date.parse(String(value || ''))
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toISOString().slice(0, 10)
}

export function extractHrefs(html) {
  const hrefs = []
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    const href = decodeEntities(String(match[1] || '').trim())
    if (href) hrefs.push(href)
  }
  return hrefs
}

export function extractSectionHtml(html, headingId) {
  const source = String(html || '')
  const labelled = new RegExp(
    `<section\\b[^>]*aria-labelledby=["']${headingId}["'][^>]*>([\\s\\S]*?)</section>`,
    'i'
  )
  const labelledMatch = source.match(labelled)
  if (labelledMatch) return labelledMatch[1]

  const idRe = new RegExp(
    `<h[1-6]\\b[^>]*id=["']${headingId}["'][^>]*>[\\s\\S]*?</h[1-6]>`,
    'i'
  )
  const headingMatch = idRe.exec(source)
  if (!headingMatch) return ''
  const after = source.slice(headingMatch.index + headingMatch[0].length)
  const until = after.match(/^[\s\S]*?(?=<(?:section|h[1-6])\b)/i)
  return until ? until[0] : after.slice(0, 4000)
}

function attrValue(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i')
  const match = String(tag || '').match(re)
  return match ? String(match[1] || '').trim() : ''
}

export function metaProperty(html, property) {
  const re = new RegExp(
    `<meta\\b[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    'i'
  )
  const re2 = new RegExp(
    `<meta\\b[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["'][^>]*>`,
    'i'
  )
  const match = String(html || '').match(re) || String(html || '').match(re2)
  return match ? decodeEntities(String(match[1] || '').trim()) : ''
}

export function tagContent(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = String(html || '').match(re)
  return match ? stripTags(match[1]) : ''
}

export function extractJsonLdBlocks(html) {
  const blocks = []
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    const raw = String(match[1] || '').trim()
    if (raw) blocks.push(raw)
  }
  return blocks
}

function collectJsonLdNodes(node, out = []) {
  if (!node) return out
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdNodes(item, out)
    return out
  }
  if (typeof node !== 'object') return out
  if (node['@type']) out.push(node)
  if (node['@graph']) collectJsonLdNodes(node['@graph'], out)
  return out
}

function typeList(node) {
  const value = node?.['@type']
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return [value]
  return []
}

export function extractArticleJsonLd(html) {
  for (const raw of extractJsonLdBlocks(html)) {
    try {
      const parsed = JSON.parse(raw)
      const nodes = collectJsonLdNodes(parsed)
      const article = nodes.find((node) =>
        typeList(node).some((type) => ARTICLE_TYPES.has(type))
      )
      if (article) return article
    } catch {
      // skip invalid JSON-LD
    }
  }
  return null
}

export function classifyHref(href, pageUrl) {
  const raw = String(href || '').trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) {
    return 'skip'
  }
  if (/^(javascript|data):/i.test(raw)) return 'skip'
  try {
    const page = new URL(pageUrl)
    const target = new URL(raw, page)
    if (target.origin === page.origin) return 'internal'
    if (target.protocol === 'http:' || target.protocol === 'https:') return 'external'
    return 'skip'
  } catch {
    return 'skip'
  }
}

export function countArticleLinks(html, pageUrl) {
  const relatedHtml = extractSectionHtml(html, 'related-heading')
  const sourcesHtml = extractSectionHtml(html, 'sources-heading')
  const relatedHrefs = relatedHtml ? extractHrefs(relatedHtml) : []
  const sourceHrefs = sourcesHtml ? extractHrefs(sourcesHtml) : []

  if (relatedHtml || sourcesHtml) {
    return {
      internalLinks: relatedHrefs.filter((href) => classifyHref(href, pageUrl) !== 'skip')
        .length,
      externalLinks: sourceHrefs.filter((href) => classifyHref(href, pageUrl) === 'external')
        .length,
      source: 'sections',
    }
  }

  const articleMatch = String(html || '').match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  const scope = articleMatch ? articleMatch[1] : String(html || '')
  let internalLinks = 0
  let externalLinks = 0
  const seen = new Set()
  for (const href of extractHrefs(scope)) {
    const kind = classifyHref(href, pageUrl)
    if (kind === 'skip') continue
    let abs = href
    try {
      abs = new URL(href, pageUrl).href
    } catch {
      // keep raw
    }
    if (seen.has(abs)) continue
    seen.add(abs)
    const parsed = parseArticleUrl(abs, pageUrl)
    if (kind === 'internal') {
      if (parsed && parsed.url.replace(/\/+$/, '') !== String(pageUrl).replace(/\/+$/, '')) {
        internalLinks += 1
      }
    } else if (kind === 'external') {
      externalLinks += 1
    }
  }
  return { internalLinks, externalLinks, source: 'article' }
}

export function parseLiveArticlePage(html, pageUrl) {
  const jsonLd = extractArticleJsonLd(html)
  const headline = jsonLd?.headline ? stripTags(jsonLd.headline) : ''
  const h1 = tagContent(html, 'h1')
  const titleTag = tagContent(html, 'title')
  const title = headline || h1 || titleTag.split(/[|–—-]/)[0].trim()

  const lastDate =
    toDateOnly(jsonLd?.dateModified) ||
    toDateOnly(metaProperty(html, 'article:modified_time')) ||
    toDateOnly(jsonLd?.datePublished) ||
    toDateOnly(metaProperty(html, 'article:published_time')) ||
    ''

  const pillar =
    stripTags(jsonLd?.articleSection || '') ||
    metaProperty(html, 'article:section') ||
    ''

  const keywordsRaw = jsonLd?.keywords
  const keywords = Array.isArray(keywordsRaw)
    ? keywordsRaw.map((item) => stripTags(item)).filter(Boolean)
    : String(keywordsRaw || '')
        .split(',')
        .map((item) => stripTags(item))
        .filter(Boolean)

  const canonical = (() => {
    const re = /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i
    const re2 = /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i
    const match = String(html || '').match(re) || String(html || '').match(re2)
    return match ? decodeEntities(match[1].trim()) : pageUrl
  })()

  const parsedUrl = parseArticleUrl(canonical, pageUrl) || parseArticleUrl(pageUrl)
  const links = countArticleLinks(html, parsedUrl?.url || pageUrl)

  return {
    slug: parsedUrl?.slug || '',
    url: parsedUrl?.url || canonical || pageUrl,
    title: title || '',
    keyword: pillar || keywords[0] || '',
    pillarKeyword: pillar,
    lastDate,
    internalLinks: links.internalLinks,
    externalLinks: links.externalLinks,
  }
}

export function mergeKeyword(liveKeyword, libraryRow, coverageRow) {
  const target = String(
    libraryRow?.target_keyword ||
      libraryRow?.targetKeyword ||
      coverageRow?.targetKeyword ||
      coverageRow?.target_keyword ||
      ""
  ).trim()
  if (target) return target
  return String(liveKeyword || "").trim()
}

const PLAN_ARTICLE_TYPES = new Set([
  "comprehensive",
  "howto",
  "comparison",
  "faq",
  "flex",
])

export function normalizeArticleType(value) {
  const type = String(value || "")
    .trim()
    .toLowerCase()
  return PLAN_ARTICLE_TYPES.has(type) ? type : ""
}

export function keywordRoleFromSupporting(supportingKeyword) {
  return String(supportingKeyword || "").trim() ? "supporting" : "pillar"
}

export function indexCoverageArticles(pillars) {
  const bySlug = new Map()

  const add = (article, { keywordRole, supportingKeyword, pillarKeyword }) => {
    if (!article || typeof article !== "object") return
    const published =
      parseArticleUrl(article.publishedUrl || article.published_url || "")
    const slug = String(article.slug || published?.slug || "").trim()
    if (!slug) return
    const record = {
      slug,
      title: String(article.title || "").trim(),
      type: normalizeArticleType(article.type),
      targetKeyword: String(
        article.targetKeyword || article.target_keyword || ""
      ).trim(),
      supportingKeyword:
        keywordRole === "pillar"
          ? ""
          : String(supportingKeyword || "").trim(),
      pillarKeyword: String(pillarKeyword || "").trim(),
      keywordRole,
    }
    bySlug.set(slug, record)
  }

  for (const pillar of Array.isArray(pillars) ? pillars : []) {
    add(pillar?.pillarArticle, {
      keywordRole: "pillar",
      supportingKeyword: "",
      pillarKeyword: pillar?.keyword,
    })
    for (const supporting of Array.isArray(pillar?.supporting)
      ? pillar.supporting
      : []) {
      for (const article of Array.isArray(supporting?.plannedArticles)
        ? supporting.plannedArticles
        : []) {
        add(article, {
          keywordRole: "supporting",
          supportingKeyword: supporting?.keyword,
          pillarKeyword: pillar?.keyword,
        })
      }
    }
  }

  return bySlug
}

export function resolvePlanFields({ slug, libraryRow, coverageBySlug }) {
  const coverage =
    coverageBySlug instanceof Map ? coverageBySlug.get(slug) || null : null
  const hasPlan = Boolean(libraryRow || coverage)
  const supporting = libraryRow
    ? String(
        libraryRow.supporting_keyword || libraryRow.supportingKeyword || ""
      ).trim()
    : String(coverage?.supportingKeyword || "").trim()
  const articleType = normalizeArticleType(
    libraryRow?.type || libraryRow?.articleType || coverage?.type
  )

  return {
    keywordRole: hasPlan ? keywordRoleFromSupporting(supporting) : "",
    articleType,
    pillarKeyword: String(
      libraryRow?.pillar_keyword ||
        libraryRow?.pillarKeyword ||
        coverage?.pillarKeyword ||
        ""
    ).trim(),
    cluster: hasPlan ? supporting : "",
    coverage,
  }
}

export function sortLiveArticles(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const da = String(a.lastDate || '')
    const db = String(b.lastDate || '')
    if (da !== db) return db.localeCompare(da)
    return String(a.title || a.slug || '').localeCompare(String(b.title || b.slug || ''))
  })
}
