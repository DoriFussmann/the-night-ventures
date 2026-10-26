import { parseFrontmatter, splitFrontmatter } from '../frontmatter.js'
import {
  renderExternalLinksYaml,
  todayIso,
  yamlEscape,
} from './externalLinksYaml.js'

import { placeInTextLinks, stripFurtherReading } from './inText.js'
import { compareTerms } from '../keyword-overlap.js'

export { renderExternalLinksYaml, todayIso, yamlEscape }
export { placeInTextLinks, stripFurtherReading }

const ARTICLES_BASE = 'articles'
const INTERNAL_START = '<!-- CMS-INTERNAL:START -->'
const INTERNAL_END = '<!-- CMS-INTERNAL:END -->'
const EXTERNAL_START = '<!-- CMS-EXTERNAL:START -->'
const EXTERNAL_END = '<!-- CMS-EXTERNAL:END -->'

export const MIN_EXTERNAL_LINKS = 3
export const MAX_EXTERNAL_LINKS = 5

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Raw frontmatter/body isolation. Aliased from the shared module so the write
// path (which needs verbatim YAML text for surgical block edits) and existing
// importers keep the `splitMarkdown` name, while the binding is also usable
// inside this module.
export const splitMarkdown = splitFrontmatter

function sVal(value) {
  return value == null ? '' : String(value)
}

// Normalize the parsed `internalLinks` value into the `{slug, anchor}[]` shape
// the planner expects. Tolerates the legacy `{url, label}` item shape (url is
// dropped, label falls back to anchor) and drops empty entries — matching the
// prior regex parser's output.
function normalizeInternalLinks(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return { slug: '', anchor: '' }
      const slug = sVal(item.slug).trim()
      const anchor = sVal(item.anchor).trim() || sVal(item.label).trim()
      return { slug, anchor }
    })
    .filter((link) => link.slug || link.anchor)
}

// Normalize the parsed `externalLinks` value into the
// `{label, url, addedAt, kind}[]` shape. Entries without a url are dropped.
function normalizeExternalLinks(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      return {
        label: sVal(item.label).trim(),
        url: sVal(item.url).trim(),
        addedAt: sVal(item.addedAt).trim(),
        kind: sVal(item.kind).trim(),
      }
    })
    .filter((link) => link && link.url)
}

export function parseArticleMarkdown(raw, filename) {
  const parsed = parseFrontmatter(raw)
  const fm = parsed.data || {}
  const fileSlug = String(filename || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/\.md$/i, '')
  const slug =
    String(fm.slug || fileSlug || '')
      .trim()
      .toLowerCase() || fileSlug

  // A frontmatter fence that exists but fails to parse is refused (ok:false),
  // not silently mis-read. Log it so it surfaces in server logs rather than
  // vanishing from the wiring corpus without a trace.
  if (!parsed.ok && parsed.error) {
    console.error(
      `parseArticleMarkdown: invalid YAML frontmatter in ${filename || '(unknown file)'}: ${parsed.error.message}`
    )
  }

  const data = {
    slug,
    title: sVal(fm.title),
    articleType: sVal(fm.articleType),
    supportingKeyword: sVal(fm.supportingKeyword),
    pillarKeyword: sVal(fm.pillarKeyword),
    targetKeyword: sVal(fm.targetKeyword),
    date: sVal(fm.date),
    updatedDate: sVal(fm.updatedDate),
    draft: fm.draft,
    internalLinks: normalizeInternalLinks(fm.internalLinks),
    externalLinks: normalizeExternalLinks(fm.externalLinks),
  }
  return {
    slug,
    data,
    body: parsed.body,
    yaml: parsed.yaml,
    raw: String(raw || ''),
    ok: parsed.ok,
  }
}

