/**
 * Offline tests for Sprint 1: SEO Controls gate, SEO brief export/import,
 * article specs, keyword limits, backlog and the site keyword-map import.
 * Run: node scripts/test-seo-controls.mjs
 */
import assert from 'node:assert/strict'
import {
  authorityFromToolResult,
  buildSeoBriefMarkdown,
  isSeoBriefMarkdown,
  parseSeoBriefMarkdown,
  seoBriefImportPreview,
  seoControlsStatus,
  SEO_CONTROL_FIELDS,
} from '../lib/seo-advisor/seoControls.js'
import {
  applyAddBacklog,
  applyAddCore,
  applyAddSupporting,
  applyImportedMap,
  applyRemoveBacklog,
  applyReplaceTree,
  applyUpdateSpec,
  MAX_CORE_KEYWORDS,
  MAX_SUPPORTING_PER_CORE,
  serializeTree,
} from '../lib/seo-advisor/pillars.js'
import { recommendKeyword } from '../lib/seo-advisor/tools.js'
import { buildSiteKeywordMap, keyTakeaways, sectionHeadings } from '../lib/seo-advisor/siteMap.js'

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`✓ ${name}`)
  } catch (err) {
    console.error(`✗ ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

const complete = {
  seo_primary_offer: 'Done-for-you investor outreach',
  target_audience: 'Seed founders',
  seo_buyer_problems: 'No investor list\nNo warm intros\nNo time\nLow reply rates',
  seo_conversion_action: 'Book a call',
  seo_commercial_url: 'https://www.heyrupert.com/book-call/',
  seo_content_edge: 'Ex-banker running real raises',
  seo_market: 'United States',
  seo_language: 'English',
}

/* ---------------- Gate ---------------- */

await test('gate: ready only when every required field is done', () => {
  assert.equal(seoControlsStatus(complete).ready, true)
  const empty = seoControlsStatus({})
  assert.equal(empty.ready, false)
  assert.equal(empty.requiredTotal, SEO_CONTROL_FIELDS.filter((f) => f.required).length)
  assert.equal(empty.requiredDone, 0)
  const missingUrl = seoControlsStatus({ ...complete, seo_commercial_url: '  ' })
  assert.deepEqual(missingUrl.missing.map((m) => m.key), ['seo_commercial_url'])
})

await test('gate: problems before buying needs at least 4 lines', () => {
  const three = seoControlsStatus({ ...complete, seo_buyer_problems: '- a\n- b\n- c' })
  assert.equal(three.ready, false)
  assert.match(three.missing[0].reason, /has 3/)
  assert.equal(seoControlsStatus({ ...complete, seo_buyer_problems: '1. a\n2. b\n3. c\n4. d' }).ready, true)
})

/* ---------------- SEO brief ---------------- */

await test('brief: lists every SEO field, filled or empty, with instructions', () => {
  const md = buildSeoBriefMarkdown({
    companyName: 'Rupert',
    domain: 'heyrupert.com',
    profile: { seo_primary_offer: 'Outreach', services: [{ title: 'Outreach', summary: 'Done for you' }] },
    keywordTree: [{ keyword: 'investor outreach', supporting: [{ keyword: 'investor list' }] }],
  })
  assert.ok(isSeoBriefMarkdown(md))
  assert.match(md, /Instructions for the AI/)
  for (const field of SEO_CONTROL_FIELDS) assert.match(md, new RegExp(`### ${field.label}`))
  assert.match(md, /### Primary offer \*required\*\n> .+\n\nOutreach/)
  assert.match(md, /_Empty — fill this in\._/)
  assert.match(md, /- Outreach: Done for you/)
  assert.match(md, /  - investor list/)
})

await test('brief: round trip parses answers; empty answers are dropped', () => {
  const md = buildSeoBriefMarkdown({ companyName: 'Rupert', profile: { seo_primary_offer: 'Outreach' } })
  const edited = md
    .replace('### Conversion action *required*\n> What a reader should do after an article. Example: “Book a call.”\n\n_Empty — fill this in._', '### Conversion action *required*\n> hint\n\nBook a call')
    .replace(/(### Problems before buying \*required\*\n> .+\n\n)_Empty — fill this in\._/, '$1- one\n- two\n* three\n4. four')
  const { values } = parseSeoBriefMarkdown(edited)
  assert.equal(values.seo_primary_offer, 'Outreach')
  assert.equal(values.seo_conversion_action, 'Book a call')
  assert.equal(values.seo_buyer_problems, 'one\ntwo\nthree\nfour')
  assert.equal(values.seo_content_edge, undefined)
  assert.equal(values.services, undefined, 'reference-only fields are never imported')
})

await test('brief: preview shows only changes and never blanks a filled field', () => {
  const profile = { seo_primary_offer: 'Outreach', seo_market: 'United States', short_description: 'We do X' }
  const rows = seoBriefImportPreview(
    { seo_primary_offer: 'Outreach', seo_market: 'US and UK', seo_language: 'English' },
    profile
  )
  assert.deepEqual(rows.map((r) => [r.key, r.change]), [
    ['seo_market', 'replace'],
    ['seo_language', 'fill'],
  ])
  const parsed = parseSeoBriefMarkdown('<!-- tnv-seo-brief v1 -->\n## SEO Controls\n### Search market *required*\n\n_Empty — fill this in._\n')
  assert.deepEqual(seoBriefImportPreview(parsed.values, profile), [])
})

await test('authority: captured only for the company’s own domain', () => {
  const moz = { available: true, target: 'www.heyrupert.com', metrics: { domainAuthority: 12, rootDomainsToRootDomain: 40 } }
  const a = authorityFromToolResult('moz_domain_metrics', moz, 'https://heyrupert.com/', null)
  assert.equal(a.domainAuthority, 12)
  assert.equal(a.referringDomains, 40)
  const b = authorityFromToolResult(
    'semrush_domain_overview',
    { available: true, domain: 'heyrupert.com', metrics: { organicKeywords: '310', organicTraffic: '95' } },
    'heyrupert.com',
    a
  )
  assert.equal(b.domainAuthority, 12, 'keeps earlier Moz data')
  assert.equal(b.organicKeywords, 310)
  assert.equal(authorityFromToolResult('moz_domain_metrics', { ...moz, target: 'rival.com' }, 'heyrupert.com'), null)
  assert.equal(authorityFromToolResult('moz_domain_metrics', { available: false }, 'heyrupert.com'), null)
})

/* ---------------- Specs and limits ---------------- */

const base = () => [
  {
    slug: 'investor-outreach',
    keyword: 'investor outreach',
    supporting: [{ slug: 'investor-list', keyword: 'investor list', plannedArticles: [] }],
  },
]

await test('add: stores the article spec and defaults status to Approved', () => {
  const { added } = applyAddSupporting(base(), {
    core: 'investor outreach',
    keyword: 'cold email investors',
    spec: { angle: 'How to cold email', keyMessages: ['a', 'b', 'c', 'd', 'e', 'f'], format: 'how-to' },
  })
  assert.equal(added.spec.status, 'approved')
  assert.equal(added.spec.keyMessages.length, 5, 'capped at 5')
  assert.equal(added.spec.format, 'how-to')
})

await test('limits: 7 Core keywords, 10 Supporting per Core', () => {
  let tree = []
  for (let i = 0; i < MAX_CORE_KEYWORDS; i += 1) tree = applyAddCore(tree, { keyword: `core ${i}` }).pillars
  assert.throws(() => applyAddCore(tree, { keyword: 'one more' }), (e) => e.code === 'limit')
  let t2 = base()
  for (let i = 1; i < MAX_SUPPORTING_PER_CORE; i += 1) {
    t2 = applyAddSupporting(t2, { core: 'investor outreach', keyword: `kw ${i}` }).pillars
  }
  assert.equal(t2[0].supporting.length, MAX_SUPPORTING_PER_CORE)
  assert.throws(() => applyAddSupporting(t2, { core: 'investor outreach', keyword: 'kw x' }), (e) => e.code === 'limit')
})

await test('limits: replace tree refuses growth past the limit but keeps legacy trees', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ keyword: `c${i}`, supporting: [] }))
  assert.throws(() => applyReplaceTree(base(), eight), (e) => e.code === 'limit')
  const legacy = eight.map((row) => ({ slug: row.keyword, keyword: row.keyword, supporting: [] }))
  assert.equal(applyReplaceTree(legacy, eight).pillars.length, 8)
})

