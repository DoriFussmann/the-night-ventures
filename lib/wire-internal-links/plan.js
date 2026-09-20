import { parseFrontmatter, splitFrontmatter } from '../frontmatter.js'

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

export function yamlEscape(value) {
  const text = String(value ?? '')
  if (
    text === '' ||
    /[:#{}[\],&*?|>!%@`]/.test(text) ||
    /^\s|\s$/.test(text) ||
    text.includes('\n') ||
    text.includes('"') ||
    /^(true|false|null|yes|no|on|off)$/i.test(text)
  ) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }
  return text
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

function sortKey(article) {
  return String(article.data.updatedDate || article.data.date || '')
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

export function planInternalLinks(articles) {
  const desired = new Map()
  const list = Array.isArray(articles) ? articles : []
  const pillars = list.filter(isPillar)

  for (const pillar of pillars) {
    const pk = norm(pillar.data.pillarKeyword)
    for (const other of list) {
      if (norm(other.data.pillarKeyword) === pk) addLink(desired, pillar.slug, other)
    }
  }

  for (const article of list) {
    if (isPillar(article)) continue
    const pk = norm(article.data.pillarKeyword)
    const pillar = pillars.find((p) => norm(p.data.pillarKeyword) === pk)
    if (pillar) addLink(desired, article.slug, pillar)
  }

  const siblingGroups = new Map()
  for (const article of list) {
    const sk = norm(article.data.supportingKeyword)
    const pk = norm(article.data.pillarKeyword)
    if (!sk || !pk) continue
    const key = `${pk}::${sk}`
    const group = siblingGroups.get(key) ?? []
    group.push(article)
    siblingGroups.set(key, group)
  }
  for (const group of siblingGroups.values()) {
    for (const a of group) {
      for (const b of group) addLink(desired, a.slug, b)
    }
  }

  if (pillars.length <= 6) {
    for (const a of pillars) {
      for (const b of pillars) addLink(desired, a.slug, b)
    }
  } else {
    for (const a of pillars) {
      const others = pillars
        .filter((p) => p.slug !== a.slug)
        .sort((x, y) => sortKey(y).localeCompare(sortKey(x)))
        .slice(0, 5)
      for (const b of others) addLink(desired, a.slug, b)
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

export function applyInternalLinksToMarkdown(raw, nextLinks) {
  const split = splitMarkdown(raw)
  if (!split.ok) {
    return { content: String(raw || ''), changed: false }
  }
  const nextYaml = replaceInternalLinksYaml(split.yaml, nextLinks)
  const nextBody = applyInternalSignpost(split.body, nextLinks)
  const content = `---\n${nextYaml}\n---\n${nextBody}`
  const normalizedPrev = String(raw || '').replace(/\r\n/g, '\n')
  const normalizedNext = content.replace(/\r\n/g, '\n')
  return { content, changed: normalizedPrev !== normalizedNext }
}

export function todayIso(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function applyExternalSignpost(body, links) {
  const inner = (Array.isArray(links) ? links : [])
    .filter((link) => link?.url)
    .map((link) => `[${link.label || link.url}](${link.url})`)
    .join(' · ')
  const line = inner ? `Sources: ${inner}.` : ''
  return upsertBlock(body, EXTERNAL_START, EXTERNAL_END, line)
}

export function renderExternalLinksYaml(links) {
  const list = Array.isArray(links) ? links.filter((l) => l?.url) : []
  if (list.length === 0) return 'externalLinks: []'
  const lines = ['externalLinks:']
  for (const link of list) {
    lines.push(`  - label: ${yamlEscape(link.label || link.url)}`)
    lines.push(`    url: ${yamlEscape(link.url)}`)
    lines.push(`    addedAt: ${yamlEscape(link.addedAt || todayIso())}`)
    if (link.kind) lines.push(`    kind: ${yamlEscape(link.kind)}`)
  }
  return lines.join('\n')
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

export function planDeltas(articles) {
  const published = publishedArticles(articles)
  const bySlug = new Map(published.map((a) => [a.slug, a]))
  const desired = planInternalLinks(published)
  const proposed = []
  const skipped = []

  for (const article of published) {
    const want = desired.get(article.slug) ?? new Map()
    const existing = Array.isArray(article.data.internalLinks)
      ? article.data.internalLinks
      : []
    const have = new Set(existing.map((l) => l.slug).filter(Boolean))
    const delta = [...want.entries()].filter(
      ([slug]) => !have.has(slug) && bySlug.has(slug)
    )
    // Merge only: start from existing internalLinks and append missing
    // targets. Never drop an existing link (including ones not in `want`).
    if (
      !delta.length &&
      existing.length === want.size &&
      existing.every((l) => want.has(l.slug))
    ) {
      skipped.push({
        slug: article.slug,
        title: String(article.data.title || article.slug),
        reason: 'already_wired',
      })
      continue
    }
    const merged = [...existing]
    for (const [slug, anchor] of want) {
      if (slug === article.slug) continue
      if (!merged.some((l) => l.slug === slug)) merged.push({ slug, anchor })
    }
    const added = delta.map(([slug, anchor]) =>
      withCleanAnchor({ slug, anchor })
    )
    proposed.push({
      slug: article.slug,
      title: String(article.data.title || article.slug),
      kept: existing.filter((link) => link.slug).map(withCleanAnchor),
      added,
      next: merged.map(withCleanAnchor),
    })
  }

  return { published, proposed, skipped }
}
