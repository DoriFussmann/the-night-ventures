// Audit Speed + Authority issue builders (pure, no network).
// Run: node scripts/test-audit-speed-authority.mjs
import assert from 'node:assert/strict'
import { buildSpeedIssues, pickSpeedTargets, rateVital, fieldVitals } from '../lib/audit/checks/speed.js'
import { buildAuthorityIssues, median } from '../lib/audit/checks/authority.js'
import { scoreCategory } from '../lib/audit/scoring.js'
import { CATEGORIES } from '../lib/audit/categories.js'
import { IMPLEMENTED_RUNNERS } from '../lib/audit/runners.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

const ids = (issues) => issues.map((i) => i.check_id).sort()

const psi = ({ perf = 95, lcpMs = 1800, cls = 0.02, origin = null, url = null } = {}) => ({
  ok: true,
  scores: { performance: perf, seo: 100, accessibility: 95 },
  coreWebVitals: { origin, url, lab: { lcpMs, cls } },
})
const crux = (lcp, inp, clsX100) => ({
  metrics: {
    lcp: { percentile: lcp },
    inp: { percentile: inp },
    cls: { percentile: clsX100 },
  },
})

test('speed + authority are implemented in categories and runners', () => {
  for (const id of ['speed', 'authority']) {
    assert.equal(CATEGORIES.find((c) => c.id === id).implemented, true)
    assert.ok(IMPLEMENTED_RUNNERS.includes(id))
  }
})

test('pickSpeedTargets takes first home, pillar, article in that order', () => {
  const t = pickSpeedTargets([
    { url: 'a1', kind: 'article' },
    { url: 'h', kind: 'home' },
    { url: 'p', kind: 'page' },
    { url: 'a2', kind: 'article' },
  ])
  assert.deepEqual(t, [
    { url: 'h', kind: 'home' },
    { url: 'a1', kind: 'article' },
  ])
})

test('rateVital thresholds (inclusive good, poor strictly above)', () => {
  assert.equal(rateVital('lcp', 2500), 'good')
  assert.equal(rateVital('lcp', 2501), 'needs_improvement')
  assert.equal(rateVital('lcp', 4001), 'poor')
  assert.equal(rateVital('cls', 0.1), 'good')
  assert.equal(rateVital('cls', 0.3), 'poor')
  assert.equal(rateVital('inp', null), null)
})

test('fieldVitals converts CrUX CLS (×100) and returns null when empty', () => {
  assert.equal(fieldVitals(crux(2000, 150, 5)).cls, 0.05)
  assert.equal(fieldVitals({ metrics: {} }), null)
  assert.equal(fieldVitals(null), null)
})

test('fast site with field data: no issues, score 100', () => {
  const { issues, metrics } = buildSpeedIssues({
    pages: [{ url: 'https://x.com/', kind: 'home', result: psi({ origin: crux(1900, 120, 3) }) }],
  })
  assert.deepEqual(issues, [])
  assert.equal(metrics.hasFieldData, true)
  assert.equal(metrics.fieldLcp, '1.9 s')
  assert.equal(scoreCategory(issues, { pagesChecked: metrics.pagesChecked }), 100)
})

test('origin CWV poor/NI become site issues once, not per page', () => {
  const origin = crux(4500, 300, 30)
  const { issues } = buildSpeedIssues({
    pages: [
      { url: 'https://x.com/', kind: 'home', result: psi({ origin }) },
      { url: 'https://x.com/articles/a/', kind: 'article', result: psi({ origin }) },
    ],
  })
  assert.deepEqual(ids(issues), ['cwv_cls_poor', 'cwv_inp_needs_improvement', 'cwv_lcp_poor'])
  assert.ok(issues.every((i) => i.scope === 'site'))
})