await test('update spec: Core and Supporting, partial patch, validation', () => {
  const core = applyUpdateSpec(base(), { core: 'investor outreach', spec: { angle: 'Pillar angle' } })
  assert.equal(core.pillars[0].spec.angle, 'Pillar angle')
  const sup = applyUpdateSpec(core.pillars, {
    core: 'investor outreach',
    keyword: 'investor list',
    spec: { keyMessages: ['x', 'y', 'z'], status: 'drafted' },
  })
  const item = sup.pillars[0].supporting[0]
  assert.deepEqual(item.spec.keyMessages, ['x', 'y', 'z'])
  assert.equal(item.spec.status, 'drafted')
  const again = applyUpdateSpec(sup.pillars, { core: 'investor outreach', keyword: 'investor list', spec: { url: 'https://x/' } })
  assert.deepEqual(again.pillars[0].supporting[0].spec.keyMessages, ['x', 'y', 'z'], 'unpatched fields kept')
  assert.throws(() => applyUpdateSpec(base(), { core: 'investor outreach', spec: { keyMessages: ['1', '2', '3', '4', '5', '6'] } }), (e) => e.code === 'limit')
  assert.throws(() => applyUpdateSpec(base(), { core: 'investor outreach', spec: { status: 'done' } }))
  assert.throws(() => applyUpdateSpec(base(), { core: 'nope', spec: {} }), (e) => e.statusCode === 404)
})

