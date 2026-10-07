// Pure HTML → facts extractor used by every page-level audit category.
// No network. Output is compact JSON so it can be stored in audit_runs.workspace.

import { decodeEntities, stripTags, extractJsonLdBlocks, toDateOnly } from '../scan-live-articles/parse.js'

export const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'ScholarlyArticle']
export const ORGANIZATION_TYPES = [
  'Organization',
  'Corporation',
  'LocalBusiness',
  'ProfessionalService',
  'OnlineBusiness',
  'NGO',
  'EducationalOrganization',
]

const MAX_LINKS = 300
const QUESTION_START =
  /^(what|how|why|when|where|which|who|whom|whose|can|could|does|do|did|is|are|was|were|should|will|would|may|might)\b/i

/**
 * Normalize a URL for comparison: absolute, lowercase host, no hash.
 * @param {string} value
 * @param {string} [base]
 * @returns {string | null}
 */
export function normalizeUrl(value, base) {
  try {
    const u = new URL(String(value || '').trim(), base || undefined)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    u.hostname = u.hostname.toLowerCase()
    return u.href
  } catch {
    return null
  }
}

/** Parse the attributes of one start tag (e.g. `<meta name="x" content="y">`). */
export function parseAttrs(tag) {
  const attrs = {}
  const body = String(tag || '')
    .replace(/^<\s*[a-zA-Z0-9-]+/, '')
    .replace(/\/?>$/, '')
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m
  while ((m = re.exec(body)) !== null) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (!(name in attrs)) attrs[name] = decodeEntities(value)
  }
  return attrs
}

function stripNonContent(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
}

function wordCount(text) {
  const t = String(text || '').trim()
  return t ? t.split(/\s+/).length : 0
}

function mainRegion(cleanHtml) {
  const main = cleanHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  if (main) return { html: main[1], source: 'main' }
  const article = cleanHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  if (article) return { html: article[1], source: 'article' }
  const body = cleanHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  return { html: body ? body[1] : cleanHtml, source: body ? 'body' : 'document' }
}

function metaTags(html) {
  const out = []
  const re = /<meta\b[^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) out.push(parseAttrs(m[0]))
  return out
}

function metaContent(metas, key) {
  const k = key.toLowerCase()
  const hit = metas.find(
    (a) => String(a.name || '').toLowerCase() === k || String(a.property || '').toLowerCase() === k
  )
  return hit ? String(hit.content || '').trim() : ''
}

function linkRel(html, rel) {
  const re = /<link\b[^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const attrs = parseAttrs(m[0])
    const rels = String(attrs.rel || '').toLowerCase().split(/\s+/)
    if (rels.includes(rel)) return String(attrs.href || '').trim()
  }
  return ''
}

/**
 * Parse robots directives from a meta robots value and/or X-Robots-Tag header.
 * @param {string[]} values
 */
export function parseRobotsDirectives(values) {
  const tokens = values
    .flatMap((v) => String(v || '').toLowerCase().split(','))
    .map((t) => t.trim())
    .filter(Boolean)
    // X-Robots-Tag may be prefixed with a user agent ("googlebot: noindex").
    .map((t) => t.replace(/^[a-z-]+bot\s*:\s*/, ''))
  const maxSnippetToken = tokens.find((t) => t.startsWith('max-snippet'))
  let maxSnippet = null
  if (maxSnippetToken) {
    const n = Number(maxSnippetToken.split(':')[1])
    maxSnippet = Number.isFinite(n) ? n : null
  }
  return {
    noindex: tokens.includes('noindex') || tokens.includes('none'),
    nofollow: tokens.includes('nofollow') || tokens.includes('none'),
    nosnippet: tokens.includes('nosnippet'),
    maxSnippet,
    raw: tokens,
  }
}