function norm(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isPillar(article) {
  return (
    norm(article.data.articleType) === 'comprehensive' &&
    !article.data.supportingKeyword
  )
}

function cleanAnchorText(value) {
  let text = String(value ?? '').trim()
  const suffix = /\s*[\(\[][^()\[\]]+[\)\]]\s*$/
  let prev
  do {
    prev = text
    text = text.replace(suffix, '').trim()
  } while (text !== prev)
  return text
}

function withCleanAnchor(link) {
  if (!link || typeof link !== 'object') return link
  return { ...link, anchor: cleanAnchorText(link.anchor || '') }
}

function anchorFor(target) {
  const kw = String(target.data.targetKeyword || '').trim()
  return cleanAnchorText(kw || String(target.data.title || target.slug))
}

function addLink(map, from, to) {
  if (from === to.slug) return
  if (!map.has(from)) map.set(from, new Map())
  map.get(from).set(to.slug, anchorFor(to))
}

function words(value) {
  return norm(value)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)
}

function overlapScore(a, b) {
  const wa = new Set([...words(a.data.targetKeyword), ...words(a.data.supportingKeyword)])
  const wb = [...words(b.data.targetKeyword), ...words(b.data.supportingKeyword)]
  return wb.filter((w) => wa.has(w)).length
}

export const MAX_SIBLING_LINKS = 3

/**
 * Who links to whom, from the keyword map's structure:
 * - a pillar links to every other article under its pillar keyword
 * - every other article links to its pillar and to 1-3 closest siblings
 * When a group has several pillar-shaped articles, the most linked-to one is
 * the pillar. Returns Map<fromSlug, Map<toSlug, anchor>>.
 */
export function planInternalLinks(articles) {
  const desired = new Map()
  const list = Array.isArray(articles) ? articles : []
  const groups = new Map()
  for (const article of list) {
    const pk = norm(article.data.pillarKeyword)
    if (!pk) continue
    if (!groups.has(pk)) groups.set(pk, [])
    groups.get(pk).push(article)
  }

  for (const group of groups.values()) {
    const inbound = (slug) =>
      group.filter((a) => a.slug !== slug && (a.data.internalLinks || []).some((l) => l.slug === slug)).length
    const pillar =
      group
        .filter(isPillar)
        .sort((a, b) => inbound(b.slug) - inbound(a.slug) || a.slug.localeCompare(b.slug))[0] || null
    for (const article of group) {
      if (pillar && article === pillar) {
        for (const other of group) addLink(desired, pillar.slug, other)
        continue
      }
      if (pillar) addLink(desired, article.slug, pillar)
      const siblings = group
        .filter((other) => other !== article && other !== pillar)
        .map((other) => ({ other, score: overlapScore(article, other) }))
        .sort((x, y) => y.score - x.score || x.other.slug.localeCompare(y.other.slug))
        .slice(0, MAX_SIBLING_LINKS)
      for (const { other } of siblings) addLink(desired, article.slug, other)
    }
  }

  return desired
}

function upsertBlock(body, start, end, inner) {
  const block = inner.trim() ? `${start}\n${inner.trim()}\n${end}` : ''
  const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`)
  if (re.test(body)) {
    return body.replace(re, block ? `${block}\n` : '')
  }
  if (!block) return body
  const related = /^## Related\b/m
  if (related.test(body)) return body.replace(related, `${block}\n\n## Related`)
  return `${body.replace(/\s*$/, '')}\n\n${block}\n`
}

export function applyInternalSignpost(body, links) {
  const inner = (Array.isArray(links) ? links : [])
    .filter((link) => link?.slug && link?.anchor)
    .map((link) => {
      const anchor = cleanAnchorText(link.anchor)
      return `[${anchor}](/${ARTICLES_BASE}/${link.slug}/)`
    })
    .join(' · ')
  const line = inner ? `Further reading: ${inner}.` : ''
  return upsertBlock(body, INTERNAL_START, INTERNAL_END, line)
}

export function renderInternalLinksYaml(links) {
  const list = Array.isArray(links) ? links.filter((l) => l?.slug) : []
  if (list.length === 0) return 'internalLinks: []'
  const lines = ['internalLinks:']
  for (const link of list) {
    lines.push(`  - slug: ${yamlEscape(link.slug)}`)
    lines.push(`    anchor: ${yamlEscape(cleanAnchorText(link.anchor || ''))}`)
  }
  return lines.join('\n')
}