test('no field data: low site issue + lab fallback per page', () => {
  const { issues, metrics } = buildSpeedIssues({
    pages: [{ url: 'https://x.com/', kind: 'home', result: psi({ perf: 40, lcpMs: 6000, cls: 0.4 }) }],
  })
  assert.deepEqual(ids(issues), ['lab_cls_high', 'lab_lcp_slow', 'no_field_data', 'performance_score_poor'])
  assert.equal(metrics.homePerformance, 40)
  assert.equal(metrics.hasFieldData, false)
})

test('origin field data suppresses lab LCP/CLS double-counting', () => {
  const { issues } = buildSpeedIssues({
    pages: [{ url: 'https://x.com/', kind: 'home', result: psi({ lcpMs: 7000, cls: 0.5, origin: crux(2000, 100, 2) }) }],
  })
  assert.deepEqual(ids(issues), [])
})

test('URL-level field data replaces lab checks for that page', () => {
  const { issues } = buildSpeedIssues({
    pages: [
      {
        url: 'https://x.com/',
        kind: 'home',
        result: psi({ perf: 70, lcpMs: 9000, origin: crux(2000, 100, 2), url: crux(3000, 100, 2) }),
      },
    ],
  })
  assert.deepEqual(ids(issues), ['page_cwv_lcp_needs_improvement', 'performance_score_needs_work'])
})

test('failed PSI page is a low issue and a table row with the error', () => {
  const { issues, metrics } = buildSpeedIssues({
    pages: [
      { url: 'https://x.com/', kind: 'home', result: psi({ origin: crux(1000, 50, 1) }) },
      { url: 'https://x.com/p/', kind: 'pillar', result: { ok: false, error: 'boom' } },
    ],
  })
  assert.deepEqual(ids(issues), ['pagespeed_failed'])
  assert.equal(metrics.pagesChecked, 1)
  assert.equal(metrics.pages[1].error, 'boom')
})

test('authority: healthy site with no competitors has no issues but warns', () => {
  const { issues, metrics } = buildAuthorityIssues({
    site: { domainAuthority: 45, linkingRootDomains: 300, spamScore: 2 },
  })
  assert.deepEqual(issues, [])
  assert.match(metrics.warnings[0], /No competitors configured/)
})

test('authority: low DA, thin roots, high spam, stale', () => {
  const { issues } = buildAuthorityIssues({
    site: { domainAuthority: 6, linkingRootDomains: 4, spamScore: 70 },
    stale: { isStale: true, reasons: ['old'] },
  })
  assert.deepEqual(ids(issues), [
    'domain_authority_very_low',
    'linking_roots_very_thin',
    'moz_data_stale',
    'spam_score_high',
  ])
})

test('authority: competitor benchmark uses median and ignores errored rows', () => {
  assert.equal(median([10, 30, 20]), 20)
  assert.equal(median([10, 20]), 15)
  assert.equal(median([]), null)
  const { issues, metrics } = buildAuthorityIssues({
    site: { domainAuthority: 25, linkingRootDomains: 60, spamScore: 1 },
    competitors: [
      { name: 'A', domain: 'a.com', domainAuthority: 50, linkingRootDomains: 800 },
      { name: 'B', domain: 'b.com', domainAuthority: 40, linkingRootDomains: 400 },
      { name: 'C', domain: 'c.com', error: 'No Moz data' },
    ],
  })
  assert.equal(metrics.competitorMedianDa, 45)
  assert.deepEqual(ids(issues), ['da_below_competitors', 'roots_below_competitors'])
  assert.equal(issues.find((i) => i.check_id === 'da_below_competitors').severity, 'high')
  assert.ok(metrics.warnings.some((w) => w.startsWith('c.com')))
})

test('authority fingerprints are stable across runs', () => {
  const a = buildAuthorityIssues({ site: { domainAuthority: 5 } }).issues[0]
  const b = buildAuthorityIssues({ site: { domainAuthority: 8 } }).issues[0]
  assert.equal(a.fingerprint, b.fingerprint)
})

console.log(`\n${passed} audit speed/authority tests passed`)
