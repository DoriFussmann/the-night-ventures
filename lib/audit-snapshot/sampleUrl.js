/**
 * Walk content_coverage.pillars and return the most recently published article URL.
 */
export function mostRecentPublishedUrl(pillars) {
  const candidates = []

  const pushArticle = (article) => {
    if (!article || typeof article !== 'object') return
    if (article.status !== 'published') return
    const url = String(article.publishedUrl || '').trim()
    if (!url) return
    const at = article.publishedAt ? Date.parse(article.publishedAt) : 0
    candidates.push({
      url,
      publishedAt: Number.isFinite(at) ? at : 0,
      title: article.title || null,
    })
  }

  for (const pillar of Array.isArray(pillars) ? pillars : []) {
    pushArticle(pillar?.pillarArticle)
    for (const supporting of Array.isArray(pillar?.supporting)
      ? pillar.supporting
      : []) {
      for (const article of Array.isArray(supporting?.plannedArticles)
        ? supporting.plannedArticles
        : []) {
        pushArticle(article)
      }
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.publishedAt - a.publishedAt)
  return candidates[0]
}

export function normalizeSiteUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  let url = raw
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  // Strip trailing slash for consistent PageSpeed/robots base.
  url = url.replace(/\/+$/, '')
  try {
    const parsed = new URL(url)
    if (!parsed.hostname) return null
    return parsed.origin
  } catch {
    return null
  }
}