function headingsWithPositions(html) {
  const out = []
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    out.push({
      level: Number(m[1]),
      text: stripTags(m[2]),
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  return out
}

/** What follows a heading: first block type and, for paragraphs, its word count. */
function firstBlockAfter(segment) {
  const re = /<(p|ul|ol|table|dl)\b[^>]*>([\s\S]*?)<\/\1>/i
  const m = segment.match(re)
  if (!m) return { firstBlock: 'none', answerWords: 0 }
  const tag = m[1].toLowerCase()
  if (tag === 'p') return { firstBlock: 'p', answerWords: wordCount(stripTags(m[2])) }
  if (tag === 'table') return { firstBlock: 'table', answerWords: 0 }
  return { firstBlock: 'list', answerWords: 0 }
}

export function isQuestionHeading(text) {
  const t = String(text || '').trim()
  return t.endsWith('?') || QUESTION_START.test(t)
}

function extractLinks(html, pageUrl, inMain) {
  const internal = []
  const external = []
  let origin = ''
  try {
    origin = new URL(pageUrl).origin
  } catch {
    origin = ''
  }
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const attrs = parseAttrs(`<a ${m[1]}>`)
    const raw = String(attrs.href || '').trim()
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(raw)) continue
    const href = normalizeUrl(raw, pageUrl)
    if (!href) continue
    const text = stripTags(m[2]).slice(0, 120)
    const rel = String(attrs.rel || '').toLowerCase()
    const entry = { href, text, rel, inMain }
    if (origin && href.startsWith(`${origin}/`)) {
      if (internal.length < MAX_LINKS) internal.push(entry)
    } else if (origin && href === origin) {
      if (internal.length < MAX_LINKS) internal.push(entry)
    } else if (external.length < MAX_LINKS) {
      let host = ''
      try {
        host = new URL(href).hostname.replace(/^www\./, '')
      } catch {
        host = ''
      }
      external.push({ ...entry, host })
    }
  }
  return { internal, external }
}

function typesOf(node) {
  const t = node?.['@type']
  if (Array.isArray(t)) return t.map(String)
  if (typeof t === 'string') return [t]
  return []
}

function collectNodes(value, out) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out)
    return
  }
  if (value['@type'] || value['@id']) out.push(value)
  for (const key of Object.keys(value)) {
    if (key === '@context') continue
    const child = value[key]
    if (child && typeof child === 'object') collectNodes(child, out)
  }
}

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function sameAsCount(node) {
  return asArray(node?.sameAs).filter((v) => typeof v === 'string' && v.trim()).length
}

function textValue(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && typeof value.name === 'string') return value.name.trim()
  return ''
}

function summarizePerson(node) {
  return {
    types: typesOf(node),
    name: textValue(node?.name),
    url: typeof node?.url === 'string' ? node.url : '',
    sameAsCount: sameAsCount(node),
  }
}

function summarizeOrganization(node) {
  const logo = node?.logo
  return {
    types: typesOf(node),
    name: textValue(node?.name),
    url: typeof node?.url === 'string' ? node.url : '',
    hasLogo: Boolean(
      (typeof logo === 'string' && logo.trim()) || (logo && typeof logo === 'object' && (logo.url || logo['@id']))
    ),
    sameAsCount: sameAsCount(node),
  }
}

/** Parse and summarize all JSON-LD on a page. */
export function extractStructuredData(html) {
  const blocks = []
  const nodes = []
  for (const raw of extractJsonLdBlocks(html)) {
    try {
      const parsed = JSON.parse(raw)
      const found = []
      collectNodes(parsed, found)
      nodes.push(...found)
      blocks.push({ valid: true, error: null, types: [...new Set(found.flatMap(typesOf))] })
    } catch (err) {
      blocks.push({ valid: false, error: String(err?.message || 'Invalid JSON').slice(0, 160), types: [] })
    }
  }

  const byId = new Map()
  for (const node of nodes) {
    if (typeof node['@id'] === 'string' && typesOf(node).length) byId.set(node['@id'], node)
  }
  const resolve = (node) => {
    if (node && typeof node === 'object' && !typesOf(node).length && typeof node['@id'] === 'string') {
      return byId.get(node['@id']) || node
    }
    return node
  }

  const typed = nodes.filter((n) => typesOf(n).length)
  const allTypes = [...new Set(typed.flatMap(typesOf))].sort()

  const articleNode = typed.find((n) => typesOf(n).some((t) => ARTICLE_TYPES.includes(t)))
  let article = null
  if (articleNode) {
    const authors = asArray(articleNode.author).map(resolve).filter(Boolean)
    const image = articleNode.image
    article = {
      types: typesOf(articleNode),
      headline: textValue(articleNode.headline),
      datePublished: toDateOnly(articleNode.datePublished),
      dateModified: toDateOnly(articleNode.dateModified),
      hasImage: Boolean(
        (typeof image === 'string' && image.trim()) ||
          (Array.isArray(image) && image.length) ||
          (image && typeof image === 'object' && (image.url || image['@id']))
      ),
      authors: authors.map((a) =>
        typeof a === 'string' ? { types: [], name: a, url: '', sameAsCount: 0 } : summarizePerson(a)
      ),
      publisher: articleNode.publisher ? textValue(resolve(articleNode.publisher)) : '',
    }
  }

  const organizations = typed
    .filter((n) => typesOf(n).some((t) => ORGANIZATION_TYPES.includes(t)))
    .map(summarizeOrganization)
  const persons = typed.filter((n) => typesOf(n).includes('Person')).map(summarizePerson)

  return {
    blocks,
    allTypes,
    article,
    organizations,
    persons,
    hasBreadcrumb: allTypes.includes('BreadcrumbList'),
    hasFaqPage: allTypes.includes('FAQPage'),
    hasWebSite: allTypes.includes('WebSite'),
  }
}

