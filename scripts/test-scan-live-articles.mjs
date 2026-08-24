import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const {
  parseArticleUrl,
  extractUrlEntries,
  extractRssArticleEntries,
  parseLiveArticlePage,
  countArticleLinks,
  mergeKeyword,
  sortLiveArticles,
  toDateOnly,
  indexCoverageArticles,
  resolvePlanFields,
} = await import(
  pathToFileURL(path.join(root, 'lib/scan-live-articles/parse.js')).href
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://perfectaiwebsites.com/</loc></url>
  <url><loc>https://perfectaiwebsites.com/articles/</loc></url>
  <url><loc>https://perfectaiwebsites.com/articles/2/</loc></url>
  <url>
    <loc>https://perfectaiwebsites.com/articles/seo-site-audit/</loc>
    <lastmod>2026-08-24T00:00:00.000Z</lastmod>
  </url>
</urlset>`

const rssXml = `<?xml version="1.0"?><rss><channel>
  <link>https://perfectaiwebsites.com/</link>
  <item>
    <title>SEO Site Audit</title>
    <link>https://perfectaiwebsites.com/articles/seo-site-audit/</link>
    <pubDate>Mon, 24 Aug 2026 00:00:00 GMT</pubDate>
  </item>
</channel></rss>`

const liveHtml = `<!DOCTYPE html><html><head>
<title>SEO Site Audit: Why Your Small Business Website Needs One</title>
<meta property="article:modified_time" content="2026-08-24">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article","headline":"SEO Site Audit: Why Your Small Business Website Needs One","dateModified":"2026-08-24","keywords":"Technical SEO Audit, SEO Site Audit","articleSection":"Technical SEO Audit"}]}</script>
</head><body>
<article>
<h1>SEO Site Audit: Why Your Small Business Website Needs One</h1>
<section aria-labelledby="related-heading"><h2 id="related-heading">Related</h2>
<ul>
<li><a href="/articles/technical-seo-audit/">technical SEO audit</a></li>
<li><a href="/articles/seo-site-audit-cost/">seo site audit cost</a></li>
<li><a href="/articles/seo-site-audit-tool/">seo site audit tool</a></li>
<li><a href="/articles/what-is-seo-site-audit/">what is seo site audit</a></li>
<li><a href="/articles/how-to-conduct-a-technical-seo-site-audit/">how to</a></li>
</ul></section>
<section aria-labelledby="sources-heading"><h2 id="sources-heading">Sources</h2>
<ul>
<li><a href="https://sitebulb.com/technical-seo/" target="_blank">Learn Technical SEO</a></li>
<li><a href="https://www.semrush.com/blog/technical-seo-audit/" target="_blank">How to Perform</a></li>
<li><a href="https://www.siteimprove.com/platform/seo/technical-seo-auditing-tools/" target="_blank">Tools</a></li>
</ul></section>
</article>
</body></html>`

console.log('=== scan-live-articles unit tests ===')

assert(parseArticleUrl('https://perfectaiwebsites.com/articles/seo-site-audit/').slug === 'seo-site-audit', 'parse article slug')
assert(parseArticleUrl('https://perfectaiwebsites.com/articles/') == null, 'reject articles index')
assert(parseArticleUrl('https://perfectaiwebsites.com/articles/2/') == null, 'reject pagination')
assert(parseArticleUrl('/articles/seo-site-audit/', 'https://perfectaiwebsites.com').slug === 'seo-site-audit', 'resolve relative article href')
console.log('✓ parseArticleUrl')

const entries = extractUrlEntries(sitemapXml)
const articleEntries = entries.filter((entry) => parseArticleUrl(entry.loc))
assert(articleEntries.length === 1, `expected 1 article loc, got ${articleEntries.length}`)
assert(articleEntries[0].lastmod === '2026-08-24', 'sitemap lastmod date-only')
console.log('✓ sitemap article filtering + lastmod')

const rss = extractRssArticleEntries(rssXml, 'https://perfectaiwebsites.com')
assert(rss.length === 1 && rss[0].slug === 'seo-site-audit', 'rss item link')
assert(rss[0].lastmod === '2026-08-24', 'rss pubDate')
console.log('✓ RSS article entries')

const parsed = parseLiveArticlePage(
  liveHtml,
  'https://perfectaiwebsites.com/articles/seo-site-audit/'
)
assert(parsed.title.startsWith('SEO Site Audit'), `title: ${parsed.title}`)
assert(parsed.keyword === 'Technical SEO Audit', `keyword: ${parsed.keyword}`)
assert(parsed.lastDate === '2026-08-24', `lastDate: ${parsed.lastDate}`)
assert(parsed.internalLinks === 5, `internal: ${parsed.internalLinks}`)
assert(parsed.externalLinks === 3, `external: ${parsed.externalLinks}`)
console.log('✓ live page parse (title, keyword, date, link counts)')

const links = countArticleLinks(liveHtml, parsed.url)
assert(links.source === 'sections', 'prefer Related/Sources sections')
console.log('✓ Related/Sources section counting')

assert(
  mergeKeyword('Technical SEO Audit', { target_keyword: 'seo site audit' }) ===
    'seo site audit',
  'library target keyword wins'
)
assert(mergeKeyword('Technical SEO Audit', null) === 'Technical SEO Audit', 'live fallback')
console.log('✓ keyword merge')

const coverageBySlug = indexCoverageArticles([
  {
    keyword: 'Technical SEO Audit',
    pillarArticle: {
      slug: 'technical-seo-audit',
      type: 'comprehensive',
      title: 'Technical SEO Audit',
      targetKeyword: 'technical seo audit',
    },
    supporting: [
      {
        keyword: 'SEO Site Audit',
        plannedArticles: [
          {
            slug: 'seo-site-audit',
            type: 'comprehensive',
            title: 'SEO Site Audit',
            targetKeyword: 'seo site audit',
            publishedUrl: 'https://perfectaiwebsites.com/articles/seo-site-audit/',
          },
          {
            slug: 'what-is-seo-site-audit',
            type: 'faq',
            title: 'SEO Site Audit FAQ',
            targetKeyword: 'what is seo site audit',
          },
        ],
      },
    ],
  },
])
assert(coverageBySlug.get('seo-site-audit')?.keywordRole === 'supporting', 'coverage supporting role')
assert(coverageBySlug.get('technical-seo-audit')?.keywordRole === 'pillar', 'coverage pillar role')
assert(coverageBySlug.get('what-is-seo-site-audit')?.type === 'faq', 'coverage faq type')

const supportingPlan = resolvePlanFields({
  slug: 'seo-site-audit',
  libraryRow: null,
  coverageBySlug,
})
assert(supportingPlan.keywordRole === 'supporting', 'resolve supporting')
assert(supportingPlan.articleType === 'comprehensive', 'resolve supporting type')
assert(supportingPlan.pillarKeyword === 'Technical SEO Audit', 'resolve pillar keyword')
assert(supportingPlan.cluster === 'SEO Site Audit', 'resolve cluster')

const libraryWins = resolvePlanFields({
  slug: 'seo-site-audit',
  libraryRow: { supporting_keyword: '', type: 'howto' },
  coverageBySlug,
})
assert(libraryWins.keywordRole === 'pillar', 'library supporting empty means pillar')
assert(libraryWins.articleType === 'howto', 'library type wins')
console.log('✓ coverage + plan fields')

assert(toDateOnly('2026-08-24T00:00:00.000Z') === '2026-08-24', 'toDateOnly')

const sorted = sortLiveArticles([
  { title: 'Older', lastDate: '2026-08-17' },
  { title: 'Newer', lastDate: '2026-08-24' },
])
assert(sorted[0].title === 'Newer', 'sort lastDate desc')
console.log('✓ sort')

console.log('All scan-live-articles unit tests passed.')
