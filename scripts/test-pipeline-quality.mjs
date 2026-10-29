/**
 * Offline tests for the writer and link fixes found reviewing the first
 * Sprint 2 article. Run: node scripts/test-pipeline-quality.mjs
 */
import assert from 'node:assert/strict'
import { joinSoftBreaks, keyMessageCoverageErrors } from '../api/generate-article.js'
import { buildUserPrompt, spellingLine } from '../lib/generate-article/prompt.js'
import { sourcesToExternalLinks } from '../lib/generate-article/sources.js'
import { hasCommercialLink, parseArticleMarkdown, planDeltas } from '../lib/wire-internal-links/plan.js'
import { TOOL_BUDGET, checkOverlapBatch, planToolRun } from '../lib/seo-advisor/tools.js'
import { buildSystemPrompt } from '../lib/seo-advisor/context.js'
import { researchLocale } from '../lib/seo-advisor/markets.js'

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

await test('citation runs are rejoined inside paragraphs only', () => {
  const body = [
    'Templates help.',
    ' Well-crafted emails get replies.',
    ' That gap is research.',
    '',
    '**Subject line:** Short. ',
    'Short subject lines do better.',
    '',
    '## Heading',
    'Text under heading',
    '',
    '- one',
    '- two',
  ].join('\n')
  const out = joinSoftBreaks(body)
  assert.match(out, /^Templates help\. Well-crafted emails get replies\. That gap is research\.\n\n/)
  assert.match(out, /\*\*Subject line:\*\* Short\. Short subject lines do better\./)
  assert.match(out, /## Heading\nText under heading/)
  assert.match(out, /- one\n- two/)
})

await test('every key message must sit under a real heading', () => {
  const body = '## Fit comes first\ntext\n\n## What to cut\ntext\n\n### When you have no time\ntext'
  const messages = ['Fit research comes before copywriting', 'Show what to cut', 'Rupert is the alternative']
  assert.deepEqual(
    keyMessageCoverageErrors(messages, [
      { keyMessage: messages[0], heading: 'Fit comes first' },
      { keyMessage: messages[1], heading: '## What to cut' },
      { keyMessage: messages[2], heading: 'When you have no time' },
    ], body),
    []
  )
  const missing = keyMessageCoverageErrors(messages, [
    { keyMessage: messages[0], heading: 'Fit comes first' },
    { keyMessage: messages[1], heading: 'What to cut' },
  ], body)
  assert.match(missing[0], /"Rupert is the alternative"/)
  const wrongHeading = keyMessageCoverageErrors([messages[0]], [{ keyMessage: messages[0], heading: 'Not in body' }], body)
  assert.equal(wrongHeading.length, 1)
  assert.deepEqual(keyMessageCoverageErrors([], [], body), [])
})

await test('spelling follows the SEO Controls market', () => {
  assert.match(spellingLine({ market: 'United States', language: 'English' }), /American/)
  assert.match(spellingLine({ market: 'United Kingdom' }), /British/)
  assert.match(spellingLine({ language: 'Hebrew' }), /Write in Hebrew/)
  assert.equal(spellingLine({}), '')
  assert.match(spellingLine({ market: 'United Kingdom.', language: 'English.' }), /British/)
  assert.match(spellingLine({ language: 'Hebrew.' }), /^Write in Hebrew\.$/)
  const prompt = buildUserPrompt({
    article: { title: 'T', targetKeyword: 't', keyMessages: ['a'] },
    pillarKeyword: 'p',
    seoControls: { targetSearcher: 'founders', market: 'United States', language: 'English' },
  })
  assert.match(prompt, /SPELLING: Use American English/)
  assert.match(prompt, /KEY MESSAGE COVERAGE/)
  assert.match(prompt, /Never take a number from a marketing blog/)
  assert.match(prompt, /Do not copy or closely paraphrase/)
})

await test('source links are labelled with the page title', async () => {
  const { externalLinks } = await sourcesToExternalLinks(
    { claimSources: [{ url: 'https://carta.com/data/x', claim: 'Median seed $4.1M' }] },
    { checkUrl: async () => ({ ok: true, title: 'Carta: VC Fundraising Benchmarks' }) }
  )
  assert.equal(externalLinks[0].label, 'Carta: VC Fundraising Benchmarks')
  const noTitle = await sourcesToExternalLinks(
    { claimSources: [{ url: 'https://www.carta.com/data/x', claim: 'c' }] },
    { checkUrl: async () => ({ ok: true, title: '' }) }
  )
  assert.equal(noTitle.externalLinks[0].label, 'carta.com')
})

await test('an existing commercial link to another site page counts; no second one is added', () => {
  assert.equal(hasCommercialLink('Work with [Rupert](/how-it-works/) today.', ['Rupert']), true)
  assert.equal(hasCommercialLink('Read the [Rupert guide](/articles/x/).', ['Rupert']), false)
  const raw = (body) =>
    `---\nslug: a\ntitle: a\npillarKeyword: p\nsupportingKeyword: a\narticleType: flex\ntargetKeyword: a\ninternalLinks: []\n---\n${body}\n`
  const withLink = { ...parseArticleMarkdown(raw('Founders use [Rupert](/how-it-works/). Rupert also helps.'), 'a.md'), path: 'a.md' }
  const { proposed, skipped } = planDeltas([withLink], { commercial: { url: '/book-call/', phrases: ['Rupert'] } })
  assert.equal(proposed.length, 0)
  assert.equal(skipped[0].slug, 'a')
})

await test('Advisor budget: Add cards never use the data budget', () => {
  const data = (n) => Array.from({ length: n }, (_, i) => ({ name: 'dataforseo_keyword_volume', id: `d${i}` }))
  const cards = (n) => Array.from({ length: n }, (_, i) => ({ name: 'recommend_keyword', id: `c${i}` }))
  const first = planToolRun([...data(10), ...cards(7)])
  assert.equal(first.toRun.length, 17)
  assert.deepEqual(first.used, { data: 10, cards: 7 })
  const second = planToolRun([...data(10), ...cards(7)], first.used)
  assert.equal(second.toRun.filter((t) => t.name !== 'recommend_keyword').length, TOOL_BUDGET.data - 10)
  assert.equal(second.toRun.filter((t) => t.name === 'recommend_keyword').length, TOOL_BUDGET.cards - 7)
  assert.equal(second.skipped.length, 4 + 2)
  assert.deepEqual(second.remaining, { data: 0, cards: 0 })
})

await test('same-results check runs several candidates in one call', async () => {
  const seen = []
  const out = await checkOverlapBatch(
    { keywords: ['a', 'B', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
    async (k) => {
      seen.push(k)
      return { available: true, verdict: k === 'c' ? 'same' : 'distinct' }
    }
  )
  assert.deepEqual(seen, ['a', 'B', 'c', 'd', 'e', 'f', 'g'])
  assert.equal(out.results.find((r) => r.keyword === 'c').verdict, 'same')
  assert.match(out.note, /first 7/)
  assert.equal((await checkOverlapBatch({}, async () => ({}))).available, false)
})

await test('system prompt tells the Advisor its budget and to batch', () => {
  const prompt = buildSystemPrompt({ company: { name: 'A' }, profile: {}, industries: [], tree: [], locale: researchLocale('us') })
  assert.match(prompt, new RegExp(`${TOOL_BUDGET.data} data lookups and ${TOOL_BUDGET.cards} Add cards`))
  assert.match(prompt, /one dataforseo_serp_overlap call checks up to 7/)
})

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`)
