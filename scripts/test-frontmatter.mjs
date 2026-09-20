// Tests for the real-YAML frontmatter parser (DL-8, build step 5.1).
// Run: node scripts/test-frontmatter.mjs
import assert from 'node:assert/strict'
import { parseArticleMarkdown } from '../lib/wire-internal-links/plan.js'
import { parseFrontmatter, splitFrontmatter } from '../lib/frontmatter.js'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log('✓', name)
}

// --- parity with the shapes the tools depend on -----------------------------
check('standard article: scalars, internal + external links', () => {
  const p = parseArticleMarkdown(
    `---
title: How to Raise a Seed Round
slug: seed-round
articleType: comprehensive
pillarKeyword: fundraising
targetKeyword: seed round
date: 2026-01-15
updatedDate: 2026-02-01
draft: false
internalLinks:
  - slug: pitch-deck
    anchor: pitch deck
externalLinks:
  - label: SEC guidance
    url: https://sec.gov/x
    addedAt: 2026-01-10
    kind: gov
---
Body.`,
    'seed-round.md'
  )
  assert.equal(p.ok, true)
  assert.equal(p.slug, 'seed-round')
  assert.equal(p.data.date, '2026-01-15') // date stays a string, not a Date
  assert.equal(p.data.draft, false)
  assert.deepEqual(p.data.internalLinks, [{ slug: 'pitch-deck', anchor: 'pitch deck' }])
  assert.deepEqual(p.data.externalLinks, [
    { label: 'SEC guidance', url: 'https://sec.gov/x', addedAt: '2026-01-10', kind: 'gov' },
  ])
})

check('empty arrays and missing fields default cleanly', () => {
  const p = parseArticleMarkdown(`---\ntitle: Empty\nslug: empty\ninternalLinks: []\nexternalLinks: []\n---\nB.`, 'empty.md')
  assert.deepEqual(p.data.internalLinks, [])
  assert.deepEqual(p.data.externalLinks, [])
  assert.equal(p.data.pillarKeyword, '')
})

check('legacy internal {url,label} item degrades to {slug,anchor}', () => {
  const p = parseArticleMarkdown(`---\ntitle: L\nslug: l\ninternalLinks:\n  - url: old-target\n    label: legacy anchor\n---\nB.`, 'l.md')
  assert.deepEqual(p.data.internalLinks, [{ slug: '', anchor: 'legacy anchor' }])
})

// --- things the old regex parser got WRONG ----------------------------------
check('flow-style array is parsed (regex parser returned [])', () => {
  const p = parseArticleMarkdown(
    `---\ntitle: F\nslug: f\ninternalLinks: [{slug: a, anchor: Alpha}, {slug: b, anchor: Beta}]\n---\nB.`,
    'f.md'
  )
  assert.deepEqual(p.data.internalLinks, [
    { slug: 'a', anchor: 'Alpha' },
    { slug: 'b', anchor: 'Beta' },
  ])
})

check('trailing comment is stripped from a scalar', () => {
  const p = parseArticleMarkdown(`---\ntitle: C\nslug: commented   # note\n---\nB.`, 'c.md')
  assert.equal(p.slug, 'commented')
})

check('CRLF line endings parse', () => {
  const raw = '---\r\ntitle: R\r\nslug: r\r\ninternalLinks:\r\n  - slug: x\r\n    anchor: Ex\r\n---\r\nB.'
  const p = parseArticleMarkdown(raw, 'r.md')
  assert.deepEqual(p.data.internalLinks, [{ slug: 'x', anchor: 'Ex' }])
})

// --- refuse rather than mis-parse -------------------------------------------
check('malformed YAML is refused (ok:false), not silently mis-read', () => {
  const p = parseArticleMarkdown(`---\ntitle: "unterminated\nslug: bad\n---\nB.`, 'bad.md')
  assert.equal(p.ok, false)
  const fm = parseFrontmatter(`---\ntitle: "unterminated\n---\nB.`)
  assert.equal(fm.ok, false)
  assert.ok(fm.error, 'error should be attached for malformed YAML')
})

check('no frontmatter fence: ok:false, body preserved', () => {
  const s = splitFrontmatter('Just a body.')
  assert.equal(s.ok, false)
  assert.equal(s.body, 'Just a body.')
})

console.log(`\nAll ${passed} frontmatter assertions passed.`)
