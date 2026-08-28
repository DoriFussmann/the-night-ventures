import assert from 'node:assert/strict'
import {
  CLEANUP_DEFAULTS,
  readCleanupOpts,
  asApprovedSlugs,
  selectCleanupCandidates,
  buildCleanupPreview,
  buildCleanupCommitPlan,
} from '../lib/article-updates/cleanup-run.js'

const EM = '\u2014'
const LDQUO = '\u201C'
const RDQUO = '\u201D'

let passed = 0
const ok = () => { passed++ }

// Fabricated live-article factory (matches loadLiveArticles shape enough).
function liveArticle(slug, bodyProse, { draft = false, title = slug } = {}) {
  const raw = [
    '---',
    `title: "${title}"`,
    'date: "2026-01-01"',
    'updatedDate: "2026-01-01"',
    draft ? 'draft: true' : 'draft: false',
    '---',
    '',
    bodyProse,
    '',
  ].join('\n')
  return { ok: true, slug, path: `site/src/content/articles/${slug}.md`, raw, data: { title, draft } }
}

function presented(slug, { bucket, daysSince, draft = false, title = slug } = {}) {
  return { slug, title, bucket, daysSince, draft }
}

const dirty = `An intro ${EM} with a ${LDQUO}quote${RDQUO} ${EM} and utm [x](https://e.com?utm_source=chatgpt.com).`
const clean = 'A perfectly clean sentence with nothing to fix here at all.'

// 1. readCleanupOpts clamps + defaults.
{
  assert.deepEqual(readCleanupOpts({}), CLEANUP_DEFAULTS)
  assert.equal(readCleanupOpts({ batchSize: 999 }).batchSize, 25)
  assert.equal(readCleanupOpts({ batchSize: 3 }).batchSize, 3)
  assert.equal(readCleanupOpts({ bumpDate: true }).bumpDate, true)
  assert.deepEqual(readCleanupOpts({ excludeBuckets: [] }).excludeBuckets, [])
  ok()
}

// 2. asApprovedSlugs dedupes across shapes.
{
  assert.deepEqual(asApprovedSlugs({ slugs: ['a', 'b', 'a'] }), ['a', 'b'])
  assert.deepEqual(asApprovedSlugs({ updates: [{ slug: 'x' }, { slug: 'y' }] }), ['x', 'y'])
  assert.deepEqual(asApprovedSlugs({ articles: [{ slug: 'z' }] }), ['z'])
  assert.deepEqual(asApprovedSlugs({}), [])
  ok()
}

// 3. selection: oldest-first, freshest bucket excluded, drafts skipped, capped.
{
  const rows = [
    presented('fresh', { bucket: '0-14', daysSince: 5 }),
    presented('old1', { bucket: '90+', daysSince: 200 }),
    presented('mid', { bucket: '30-60', daysSince: 45 }),
    presented('old2', { bucket: '60-90', daysSince: 80 }),
    presented('draftold', { bucket: '90+', daysSince: 300, draft: true }),
    presented('undated', { bucket: 'unknown', daysSince: null }),
  ]
  const picked = selectCleanupCandidates(rows, { ...CLEANUP_DEFAULTS, batchSize: 3 })
  assert.deepEqual(picked, ['old1', 'old2', 'mid'], 'oldest-first, no fresh/draft, capped at 3')
  // undated sorts last, never before a dated article
  const all = selectCleanupCandidates(rows, { ...CLEANUP_DEFAULTS, batchSize: 10 })
  assert.equal(all[all.length - 1], 'undated')
  assert.ok(!all.includes('fresh'), 'fresh bucket excluded')
  assert.ok(!all.includes('draftold'), 'draft excluded')
  ok()
}

// 4. preview: only changed articles surface, with diffs/stats; clean ones skipped.
{
  const live = [liveArticle('old1', dirty), liveArticle('old2', clean)]
  const rows = [
    presented('old1', { bucket: '90+', daysSince: 200 }),
    presented('old2', { bucket: '90+', daysSince: 190 }),
  ]
  const out = buildCleanupPreview(live, rows, { ...CLEANUP_DEFAULTS, batchSize: 5 })
  assert.equal(out.scanned, 2)
  assert.equal(out.changedCount, 1)
  assert.equal(out.previews[0].slug, 'old1')
  assert.ok(out.previews[0].diffs.length > 0, 'diffs present')
  assert.ok(out.previews[0].stats.trackingChanged >= 1, 'utm counted')
  assert.deepEqual(out.skipped, [{ slug: 'old2', reason: 'already_clean' }])
  ok()
}