await test('serialize: specs exposed; status moves forward when planned or drafted', () => {
  const pillars = [
    {
      slug: 'investor-outreach',
      keyword: 'investor outreach',
      supporting: [
        { slug: 'investor-list', keyword: 'investor list', plannedArticles: [{ title: 'x' }] },
        { slug: 'investor-crm', keyword: 'investor crm', plannedArticles: [] },
        { slug: 'cold-email', keyword: 'cold email', plannedArticles: [], spec: { status: 'live' } },
      ],
    },
  ]
  const t = serializeTree(pillars, [{ pillar_keyword: 'investor outreach', supporting_keyword: 'investor crm' }])
  assert.equal(t[0].spec.status, 'approved')
  assert.deepEqual(t[0].supporting.map((s) => s.spec.status), ['planned', 'drafted', 'live'])
  assert.deepEqual(t[0].backlog, [])
})

await test('backlog: park, reject duplicates, promote removes it, remove', () => {
  let { pillars } = applyAddBacklog(base(), { core: 'investor outreach', keyword: 'investor email template' })
  assert.equal(pillars[0].backlog.length, 1)
  assert.throws(() => applyAddBacklog(pillars, { core: 'investor outreach', keyword: 'investor list' }), (e) => e.code === 'duplicate')
  const promoted = applyAddSupporting(pillars, { core: 'investor outreach', keyword: 'investor email template' })
  assert.equal(promoted.pillars[0].backlog.length, 0)
  pillars = applyAddBacklog(pillars, { core: 'investor outreach', keyword: 'other idea' }).pillars
  assert.equal(applyRemoveBacklog(pillars, { core: 'investor outreach', keyword: 'other idea' }).pillars[0].backlog.length, 1)
})

await test('recommend_keyword: carries the spec and respects limits', () => {
  const ok = recommendKeyword(
    { type: 'supporting', keyword: 'cold email investors', core: 'investor outreach', reason: 'r', angle: 'A', key_messages: ['1', '2', '3'], format: 'how-to' },
    { pillars: base() }
  )
  assert.equal(ok.shown, true)
  assert.deepEqual(ok.card.spec.keyMessages, ['1', '2', '3'])
  assert.equal(ok.card.spec.format, 'how-to')
  const thin = recommendKeyword({ type: 'core', keyword: 'pitch deck', reason: 'r', angle: 'A', key_messages: ['1'] }, { pillars: base() })
  assert.ok(thin.warning)
  const full = Array.from({ length: MAX_CORE_KEYWORDS }, (_, i) => ({ slug: `c${i}`, keyword: `c${i}`, supporting: [] }))
  assert.equal(recommendKeyword({ type: 'core', keyword: 'new', reason: 'r' }, { pillars: full }).shown, false)
})

/* ---------------- Site map import ---------------- */

const art = (slug, data, body = '') => ({ slug, data: { slug, draft: false, ...data }, body })

