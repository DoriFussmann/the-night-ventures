// Audit Cluster Integrity: model building + issue builder (pure, no network).
// Run: node scripts/test-audit-clusters.mjs
import assert from 'node:assert/strict'
import {
  buildClusterModel,
  clusterUrls,
  buildClusterIssues,
  projectClusterFacts,
  urlKey,
} from '../lib/audit/checks/clusters.js'
import { CATEGORIES } from '../lib/audit/categories.js'
import { IMPLEMENTED_RUNNERS } from '../lib/audit/runners.js'
import { scoreCategory } from '../lib/audit/scoring.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}
const ids = (issues) => issues.map((i) => i.check_id).sort()
const S = 'https://www.x.com'

const coverage = [
  {
    slug: 'seed-funding',
    keyword: 'Seed Funding',
    pillarArticle: { title: 'Seed funding guide', targetKeyword: 'seed funding', publishedUrl: `${S}/articles/seed-funding/` },
    supporting: [
      {
        keyword: 'seed valuation',
        plannedArticles: [
          { title: 'A', targetKeyword: 'seed valuation', publishedUrl: `${S}/articles/a/`, status: 'published' },
          { title: 'B', targetKeyword: 'seed round size', publishedUrl: `${S}/articles/b/`, status: 'published' },
          { title: 'C', targetKeyword: 'safe notes', publishedUrl: `${S}/articles/c/`, status: 'published' },
          { title: 'D', targetKeyword: 'pro rata', status: 'planned' },
        ],
      },
    ],
  },
]

const page = (url, links, kind = 'article') => ({
  url,
  kind,
  status: 200,
  finalUrl: url,
  facts: { links: links.map(([href, text]) => ({ href, text })) },
})
const pillarUrl = `${S}/articles/seed-funding/`
const healthyPages = () => [
  page(pillarUrl, [[`${S}/articles/a/`, 'valuation'], [`${S}/articles/b`, 'round size'], [`https://x.com/articles/c/`, 'SAFEs']], 'pillar'),
  page(`${S}/articles/a/`, [[pillarUrl, 'seed funding guide'], [`${S}/articles/b/`, 'round size']]),
  page(`${S}/articles/b/`, [[pillarUrl, 'seed funding'], [`${S}/articles/c/`, 'SAFE notes']]),
  page(`${S}/articles/c/`, [[pillarUrl, 'our seed funding guide'], [`${S}/articles/a/`, 'valuation']]),
]

test('clusters is implemented in categories and runners', () => {
  assert.equal(CATEGORIES.find((c) => c.id === 'clusters').implemented, true)
  assert.ok(IMPLEMENTED_RUNNERS.includes('clusters'))
})

test('urlKey ignores www, trailing slash, query and case', () => {
  assert.equal(urlKey('https://www.X.com/Articles/a/?utm=1#h'), 'x.com/articles/a')
  assert.equal(urlKey('https://x.com'), 'x.com/')
  assert.equal(urlKey('mailto:a@b.c'), null)
})

test('model: coverage pillar + articles, unpublished counted', () => {
  const m = buildClusterModel(coverage, [])
  assert.equal(m.clusters.length, 1)
  const c = m.clusters[0]
  assert.equal(c.pillar.url, pillarUrl)
  assert.equal(c.articles.length, 3)
  assert.equal(c.plannedTotal, 4)
  assert.equal(c.plannedUnpublished, 1)
})

test('model: library rows join by pillar keyword, dedupe URLs, count unclustered', () => {
  const m = buildClusterModel(coverage, [
    { pillar_keyword: 'seed funding', supporting_keyword: 'x', target_keyword: 'term sheets', title: 'E', published_url: `${S}/articles/e/` },
    { pillar_keyword: 'Seed Funding', supporting_keyword: 'x', target_keyword: 'seed valuation', title: 'A dup', published_url: `https://x.com/articles/a` },
    { pillar_keyword: 'Hiring', supporting_keyword: null, target_keyword: 'hiring', title: 'Hiring', published_url: `${S}/articles/hiring/` },
    { pillar_keyword: '', supporting_keyword: null, target_keyword: 'idea', title: 'Idea', published_url: `${S}/articles/idea/` },
  ])
  const seed = m.clusters.find((c) => c.id === 'seed-funding')
  assert.equal(seed.articles.length, 4)
  const hiring = m.clusters.find((c) => c.id === 'hiring')
  assert.equal(hiring.pillar.url, `${S}/articles/hiring/`)
  assert.equal(m.unclustered, 1)
})

