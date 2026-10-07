// Page facts extraction, URL helpers, hosting detection, crawl + schema issue builders.
// Run: node scripts/test-audit-page-facts.mjs
import assert from 'node:assert/strict'
import { extractPageFacts, parseRobotsDirectives, normalizeUrl, isQuestionHeading } from '../lib/audit/pageFacts.js'
import { classifyUrl, sitemapDirectives } from '../lib/audit/urls.js'
import { detectHosting } from '../lib/audit/preflight.js'
import { buildCrawlIssues } from '../lib/audit/checks/crawl.js'
import { buildSchemaIssues } from '../lib/audit/checks/schema.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const ARTICLE_URL = 'https://www.example.com/articles/how-to-audit/'

const ARTICLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>How to Audit a Site | Example</title>
  <meta name="description" content="A practical guide to auditing.">
  <meta name="robots" content="index, follow, max-snippet:-1">
  <meta property="article:modified_time" content="2026-09-01T10:00:00Z">
  <link rel="canonical" href="https://www.example.com/articles/how-to-audit/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"Organization","@id":"https://www.example.com/#org","name":"Example","logo":{"@type":"ImageObject","url":"https://www.example.com/logo.png"},"sameAs":["https://www.linkedin.com/company/example"]},
    {"@type":"Person","@id":"https://www.example.com/#dori","name":"Dori","url":"https://www.example.com/about/","sameAs":["https://x.com/dori"]},
    {"@type":"BlogPosting","headline":"How to Audit a Site","datePublished":"2026-08-01","dateModified":"2026-09-01","image":"https://www.example.com/hero.jpg","author":{"@id":"https://www.example.com/#dori"},"publisher":{"@id":"https://www.example.com/#org"}},
    {"@type":"BreadcrumbList","itemListElement":[]}
  ]}
  </script>
  <script type="application/ld+json">{ broken json </script>
  <script>var ignored = '<h2>Not a heading</h2>';</script>
</head>
<body>
  <header><a href="/">Home</a><h1>Site nav title</h1></header>
  <main>
    <article>
      <h1>How to Audit a Site</h1>
      <p>Updated <time datetime="2026-09-01">Sep 1, 2026</time></p>
      <h2>What is a site audit?</h2>
      <p>A site audit is a structured review of how search engines and AI assistants crawl, understand and cite a website.</p>
      <h2>Steps</h2>
      <ul><li>Crawl</li><li>Check schema</li></ul>
      <h3>How long does it take?</h3>
      <div><p>${'word '.repeat(80)}</p></div>
      <table><tr><td>a</td></tr></table>
      <h2>FAQ</h2>
      <details><summary>Q1</summary><p>A1</p></details>
      <p>See <a href="/articles/pillar/">the pillar guide</a> and <a href="https://developers.google.com/search" rel="nofollow">Google docs</a>.</p>
      <p data-nosnippet>Private note</p>
    </article>
  </main>
  <footer><a href="https://www.linkedin.com/company/example">LinkedIn</a><a href="mailto:hi@example.com">Mail</a></footer>
</body>
</html>`

test('extractPageFacts: head + directives', () => {
  const f = extractPageFacts(ARTICLE_HTML, { url: ARTICLE_URL, headers: { 'x-robots-tag': 'googlebot: nosnippet' } })
  assert.equal(f.lang, 'en')
  assert.equal(f.title, 'How to Audit a Site | Example')
  assert.equal(f.description, 'A practical guide to auditing.')
  assert.equal(f.canonical, ARTICLE_URL)
  assert.equal(f.robots.noindex, false)
  assert.equal(f.robots.nosnippet, true, 'X-Robots-Tag with UA prefix is honored')
  assert.equal(f.robots.maxSnippet, -1)
  assert.equal(f.dataNosnippetCount, 1)
  assert.equal(f.metaDates.modified, '2026-09-01')
})

test('extractPageFacts: headings, answer-first sections, FAQ, lists, tables', () => {
  const f = extractPageFacts(ARTICLE_HTML, { url: ARTICLE_URL })
  assert.deepEqual(f.h1s, ['Site nav title', 'How to Audit a Site'])
  assert.equal(f.mainSource, 'main')
  const what = f.sections.find((s) => s.text === 'What is a site audit?')
  assert.equal(what.isQuestion, true)
  assert.equal(what.firstBlock, 'p')
  assert.ok(what.answerWords > 10 && what.answerWords <= 60)
  assert.equal(f.sections.find((s) => s.text === 'Steps').firstBlock, 'list')
  assert.equal(f.sections.find((s) => s.text === 'How long does it take?').answerWords, 80)
  assert.ok(!f.sections.some((s) => s.text === 'Not a heading'), 'script content ignored')
  assert.equal(f.hasFaqSection, true)
  assert.equal(f.listCount, 1)
  assert.equal(f.tableCount, 1)
  assert.deepEqual(
    f.timeElements.map((t) => t.date),
    ['2026-09-01']
  )
  assert.match(f.timeElements[0].label, /Updated/)
})

test('extractPageFacts: links split internal/external with main flag', () => {
  const f = extractPageFacts(ARTICLE_HTML, { url: ARTICLE_URL })
  const pillar = f.links.internal.find((l) => l.href === 'https://www.example.com/articles/pillar/')
  assert.ok(pillar && pillar.inMain && pillar.text === 'the pillar guide')
  assert.ok(f.links.internal.some((l) => l.href === 'https://www.example.com/' && !l.inMain))
  const google = f.links.external.find((l) => l.host === 'developers.google.com')
  assert.ok(google && google.inMain && google.rel === 'nofollow')
  assert.ok(!f.links.external.some((l) => l.href.startsWith('mailto:')))
})

test('extractPageFacts: JSON-LD graph, @id author resolution, invalid block', () => {
  const sd = extractPageFacts(ARTICLE_HTML, { url: ARTICLE_URL }).structured
  assert.equal(sd.blocks.length, 2)
  assert.equal(sd.blocks.filter((b) => !b.valid).length, 1)
  assert.equal(sd.article.headline, 'How to Audit a Site')
  assert.equal(sd.article.dateModified, '2026-09-01')
  assert.equal(sd.article.hasImage, true)
  assert.equal(sd.article.authors.length, 1)
  assert.deepEqual(sd.article.authors[0].types, ['Person'])
  assert.equal(sd.article.authors[0].sameAsCount, 1)
  assert.equal(sd.article.publisher, 'Example')
  assert.equal(sd.organizations[0].hasLogo, true)
  assert.equal(sd.hasBreadcrumb, true)
  assert.equal(sd.hasFaqPage, false)
})

test('parseRobotsDirectives', () => {
  assert.equal(parseRobotsDirectives(['none']).noindex, true)
  assert.equal(parseRobotsDirectives(['index, max-snippet:50']).maxSnippet, 50)
  assert.equal(parseRobotsDirectives(['']).nosnippet, false)
})

test('helpers: normalizeUrl, isQuestionHeading, classifyUrl, sitemapDirectives, detectHosting', () => {
  assert.equal(normalizeUrl('/a#x', 'https://EXAMPLE.com/b'), 'https://example.com/a')
  assert.equal(normalizeUrl('mailto:a@b.c'), null)
  assert.equal(isQuestionHeading('How to start'), true)
  assert.equal(isQuestionHeading('Pricing'), false)
  assert.equal(isQuestionHeading('Is it worth it?'), true)
  const pillars = new Set(['https://www.example.com/guide/'])
  assert.equal(classifyUrl('https://www.example.com/', pillars), 'home')
  assert.equal(classifyUrl('https://www.example.com/guide/', pillars), 'pillar')
  assert.equal(classifyUrl('https://www.example.com/articles/x/', pillars), 'article')
  assert.equal(classifyUrl('https://www.example.com/articles/', pillars), 'listing')
  assert.equal(classifyUrl('https://www.example.com/articles/2/', pillars), 'listing')
  assert.equal(classifyUrl('https://www.example.com/about/', pillars), 'page')
  assert.deepEqual(sitemapDirectives('User-agent: *\nSitemap: https://x.com/sitemap-index.xml # main\n'), [
    'https://x.com/sitemap-index.xml',
  ])
  assert.equal(detectHosting({ 'x-vercel-id': 'iad1::abc', server: 'Vercel' }), 'Vercel')
  assert.equal(detectHosting({ 'cf-ray': '1' }), 'Cloudflare')
  assert.equal(detectHosting({ 'x-nf-request-id': '1' }), 'Netlify')
  assert.equal(detectHosting({}), 'Unknown')
})

const SITE = 'https://www.example.com'
const page = (path, extra = {}) => ({
  url: `${SITE}${path}`,
  status_code: 200,
  resource_type: 'html',
  click_depth: 1,
  meta: {
    title: `Title ${path}`,
    description: `A description long enough to pass the minimum length check for ${path}.`,
    canonical: `${SITE}${path}`,
    htags: { h1: ['H1'] },
    inbound_links_count: 3,
  },
  ...extra,
})

test('buildCrawlIssues: core checks', () => {
  const pages = [
    page('/'),
    page('/articles/a/'),
    page('/articles/b/', { meta: { ...page('/articles/b/').meta, title: 'Title /articles/a/' } }),
    page('/articles/c/', { meta: { ...page('/articles/c/').meta, inbound_links_count: 0 } }),
    page('/articles/d/', { meta: { ...page('/articles/d/').meta, canonical: `${SITE}/articles/d` } }),
    page('/about', { click_depth: 5 }),
    page('/gone/', { status_code: 404 }),
    page('/old/', { status_code: 301, location: `${SITE}/new/` }),
    { url: `${SITE}/style.css`, resource_type: 'stylesheet', status_code: 200 },
  ]
  const sitemapUrls = ['/', '/articles/a/', '/articles/b/', '/articles/c/', '/articles/d/', '/gone/'].map(
    (p) => `${SITE}${p}`
  )
  const { issues, metrics } = buildCrawlIssues({
    siteUrl: SITE,
    summary: { crawl_status: { crawl_stop_reason: 'empty_queue', pages_crawled: 9 }, domain_info: { ssl_info: { valid_certificate: true } } },
    pages,
    nonIndexable: [{ url: `${SITE}/articles/c/`, reason: 'meta_tag' }],
    redirectChains: [{ is_redirect_loop: false, chain: [{ from_url: `${SITE}/x`, to_url: `${SITE}/y` }, { from_url: `${SITE}/y`, to_url: `${SITE}/z` }] }],
    brokenLinks: [{ link_from: `${SITE}/articles/a/`, link_to: `${SITE}/gone/`, is_broken: true }],
    sitemapUrls,
    siteChecks: {
      mainHost: 'www.example.com',
      notFound: { status: 200, error: null },
      httpRedirect: { status: 200, finalUrl: 'http://www.example.com/', endsHttps: false, error: null },
      altHost: { host: 'example.com', status: 200, finalHost: 'www.example.com', redirected: true, error: null },
    },
  })
  const ids = (id) => issues.filter((i) => i.check_id === id)
  assert.equal(ids('sitemap_url_error').length, 1)
  assert.equal(ids('sitemap_url_error')[0].severity, 'critical')
  assert.equal(ids('internal_link_to_redirect').length, 1)
  assert.equal(ids('broken_internal_link')[0].url, `${SITE}/gone/`)
  assert.deepEqual(ids('broken_internal_link')[0].evidence.sources, [`${SITE}/articles/a/`])
  assert.equal(ids('redirect_chain').length, 1)
  assert.equal(ids('sitemap_url_non_indexable')[0].url, `${SITE}/articles/c/`)
  assert.equal(ids('sitemap_url_canonicalized')[0].url, `${SITE}/articles/d/`)
  assert.equal(ids('title_duplicate').length, 2)
  assert.equal(ids('orphan_page').length, 0, 'non-indexable orphan is not double-reported')
  assert.equal(ids('deep_page')[0].url, `${SITE}/about`)
  assert.equal(ids('not_in_sitemap')[0].url, `${SITE}/about`)
  assert.equal(ids('trailing_slash_inconsistent').length, 1)
  assert.equal(ids('soft_404').length, 1)
  assert.equal(ids('http_not_redirected').length, 1)
  assert.equal(ids('alternate_host_not_redirected').length, 0, 'alt host redirects correctly')
  assert.equal(metrics.htmlPages, 8)
  assert.equal(metrics.nonIndexablePages, 1)
  assert.equal(new Set(issues.map((i) => i.fingerprint)).size, issues.length, 'fingerprints unique')
})

test('buildCrawlIssues: orphan + unknown fields stay silent', () => {
  const pages = [page('/'), page('/articles/o/', { meta: { title: 'T', description: 'D'.repeat(80), canonical: `${SITE}/articles/o/`, inbound_links_count: 0 } })]
  const { issues } = buildCrawlIssues({
    siteUrl: SITE,
    summary: null,
    pages,
    nonIndexable: [],
    redirectChains: [],
    brokenLinks: null,
    sitemapUrls: [`${SITE}/`, `${SITE}/articles/o/`],
    siteChecks: null,
  })
  assert.equal(issues.filter((i) => i.check_id === 'orphan_page').length, 1)
  assert.equal(issues.filter((i) => i.check_id.startsWith('h1_')).length, 0, 'missing htags = unknown, not a failure')
})

test('buildSchemaIssues: article, author, org, dates, faq', () => {
  const good = extractPageFacts(ARTICLE_HTML, { url: ARTICLE_URL })
  const homeHtml = '<html><head><script type="application/ld+json">{"@type":"Organization","name":"Example"}</script></head><body><main><h1>Home</h1></main></body></html>'
  const bareHtml =
    '<html><head><script type="application/ld+json">{"@type":"BlogPosting","headline":"X","datePublished":"2026-01-01","author":"Someone"}</script></head><body><main><p><time datetime="2026-02-02">Feb 2</time></p></main></body></html>'
  const { issues, metrics } = buildSchemaIssues([
    { url: `${SITE}/`, kind: 'home', status: 200, facts: extractPageFacts(homeHtml, { url: `${SITE}/` }) },
    { url: ARTICLE_URL, kind: 'article', status: 200, facts: good },
    { url: `${SITE}/articles/bare/`, kind: 'article', status: 200, facts: extractPageFacts(bareHtml, { url: `${SITE}/articles/bare/` }) },
    { url: `${SITE}/articles/none/`, kind: 'article', status: 200, facts: extractPageFacts('<html><body>x</body></html>', { url: `${SITE}/articles/none/` }) },
    { url: `${SITE}/broken/`, kind: 'page', status: 500, facts: null },
  ])
  const at = (id, url) => issues.filter((i) => i.check_id === id && (!url || i.url === url))
  assert.equal(at('jsonld_invalid', ARTICLE_URL).length, 1)
  assert.equal(at('faq_schema_missing', ARTICLE_URL).length, 1)
  assert.equal(at('article_missing_author', ARTICLE_URL).length, 0)
  assert.equal(at('schema_date_mismatch', ARTICLE_URL).length, 0, 'visible date matches dateModified')
  const bare = `${SITE}/articles/bare/`
  assert.equal(at('author_not_person', bare).length, 1)
  assert.equal(at('article_missing_date_modified', bare).length, 1)
  assert.equal(at('article_missing_image', bare).length, 1)
  assert.equal(at('schema_date_mismatch', bare).length, 1)
  assert.equal(at('breadcrumb_missing', bare).length, 1)
  assert.equal(at('article_schema_missing', `${SITE}/articles/none/`).length, 1)
  assert.equal(at('organization_no_logo').length, 1)
  assert.equal(at('organization_no_sameas').length, 1)
  assert.equal(at('website_schema_missing').length, 1)
  assert.equal(at('organization_no_logo')[0].scope, 'site')
  assert.equal(metrics.pagesChecked, 4)
  assert.equal(metrics.pagesFailed, 1)
  assert.equal(metrics.articlePages, 3)
})

console.log(`\n${passed} audit page-facts tests passed`)
