import assert from 'node:assert/strict'
import { cleanupArticle, _internal } from '../lib/article-updates/cleanup.js'

const EM = '\u2014'
const LDQUO = '\u201C'
const RDQUO = '\u201D'
const RSQUO = '\u2019'

let passed = 0
const ok = (name) => {
  passed++
  // console.log('  ok -', name)
}

// --- helper to build a document with frontmatter + body -------------------
const fm = [
  '---',
  'title: "A Guide"',
  `description: "Keep ${LDQUO}curly${RDQUO} quotes here verbatim"`,
  '---',
].join('\n')

// 1. Frontmatter is verbatim — curly quotes in description survive.
{
  const doc = fm + '\n\nPlain body sentence.\n'
  const { cleaned } = cleanupArticle(doc)
  assert.ok(cleaned.includes(`${LDQUO}curly${RDQUO}`), 'frontmatter must be untouched')
  ok('frontmatter verbatim')
}

// 2. Headings are never touched.
{
  const doc = '## Where Things Stand\n\nBody text.\n'
  const { cleaned } = cleanupArticle(doc)
  assert.ok(cleaned.startsWith('## Where Things Stand'), 'heading preserved')
  ok('headings preserved')
}

// 3. WTS comment block is protected (curly quotes + em-dash inside survive).
{
  const inside = `As of 2026 ${LDQUO}living${RDQUO} URLs ${EM} matter ${EM} a lot.`
  const doc = [
    'Intro prose.',
    '',
    '<!-- WHERE-THINGS-STAND:START -->',
    inside,
    '<!-- WHERE-THINGS-STAND:END -->',
    '',
    'Outro prose.',
  ].join('\n')
  const { cleaned } = cleanupArticle(doc)
  assert.ok(cleaned.includes(inside), 'WTS block content must be untouched')
  ok('WTS block protected')
}

// 4. CMS-EXTERNAL block is protected — utm params inside survive.
{
  const link = 'Sources: [x](https://ex.com/a?utm_source=chatgpt.com).'
  const doc = [
    'Body.',
    '<!-- CMS-EXTERNAL:START -->',
    link,
    '<!-- CMS-EXTERNAL:END -->',
  ].join('\n')
  const { cleaned } = cleanupArticle(doc)
  assert.ok(cleaned.includes('utm_source=chatgpt.com'), 'CMS-EXTERNAL untouched')
  ok('CMS block protected')
}

// 5. Fenced code is untouched.
{
  const doc = ['Prose.', '', '```', `const s = ${LDQUO}x${RDQUO} // ${EM}`, '```', '', 'More.'].join('\n')
  const { cleaned } = cleanupArticle(doc)
  assert.ok(cleaned.includes(`const s = ${LDQUO}x${RDQUO}`), 'fenced code untouched')
  ok('fenced code protected')
}

// 6. Inline code is untouched by the quote pass.
{
  const doc = `Use \`${LDQUO}literal${RDQUO}\` and normalize ${LDQUO}prose${RDQUO}.\n`
  const { cleaned } = cleanupArticle(doc)
  assert.ok(cleaned.includes(`\`${LDQUO}literal${RDQUO}\``), 'inline code curly preserved')
  assert.ok(cleaned.includes('"prose"'), 'prose curly normalized')
  ok('inline code protected, prose normalized')
}

// 7. Quotes normalized in prose (curly -> straight).
{
  const doc = `He said ${LDQUO}hello${RDQUO} and it${RSQUO}s fine.\n`
  const { cleaned, stats } = cleanupArticle(doc)
  assert.equal(cleaned.trim(), `He said "hello" and it's fine.`)
  assert.equal(stats.quotesChanged, 1)
  ok('quotes normalized')
}

// 8a. Mid-line ## stripped; lone stray ** stripped (unambiguous).
{
  const doc = 'A ## leaked marker and **Key point that leaked in.\n'
  const { cleaned } = cleanupArticle(doc)
  assert.ok(!cleaned.includes('##'), 'mid-line ## removed')
  assert.ok(!cleaned.includes('**'), 'lone stray ** removed')
  ok('mid-line ## + lone ** removed')
}

// 8b. Balanced **bold** kept by default (bold is valid markdown).
{
  const doc = 'Real **bold** stays put here.\n'
  const { cleaned } = cleanupArticle(doc)
  assert.ok(cleaned.includes('**bold**'), 'balanced bold kept')
  ok('balanced bold preserved')
}

