/**
 * Offline tests for Sprint 2: one article per keyword, sourced writing,
 * in-text links, same-results check and the guided Advisor.
 * Run: node scripts/test-sprint2.mjs
 */
import assert from 'node:assert/strict'
import {
  applySerpCache,
  checkSerpOverlap,
  normalizeResultUrl,
  overlapMessage,
  sharedCount,
  topUrlsFromSerp,
  verdictFor,
  writtenArticlesFromMap,
} from '../lib/seo-advisor/serpOverlap.js'
import { computeNextStep, formatProgress } from '../lib/seo-advisor/nextStep.js'
import { advanceSpecStatus, applyAddSecondary, serializeTree } from '../lib/seo-advisor/pillars.js'
import { newKeywordsIn, withOwnSerp } from '../lib/seo-advisor/keywordGuard.js'
import { localeFromSeoControls } from '../lib/seo-advisor/markets.js'
import { blockingOverlaps, findKeywordOverlaps } from '../lib/keyword-overlap.js'
import { applySpecToProposal, normalizePlannerSpec } from '../api/plan-cluster.js'
import { claimSourceErrors, countStatistics, sourcesToExternalLinks } from '../lib/generate-article/sources.js'
import { placeInTextLinks, phraseVariants, stripFurtherReading } from '../lib/wire-internal-links/inText.js'
import { applyInternalLinksToMarkdown, parseArticleMarkdown, planDeltas, planInternalLinks } from '../lib/wire-internal-links/plan.js'

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

const serp = (...urls) => ({ available: true, items: urls.map((url) => ({ type: 'organic', url })) })
const urls = (prefix, n, from = 0) => Array.from({ length: n }, (_, i) => `https://${prefix}${i + from}.com/page`)

/* ---------------- Same-results check ---------------- */

await test('serp: URLs normalize; top 10 organic only; shared counts', () => {
  assert.equal(normalizeResultUrl('https://www.Example.com/Guide/?a=1#x'), 'example.com/guide')
  const top = topUrlsFromSerp({
    available: true,
    items: [{ type: 'featured_snippet', url: 'https://a.com/x' }, ...urls('s', 12).map((url) => ({ type: 'organic', url }))],
  })
  assert.equal(top.length, 10)
  assert.ok(!top.includes('a.com/x'))
  assert.equal(topUrlsFromSerp({ available: false }), null)
  assert.equal(sharedCount(['a', 'b', 'c'], ['b', 'c', 'd']), 2)
  assert.deepEqual([verdictFor(5), verdictFor(4), verdictFor(3), verdictFor(2), verdictFor(1)], ['same', 'same', 'close', 'close', 'distinct'])
})

const map = () => [
  {
    slug: 'investor-outreach',
    keyword: 'investor outreach',
    supporting: [
      { slug: 'investor-list', keyword: 'investor list', serp: { urls: urls('l', 10).map(normalizeResultUrl), fetchedAt: new Date().toISOString(), market: 'us', language: 'en' } },
      { slug: 'investor-crm', keyword: 'investor crm' },
    ],
  },
]