/**
 * Extract every fact the audit categories need from one HTML document.
 * @param {string} html
 * @param {{ url: string, headers?: Record<string, string> }} context
 */
export function extractPageFacts(html, { url, headers = {} }) {
  const source = String(html || '')
  const clean = stripNonContent(source)
  const metas = metaTags(source)
  const region = mainRegion(clean)
  const mainText = stripTags(region.html)

  const headTitle = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const title = headTitle ? stripTags(headTitle[1]) : ''
  const description = metaContent(metas, 'description')
  const canonicalRaw = linkRel(source, 'canonical')
  const robotsMeta = [metaContent(metas, 'robots'), metaContent(metas, 'googlebot')].filter(Boolean)
  const xRobots = String(headers['x-robots-tag'] || '')
  const directives = parseRobotsDirectives([...robotsMeta, xRobots])

  const allHeadings = headingsWithPositions(clean)
  const mainHeadings = headingsWithPositions(region.html)
  const h1s = allHeadings.filter((h) => h.level === 1).map((h) => h.text)

  const sections = mainHeadings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h, i, list) => {
      const nextStart = list[i + 1]?.start ?? region.html.length
      const segment = region.html.slice(h.end, nextStart)
      return {
        level: h.level,
        text: h.text.slice(0, 160),
        isQuestion: isQuestionHeading(h.text),
        ...firstBlockAfter(segment),
      }
    })

  const faqHeading = mainHeadings.some((h) => /\b(faqs?|frequently asked questions)\b/i.test(h.text))
  const detailsCount = (region.html.match(/<details\b/gi) || []).length

  const timeElements = []
  const timeRe = /<time\b([^>]*)>([\s\S]*?)<\/time>/gi
  let tm
  while ((tm = timeRe.exec(region.html)) !== null && timeElements.length < 6) {
    const attrs = parseAttrs(`<time ${tm[1]}>`)
    const before = stripTags(region.html.slice(Math.max(0, tm.index - 120), tm.index)).slice(-40)
    timeElements.push({
      date: toDateOnly(attrs.datetime || stripTags(tm[2])),
      label: before,
    })
  }

  const mainLinks = extractLinks(region.html, url, true)
  const allLinks = extractLinks(clean, url, false)
  const mainHrefs = new Set(mainLinks.internal.map((l) => l.href))
  const mainExternal = new Set(mainLinks.external.map((l) => l.href))
  const internal = [
    ...mainLinks.internal,
    ...allLinks.internal.filter((l) => !mainHrefs.has(l.href)),
  ].slice(0, MAX_LINKS)
  const external = [
    ...mainLinks.external,
    ...allLinks.external.filter((l) => !mainExternal.has(l.href)),
  ].slice(0, MAX_LINKS)

  const htmlTag = source.match(/<html\b[^>]*>/i)

  return {
    version: 1,
    url,
    lang: htmlTag ? String(parseAttrs(htmlTag[0]).lang || '') : '',
    title,
    description,
    canonical: canonicalRaw ? normalizeUrl(canonicalRaw, url) : null,
    robots: directives,
    dataNosnippetCount: (source.match(/\bdata-nosnippet\b/gi) || []).length,
    h1s,
    headingCount: allHeadings.length,
    sections,
    mainSource: region.source,
    mainWordCount: wordCount(mainText),
    listCount: (region.html.match(/<(ul|ol)\b/gi) || []).length,
    tableCount: (region.html.match(/<table\b/gi) || []).length,
    hasFaqSection: faqHeading || detailsCount >= 2,
    timeElements,
    metaDates: {
      published: toDateOnly(metaContent(metas, 'article:published_time')),
      modified: toDateOnly(metaContent(metas, 'article:modified_time')),
    },
    links: { internal, external },
    structured: extractStructuredData(source),
  }
}