export function replaceInternalLinksYaml(yaml, links) {
  const block = renderInternalLinksYaml(links)
  const re = /^internalLinks:.*(?:\r?\n[ \t].+)*/m
  if (re.test(yaml)) {
    return yaml.replace(re, block)
  }
  if (/^externalLinks:/m.test(yaml)) {
    return yaml.replace(/^externalLinks:/m, `${block}\nexternalLinks:`)
  }
  return `${String(yaml || '').replace(/\s*$/, '')}\n${block}\n`
}

/**
 * Write frontmatter internalLinks and the body. `nextBody` is the body with
 * links placed in the text (from planDeltas); without it the legacy
 * "Further reading" block is simply removed.
 */
export function applyInternalLinksToMarkdown(raw, nextLinks, nextBodyIn) {
  const split = splitMarkdown(raw)
  if (!split.ok) {
    return { content: String(raw || ''), changed: false }
  }
  const nextYaml = replaceInternalLinksYaml(split.yaml, nextLinks)
  const nextBody = typeof nextBodyIn === 'string' ? nextBodyIn : stripFurtherReading(split.body)
  const content = `---\n${nextYaml}\n---\n${nextBody}`
  const normalizedPrev = String(raw || '').replace(/\r\n/g, '\n')
  const normalizedNext = content.replace(/\r\n/g, '\n')
  return { content, changed: normalizedPrev !== normalizedNext }
}

export function applyExternalSignpost(body, links) {
  const inner = (Array.isArray(links) ? links : [])
    .filter((link) => link?.url)
    .map((link) => `[${link.label || link.url}](${link.url})`)
    .join(' · ')
  const line = inner ? `Sources: ${inner}.` : ''
  return upsertBlock(body, EXTERNAL_START, EXTERNAL_END, line)
}

export function replaceExternalLinksYaml(yaml, links) {
  const block = renderExternalLinksYaml(links)
  const re = /^externalLinks:.*(?:\r?\n[ \t].+)*/m
  if (re.test(yaml)) {
    return yaml.replace(re, block)
  }
  if (/^internalLinks:/m.test(yaml)) {
    const internalRe = /^internalLinks:.*(?:\r?\n[ \t].+)*/m
    return yaml.replace(internalRe, (match) => `${match}\n${block}`)
  }
  return `${String(yaml || '').replace(/\s*$/, '')}\n${block}\n`
}

export function trimExternalLinks(links) {
  const list = Array.isArray(links) ? links.filter((l) => l?.url) : []
  if (list.length <= MAX_EXTERNAL_LINKS) return list
  const sorted = [...list].sort((a, b) =>
    String(a.addedAt || '').localeCompare(String(b.addedAt || ''))
  )
  const drop = sorted.length - MAX_EXTERNAL_LINKS
  const removed = new Set(sorted.slice(0, drop))
  return list.filter((link) => !removed.has(link))
}

export function applyExternalLinksToMarkdown(raw, nextLinks) {
  const split = splitMarkdown(raw)
  if (!split.ok) {
    return { content: String(raw || ''), changed: false }
  }
  const next = trimExternalLinks(nextLinks)
  const nextYaml = replaceExternalLinksYaml(split.yaml, next)
  const nextBody = applyExternalSignpost(split.body, next)
  const content = `---\n${nextYaml}\n---\n${nextBody}`
  const normalizedPrev = String(raw || '').replace(/\r\n/g, '\n')
  const normalizedNext = content.replace(/\r\n/g, '\n')
  return { content, changed: normalizedPrev !== normalizedNext }
}

export function publishedArticles(articles) {
  return (Array.isArray(articles) ? articles : []).filter(
    (article) => article?.data?.draft !== true
  )
}

/**
 * One commercial link per article: a link on the brand / offer words to any
 * site page outside /articles/ already counts, even if it points at a
 * different page than SEO Controls names.
 */
