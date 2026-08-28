import assert from 'node:assert/strict'
import { scoreSource, pickBestSource, wireProofLink, PROOF_KIND } from '../lib/article-updates/proof-link.js'
import {
  applyExternalLinksToMarkdown,
  parseArticleMarkdown,
} from '../lib/wire-internal-links/plan.js'

let passed = 0
const ok = () => { passed++ }

// 1. scoreSource: authority + keyword overlap; self / deny / bad-url excluded.
{
  const ctx = {
    targetKeyword: 'core web vitals',
    pillarKeyword: 'technical seo',
    allow: ['web.dev'],
    deny: ['spam.com'],
    host: 'rupert.example',
  }
  const good = scoreSource({ title: 'Core Web Vitals guide', url: 'https://web.dev/vitals' }, ctx)
  const weak = scoreSource({ title: 'Unrelated page', url: 'https://random.org/x' }, ctx)
  assert.ok(good > weak, 'authoritative + relevant scores higher')
  assert.equal(scoreSource({ url: 'https://rupert.example/a' }, ctx), -Infinity, 'no self-cite')
  assert.equal(scoreSource({ url: 'https://spam.com/a' }, ctx), -Infinity, 'deny excluded')
  assert.equal(scoreSource({ url: 'not-a-url' }, ctx), -Infinity, 'invalid url excluded')
  ok()
}

// 2. pickBestSource: best by score; stable on ties; null when none eligible.
{
  const ctx = { targetKeyword: 'core web vitals', pillarKeyword: '', allow: ['web.dev'], host: 'rupert.example' }
  const best = pickBestSource(
    [
      { title: 'Random', url: 'https://random.org/a' },
      { title: 'Core Web Vitals', url: 'https://web.dev/vitals' },
    ],
    ctx
  )
  assert.deepEqual(best, { label: 'Core Web Vitals', url: 'https://web.dev/vitals' })
  assert.equal(pickBestSource([{ url: 'https://rupert.example/self' }], ctx), null)
  assert.equal(pickBestSource([], ctx), null)
  ok()
}

// 3. wireProofLink: adds typed proof, replaces prior proof (no stacking).
{
  const existing = [
    { label: 'A', url: 'https://a.com', addedAt: '2026-01-01' },
    { label: 'Old proof', url: 'https://old-proof.com', addedAt: '2026-02-01', kind: PROOF_KIND },
  ]
  const next = wireProofLink(existing, { label: 'New proof', url: 'https://new-proof.com' }, { today: '2026-08-01' })
  const proofs = next.filter((l) => l.kind === PROOF_KIND)
  assert.equal(proofs.length, 1, 'exactly one proof')
  assert.equal(proofs[0].url, 'https://new-proof.com')
  assert.ok(!next.some((l) => l.url === 'https://old-proof.com'), 'old proof removed')
  assert.ok(next.some((l) => l.url === 'https://a.com'), 'non-proof link retained')
  ok()
}

// 4. wireProofLink dedupes: proof URL already present as a plain link is promoted.
{
  const existing = [{ label: 'Dup', url: 'https://dup.com', addedAt: '2026-01-01' }]
  const next = wireProofLink(existing, { label: 'Dup', url: 'https://dup.com' }, { today: '2026-08-01' })
  assert.equal(next.length, 1)
  assert.equal(next[0].kind, PROOF_KIND, 'existing link promoted to proof, not duplicated')
  ok()
}

// 5. cap of 5: proof counts, oldest NON-proof evicted, proof always kept.
{
  const existing = [
    { label: 'L1', url: 'https://1.com', addedAt: '2026-01-01' },
    { label: 'L2', url: 'https://2.com', addedAt: '2026-02-01' },
    { label: 'L3', url: 'https://3.com', addedAt: '2026-03-01' },
    { label: 'L4', url: 'https://4.com', addedAt: '2026-04-01' },
    { label: 'L5', url: 'https://5.com', addedAt: '2026-05-01' },
  ]
  const next = wireProofLink(existing, { label: 'Proof', url: 'https://proof.com' }, { today: '2026-08-01' })
  assert.equal(next.length, 5, 'capped at 5')
  assert.ok(next.some((l) => l.kind === PROOF_KIND), 'proof kept')
  assert.ok(!next.some((l) => l.url === 'https://1.com'), 'oldest non-proof evicted')
  ok()
}

// 6. End-to-end on raw markdown: typed link + CMS-EXTERNAL block round-trip.
{
  const raw = [
    '---',
    'title: "Guide"',
    'date: "2026-01-01"',
    'updatedDate: "2026-01-01"',
    'draft: false',
    'internalLinks: []',
    'externalLinks: []',
    '---',
    '',
    'Body paragraph here.',
    '',
  ].join('\n')

  const next = wireProofLink([], { label: 'Proof', url: 'https://proof.com/x' }, { today: '2026-08-01' })
  const { content, changed } = applyExternalLinksToMarkdown(raw, next)
  assert.equal(changed, true)
  assert.ok(content.includes('kind: wts-proof'), 'kind persisted in frontmatter')
  assert.ok(content.includes('<!-- CMS-EXTERNAL:START -->'), 'CMS-EXTERNAL block created')
  assert.ok(content.includes('[Proof](https://proof.com/x)'), 'body signpost rendered')

  const parsed = parseArticleMarkdown(content, 'guide.md')
  const proof = parsed.data.externalLinks.find((l) => l.kind === 'wts-proof')
  assert.ok(proof, 'proof parsed back with kind')
  assert.equal(proof.url, 'https://proof.com/x')
  ok()
}

console.log(`\nAll ${passed} proof-link assertions passed.`)
