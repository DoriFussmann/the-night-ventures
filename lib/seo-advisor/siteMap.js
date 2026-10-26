/**
 * Build a keyword map (Core → Supporting, with article specs) from a site's
 * published articles. Used once to bring Rupert and Album Amicorum into the
 * Advisor's keyword map. Pure: takes parsed articles, returns the map.
 *
 * Rules
 * - Core keyword = the article's `pillarKeyword` (what the site's topic hubs
 *   use, so new articles keep landing in the right hub).
 * - Pillar article of a Core = the article in that group with no
 *   `supportingKeyword`. If there are several, the one the group links to most.
 * - Every other article in the group is a Supporting keyword:
 *   `supportingKeyword`, else `targetKeyword`.
 * - Spec: primary keyword = targetKeyword, angle = description, key messages
 *   = the article's "Key Takeaways" bullets (first 5), status Live, URL.
 */

const FORMAT_BY_TYPE = {
  comparison: 'comparison',
  howto: 'how-to',
  'how-to': 'how-to',
  faq: 'faq',
  list: 'list',
  listicle: 'list',
  template: 'template',
  comprehensive: 'guide',
  guide: 'guide',
  flex: 'explainer',
  explainer: 'explainer',
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function slugify(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Bullets under a "Key Takeaways" heading in the article body. */
export function keyTakeaways(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => /^#{2,3}\s+key takeaways\s*$/i.test(line.trim()))
  if (start === -1) return []
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break
    const m = line.match(/^\s*[-*]\s+(.+)$/)
    if (m) out.push(text(m[1].replace(/\*\*/g, '')))
  }
  return out
}

const SKIP_HEADINGS = /^(faq|frequently asked|sources|references|where things stand|conclusion|final thoughts|key takeaways|related|further reading|next steps)/i

/** Fallback when an article has no Key Takeaways: its H2 headings, which carry the argument. */
export function sectionHeadings(body) {
  return String(body || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.match(/^##\s+(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => text(m[1].replace(/[*_`]/g, '')))
    .filter((h) => h && !SKIP_HEADINGS.test(h))
}

function linksOf(data) {
  return (Array.isArray(data?.internalLinks) ? data.internalLinks : [])
    .map((link) => text(link?.slug))
    .filter(Boolean)
}

function articleUrl(siteUrl, slug, pathPrefix) {
  const base = text(siteUrl).replace(/\/+$/, '')
  return base ? `${base}${pathPrefix}${slug}/` : ''
}

/**
 * @param articles [{ slug, data, body }] parsed markdown (data = frontmatter)
 * @param opts { siteUrl, pathPrefix = '/articles/' }
 * @returns { cores: [{ keyword, spec, supporting: [{ keyword, spec, slug }] , slug }], skipped: [] }
 */
export function buildSiteKeywordMap(articles, { siteUrl = '', pathPrefix = '/articles/' } = {}) {
  const skipped = []
  const live = []
  for (const article of Array.isArray(articles) ? articles : []) {
    const data = article?.data || {}
    const slug = text(data.slug || article.slug)
    if (data.draft === true || String(data.draft) === 'true') {
      skipped.push(`${slug} (draft)`)
      continue
    }
    const pillar = text(data.pillarKeyword)
    if (!pillar) {
      skipped.push(`${slug} (no pillarKeyword)`)
      continue
    }
    live.push({ slug, data, body: article.body || '', pillar })
  }

  const groups = new Map()
  for (const article of live) {
    const key = slugify(article.pillar)
    if (!groups.has(key)) groups.set(key, { keyword: article.pillar, items: [] })
    groups.get(key).items.push(article)
  }

  const specFor = (article, type) => {
    const takeaways = keyTakeaways(article.body)
    const messages = takeaways.length >= 3 ? takeaways : sectionHeadings(article.body)
    const spec = {
      primaryKeyword: text(article.data.targetKeyword),
      angle: text(article.data.description),
      keyMessages: messages.slice(0, 5),
      messagesFrom: takeaways.length >= 3 ? 'key takeaways' : 'section headings',
      status: 'live',
      url: articleUrl(siteUrl, article.slug, pathPrefix),
    }
    if (type === 'supporting') {
      spec.format = FORMAT_BY_TYPE[text(article.data.articleType).toLowerCase()] || ''
      const exclude = new Set(
        [article.data.targetKeyword, article.data.supportingKeyword, article.pillar].map((k) =>
          text(k).toLowerCase()
        )
      )
      spec.secondaryKeywords = (Array.isArray(article.data.keywords) ? article.data.keywords : [])
        .map(text)
        .filter((k) => k && !exclude.has(k.toLowerCase()))
    }
    return spec
  }

  const cores = []
  for (const group of groups.values()) {
    const candidates = group.items.filter((item) => !text(item.data.supportingKeyword))
    const inbound = (slug) =>
      group.items.filter((item) => item.slug !== slug && linksOf(item.data).includes(slug)).length
    const pillarArticle =
      [...candidates].sort((a, b) => inbound(b.slug) - inbound(a.slug))[0] || null

    const supporting = group.items
      .filter((item) => item !== pillarArticle)
      .map((item) => ({
        keyword: text(item.data.supportingKeyword) || text(item.data.targetKeyword) || item.slug,
        slug: item.slug,
        spec: specFor(item, 'supporting'),
      }))

    cores.push({
      keyword: group.keyword,
      slug: pillarArticle?.slug || null,
      spec: pillarArticle
        ? specFor(pillarArticle, 'core')
        : { status: 'approved', keyMessages: [], angle: '', url: '', primaryKeyword: '' },
      supporting,
    })
  }

  return { cores, skipped }
}

/** Markdown preview for the user to approve before anything is written. */
export function siteMapPreviewMarkdown({ siteName, cores, skipped }) {
  const supportingTotal = cores.reduce((n, core) => n + core.supporting.length, 0)
  const lines = [
    `# Keyword map import preview: ${siteName}`,
    '',
    `${cores.length} Core keywords, ${supportingTotal} Supporting keywords. Every one is a live article.`,
    'Nothing is removed from the stored map; existing entries keep their data and only empty spec fields are filled.',
    '',
  ]
  for (const core of cores) {
    lines.push(`## Core: ${core.keyword}`)
    lines.push(`- Pillar article: ${core.spec.url || '(none on the site)'}`)
    if (core.spec.primaryKeyword) lines.push(`- Primary keyword: ${core.spec.primaryKeyword}`)
    if (core.spec.angle) lines.push(`- Angle: ${core.spec.angle}`)
    lines.push(`- Key messages (${core.spec.keyMessages.length}, from ${core.spec.messagesFrom || 'n/a'}):`)
    for (const m of core.spec.keyMessages) lines.push(`  - ${m}`)
    lines.push('')
    for (const item of core.supporting) {
      lines.push(`### Supporting: ${item.keyword}`)
      lines.push(`- URL: ${item.spec.url}`)
      if (item.spec.format) lines.push(`- Format: ${item.spec.format}`)
      if (item.spec.angle) lines.push(`- Angle: ${item.spec.angle}`)
      if (item.spec.secondaryKeywords.length) {
        lines.push(`- Secondary keywords: ${item.spec.secondaryKeywords.join(', ')}`)
      }
      lines.push(`- Key messages (${item.spec.keyMessages.length}, from ${item.spec.messagesFrom}):`)
      for (const m of item.spec.keyMessages) lines.push(`  - ${m}`)
      lines.push('')
    }
  }
  if (skipped.length) {
    lines.push('## Skipped', '', ...skipped.map((s) => `- ${s}`), '')
  }
  return lines.join('\n')
}