await test('site map: groups by pillarKeyword, picks the pillar article, builds specs', () => {
  const body = '## Key Takeaways\n\n- One\n- **Two**\n- Three\n\n## Next\n- not a takeaway'
  const { cores, skipped } = buildSiteKeywordMap(
    [
      art('slow-childhood', { pillarKeyword: 'Slow Childhood', targetKeyword: 'slow childhood', description: 'Pillar', internalLinks: [{ slug: 'analog-toys' }] }, body),
      art('benefits-of-handwriting', { pillarKeyword: 'Slow Childhood', targetKeyword: 'benefits of handwriting', internalLinks: [{ slug: 'slow-childhood' }] }, '## Why it matters\n## FAQ\n## The brain'),
      art('analog-toys', { pillarKeyword: 'Slow Childhood', supportingKeyword: 'analog toys', targetKeyword: 'analog toys', articleType: 'comparison', keywords: ['analog toys', 'wooden toys'], internalLinks: [{ slug: 'slow-childhood' }] }),
      art('draft-one', { pillarKeyword: 'Slow Childhood', draft: true }),
      art('orphan', {}),
    ],
    { siteUrl: 'https://www.albumamicorum.com/' }
  )
  assert.equal(cores.length, 1)
  const core = cores[0]
  assert.equal(core.keyword, 'Slow Childhood')
  assert.equal(core.slug, 'slow-childhood', 'most-linked candidate is the pillar')
  assert.equal(core.spec.url, 'https://www.albumamicorum.com/articles/slow-childhood/')
  assert.deepEqual(core.spec.keyMessages, ['One', 'Two', 'Three'])
  assert.equal(core.spec.status, 'live')
  assert.deepEqual(core.supporting.map((s) => s.keyword), ['benefits of handwriting', 'analog toys'])
  assert.deepEqual(core.supporting[0].spec.keyMessages, ['Why it matters', 'The brain'], 'heading fallback skips FAQ')
  assert.equal(core.supporting[1].spec.format, 'comparison')
  assert.deepEqual(core.supporting[1].spec.secondaryKeywords, ['wooden toys'])
  assert.equal(skipped.length, 2)
  assert.deepEqual(keyTakeaways('no heading'), [])
  assert.deepEqual(sectionHeadings('## Sources\n## Real point'), ['Real point'])
})

await test('site map merge: fills empty specs, keeps data, never removes, parks overflow', () => {
  const stored = [
    {
      slug: 'investor-outreach',
      keyword: 'investor outreach',
      pillarArticle: { status: 'planned' },
      spec: { angle: 'Keep me', keyMessages: [], status: 'approved' },
      supporting: [{ slug: 'investor-list', keyword: 'investor list', plannedArticles: [{ t: 1 }] }],
    },
    { slug: 'unrelated', keyword: 'unrelated', supporting: [] },
  ]
  const imported = [
    {
      keyword: 'investor outreach',
      spec: { angle: 'New', keyMessages: ['a', 'b', 'c'], status: 'live', url: 'https://x/a/' },
      supporting: [
        { keyword: 'investor list', spec: { keyMessages: ['m'], status: 'live' } },
        ...Array.from({ length: 10 }, (_, i) => ({ keyword: `extra ${i}`, spec: { status: 'live' } })),
      ],
    },
    { keyword: 'pitch deck', spec: { status: 'live' }, supporting: [{ keyword: 'unrelated', spec: {} }] },
  ]
  const { pillars, report } = applyImportedMap(stored, imported)
  const outreach = pillars[0]
  assert.equal(outreach.spec.angle, 'Keep me', 'existing text kept')
  assert.deepEqual(outreach.spec.keyMessages, ['a', 'b', 'c'], 'empty list filled')
  assert.equal(outreach.spec.status, 'live')
  assert.deepEqual(outreach.pillarArticle, { status: 'planned' })
  assert.deepEqual(outreach.supporting[0].plannedArticles, [{ t: 1 }])
  assert.equal(outreach.supporting.length, 10)
  assert.equal(report.parked.length, 1)
  assert.equal(outreach.backlog.length, 1)
  assert.ok(pillars.some((p) => p.keyword === 'unrelated'), 'nothing removed')
  assert.ok(report.conflicts.some((c) => c.startsWith('unrelated')))
  assert.deepEqual(report.coresAdded, ['pitch deck'])
})

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`)
