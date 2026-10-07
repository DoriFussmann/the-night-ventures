// Audit scoring, diffs, overrides, fingerprints, connection blocking.
// Run: node scripts/test-audit-scoring.mjs
import assert from 'node:assert/strict'
import { scoreCategory, overallScore, diffIssues, partitionAccepted, SEVERITY_PENALTY } from '../lib/audit/scoring.js'
import { fingerprint, makeIssue, dedupeIssues } from '../lib/audit/issues.js'
import { CATEGORIES, blockingFailures } from '../lib/audit/categories.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const issue = (checkId, severity, url = null, extra = {}) =>
  makeIssue({ category: 'schema', checkId, severity, title: checkId, url, ...extra })

test('weights sum to 100', () => {
  assert.equal(
    CATEGORIES.reduce((s, c) => s + c.weight, 0),
    100
  )
})

test('no issues scores 100', () => {
  assert.equal(scoreCategory([], { pagesChecked: 10 }), 100)
})

test('site-level critical costs the full penalty', () => {
  assert.equal(scoreCategory([issue('x', 'critical')], { pagesChecked: 10 }), 100 - SEVERITY_PENALTY.critical)
})

test('page issue is scaled by affected share, counted once per check', () => {
  // 1 of 10 pages: 12 × (0.5 + 0.05) = 6.6 → 93
  assert.equal(scoreCategory([issue('a', 'high', 'https://x.com/1')], { pagesChecked: 10 }), 93)
  // 10 of 10 pages: full 12 → 88 (not 10 × 12)
  const all = Array.from({ length: 10 }, (_, i) => issue('a', 'high', `https://x.com/${i}`))
  assert.equal(scoreCategory(all, { pagesChecked: 10 }), 88)
})

test('check group takes its highest severity', () => {
  const mixed = [issue('a', 'low', 'https://x.com/1'), issue('a', 'critical', 'https://x.com/2')]
  // critical 30 × (0.5 + 0.5 × 2/2) = 30
  assert.equal(scoreCategory(mixed, { pagesChecked: 2 }), 70)
})

test('score floors at 0', () => {
  const many = Array.from({ length: 10 }, (_, i) => issue(`c${i}`, 'critical'))
  assert.equal(scoreCategory(many, {}), 0)
})

test('overall is the weighted average of categories that ran', () => {
  assert.equal(overallScore({}), null)
  assert.equal(overallScore({ crawl: 80 }), 80)
  // crawl 20 × 100 + schema 15 × 30 = 2450 / 35 = 70
  assert.equal(overallScore({ crawl: 100, schema: 30, unknown: 0, speed: null }), 70)
})

test('diff: baseline without previous run', () => {
  const d = diffIssues([issue('a', 'low', 'https://x.com/1')], null)
  assert.equal(d.current[0].diff, 'baseline')
  assert.deepEqual(d.fixed, [])
})

test('diff: new, persisting and fixed', () => {
  const keep = issue('a', 'low', 'https://x.com/1')
  const gone = issue('b', 'low', 'https://x.com/2')
  const fresh = issue('c', 'low', 'https://x.com/3')
  const d = diffIssues([keep, fresh], [keep, gone])
  assert.equal(d.current.find((i) => i.check_id === 'a').diff, 'persisting')
  assert.equal(d.current.find((i) => i.check_id === 'c').diff, 'new')
  assert.deepEqual(
    d.fixed.map((i) => i.check_id),
    ['b']
  )
})

test('accepted issues are excluded', () => {
  const a = issue('a', 'critical')
  const b = issue('b', 'low')
  const { active, accepted } = partitionAccepted([a, b], new Set([a.fingerprint]))
  assert.deepEqual(
    active.map((i) => i.check_id),
    ['b']
  )
  assert.deepEqual(
    accepted.map((i) => i.check_id),
    ['a']
  )
})

test('fingerprint is stable and ignores hash + host case', () => {
  const f1 = fingerprint('crawl', 'title_missing', 'https://WWW.Example.com/a/#top')
  const f2 = fingerprint('crawl', 'title_missing', 'https://www.example.com/a/')
  assert.equal(f1, f2)
  assert.match(f1, /^[0-9a-f]{24}$/)
  assert.notEqual(f1, fingerprint('crawl', 'title_missing', 'https://www.example.com/a'))
  assert.notEqual(f1, fingerprint('schema', 'title_missing', 'https://www.example.com/a/'))
})

test('makeIssue validates severity and dedupe keeps first', () => {
  assert.throws(() => issue('a', 'severe'))
  const a = issue('a', 'low', 'https://x.com/1', { detail: 'first' })
  const b = issue('a', 'low', 'https://x.com/1', { detail: 'second' })
  assert.equal(dedupeIssues([a, b]).length, 1)
  assert.equal(dedupeIssues([a, b])[0].detail, 'first')
  assert.equal(a.scope, 'page')
  assert.equal(issue('s', 'low').scope, 'site')
})

test('blocking failures only for failing required connections', () => {
  assert.deepEqual(blockingFailures('crawl', { dataforseo: { status: 'fail' }, site_home: { status: 'ok' } }), [
    'dataforseo',
  ])
  assert.deepEqual(blockingFailures('schema', { dataforseo: { status: 'fail' } }), [])
  assert.deepEqual(blockingFailures('crawl', { dataforseo: { status: 'warn' } }), [])
})

console.log(`\n${passed} audit scoring tests passed`)
