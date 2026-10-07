// Structured Data: page facts (JSON-LD summaries) → issues.

import { makeIssue, dedupeIssues } from '../issues.js'

const CATEGORY = 'schema'
const CONTENT_KINDS = new Set(['article', 'pillar'])

const ARTICLE_FIELDS = [
  { key: 'headline', checkId: 'article_missing_headline', severity: 'medium', label: 'headline' },
  { key: 'datePublished', checkId: 'article_missing_date_published', severity: 'medium', label: 'datePublished' },
  { key: 'dateModified', checkId: 'article_missing_date_modified', severity: 'medium', label: 'dateModified' },
  { key: 'hasImage', checkId: 'article_missing_image', severity: 'low', label: 'image' },
]

function visibleDates(facts) {
  const dates = new Set()
  for (const t of facts?.timeElements || []) if (t?.date) dates.add(t.date)
  return dates
}

/**
 * @param {Array<{ url: string, kind: string, status: number, facts: any, error?: string | null }>} pages
 */
export function buildSchemaIssues(pages) {
  const issues = []
  const add = (input) => issues.push(makeIssue({ category: CATEGORY, ...input }))
  const analyzed = (pages || []).filter((p) => p?.facts && p.status >= 200 && p.status < 300)

  const typeCounts = {}
  let pagesWithJsonLd = 0
  let articlePages = 0
  let articlesWithSchema = 0

  for (const page of analyzed) {
    const sd = page.facts.structured || {}
    const blocks = Array.isArray(sd.blocks) ? sd.blocks : []
    for (const t of sd.allTypes || []) typeCounts[t] = (typeCounts[t] || 0) + 1
    if (blocks.length) pagesWithJsonLd += 1

    const invalid = blocks.filter((b) => !b.valid)
    if (invalid.length) {
      add({
        checkId: 'jsonld_invalid',
        severity: 'high',
        title: 'Invalid JSON-LD (parse error)',
        detail: invalid[0].error || '',
        url: page.url,
        fixHint: 'Fix the JSON syntax in the structured-data component; search engines ignore invalid blocks.',
      })
    } else if (!blocks.length) {
      add({
        checkId: 'jsonld_missing',
        severity: 'medium',
        title: 'No structured data on page',
        url: page.url,
      })
    }

    if (!CONTENT_KINDS.has(page.kind)) continue
    articlePages += 1
    const article = sd.article
    if (!article) {
      add({
        checkId: 'article_schema_missing',
        severity: 'high',
        title: 'Article/BlogPosting schema missing',
        url: page.url,
        fixHint: 'Emit BlogPosting JSON-LD from the article layout.',
      })
      continue
    }
    articlesWithSchema += 1

    for (const field of ARTICLE_FIELDS) {
      if (!article[field.key]) {
        add({
          checkId: field.checkId,
          severity: field.severity,
          title: `Article schema missing ${field.label}`,
          url: page.url,
        })
      }
    }

    const authors = Array.isArray(article.authors) ? article.authors : []
    if (!authors.length) {
      add({
        checkId: 'article_missing_author',
        severity: 'high',
        title: 'Article schema has no author',
        url: page.url,
        fixHint: 'Add author as a Person with name, url (author page) and sameAs profiles.',
      })
    } else {
      const person = authors.find((a) => (a.types || []).includes('Person'))
      if (!person) {
        add({
          checkId: 'author_not_person',
          severity: 'medium',
          title: 'Article author is not a Person',
          detail: `Author types: ${authors.map((a) => (a.types || []).join('/') || 'text').join(', ')}`,
          url: page.url,
          fixHint: 'Use a Person author; AI engines and Google weigh identifiable authors (E-E-A-T).',
        })
      } else if (!person.url && !person.sameAsCount) {
        add({
          checkId: 'author_no_profile',
          severity: 'medium',
          title: 'Author has no url or sameAs',
          detail: person.name ? `Author: ${person.name}` : '',
          url: page.url,
          fixHint: 'Add the author page URL and sameAs links (LinkedIn, X, etc.) to the Person.',
        })
      }
    }

    if (!sd.hasBreadcrumb) {
      add({
        checkId: 'breadcrumb_missing',
        severity: 'low',
        title: 'BreadcrumbList schema missing',
        url: page.url,
      })
    }
    if (page.facts.hasFaqSection && !sd.hasFaqPage) {
      add({
        checkId: 'faq_schema_missing',
        severity: 'low',
        title: 'FAQ section without FAQPage schema',
        url: page.url,
        fixHint: 'Emit FAQPage JSON-LD from the FAQ component (questions and answers must match the visible text).',
      })
    }

    // The freshest schema date must be the one readers (and crawlers) see.
    const visible = visibleDates(page.facts)
    const latestSchemaDate = article.dateModified || article.datePublished
    if (visible.size && latestSchemaDate && !visible.has(latestSchemaDate)) {
      add({
        checkId: 'schema_date_mismatch',
        severity: 'medium',
        title: 'Schema date does not match the visible date',
        detail: `Schema ${article.dateModified ? 'dateModified' : 'datePublished'} ${latestSchemaDate}; visible: ${[...visible].join(', ')}`,
        url: page.url,
        evidence: { visible: [...visible], datePublished: article.datePublished, dateModified: article.dateModified },
        fixHint: 'Render the visible published/updated dates from the same frontmatter fields as the schema.',
      })
    }
  }

  // Site-level entity schema (homepage)
  const home = analyzed.find((p) => p.kind === 'home')
  if (home) {
    const sd = home.facts.structured || {}
    const org = (sd.organizations || [])[0]
    if (!org) {
      add({
        checkId: 'organization_missing',
        severity: 'high',
        title: 'Organization schema missing on homepage',
        url: home.url,
        scope: 'site',
        fixHint: 'Add Organization JSON-LD (name, url, logo, sameAs) to the homepage.',
      })
    } else {
      if (!org.hasLogo) {
        add({
          checkId: 'organization_no_logo',
          severity: 'medium',
          title: 'Organization schema has no logo',
          url: home.url,
          scope: 'site',
        })
      }
      if (!org.sameAsCount) {
        add({
          checkId: 'organization_no_sameas',
          severity: 'medium',
          title: 'Organization schema has no sameAs links',
          url: home.url,
          scope: 'site',
          fixHint: 'List the brand’s official profiles in sameAs so engines can resolve the entity.',
        })
      }
    }
    if (!sd.hasWebSite) {
      add({
        checkId: 'website_schema_missing',
        severity: 'low',
        title: 'WebSite schema missing on homepage',
        url: home.url,
        scope: 'site',
      })
    }
  }

  return {
    issues: dedupeIssues(issues),
    metrics: {
      pagesChecked: analyzed.length,
      pagesFailed: (pages || []).length - analyzed.length,
      pagesWithJsonLd,
      articlePages,
      articlesWithSchema,
      typeCounts,
    },
  }
}
