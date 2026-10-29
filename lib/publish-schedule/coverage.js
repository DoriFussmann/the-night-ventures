/**
 * Pure keyword-map (content_coverage.pillars) helpers shared by the browser
 * flows and the scheduled publisher.
 */
import { stripNoVolumeTag } from '../stripNoVolumeTag.js'
import { advanceSpecStatus } from '../seo-advisor/pillars.js'

export function norm(value) {
  return stripNoVolumeTag(value).toLowerCase()
}

export function slugify(value) {
  const base = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || ''
}

export function findPillar(pillars, pillarKeyword) {
  const lower = norm(pillarKeyword)
  const slug = slugify(pillarKeyword)
  return (
    pillars.find((p) => slugify(p.keyword) === slug || p.slug === slug) ||
    pillars.find((p) => norm(p.keyword) === lower) ||
    null
  )
}

export function findSupporting(pillar, supportingKeyword) {
  const supporting = Array.isArray(pillar?.supporting) ? pillar.supporting : []
  if (!supportingKeyword) return null
  const lower = norm(supportingKeyword)
  const slug = slugify(supportingKeyword)
  return (
    supporting.find((s) => slugify(s.keyword) === slug || s.slug === slug) ||
    supporting.find((s) => norm(s.keyword) === lower) ||
    null
  )
}

export function articleMatches(item, { targetKeyword, title }) {
  const kw = norm(targetKeyword)
  const t = norm(title)
  if (kw && norm(item?.targetKeyword) === kw) return true
  if (t && norm(item?.title) === t) return true
  return false
}

/**
 * Mark articles published in the map (pure). Mirrors updateCoveragePublished.
 * @returns {{ pillars, updated, unmatched, warning? }}
 */
export function applyCoveragePublished(
  sourcePillars,
  { pillarKeyword, supportingKeyword, successes, publishedUrl = '', siteBase = '', now = new Date().toISOString() }
) {
  const list = Array.isArray(successes) ? successes : []
  const pillars = Array.isArray(sourcePillars) ? structuredClone(sourcePillars) : []
  const pillar = findPillar(pillars, pillarKeyword)
  if (!pillar) {
    return {
      updated: 0,
      unmatched: list.length,
      pillars,
      warning: `No coverage pillar matched “${pillarKeyword || '(empty)'}”.`,
    }
  }

  let updated = 0
  let unmatched = 0
  const urlFor = (frontmatter) => {
    if (publishedUrl) return String(publishedUrl).trim()
    const slug = String(frontmatter?.slug || '').trim()
    return siteBase && slug ? `${siteBase}/articles/${slug}/` : ''
  }
  let url = ''
  const markPublished = (existing, frontmatter) => {
    const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {}
    url = urlFor(fm)
    return {
      ...existing,
      status: 'published',
      publishedAt: now,
      updatedAt: now,
      draft: false,
      ...(url ? { publishedUrl: url } : {}),
      ...(fm.title ? { title: String(fm.title) } : {}),
      ...(fm.slug ? { slug: String(fm.slug) } : {}),
    }
  }

  if (!supportingKeyword) {
    for (const success of list) {
      const current =
        pillar.pillarArticle && typeof pillar.pillarArticle === 'object'
          ? pillar.pillarArticle
          : { status: 'planned' }
      const matches =
        !pillar.pillarArticle ||
        typeof pillar.pillarArticle !== 'object' ||
        articleMatches(current, success) ||
        (!current.targetKeyword && !current.title)
      if (!matches) {
        unmatched += 1
        continue
      }
      pillar.pillarArticle = markPublished(current, success.frontmatter)
      Object.assign(pillar, advanceSpecStatus(pillar, 'live', { url, type: 'core' }))
      updated += 1
    }
  } else {
    const supporting = findSupporting(pillar, supportingKeyword)
    if (!supporting) {
      return {
        updated: 0,
        unmatched: list.length,
        pillars,
        warning: `No coverage supporting keyword matched “${supportingKeyword}”.`,
      }
    }
    const planned = Array.isArray(supporting.plannedArticles) ? [...supporting.plannedArticles] : []
    for (const success of list) {
      const idx = planned.findIndex((item) => articleMatches(item, success))
      if (idx === -1) {
        unmatched += 1
        continue
      }
      planned[idx] = markPublished(planned[idx], success.frontmatter)
      updated += 1
    }
    supporting.plannedArticles = planned
    if (updated > 0) Object.assign(supporting, advanceSpecStatus(supporting, 'live', { url }))
    pillar.supporting = (pillar.supporting || []).map((s) =>
      s.slug === supporting.slug || norm(s.keyword) === norm(supporting.keyword) ? supporting : s
    )
  }

  const nextPillars = pillars.map((p) =>
    p.slug === pillar.slug || norm(p.keyword) === norm(pillar.keyword) ? pillar : p
  )
  const result = { updated, unmatched, pillars: nextPillars }
  if (unmatched > 0) {
    result.warning = `${unmatched} article${unmatched === 1 ? '' : 's'} could not be marked published in coverage.`
  }
  return result
}

/** https://<domain> from a company_profiles.domain value. */
export function siteBaseFromDomain(domain) {
  const clean = String(domain || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  return clean ? `https://${clean}` : ''
}