await test('serp: 4+ shared = same; stale/missing caches refetched and returned', async () => {
  const calls = []
  const fetchSerp = async (kw) => {
    calls.push(kw)
    if (kw === 'list of investors') return serp(...urls('l', 5), ...urls('z', 5))
    if (kw === 'investor crm') return serp(...urls('c', 10))
    return serp(...urls('o', 10))
  }
  const result = await checkSerpOverlap({ keyword: 'list of investors', pillars: map(), fetchSerp, market: 'us', language: 'en' })
  assert.equal(result.verdict, 'same')
  assert.equal(result.closest.keyword, 'investor list')
  assert.equal(result.closest.shared, 5)
  assert.deepEqual(calls.sort(), ['investor crm', 'investor outreach', 'list of investors'])
  assert.deepEqual(Object.keys(result.refreshed).sort(), ['investor-outreach', 'investor-outreach/investor-crm'])
  assert.match(overlapMessage(result, 'list of investors'), /Same Google results as “investor list” \(5 of 10/)
  const cached = applySerpCache(map(), result.refreshed).pillars
  assert.equal(cached[0].supporting[1].serp.urls.length, 10)
  assert.equal(cached[0].serp.market, 'us')
})

await test('serp: market change counts as stale; 2-3 = close; failures = unchecked, never blocking', async () => {
  const calls = []
  const fetchSerp = async (kw) => {
    calls.push(kw)
    return kw === 'cold email investors' ? serp(...urls('l', 2), ...urls('q', 8)) : serp(...urls('l', 10))
  }
  const r = await checkSerpOverlap({ keyword: 'cold email investors', pillars: map(), fetchSerp, market: 'uk', language: 'en' })
  assert.ok(calls.includes('investor list'), 'uk market refetches the us cache')
  assert.equal(r.verdict, 'close')
  const down = await checkSerpOverlap({ keyword: 'x', pillars: map(), fetchSerp: async () => ({ available: false, reason: 'no creds' }) })
  assert.equal(down.checked, false)
  assert.equal(down.verdict, 'unchecked')
  assert.match(overlapMessage(down, 'x'), /Couldn't check/)
})

await test('serp: renames are not compared with themselves; own SERP cached on add', () => {
  const stored = map()
  const edited = [{ keyword: 'investor outreach', supporting: ['investor lists', 'investor crm'] }]
  assert.deepEqual(newKeywordsIn(stored, edited), ['investor lists'])
  assert.deepEqual(newKeywordsIn(edited, stored), ['investor list'])
  const own = withOwnSerp(stored, { core: 'investor outreach', keyword: 'investor crm' }, { urls: ['a'], fetchedAt: 'now' })
  assert.deepEqual(own.pillars[0].supporting[1].serp.urls, ['a'])
})

await test('add secondary: folds a keyword into an article spec once', () => {
  const first = applyAddSecondary(map(), { core: 'investor outreach', keyword: 'investor list', secondary: 'list of investors' })
  const again = applyAddSecondary(first.pillars, { core: 'investor outreach', keyword: 'investor list', secondary: 'List of investors' })
  assert.deepEqual(again.pillars[0].supporting[0].spec.secondaryKeywords, ['list of investors'])
  const core = applyAddSecondary(map(), { core: 'investor outreach', secondary: 'investor outreach strategy' })
  assert.deepEqual(core.pillars[0].spec.secondaryKeywords, ['investor outreach strategy'])
})

await test('market from SEO Controls free text', () => {
  assert.equal(localeFromSeoControls({ seo_market: 'United States', seo_language: 'English' }).market, 'us')
  assert.equal(localeFromSeoControls({ seo_market: 'USA' }).market, 'us')
  assert.equal(localeFromSeoControls({ seo_market: 'Israel', seo_language: 'Hebrew' }).dfsLocationCode, 2376)
  assert.equal(localeFromSeoControls({}).market, 'us')
  assert.equal(localeFromSeoControls({ seo_market: 'United Kingdom.', seo_language: 'English.' }).market, 'uk')
  assert.equal(localeFromSeoControls({ seo_market: 'Israel.', seo_language: 'Hebrew.' }).language, 'he')
})

/* ---------------- Guided Advisor ---------------- */

const spec = (n, status = 'approved') => ({ keyMessages: Array.from({ length: n }, (_, i) => `m${i}`), status })
const node = (keyword, s, supporting = []) => ({ slug: keyword, keyword, spec: s, supporting, backlog: [] })

await test('next step follows the map state', () => {
  assert.equal(computeNextStep([]).kind, 'cores')
  const four = ['a', 'b', 'c', 'd'].map((k) => node(k, spec(3, 'live'), [1, 2, 3, 4].map((i) => node(`${k}${i}`, spec(3, 'live')))))
  assert.equal(computeNextStep(four).kind, 'review')
  const thin = structuredClone(four)
  thin[2].supporting = thin[2].supporting.slice(0, 1)
  const s1 = computeNextStep(thin)
  assert.equal(s1.kind, 'supporting')
  assert.equal(s1.core, 'c')
  const specGap = structuredClone(four)
  specGap[1].supporting[2].spec = spec(1)
  assert.equal(computeNextStep(specGap).keyword, 'b3')
  const pillarGap = structuredClone(four)
  pillarGap[3].spec.status = 'approved'
  assert.equal(computeNextStep(pillarGap).kind, 'pillar')
  const toWrite = structuredClone(four)
  toWrite[0].supporting[0].spec.status = 'approved'
  assert.equal(computeNextStep(toWrite).kind, 'generate')
  assert.match(formatProgress(computeNextStep(four).progress), /4\/7 Core · 16 Supporting · 20\/20 specs complete · 20 Live/)
})

/* ---------------- One article per keyword ---------------- */

await test('planner: spec forces the single article onto the approved spec', () => {
  const s = normalizePlannerSpec({ primaryKeyword: 'investor list', keyMessages: ['a', 'b', 'c', 'd', 'e', 'f'], angle: 'A', secondaryKeywords: ['x'], expertNotes: 'E' })
  assert.equal(s.keyMessages.length, 5)
  const out = applySpecToProposal(
    { clusterRationale: 'r', articles: [{ title: 'T', targetKeyword: 'other', type: 'flex', keyMessages: ['z'], internalLinks: ['l'] }, { title: 'second' }] },
    { spec: s, type: 'howto', keyword: 'investor list' }
  )
  assert.equal(out.articles.length, 1)
  assert.equal(out.articles[0].targetKeyword, 'investor list')
  assert.equal(out.articles[0].type, 'howto')
  assert.deepEqual(out.articles[0].keyMessages, ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(out.articles[0].internalLinks, [])
  assert.equal(out.articles[0].expertInput, 'E')
  assert.equal(normalizePlannerSpec(null), null)
})

await test('spec status moves forward only, URL filled on publish', () => {
  const item = { keyword: 'x', spec: { status: 'approved', keyMessages: ['a'] } }
  const planned = advanceSpecStatus(item, 'planned')
  assert.equal(planned.spec.status, 'planned')
  const live = advanceSpecStatus(planned, 'live', { url: 'https://s.com/articles/x/' })
  assert.equal(live.spec.url, 'https://s.com/articles/x/')
  assert.equal(advanceSpecStatus(live, 'drafted').spec.status, 'live', 'never moves back')
  assert.equal(advanceSpecStatus(null, 'live'), null)
})

await test('cannibalization guard: a planned target that matches a written article blocks', () => {
  const pillars = [
    node('investor outreach', { ...spec(3, 'live'), url: 'https://s.com/articles/outreach/' }, [
      node('investor list', { ...spec(3, 'live'), primaryKeyword: 'investor list', url: 'https://s.com/articles/investor-list/' }),
      node('investor crm', spec(3)),
    ]),
  ]
  const written = writtenArticlesFromMap(pillars, { exceptKeyword: 'investor crm' })
  assert.equal(written.length, 2)
  const clash = blockingOverlaps(findKeywordOverlaps({ slug: 'investor-lists', targetKeyword: 'investor lists', pillarKeyword: 'investor outreach', supportingKeyword: 'investor crm', articleType: 'flex' }, written))
  assert.equal(clash[0].slug, 'investor-list')
  const ok = blockingOverlaps(findKeywordOverlaps({ slug: 'investor-crm', targetKeyword: 'investor crm', pillarKeyword: 'investor outreach', supportingKeyword: 'investor crm', articleType: 'flex' }, written))
  assert.equal(ok.length, 0)
})

await test('serializeTree exposes secondary keywords and expert notes on specs', () => {
  const t = serializeTree([{ slug: 'a', keyword: 'a', spec: { secondaryKeywords: ['b'], expertNotes: 'n' }, supporting: [] }])
  assert.deepEqual(t[0].spec.secondaryKeywords, ['b'])
  assert.equal(t[0].spec.expertNotes, 'n')
})

/* ---------------- Sourced writing ---------------- */

await test('sources: statistics need claim sources; WTS section is not counted', () => {
  const body = 'Seed rounds grew 18% last year, to $4.1 million.\n\n## Where Things Stand\n<!-- WHERE-THINGS-STAND:START -->\nUp 30%.\n<!-- WHERE-THINGS-STAND:END -->'
  assert.equal(countStatistics(body), 2)
  assert.equal(claimSourceErrors(body, []).length, 1)
  assert.equal(claimSourceErrors(body, [{ url: 'https://carta.com/x', claim: 'up 18% to $4.1 million' }]).length, 0)
  const partial = claimSourceErrors(body, [{ url: 'https://carta.com/x', claim: '18%' }])
  assert.match(partial[0], /no matching entry in claimSources: \$4\.1 million/)
  assert.equal(claimSourceErrors('No numbers here.', []).length, 0)
})

await test('sources: loading URLs become externalLinks; dead, social, own-site and duplicate ones are dropped', async () => {
  const checkUrl = async (url) => !url.includes('dead')
  const { externalLinks, dropped } = await sourcesToExternalLinks(
    {
      claimSources: [
        { url: 'https://carta.com/data/seed', claim: 'Median seed is $4.1M' },
        { url: 'https://carta.com/data/seed/', claim: 'dupe' },
        { url: 'https://dead.example.com/x', claim: 'gone' },
        { url: 'https://www.reddit.com/r/startups', claim: 'forum' },
        { url: 'https://heyrupert.com/articles/x/', claim: 'own' },
      ],
      whereThingsStandSources: [{ url: 'https://news.crunchbase.com/a', claim: 'Q3 funding' }],
    },
    { checkUrl, ownHost: 'heyrupert.com', today: '2026-10-25' }
  )
  assert.deepEqual(externalLinks.map((l) => [l.url, l.kind]), [
    ['https://carta.com/data/seed', 'claim'],
    ['https://news.crunchbase.com/a', 'where-things-stand'],
  ])
  assert.equal(externalLinks[0].addedAt, '2026-10-25')
  assert.deepEqual(dropped.map((d) => d.reason).sort(), ['did not load', 'own site', 'social or forum site'])
})

/* ---------------- In-text links ---------------- */

await test('in-text: links placed in prose only, once per paragraph, never inside links or skipped sections', () => {
  const body = [
    '## Why lists matter',
    '',
    'A good investor list starts with stage fit. Your [pitch deck](/articles/pitch-deck/) comes later.',
    '',
    'Keep the investor list current and track replies in an investor CRM.',
    '',
    '## Key Takeaways',
    '',
    '- An investor crm keeps follow-ups on time.',
  ].join('\n')
  const out = placeInTextLinks(body, [
    { href: '/articles/investor-list/', slug: 'investor-list', phrases: ['investor list'] },
    { href: '/articles/investor-crm/', slug: 'investor-crm', phrases: ['investor crm'] },
    { href: '/articles/pitch-deck/', slug: 'pitch-deck', phrases: ['pitch deck'] },
    { href: '/articles/missing/', slug: 'missing', phrases: ['venture debt'] },
  ])
  assert.match(out.body, /A good \[investor list\]\(\/articles\/investor-list\/\) starts/)
  assert.match(out.body, /track replies in an \[investor CRM\]\(\/articles\/investor-crm\/\)/)
  assert.match(out.body, /- An investor crm keeps/, 'Key Takeaways untouched')
  assert.deepEqual(out.placed.map((p) => p.slug), ['investor-list', 'investor-crm'])
  assert.deepEqual(out.unplaced.map((u) => u.slug), ['missing'])
  assert.equal(out.placed[0].sentence, 'A good investor list starts with stage fit.')
})

await test('in-text: plural/singular variants; Further reading removed', () => {
  assert.deepEqual(phraseVariants('angel investor'), ['angel investor', 'angel investors'])
  assert.deepEqual(phraseVariants('investor lists'), ['investor lists', 'investor list'])
  const stripped = stripFurtherReading('Body.\n\n<!-- CMS-INTERNAL:START -->\nFurther reading: [a](/articles/a/).\n<!-- CMS-INTERNAL:END -->\n\nMore.\nFurther reading: [b](/articles/b/).\n')
  assert.ok(!/Further reading|CMS-INTERNAL/.test(stripped))
  assert.match(stripped, /Body\.\n\nMore\./)
})

const md = (slug, fm, body) =>
  parseArticleMarkdown(
    `---\nslug: ${slug}\ntitle: ${slug}\npillarKeyword: ${fm.pillar}\n${fm.supporting ? `supportingKeyword: ${fm.supporting}\n` : ''}articleType: ${fm.type || 'flex'}\ntargetKeyword: ${fm.target}\ninternalLinks: []\n---\n${body}\n`,
    `${slug}.md`
  )

await test('link plan: pillar → every spoke; spoke → pillar + up to 3 closest siblings', () => {
  const arts = [
    md('outreach', { pillar: 'investor outreach', type: 'comprehensive', target: 'investor outreach' }, 'x'),
    ...['investor list', 'investor crm', 'investor email', 'investor update', 'cold email'].map((k) =>
      md(k.replace(/ /g, '-'), { pillar: 'investor outreach', supporting: k, target: k }, 'x')
    ),
  ]
  const plan = planInternalLinks(arts)
  assert.equal(plan.get('outreach').size, 5)
  const fromList = [...plan.get('investor-list').keys()]
  assert.equal(fromList.length, 4)
  assert.equal(fromList[0], 'outreach')
})

await test('link plan → markdown: in-text links, commercial link once, frontmatter lists them', () => {
  const pillar = md('outreach', { pillar: 'investor outreach', type: 'comprehensive', target: 'investor outreach' }, 'Start with an investor list and a plan.\n\nRupert can run it for you.')
  const spoke = md('investor-list', { pillar: 'investor outreach', supporting: 'investor list', target: 'investor list' }, 'Good investor outreach needs a list.\n\nFurther reading: [x](/articles/x/).')
  const arts = [pillar, spoke].map((a) => ({ ...a, path: `${a.slug}.md` }))
  const { proposed } = planDeltas(arts, { commercial: { url: '/book-call/', phrases: ['Book a call', 'Rupert'] } })
  const p = proposed.find((x) => x.slug === 'outreach')
  assert.deepEqual(p.added.map((a) => [a.slug, a.anchor]), [['investor-list', 'investor list'], ['/book-call/', 'Rupert']])
  const written = applyInternalLinksToMarkdown(pillar.raw, p.next, p.body)
  assert.match(written.content, /an \[investor list\]\(\/articles\/investor-list\/\) and/)
  assert.match(written.content, /\[Rupert\]\(\/book-call\/\) can run it/)
  assert.match(written.content, /internalLinks:\n  - slug: investor-list/)
  const s = proposed.find((x) => x.slug === 'investor-list')
  assert.equal(s.signpostRemoved, true)
  assert.ok(!/Further reading/.test(s.body))
  assert.match(s.body, /\[investor outreach\]\(\/articles\/outreach\/\)/)
})

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`)