test('clusterUrls lists pillars first, deduped', () => {
  const urls = clusterUrls(buildClusterModel(coverage, []))
  assert.equal(urls[0].kind, 'pillar')
  assert.equal(urls.length, 4)
})

test('healthy cluster: only the planned-unpublished note, links matched across www/slash', () => {
  const model = buildClusterModel(coverage, [])
  const { issues, metrics } = buildClusterIssues(healthyPages(), { model })
  assert.deepEqual(ids(issues), ['planned_articles_unpublished'])
  assert.equal(metrics.pillarLinkCoverage, 100)
  assert.equal(metrics.backLinkCoverage, 100)
  assert.equal(metrics.clusters[0].pillarLinksOut, '3/3')
})

test('broken hub: missing links both ways, no siblings, generic + off-topic anchors', () => {
  const model = buildClusterModel(coverage, [])
  const pages = [
    page(pillarUrl, [[`${S}/articles/a/`, 'valuation']], 'pillar'),
    page(`${S}/articles/a/`, [[pillarUrl, 'click here'], [`${S}/articles/b/`, 'b']]),
    page(`${S}/articles/b/`, [[pillarUrl, 'this page']]),
    page(`${S}/articles/c/`, []),
  ]
  const { issues } = buildClusterIssues(pages, { model })
  const got = ids(issues)
  assert.equal(got.filter((x) => x === 'pillar_missing_link_to_article').length, 2)
  assert.equal(got.filter((x) => x === 'article_missing_link_to_pillar').length, 1)
  assert.equal(got.filter((x) => x === 'article_no_sibling_links').length, 2)
  assert.equal(got.filter((x) => x === 'pillar_anchor_off_topic').length, 2)
  assert.ok(got.includes('generic_anchor_text'))
  assert.ok(scoreCategory(issues, { pagesChecked: 4 }) < 80)
})

test('articles without a pillar page, page errors, and thin clusters', () => {
  const model = buildClusterModel(
    [{ slug: 'solo', keyword: 'Solo', pillarArticle: { publishedUrl: `${S}/solo/` }, supporting: [] }],
    [{ pillar_keyword: 'Orphans', supporting_keyword: 's', target_keyword: 'o1', title: 'o1', published_url: `${S}/o1/` }]
  )
  const pages = [
    { url: `${S}/solo/`, kind: 'pillar', status: 404, finalUrl: `${S}/solo/`, error: null, facts: null },
    page(`${S}/o1/`, []),
  ]
  const { issues } = buildClusterIssues(pages, { model })
  assert.deepEqual(ids(issues), ['cluster_thin', 'member_page_error', 'pillar_page_missing'])
  assert.equal(issues.find((i) => i.check_id === 'cluster_thin').severity, 'medium')
})

test('keyword cannibalization flags each page sharing a target keyword', () => {
  const model = buildClusterModel(coverage, [
    { pillar_keyword: 'Other', supporting_keyword: 's', target_keyword: 'Seed Valuation', title: 'dup', published_url: `${S}/articles/z/` },
  ])
  const { issues } = buildClusterIssues(healthyPages(), { model })
  const cann = issues.filter((i) => i.check_id === 'keyword_cannibalization')
  assert.equal(cann.length, 2)
})

test('projectClusterFacts keeps only in-content internal links', () => {
  const p = projectClusterFacts({
    h1s: ['H'],
    title: 'T',
    links: { internal: [{ href: 'a', text: 'x', inMain: true }, { href: 'b', text: 'nav', inMain: false }] },
  })
  assert.deepEqual(p.links, [{ href: 'a', text: 'x' }])
})

console.log(`\n${passed} audit cluster tests passed`)
