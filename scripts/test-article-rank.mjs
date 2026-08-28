import assert from 'node:assert/strict'
import {
  normalizeUrlForMatch,
  findPosition,
  classifyRank,
  partitionByRank,
  fetchRankForCandidate,
  annotateCandidatesWithRank,
} from '../lib/article-updates/rank.js'

let passed = 0
const ok = () => { passed++ }

// 1. URL normalization collapses protocol / www / trailing slash / query.
{
  const a = normalizeUrlForMatch('https://www.site.com/articles/x/?utm=1#h')
  const b = normalizeUrlForMatch('http://site.com/articles/x')
  assert.equal(a, 'site.com/articles/x')
  assert.equal(a, b)
  assert.equal(normalizeUrlForMatch(''), '')
  ok()
}

// 2. findPosition matches despite trivial URL differences; null when absent.
{
  const items = [
    { rank: 1, url: 'https://competitor.com/a' },
    { rank: 7, url: 'http://www.site.com/articles/x/' },
  ]
  assert.equal(findPosition(items, 'https://site.com/articles/x'), 7)
  assert.equal(findPosition(items, 'https://site.com/articles/other'), null)
  assert.equal(findPosition([], 'https://site.com/x'), null)
  ok()
}

// 3. classifyRank thresholds + availability passthrough.
{
  assert.deepEqual(classifyRank(5, 30, true), { available: true, position: 5, ranking: true, rankSkip: true })
  assert.deepEqual(classifyRank(45, 30, true), { available: true, position: 45, ranking: true, rankSkip: false })
  assert.deepEqual(classifyRank(null, 30, true), { available: true, position: null, ranking: false, rankSkip: false })
  assert.deepEqual(classifyRank(null, 30, false), { available: false, position: null, ranking: false, rankSkip: false })
  ok()
}

// 4. partitionByRank: default-skips ranking pages; force / forceSlugs override.
{
  const rank = {
    a: { rankSkip: true, position: 4 },
    b: { rankSkip: false, position: 55 },
    c: { rankSkip: true, position: 12 },
  }
  const def = partitionByRank(['a', 'b', 'c'], rank)
  assert.deepEqual(def.commit, ['b'])
  assert.deepEqual(def.rankSkipped.map((r) => r.slug), ['a', 'c'])

  const forced = partitionByRank(['a', 'b', 'c'], rank, { force: true })
  assert.deepEqual(forced.commit, ['a', 'b', 'c'])
  assert.deepEqual(forced.rankSkipped, [])

  const one = partitionByRank(['a', 'b', 'c'], rank, { forceSlugs: ['a'] })
  assert.deepEqual(one.commit, ['a', 'b'])
  assert.deepEqual(one.rankSkipped.map((r) => r.slug), ['c'])
  ok()
}

// 5. fetchRankForCandidate: ranking well -> rankSkip (mocked SERP, no cache).
{
  const serpFn = async () => ({ available: true, items: [{ rank: 3, url: 'https://site.com/articles/x/' }] })
  const r = await fetchRankForCandidate(
    { slug: 'x', keyword: 'foo', publishedUrl: 'https://site.com/articles/x' },
    { serpFn, noCache: true, threshold: 30 }
  )
  assert.equal(r.position, 3)
  assert.equal(r.rankSkip, true)
  ok()
}

// 6. not found in SERP -> eligible (no rankSkip).
{
  const serpFn = async () => ({ available: true, items: [{ rank: 1, url: 'https://competitor.com/a' }] })
  const r = await fetchRankForCandidate(
    { slug: 'x', keyword: 'foo', publishedUrl: 'https://site.com/articles/x' },
    { serpFn, noCache: true }
  )
  assert.equal(r.position, null)
  assert.equal(r.rankSkip, false)
  assert.equal(r.ranking, false)
  ok()
}

// 7. provider unavailable -> eligible, available:false.
{
  const serpFn = async () => ({ available: false, reason: 'DataForSEO HTTP 500' })
  const r = await fetchRankForCandidate(
    { slug: 'x', keyword: 'foo', publishedUrl: 'https://site.com/articles/x' },
    { serpFn, noCache: true }
  )
  assert.equal(r.available, false)
  assert.equal(r.rankSkip, false)
  ok()
}

// 8. missing keyword/url -> eligible without calling SERP.
{
  let called = false
  const serpFn = async () => { called = true; return { available: true, items: [] } }
  const r = await fetchRankForCandidate({ slug: 'x', keyword: '', publishedUrl: '' }, { serpFn, noCache: true })
  assert.equal(called, false, 'must not call SERP without inputs')
  assert.equal(r.available, false)
  assert.equal(r.rankSkip, false)
  ok()
}

// 9. annotateCandidatesWithRank maps a batch by slug.
{
  const serpFn = async ({ keyword }) =>
    keyword === 'hot'
      ? { available: true, items: [{ rank: 2, url: 'https://site.com/hot' }] }
      : { available: true, items: [{ rank: 88, url: 'https://site.com/cold' }] }
  const out = await annotateCandidatesWithRank(
    [
      { slug: 'hot', keyword: 'hot', publishedUrl: 'https://site.com/hot' },
      { slug: 'cold', keyword: 'cold', publishedUrl: 'https://site.com/cold' },
    ],
    { serpFn, noCache: true, threshold: 30 }
  )
  assert.equal(out.hot.rankSkip, true)
  assert.equal(out.cold.rankSkip, false)
  assert.equal(out.cold.position, 88)
  ok()
}

console.log(`\nAll ${passed} rank assertions passed.`)
