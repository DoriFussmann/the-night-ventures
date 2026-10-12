// Cluster Integrity: does each pillar and its supporting articles link together
// the way the content plan says they should? Pure: model + fetched pages in,
// { issues, metrics } out. The runner fetches only cluster member pages.

import { makeIssue, dedupeIssues } from '../issues.js'

const CATEGORY = 'clusters'

/** Anchor texts that tell neither readers nor search engines anything. */
export const GENERIC_ANCHORS = new Set([
  'click here', 'here', 'read more', 'learn more', 'more', 'this', 'this article',
  'this post', 'this guide', 'link', 'continue reading', 'see more', 'find out more',
  'read this', 'go', 'details', 'more info', 'read the full article', 'full article',
])

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'from', 'that', 'this', 'what', 'how',
  'why', 'are', 'can', 'into', 'about', 'best', 'guide', 'vs', 'a', 'an', 'of', 'to',
  'in', 'on', 'is', 'it', 'or', 'by', 'at', 'as', 'be',
])

/** Minimum supporting articles for a cluster to read as topical depth. */
export const MIN_CLUSTER_ARTICLES = 3

function clean(value) {
  return String(value || '')
    .replace(/\s*\[no volume\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function norm(value) {
  return clean(value).toLowerCase()
}

export function slugify(value) {
  return norm(value)
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Comparison key for a URL: host without www, path without trailing slash,
 * no query/hash, lowercased. Lets www/apex and slash variants match.
 * @param {string} value
 * @returns {string | null}
 */
export function urlKey(value) {
  try {
    const u = new URL(String(value || '').trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '').toLowerCase() || '/'
    return `${host}${path}`
  } catch {
    return null
  }
}

function tokens(value) {
  return norm(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

/**
 * Build the cluster model from the coverage plan and the published article library.
 * @param {any[]} pillars  content_coverage.pillars
 * @param {Array<{ pillar_keyword?: string, supporting_keyword?: string|null, target_keyword?: string,
 *                 title?: string, published_url?: string }>} library  published generated_articles rows
 */
export function buildClusterModel(pillars, library = []) {
  /** @type {Map<string, any>} */
  const clusters = new Map()
  const ensure = (keyword, slug) => {
    const id = slug || slugify(keyword)
    if (!id) return null
    if (!clusters.has(id)) {
      clusters.set(id, {
        id,
        keyword: clean(keyword) || id,
        pillar: null,
        articles: [],
        plannedTotal: 0,
        plannedUnpublished: 0,
      })
    }
    return clusters.get(id)
  }
  const addArticle = (cluster, article) => {
    const key = urlKey(article.url)
    if (!key) return
    if (cluster.pillar && urlKey(cluster.pillar.url) === key) return
    if (cluster.articles.some((a) => urlKey(a.url) === key)) return
    cluster.articles.push(article)
  }

  for (const p of Array.isArray(pillars) ? pillars : []) {
    const cluster = ensure(p?.keyword, p?.slug)
    if (!cluster) continue
    const pa = p?.pillarArticle && typeof p.pillarArticle === 'object' ? p.pillarArticle : null
    if (pa?.publishedUrl) {
      cluster.pillar = {
        url: String(pa.publishedUrl).trim(),
        title: clean(pa.title),
        targetKeyword: clean(pa.targetKeyword) || cluster.keyword,
      }
    }
    for (const s of Array.isArray(p?.supporting) ? p.supporting : []) {
      for (const a of Array.isArray(s?.plannedArticles) ? s.plannedArticles : []) {
        if (!a || typeof a !== 'object') continue
        cluster.plannedTotal += 1
        if (a.publishedUrl) {
          addArticle(cluster, {
            url: String(a.publishedUrl).trim(),
            title: clean(a.title),
            targetKeyword: clean(a.targetKeyword),
            supportingKeyword: clean(s?.keyword),
          })
        } else {
          cluster.plannedUnpublished += 1
        }
      }
    }
  }

  let unclustered = 0
  for (const row of library || []) {
    const url = String(row?.published_url || '').trim()
    if (!url) continue
    const pillarKeyword = clean(row.pillar_keyword)
    if (!pillarKeyword) {
      unclustered += 1
      continue
    }
    const cluster = ensure(pillarKeyword)
    const isPillar = !clean(row.supporting_keyword)
    if (isPillar) {
      if (!cluster.pillar) {
        cluster.pillar = { url, title: clean(row.title), targetKeyword: clean(row.target_keyword) || cluster.keyword }
      }
      continue
    }
    addArticle(cluster, {
      url,
      title: clean(row.title),
      targetKeyword: clean(row.target_keyword),
      supportingKeyword: clean(row.supporting_keyword),
    })
  }

  // A pillar URL may also have been added as an article before the pillar was known.
  for (const c of clusters.values()) {
    if (c.pillar) {
      const pk = urlKey(c.pillar.url)
      c.articles = c.articles.filter((a) => urlKey(a.url) !== pk)
    }
  }

  return {
    clusters: [...clusters.values()].filter((c) => c.pillar || c.articles.length),
    unclustered,
  }
}

/**
 * Member URLs to fetch, pillars first, deduplicated.
 * @returns {Array<{ url: string, kind: 'pillar'|'article', clusterId: string }>}
 */
export function clusterUrls(model, cap = 150) {
  const out = []
  const seen = new Set()
  const push = (url, kind, clusterId) => {
    const key = urlKey(url)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ url, kind, clusterId })
  }
  for (const c of model.clusters) if (c.pillar) push(c.pillar.url, 'pillar', c.id)
  for (const c of model.clusters) for (const a of c.articles) push(a.url, 'article', c.id)
  return out.slice(0, cap)
}

/** Fields kept per fetched page (keeps the run workspace small). */
export function projectClusterFacts(facts) {
  return {
    h1: facts.h1s?.[0] || '',
    title: facts.title || '',
    links: (facts.links?.internal || [])
      .filter((l) => l.inMain)
      .map((l) => ({ href: l.href, text: String(l.text || '').slice(0, 80) })),
  }
}

/**
 * @param {Array<{ url: string, kind: string, status?: number, finalUrl?: string, error?: string,
 *                 facts: { links: Array<{ href: string, text: string }> } | null }>} pages
 * @param {{ model: ReturnType<typeof buildClusterModel> }} ws
 */
export function buildClusterIssues(pages, ws) {
  const model = ws?.model || { clusters: [], unclustered: 0 }
  const issues = []

  // Page lookup by stored URL and by where it actually landed.
  const pageByKey = new Map()
  for (const p of pages || []) {
    for (const u of [p.url, p.finalUrl]) {
      const k = urlKey(u)
      if (k && !pageByKey.has(k)) pageByKey.set(k, p)
    }
  }
  const memberKeys = (url) => {
    const p = pageByKey.get(urlKey(url))
    return new Set([urlKey(url), urlKey(p?.finalUrl)].filter(Boolean))
  }
  const linksOf = (url) => {
    const p = pageByKey.get(urlKey(url))
    return p?.facts?.links || null
  }
  const linksTo = (links, targetUrl) => {
    const keys = memberKeys(targetUrl)
    return (links || []).filter((l) => keys.has(urlKey(l.href)))
  }

  const okPages = (pages || []).filter((p) => p.facts)
  const clusterRows = []
  let pillarSlots = 0
  let pillarLinked = 0
  let backSlots = 0
  let backLinked = 0

  for (const c of model.clusters) {
    const row = {
      id: c.id,
      keyword: c.keyword,
      pillarUrl: c.pillar?.url || null,
      articles: c.articles.length,
      pillarLinksOut: null,
      linksBack: null,
      siblingLinked: null,
      plannedUnpublished: c.plannedUnpublished,
    }

    if (!c.pillar && c.articles.length) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'pillar_page_missing',
          severity: 'high',
          title: 'Cluster has articles but no published pillar page',
          detail: `"${c.keyword}": ${c.articles.length} published article(s) with no pillar page to anchor them.`,
          target: `pillar:${c.id}`,
          evidence: { cluster: c.keyword, articles: c.articles.length },
          fixHint: 'Publish the pillar page, then link it to every supporting article and back.',
        })
      )
    }

    const pillarLinks = c.pillar ? linksOf(c.pillar.url) : null
    let outCount = 0
    let backCount = 0
    let siblingCount = 0
    const checkable = c.articles.filter((a) => linksOf(a.url))

    for (const a of c.articles) {
      // A page that failed to load is reported once, as member_page_error.
      if (pageByKey.get(urlKey(a.url)) && !linksOf(a.url)) continue
      const aLinks = linksOf(a.url)

      if (pillarLinks) {
        pillarSlots += 1
        if (linksTo(pillarLinks, a.url).length) {
          outCount += 1
          pillarLinked += 1
        } else {
          issues.push(
            makeIssue({
              category: CATEGORY,
              checkId: 'pillar_missing_link_to_article',
              severity: 'high',
              title: 'Pillar page does not link to this supporting article',
              detail: `Pillar "${c.keyword}" (${c.pillar.url}) has no in-content link to this article.`,
              url: a.url,
              evidence: { pillarUrl: c.pillar.url, cluster: c.keyword },
              fixHint: 'Add a contextual link from the pillar section that covers this subtopic.',
            })
          )
        }
      }

      if (!aLinks) continue

      if (c.pillar) {
        backSlots += 1
        const back = linksTo(aLinks, c.pillar.url)
        if (back.length) {
          backCount += 1
          backLinked += 1
          const pillarTokens = new Set([...tokens(c.keyword), ...tokens(c.pillar.targetKeyword)])
          const onTopic = back.some((l) => tokens(l.text).some((t) => pillarTokens.has(t)))
          if (pillarTokens.size && !onTopic) {
            issues.push(
              makeIssue({
                category: CATEGORY,
                checkId: 'pillar_anchor_off_topic',
                severity: 'low',
                title: 'Link back to the pillar does not use the pillar topic',
                detail: `Anchor text "${back[0].text || '(empty)'}" doesn't mention "${c.keyword}".`,
                url: a.url,
                evidence: { anchors: back.map((l) => l.text).slice(0, 3), cluster: c.keyword },
                fixHint: `Use anchor text that names the pillar topic, e.g. "${c.keyword}".`,
              })
            )
          }
        } else {
          issues.push(
            makeIssue({
              category: CATEGORY,
              checkId: 'article_missing_link_to_pillar',
              severity: 'high',
              title: 'Supporting article does not link back to its pillar',
              detail: `No in-content link to the "${c.keyword}" pillar (${c.pillar.url}).`,
              url: a.url,
              evidence: { pillarUrl: c.pillar.url, cluster: c.keyword },
              fixHint: 'Link to the pillar early in the article, with anchor text naming the pillar topic.',
            })
          )
        }
      }

      const siblings = c.articles.filter((s) => s !== a)
      if (siblings.length >= 2) {
        const linked = siblings.some((s) => linksTo(aLinks, s.url).length)
        if (linked) siblingCount += 1
        else {
          issues.push(
            makeIssue({
              category: CATEGORY,
              checkId: 'article_no_sibling_links',
              severity: 'medium',
              title: 'Article does not link to any other article in its cluster',
              detail: `"${c.keyword}" has ${siblings.length} other article(s); this one links to none of them.`,
              url: a.url,
              evidence: { cluster: c.keyword, siblings: siblings.length },
              fixHint: 'Link to one or two closely related articles in the same cluster where the text naturally refers to them.',
            })
          )
        }
      }
    }

    const loaded = c.articles.filter((a) => !pageByKey.get(urlKey(a.url)) || linksOf(a.url)).length
    if (pillarLinks && loaded) row.pillarLinksOut = `${outCount}/${loaded}`
    if (c.pillar && checkable.length) row.linksBack = `${backCount}/${checkable.length}`
    if (checkable.length && c.articles.length >= 3) row.siblingLinked = `${siblingCount}/${checkable.length}`

    if (c.pillar && c.articles.length < MIN_CLUSTER_ARTICLES) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'cluster_thin',
          severity: c.articles.length === 0 ? 'medium' : 'low',
          title: `Cluster has fewer than ${MIN_CLUSTER_ARTICLES} published supporting articles`,
          detail: `"${c.keyword}": ${c.articles.length} supporting article(s) published.`,
          target: `thin:${c.id}`,
          evidence: { cluster: c.keyword, articles: c.articles.length },
          fixHint: 'Publish more supporting articles so the pillar shows topical depth.',
        })
      )
    }

    if (c.plannedUnpublished > 0) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'planned_articles_unpublished',
          severity: 'low',
          title: 'Planned cluster articles not yet published',
          detail: `"${c.keyword}": ${c.plannedUnpublished} of ${c.plannedTotal} planned article(s) not published.`,
          target: `planned:${c.id}`,
          evidence: { cluster: c.keyword, unpublished: c.plannedUnpublished, planned: c.plannedTotal },
          fixHint: 'Generate and publish the remaining planned articles (Generation → Cluster).',
        })
      )
    }

    clusterRows.push(row)
  }

  // Generic anchors on links between cluster members (one issue per source page).
  const allMemberKeys = new Set()
  for (const c of model.clusters) {
    for (const u of [c.pillar?.url, ...c.articles.map((a) => a.url)].filter(Boolean)) {
      for (const k of memberKeys(u)) allMemberKeys.add(k)
    }
  }
  for (const p of okPages) {
    const generic = p.facts.links.filter(
      (l) => allMemberKeys.has(urlKey(l.href)) && GENERIC_ANCHORS.has(norm(l.text).replace(/[.:!…]+$/, ''))
    )
    if (generic.length) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'generic_anchor_text',
          severity: 'low',
          title: 'Cluster links use generic anchor text',
          detail: `${generic.length} link(s) with text like "${generic[0].text}".`,
          url: p.url,
          evidence: { anchors: generic.slice(0, 5).map((l) => ({ text: l.text, href: l.href })) },
          fixHint: 'Rewrite the anchor to describe the target page ("how to price a seed round", not "read more").',
        })
      )
    }
  }

  // Member pages that failed to load.
  for (const p of pages || []) {
    if (p.facts) continue
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'member_page_error',
        severity: 'high',
        title: 'Published cluster page could not be loaded',
        detail: `${p.kind === 'pillar' ? 'Pillar' : 'Article'} returned ${p.error || `HTTP ${p.status}`}.`,
        url: p.url,
        evidence: { status: p.status ?? null, kind: p.kind },
        fixHint: 'Fix the page or update its published URL in the article library.',
      })
    )
  }

  // Two published articles chasing the same keyword.
  const byKeyword = new Map()
  for (const c of model.clusters) {
    for (const a of [c.pillar ? { ...c.pillar, isPillar: true } : null, ...c.articles].filter(Boolean)) {
      const kw = norm(a.targetKeyword)
      if (!kw) continue
      const list = byKeyword.get(kw) || []
      if (!list.some((x) => urlKey(x.url) === urlKey(a.url))) list.push({ ...a, cluster: c.keyword })
      byKeyword.set(kw, list)
    }
  }
  for (const [kw, list] of byKeyword) {
    if (list.length < 2) continue
    for (const a of list) {
      const others = list.filter((x) => x !== a)
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'keyword_cannibalization',
          severity: 'medium',
          title: 'Another published page targets the same keyword',
          detail: `"${kw}" is also targeted by ${others.map((o) => o.url).join(', ')}.`,
          url: a.url,
          evidence: { keyword: kw, others: others.map((o) => o.url) },
          fixHint: 'Merge the pages, or retarget one to a distinct keyword and link it to the other.',
        })
      )
    }
  }

  const totalArticles = model.clusters.reduce((s, c) => s + c.articles.length, 0)
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : null)
  const warnings = []
  if (model.unclustered) {
    warnings.push(`${model.unclustered} published article(s) have no pillar assigned and were not checked.`)
  }

  return {
    issues: dedupeIssues(issues),
    metrics: {
      pagesChecked: okPages.length,
      pagesFailed: (pages || []).length - okPages.length,
      clusterCount: model.clusters.length,
      pillarsPublished: model.clusters.filter((c) => c.pillar).length,
      articleCount: totalArticles,
      pillarLinkCoverage: pct(pillarLinked, pillarSlots),
      backLinkCoverage: pct(backLinked, backSlots),
      unclustered: model.unclustered,
      clusters: clusterRows,
      warnings,
    },
  }
}
