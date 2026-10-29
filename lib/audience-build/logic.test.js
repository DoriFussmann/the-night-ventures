// Run: node --test lib/audience-build/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProfileText,
  competitorNames,
  compactCandidates,
  coverage,
  dailyNeed,
  insightsBody,
  missingKeyFields,
  normalizePlan,
  normalizeRerank,
  parseJsonObject,
  summarizeInsights,
} from './logic.js'

test('competitorNames dedupes and accepts objects or strings', () => {
  assert.deepEqual(
    competitorNames({ competitors: [{ name: 'Xero', url: 'x' }, 'QuickBooks', { name: 'xero' }, { name: '' }] }),
    ['Xero', 'QuickBooks']
  )
  assert.deepEqual(competitorNames({}), [])
})

test('buildProfileText skips empty fields and includes services, competitors, ICP', () => {
  const text = buildProfileText('Acme', {
    domain: 'acme.com',
    short_description: 'AI bookkeeping',
    target_audience: '',
    services: [{ title: 'Monthly close', summary: 'Books closed by day 5' }],
    competitors: [{ name: 'Bench' }],
    icp_seniority: ['owner', 'cxo'],
  })
  assert.match(text, /^# Acme/)
  assert.match(text, /## What we do\nAI bookkeeping/)
  assert.doesNotMatch(text, /Ideal customer/)
  assert.match(text, /- Monthly close: Books closed by day 5/)
  assert.match(text, /## Competitors\nBench/)
  assert.match(text, /Buyer seniority: owner, cxo/)
})

test('missingKeyFields flags thin profiles', () => {
  assert.deepEqual(missingKeyFields({ short_description: 'x' }), ['Ideal customer', 'Customer problem', 'Competitors'])
  assert.deepEqual(
    missingKeyFields({ short_description: 'x', target_audience: 'y', customer_problem: 'z', competitors: [{ name: 'A' }] }),
    []
  )
})

test('dailyNeed is inboxes x cap with a 3x target pool (single touch)', () => {
  assert.deepEqual(dailyNeed({ outbound_inboxes: 2, outbound_daily_cap: 30 }), {
    inboxes: 2,
    cap: 30,
    need: 60,
    multiplier: 3,
    targetPool: 180,
  })
  assert.equal(dailyNeed({ outbound_inboxes: 2, outbound_daily_cap: 30 }, 2.5).targetPool, 150)
  assert.equal(dailyNeed({}).need, 30)
})

test('parseJsonObject tolerates fences and prose', () => {
  assert.deepEqual(parseJsonObject('Here:\n```json\n{"a":1,"b":{"c":2}}\n```'), { a: 1, b: { c: 2 } })
  assert.throws(() => parseJsonObject('no json'))
})

test('normalizePlan cleans, dedupes and always includes stored competitors', () => {
  const plan = normalizePlan(
    { buyer_summary: 'Owners of small firms', phrases: ['  bookkeeping  software ', 'Bookkeeping software', 'x', ''], names: ['Xero'] },
    ['Bench', 'xero']
  )
  assert.deepEqual(plan.phrases, ['bookkeeping software'])
  assert.deepEqual(plan.names, ['Bench', 'xero'])
  assert.throws(() => normalizePlan({ phrases: [], names: [] }, []))
})

test('normalizeRerank keeps only offered ids, clamps, sorts, caps', () => {
  const out = normalizeRerank(
    {
      ranked: [
        { segment_id: 'b2b_2', relevance: 7, reason: 'adjacent' },
        { segment_id: 'b2b_1', relevance: 14, reason: 'exact' },
        { segment_id: 'b2b_999', relevance: 10, reason: 'invented' },
        { segment_id: 'b2b_2', relevance: 9, reason: 'dupe' },
      ],
    },
    ['b2b_1', 'b2b_2']
  )
  assert.deepEqual(
    out.map((r) => [r.segment_id, r.relevance]),
    [
      ['b2b_1', 10],
      ['b2b_2', 7],
    ]
  )
})

test('compactCandidates is one line per candidate', () => {
  const s = compactCandidates([{ segment_id: 'b2b_1', topic: 'Bench', category: 'Accounting', subcategory: 'SMB', keywords: 'a, b' }])
  assert.equal(s, 'b2b_1 | Bench | Accounting > SMB | a, b')
})

test('insightsBody applies hard floors, caps days_back at 7, no DNC filter', () => {
  const b = insightsBody({ segmentId: 'b2b_1003', daysBack: 10 })
  assert.deepEqual(b.segment, ['b2b_1003'])
  assert.equal(b.days_back, 7)
  assert.deepEqual(b.score, ['high'])
  assert.deepEqual(b.filters.notNulls, ['BUSINESS_EMAIL', 'BUSINESS_EMAILS_VALIDATION_STATUS'])
  assert.equal(b.filters.nullOnly, undefined)
})

test('summarizeInsights handles array and object distributions', () => {
  const s = summarizeInsights({
    reach: 471,
    distributions: {
      seniority_level: [['staff', 181], ['cxo', 73]],
      company_employee_count: { '1 to 10': 48, '10000+': 89 },
    },
  })
  assert.equal(s.reach, 471)
  assert.deepEqual(s.seniority[0], { value: 'staff', count: 181 })
  assert.deepEqual(s.employee_count[0], { value: '10000+', count: 89 })
  assert.deepEqual(s.department, [])
})

test('coverage compares fresh daily supply with need and 3x target', () => {
  assert.deepEqual(coverage(200, 60), { ratio: 3.3, status: 'covers' })
  assert.deepEqual(coverage(90, 60), { ratio: 1.5, status: 'partial' })
  assert.deepEqual(coverage(9, 60), { ratio: 0.2, status: 'short' })
  assert.equal(coverage(10, 0).status, 'unknown')
})

import { attachCounts, filterKey, isFresh } from './logic.js'

test('filterKey ignores key order and score order', () => {
  const a = filterKey({ score: ['high', 'medium'], filters: { notNulls: ['A'], businessProfile: { seniority: ['vp'] } } })
  const b = filterKey({ filters: { businessProfile: { seniority: ['vp'] }, notNulls: ['A'] }, score: ['medium', 'high'] })
  assert.equal(a, b)
  assert.notEqual(a, filterKey({ score: ['high'], filters: { notNulls: ['A'] } }))
})

test('attachCounts needs both windows to count a segment', () => {
  const out = attachCounts(
    [{ segment_id: 'b2b_1' }, { segment_id: 'b2b_2' }],
    [
      { segment_id: 'b2b_1', days_back: 7, reach: 471, summary: { reach: 471 }, counted_at: 't' },
      { segment_id: 'b2b_1', days_back: 1, reach: 140, counted_at: 't' },
      { segment_id: 'b2b_2', days_back: 7, reach: 50 },
    ],
    30
  )
  assert.equal(out[0].counted, true)
  assert.equal(out[0].reach_1d_high, 140)
  assert.deepEqual(out[0].coverage, { ratio: 4.7, status: 'covers' })
  assert.equal(out[1].counted, false)
  assert.equal(out[1].reach_7d_high, 50)
  assert.equal(out[1].coverage, null)
})

test('isFresh uses a 12 hour window', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')
  assert.equal(isFresh('2026-10-29T01:00:00Z', now), true)
  assert.equal(isFresh('2026-10-28T23:00:00Z', now), false)
  assert.equal(isFresh(null, now), false)
})

import { poolMultiplier } from './logic.js'

test('poolMultiplier clamps the Admin setting and coverage follows it', () => {
  assert.equal(poolMultiplier(undefined), 3)
  assert.equal(poolMultiplier('2.54'), 2.5)
  assert.equal(poolMultiplier(50), 10)
  assert.equal(poolMultiplier(0.5), 1)
  assert.equal(coverage(120, 60, 2).status, 'covers')
  assert.equal(coverage(120, 60, 3).status, 'partial')
})
