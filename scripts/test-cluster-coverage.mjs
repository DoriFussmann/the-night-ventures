// Logic gate for "generate one cluster per pillar".
// Run: node scripts/test-cluster-coverage.mjs
// Must end with "assertions passed."

import { pickCoverageClusters } from '../src/pages/tools/articlesAutomation/selectCluster.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
  passed += 1
}

const available = (kw) => ({ keyword: kw, slug: kw, plannedArticles: [] })
const planned = (kw) => ({ keyword: kw, slug: kw, plannedArticles: [{ status: 'planned' }] })
const completed = (kw) => ({ keyword: kw, slug: kw, plannedArticles: [{ status: 'published' }] })

// Mirrors the rupert case: 4 pillars already have a cluster, 3 do not.
const pillars = [
  { keyword: 'P1', slug: 'P1', pillarArticle: 'published', supporting: [completed('c1a'), available('c1b')] }, // covered
  { keyword: 'P2', slug: 'P2', pillarArticle: 'published', supporting: [completed('c2a')] }, // covered
  { keyword: 'P3', slug: 'P3', pillarArticle: 'published', supporting: [completed('c3a')] }, // covered
  { keyword: 'P4', slug: 'P4', pillarArticle: 'published', supporting: [completed('c4a')] }, // covered
  { keyword: 'P5', slug: 'P5', pillarArticle: 'published', supporting: [available('c5a'), available('c5b')] }, // needs one
  { keyword: 'P6', slug: 'P6', pillarArticle: 'published', supporting: [available('c6a')] }, // needs one
  { keyword: 'P7', slug: 'P7', pillarArticle: 'published', supporting: [planned('c7a')] }, // needs one (from plan)
]

const result = pickCoverageClusters(pillars)

// The core expectation: 3, not "all clusters".
assert(result.length === 3, `expected 3 picks, got ${result.length}`)

const pickedPillars = result.map((r) => r.pillarKeyword)
for (const good of ['P1', 'P2', 'P3', 'P4']) {
  assert(!pickedPillars.includes(good), `covered pillar ${good} is skipped`)
}
for (const need of ['P5', 'P6', 'P7']) {
  assert(pickedPillars.includes(need), `uncovered pillar ${need} is included`)
}

// Exactly one per uncovered pillar (no duplicates).
assert(new Set(pickedPillars).size === pickedPillars.length, 'one pick per pillar, no dupes')

// P5 takes its FIRST available cluster; P7 falls back to its planned one.
assert(result.find((r) => r.pillarKeyword === 'P5').clusterKeyword === 'c5a', 'P5 -> first available')
assert(result.find((r) => r.pillarKeyword === 'P7').clusterKeyword === 'c7a', 'P7 -> planned fallback')

// Full cluster objects (drop-in for the batch loop): status + slugs present.
for (const r of result) {
  for (const f of ['pillarKeyword', 'pillarSlug', 'clusterKeyword', 'clusterSlug', 'status']) {
    assert(r[f] !== undefined, `pick carries ${f}`)
  }
}

// Unpublished pillar is never picked.
const withBlocked = pickCoverageClusters([
  { keyword: 'X', slug: 'X', pillarArticle: 'missing', supporting: [available('x1')] },
])
assert(withBlocked.length === 0, 'unpublished pillar is skipped')

// Re-runnable: once P5 gets a completed cluster, only P6 and P7 remain.
const after = pickCoverageClusters(
  pillars.map((p) =>
    p.keyword === 'P5' ? { ...p, supporting: [completed('c5a'), available('c5b')] } : p
  )
)
assert(after.length === 2, 'after P5 covered, 2 remain')
assert(!after.map((r) => r.pillarKeyword).includes('P5'), 'P5 drops out once covered')

// Garbage input doesn't throw.
assert(pickCoverageClusters([]).length === 0, 'empty -> none')
assert(pickCoverageClusters(null).length === 0, 'null -> none')

console.log(`${passed} assertions passed.`)