export function hasCommercialLink(body, phrases) {
  const text = String(body || '')
  return (phrases || []).some((phrase) => {
    const p = String(phrase || '').trim()
    if (!p) return false
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\[[^\\]]*${esc}[^\\]]*\\]\\((?!/articles/)(?:/|https?://)[^)]*\\)`, 'i').test(text)
  })
}

function sameKeyword(a, b) {
  const match = compareTerms(a, b)
  return match === 'exact' || match === 'same-words'
}

/**
 * Anchor phrases that may link to `target`. A supporting or pillar keyword
 * that another published article targets belongs to that article, so it is
 * never used as anchor text for this one (otherwise a cluster article steals
 * its cluster head's links).
 */
export function phrasesFor(target, published = []) {
  const out = []
  const ownedElsewhere = (phrase) =>
    published.some(
      (other) => other.slug !== target.slug && sameKeyword(phrase, other.data.targetKeyword)
    )
  const push = (v, own = false) => {
    const t = String(v || '').trim()
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) return
    if (!own && ownedElsewhere(t)) return
    out.push(t)
  }
  push(target.data.targetKeyword, true)
  push(target.data.supportingKeyword)
  if (isPillar(target)) push(target.data.pillarKeyword)
  return out
}

/**
 * For every published article: the links it should have (planInternalLinks
 * plus one commercial link), placed inside sentences that already mention
 * the target. Targets with no natural place are reported, never forced.
 *
 * @param opts.commercial { url, phrases: [string] } the page every article links to once
 */
export function planDeltas(articles, { commercial } = {}) {
  const published = publishedArticles(articles)
  const bySlug = new Map(published.map((a) => [a.slug, a]))
  const desired = planInternalLinks(published)
  const proposed = []
  const skipped = []
  const commercialUrl = String(commercial?.url || '').trim()
  const commercialPhrases = (commercial?.phrases || []).map((p) => String(p || '').trim()).filter(Boolean)

  for (const article of published) {
    const want = desired.get(article.slug) ?? new Map()
    const existing = Array.isArray(article.data.internalLinks) ? article.data.internalLinks : []
    const targets = [...want.keys()]
      .filter((slug) => slug !== article.slug && bySlug.has(slug))
      .map((slug) => ({
        href: `/${ARTICLES_BASE}/${slug}/`,
        slug,
        kind: 'internal',
        // An article's own keyword is never linked away from it.
        phrases: phrasesFor(bySlug.get(slug), published).filter(
          (phrase) => !sameKeyword(phrase, article.data.targetKeyword)
        ),
      }))
      .filter((target) => target.phrases.length > 0)
    if (commercialUrl && commercialPhrases.length && !hasCommercialLink(article.body, commercialPhrases)) {
      targets.push({ href: commercialUrl, kind: 'commercial', phrases: commercialPhrases })
    }

    const cleaned = stripFurtherReading(article.body)
    const placedResult = placeInTextLinks(cleaned, targets)
    const placedInternal = placedResult.placed.filter((p) => p.kind === 'internal')
    const signpostRemoved = cleaned !== String(article.body || '')

    if (placedResult.placed.length === 0 && !signpostRemoved) {
      skipped.push({
        slug: article.slug,
        title: String(article.data.title || article.slug),
        reason: placedResult.unplaced.length ? 'no_natural_place' : 'already_wired',
        unplaced: placedResult.unplaced.map((u) => u.slug || u.href),
      })
      continue
    }

    const merged = [...existing]
    for (const p of placedInternal) {
      if (!merged.some((l) => l.slug === p.slug)) merged.push({ slug: p.slug, anchor: p.anchor })
    }
    proposed.push({
      slug: article.slug,
      title: String(article.data.title || article.slug),
      kept: existing.filter((link) => link.slug).map(withCleanAnchor),
      added: placedResult.placed.map((p) => ({
        slug: p.slug || p.href,
        anchor: cleanAnchorText(p.anchor),
        sentence: p.sentence,
        kind: p.kind,
      })),
      unplaced: placedResult.unplaced.map((u) => u.slug || u.href),
      signpostRemoved,
      next: merged.map(withCleanAnchor),
      body: placedResult.body,
    })
  }

  return { published, proposed, skipped }
}