// 8c. Ambiguous unbalanced bold (odd, >1) is left verbatim and FLAGGED.
{
  const doc = '**intro and a real **bold** phrase.\n'
  const { cleaned, flags } = cleanupArticle(doc)
  assert.ok(cleaned.includes('**intro and a real **bold** phrase'), 'ambiguous left verbatim')
  assert.equal(flags.length, 1, 'ambiguous bold flagged for review')
  assert.equal(flags[0].kind, 'unbalanced-bold')
  ok('ambiguous bold flagged, not guessed')
}

// 8d. stripBalancedBold opt-in removes all ** (aggressive sweep).
{
  const doc = 'Real **bold** and **more** here.\n'
  const { cleaned } = cleanupArticle(doc, { stripBalancedBold: true })
  assert.ok(!cleaned.includes('**'), 'all bold removed under opt-in')
  ok('stripBalancedBold sweep')
}

// 9. Tracking params stripped from prose URL, real params + fragment kept.
{
  const doc =
    'See [g](https://ex.com/p?utm_source=chatgpt.com&id=7&utm_medium=x#sec) now.\n'
  const { cleaned, stats } = cleanupArticle(doc)
  assert.ok(cleaned.includes('https://ex.com/p?id=7#sec'), 'utm stripped, id + fragment kept')
  assert.ok(!/utm_/.test(cleaned), 'no utm remains')
  assert.equal(stats.trackingChanged, 1)
  ok('tracking stripped')
}

// 10. Em-dash: reduce toward target, never to zero, never below target.
// Realistic length (~400 words) with 20 spaced em-dashes (~50/1k).
{
  const tokens = []
  let dashes = 0
  for (let i = 0; i < 400; i++) {
    tokens.push(`word${i}`)
    if (i > 0 && i % 20 === 0 && dashes < 20) {
      tokens.push(EM)
      dashes++
    }
  }
  const doc = tokens.join(' ') + '.\n'
  const { stats } = cleanupArticle(doc, { emDashTargetPer1k: 10 })
  assert.ok(stats.emDashBefore >= 19, 'fixture has many em-dashes')
  assert.ok(stats.emDashBefore > stats.emDashAfter, 'em-dashes reduced')
  assert.ok(stats.emDashAfter > 0, 'not reduced to zero')
  assert.ok(stats.emDashAfter <= stats.emDashTarget, 'at or under target')
  assert.ok(stats.emDashPer1kAfter <= 10, 'density within human range')
  ok(`em-dash ${stats.emDashPer1kBefore}/1k -> ${stats.emDashPer1kAfter}/1k (target ${stats.emDashTarget})`)
}

// 11. Em-dash below target is left alone (faithful — no gratuitous edits).
{
  const doc =
    'A calm paragraph with exactly one ' + EM + ' dash among many many words here indeed.\n'
  const { stats, diffs } = cleanupArticle(doc, { emDashTargetPer1k: 10 })
  assert.equal(stats.emDashBefore, 1)
  assert.equal(stats.emDashAfter, 1)
  assert.equal(diffs.filter((d) => d.pass === 'em-dash').length, 0)
  ok('under-target em-dash untouched')
}

// 12. Lossless parenthetical rewrite: " — X — " -> " (X) ".
{
  const doc = `The result ${EM} surprisingly ${EM} held across every test we ran here today.\n`
  const { cleaned } = cleanupArticle(doc, { emDashTargetPer1k: 0 })
  assert.ok(cleaned.includes('(surprisingly)'), 'parenthetical rewrite applied')
  ok('parenthetical rewrite')
}

// 13. Idempotency: cleaning twice yields the same result.
{
  const doc = [
    fm,
    '',
    `Prose with ${LDQUO}quotes${RDQUO}, a ${EM} dash ${EM} pair, **oops and [l](https://e.com?utm_source=chatgpt.com).`,
    '',
    '## Heading stays',
    '',
    '<!-- CMS-EXTERNAL:START -->',
    'Sources: [a](https://e.com?utm_source=chatgpt.com).',
    '<!-- CMS-EXTERNAL:END -->',
  ].join('\n')
  const once = cleanupArticle(doc).cleaned
  const twice = cleanupArticle(once).cleaned
  assert.equal(once, twice, 'cleanup must be idempotent')
  ok('idempotent')
}

// 14. changed=false on already-clean input.
{
  const clean = fm.replace(`${LDQUO}curly${RDQUO}`, 'plain') + '\n\nA clean sentence.\n'
  const { changed } = cleanupArticle(clean, { emDashTargetPer1k: 10 })
  assert.equal(changed, false, 'no changes reported on clean doc')
  ok('clean doc unchanged')
}

console.log(`\nAll ${passed} cleanup assertions passed.`)