// 5. preview respects batch cap + fresh exclusion end-to-end.
{
  const live = [liveArticle('a', dirty), liveArticle('b', dirty), liveArticle('c', dirty)]
  const rows = [
    presented('a', { bucket: '0-14', daysSince: 3 }), // fresh -> excluded
    presented('b', { bucket: '90+', daysSince: 120 }),
    presented('c', { bucket: '60-90', daysSince: 70 }),
  ]
  const out = buildCleanupPreview(live, rows, { ...CLEANUP_DEFAULTS, batchSize: 1 })
  assert.equal(out.previews.length, 1)
  assert.equal(out.previews[0].slug, 'b', 'stalest eligible only')
  ok()
}

// 6. commit-plan: files only for changed, unchanged/draft/not-found skipped.
{
  const live = [
    liveArticle('old1', dirty),
    liveArticle('old2', clean),
    liveArticle('drafty', dirty, { draft: true }),
  ]
  const plan = buildCleanupCommitPlan(live, ['old1', 'old2', 'drafty', 'ghost'], CLEANUP_DEFAULTS)
  assert.equal(plan.files.length, 1)
  assert.equal(plan.files[0].slug, 'old1')
  assert.ok(plan.files[0].path.endsWith('old1.md'))
  assert.ok(!plan.files[0].content.includes('utm_source'), 'utm stripped in committed content')
  const reasons = Object.fromEntries(plan.skipped.map((s) => [s.slug, s.reason]))
  assert.equal(reasons.old2, 'unchanged')
  assert.equal(reasons.drafty, 'draft')
  assert.equal(reasons.ghost, 'not_found')
  ok()
}

// 7. commit-plan does NOT bump updatedDate by default; does when asked.
{
  const live = [liveArticle('old1', dirty)]
  const noBump = buildCleanupCommitPlan(live, ['old1'], { ...CLEANUP_DEFAULTS, bumpDate: false })
  assert.ok(noBump.files[0].content.includes('updatedDate: "2026-01-01"'), 'date untouched')
  const bumped = buildCleanupCommitPlan(live, ['old1'], { ...CLEANUP_DEFAULTS, bumpDate: true })
  const today = new Date().toISOString().slice(0, 10)
  assert.ok(bumped.files[0].content.includes(`updatedDate: ${today}`), 'date bumped on opt-in')
  ok()
}

// 8. maxCommit rail: overflow slugs are deferred, not committed.
{
  const live = ['a', 'b', 'c'].map((s) => liveArticle(s, dirty))
  const plan = buildCleanupCommitPlan(live, ['a', 'b', 'c'], { ...CLEANUP_DEFAULTS, maxCommit: 2 })
  assert.equal(plan.files.length, 2)
  const deferred = plan.skipped.filter((s) => s.reason === 'deferred').map((s) => s.slug)
  assert.deepEqual(deferred, ['c'])
  ok()
}

// 9. preview attaches rank signal from rankBySlug.
{
  const live = [liveArticle('r1', dirty), liveArticle('r2', dirty)]
  const rows = [
    presented('r1', { bucket: '90+', daysSince: 200 }),
    presented('r2', { bucket: '90+', daysSince: 150 }),
  ]
  const rankBySlug = {
    r1: { available: true, position: 4, ranking: true, rankSkip: true },
    r2: { available: true, position: 60, ranking: true, rankSkip: false },
  }
  const out = buildCleanupPreview(live, rows, { ...CLEANUP_DEFAULTS, batchSize: 5 }, rankBySlug)
  const bySlug = Object.fromEntries(out.previews.map((p) => [p.slug, p]))
  assert.equal(bySlug.r1.rankSkip, true)
  assert.equal(bySlug.r1.position, 4)
  assert.equal(bySlug.r2.rankSkip, false)
  assert.equal(out.rankSkipCount, 1)
  assert.equal(out.rankThreshold, 30)
  ok()
}

console.log(`\nAll ${passed} cleanup-run assertions passed.`)
