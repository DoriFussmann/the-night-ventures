import assert from 'node:assert/strict'
import { checkCoherence, checkArticlesCoherence } from '../lib/coherence.js'

let passed = 0
const ok = () => { passed++ }

// 1. Real template article: curated short slug must NOT false-positive.
{
  const r = checkCoherence({
    slug: 'content-strategy-foundations',
    title: 'Content Strategy Foundations for Editorial SEO Teams 2026',
    pillarKeyword: 'content strategy',
    targetKeyword: 'content strategy foundations',
  })
  assert.equal(r.ok, true, JSON.stringify(r.warnings))
  ok()
}

// 2. Marker present anywhere is flagged (ties to strip-at-source).
{
  const r = checkCoherence({
    slug: 'x',
    title: 'A title',
    pillarKeyword: 'topic clusters (no volume data)',
    targetKeyword: 'a',
  })
  assert.ok(r.warnings.includes('no-volume-marker-present'))
  assert.equal(r.cleaned.pillarKeyword, 'topic clusters')
  ok()
}

// 3. Malformed slug (not idempotent under slugify).
{
  const r = checkCoherence({ slug: 'Bad Slug!', title: 'Bad Slug', pillarKeyword: 'bad' })
  assert.ok(r.warnings.includes('slug-malformed'))
  ok()
}

// 4. Slug word not present in title -> mismatch.
{
  const r = checkCoherence({
    slug: 'pricing-guide',
    title: 'How to choose a CRM',
    pillarKeyword: 'crm',
  })
  assert.ok(r.warnings.includes('slug-title-mismatch'))
  ok()
}

// 5. Pillar absent from title.
{
  const r = checkCoherence({
    slug: 'crm-guide',
    title: 'CRM guide for teams',
    pillarKeyword: 'email marketing',
  })
  assert.ok(r.warnings.includes('pillar-absent-from-title'))
  ok()
}

// 6. Empty fields flagged.
{
  const r = checkCoherence({ slug: '', title: '', pillarKeyword: '' })
  assert.ok(r.warnings.includes('slug-empty'))
  assert.ok(r.warnings.includes('title-empty'))
  assert.ok(r.warnings.includes('pillar-empty'))
  ok()
}

// 7. checkArticlesCoherence returns only the incoherent ones, across shapes.
{
  const rows = checkArticlesCoherence([
    { slug: 'content-strategy-foundations', title: 'Content Strategy Foundations for Editorial SEO Teams 2026', pillar_keyword: 'content strategy' },
    { data: { title: 'Mismatch title', pillarKeyword: 'zzz' }, slug: 'totally-different-words' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].slug, 'totally-different-words')
  ok()
}

console.log(`\nAll ${passed} coherence assertions passed.`)
