// Tests for the keyword-overlap (cannibalization) check.
// Run: node scripts/test-keyword-overlap.mjs
import assert from 'node:assert/strict'
import {
  blockingOverlaps,
  compareTerms,
  findKeywordOverlaps,
  intentWords,
  summarizeOverlaps,
} from '../lib/keyword-overlap.js'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log('✓', name)
}

const live = [
  { slug: 'seed-vs-series-a', title: 'Seed vs Series A', targetKeyword: 'seed vs series a', pillarKeyword: 'series a', supportingKeyword: 'seed vs series a', articleType: 'comprehensive' },
  { slug: 'pre-seed-funding', title: 'Pre-Seed Funding', targetKeyword: 'pre seed funding', pillarKeyword: 'startup funding', supportingKeyword: 'pre seed funding', articleType: 'comprehensive' },
  { slug: 'series-a', title: 'Series A', targetKeyword: 'series a', pillarKeyword: 'series a', articleType: 'comprehensive' },
  { slug: 'seed-pitch-deck', title: 'Seed Pitch Deck', targetKeyword: 'seed pitch deck', pillarKeyword: 'pitch deck', supportingKeyword: 'seed pitch deck', articleType: 'comprehensive' },
]

check('intent words: plurals, filler and "pre seed" normalised', () => {
  assert.deepEqual(intentWords('What is Pre-Seed Funding?'), ['preseed'])
  assert.deepEqual(intentWords('investors for small businesses'), ['investor', 'small', 'business'])
  assert.deepEqual(intentWords('series a'), ['series', 'a'])
})

check('compareTerms grades exact, same-words, near, none', () => {
  assert.equal(compareTerms('Seed vs Series A', 'seed vs series a'), 'exact')
  assert.equal(compareTerms('seed funding vs series a', 'seed vs series a'), 'same-words')
  assert.equal(compareTerms('seed pitch deck examples', 'seed pitch deck'), 'near')
  assert.equal(compareTerms('pre seed pitch deck', 'seed pitch deck'), null)
  assert.equal(compareTerms('pre seed vs seed funding', 'pre seed funding'), null, 'comparison vs non-comparison')
  assert.equal(compareTerms('', 'seed'), null)
})

check('same target keyword (other words) blocks', () => {
  const f = findKeywordOverlaps({ slug: 'seed-funding-vs-series-a', targetKeyword: 'seed funding vs series a' }, live)
  assert.equal(f[0].slug, 'seed-vs-series-a')
  assert.equal(f[0].rule, 'target-keyword')
  assert.equal(f[0].blocking, true)
  assert.equal(blockingOverlaps(f).length, 1)
})

check('near keyword only warns', () => {
  const f = findKeywordOverlaps({ slug: 'seed-pitch-deck-examples', targetKeyword: 'seed pitch deck examples', pillarKeyword: 'pitch deck', supportingKeyword: 'seed pitch deck', articleType: 'flex' }, live)
  assert.equal(f.length, 1)
  assert.equal(f[0].match, 'near')
  assert.equal(blockingOverlaps(f).length, 0)
})

check('target keyword equal to a pillar keyword blocks', () => {
  const f = findKeywordOverlaps({ slug: 'series-a-guide-for-founders', targetKeyword: 'Series A' }, live)
  assert.ok(f.some((x) => x.slug === 'series-a' && x.blocking))
})

check('a second pillar for the same pillar keyword blocks', () => {
  const f = findKeywordOverlaps(
    { slug: 'series-a-funding-explained', targetKeyword: 'series a financing', pillarKeyword: 'series a', articleType: 'comprehensive' },
    live
  )
  const hit = f.find((x) => x.slug === 'series-a')
  assert.equal(hit.rule, 'second-pillar')
  assert.equal(hit.blocking, true)
})

check('near-duplicate slug is caught even with a distinct keyword', () => {
  const f = findKeywordOverlaps({ slug: 'what-is-pre-seed-funding', targetKeyword: 'pre-seed definition' }, live)
  assert.equal(f[0].slug, 'pre-seed-funding')
  assert.equal(f[0].rule, 'slug')
})

check('the article itself and unrelated articles are ignored', () => {
  assert.deepEqual(findKeywordOverlaps({ slug: 'series-a', targetKeyword: 'series a', pillarKeyword: 'series a', articleType: 'comprehensive' }, live).map((x) => x.slug), [])
  assert.deepEqual(findKeywordOverlaps({ slug: 'investor-crm', targetKeyword: 'investor crm' }, live), [])
})

check('summary names the conflicts and the first reason', () => {
  const f = findKeywordOverlaps({ slug: 'seed-funding-vs-series-a', targetKeyword: 'seed funding vs series a' }, live)
  assert.match(summarizeOverlaps(f), /^Keyword overlap with seed-vs-series-a — target keyword "seed funding vs series a" is the same words as "seed vs series a"\.$/)
  assert.equal(summarizeOverlaps([]), '')
})

console.log(`\nAll ${passed} keyword-overlap assertions passed.`)
