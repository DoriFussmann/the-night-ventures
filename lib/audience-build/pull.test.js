// Run: node --test lib/audience-build/pull.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFit,
  classify,
  emailDomain,
  excludedDomainSet,
  filtersSummary,
  fitLines,
  preRank,
  rankAndSelect,
  runDate,
  scoreCandidate,
  toCandidate,
} from './pull.js'

test('toCandidate prefers the verified business email and never uses personal', () => {
  const c = toCandidate({
    UUID: 'u1',
    BUSINESS_VERIFIED_EMAILS: 'Jo@Acme.com, jo2@acme.com',
    BUSINESS_EMAIL: 'other@acme.com',
    PERSONAL_EMAILS: 'jo@gmail.com',
    SENIORITY_LEVEL: 'CXO',
    COMPANY_DOMAIN: 'https://www.Acme.com/about',
  })
  assert.equal(c.email, 'jo@acme.com')
  assert.equal(c.email_verified, true)
  assert.equal(c.seniority, 'cxo')
  assert.equal(c.company_domain, 'acme.com')
  assert.equal(toCandidate({ PERSONAL_EMAILS: 'a@gmail.com' }).email, '')
  assert.equal(toCandidate({ BUSINESS_EMAIL: 'b@x.io' }).email_verified, false)
})

test('classify removes duplicates, DNC, recent contacts and excluded domains', () => {
  const people = [
    { email: 'a@x.com', company_domain: 'x.com' },
    { email: 'a@x.com', company_domain: 'x.com' },
    { email: 'b@y.com', company_domain: 'y.com' },
    { email: 'c@z.com', company_domain: 'z.com' },
    { email: 'd@mine.com', company_domain: 'mine.com' },
    { email: 'e@w.com', company_domain: 'competitor.com' },
    { email: '', company_domain: 'q.com' },
  ]
  const { candidates, counts } = classify(people, {
    dnc: new Set(['b@y.com']),
    recent: new Set(['c@z.com']),
    excludedDomains: excludedDomainSet({ domain: 'https://www.mine.com', outbound_exclude_domains: ['Competitor.com'] }),
  })
  assert.deepEqual(
    candidates.map((c) => c.removed_reason),
    [null, 'duplicate', 'dnc', 'emailed_recently', 'excluded_domain', 'excluded_domain']
  )
  assert.deepEqual(counts, {
    pulled: 7,
    no_business_email: 1,
    duplicates: 1,
    dnc: 1,
    emailed_recently: 1,
    excluded_domain: 2,
    eligible: 1,
  })
})

test('emailDomain and excludedDomainSet normalise', () => {
  assert.equal(emailDomain('x@Sub.Acme.com'), 'sub.acme.com')
  assert.deepEqual([...excludedDomainSet({ domain: 'www.a.com/', outbound_exclude_domains: ['http://b.com', ''] })], ['a.com', 'b.com'])
})

test('scoreCandidate weighs fit 70 / size 20 / contact 10', () => {
  const f = { employee_bands: ['11 to 25'] }
  assert.equal(scoreCandidate({ fit_score: 10, employee_count: '11 to 25', email_verified: true, linkedin_url: 'x' }, f), 1)
  assert.equal(scoreCandidate({ fit_score: 5, employee_count: '1 to 10', email_verified: false }, f), 0.51)
  assert.equal(scoreCandidate({ fit_score: 0, employee_count: '' }, {}), 0.24)
})

test('rankAndSelect ranks eligible only and selects the top need', () => {
  const out = rankAndSelect(
    [
      { email: 'a', fit_score: 3, removed_reason: null, email_verified: true },
      { email: 'b', fit_score: 9, removed_reason: null, email_verified: true },
      { email: 'c', fit_score: 10, removed_reason: 'dnc' },
      { email: 'd', fit_score: 6, removed_reason: null, email_verified: true },
    ],
    2,
    {}
  )
  assert.deepEqual(
    out.map((c) => [c.email, c.rank, c.selected]),
    [
      ['b', 1, true],
      ['d', 2, true],
      ['a', 3, false],
      ['c', null, false],
    ]
  )
})

test('applyFit maps by index, clamps, and marks the unscored', () => {
  const out = applyFit([{ email: 'a' }, { email: 'b' }, { email: 'c' }], {
    scores: [
      { i: 1, fit: 12, reason: 'owner at fitting firm' },
      { i: 0, fit: 4 },
      { i: 9, fit: 10 },
      { i: 1, fit: 0 },
    ],
  })
  assert.deepEqual(
    out.map((c) => [c.fit_score, c.fit_reason]),
    [
      [4, ''],
      [10, 'owner at fitting firm'],
      [0, 'not scored'],
    ]
  )
})

test('preRank puts filter matches first', () => {
  const out = preRank(
    [
      { email: 'a', seniority: 'staff', employee_count: '1 to 10' },
      { email: 'b', seniority: 'cxo', employee_count: '11 to 25' },
    ],
    { seniority: ['cxo'], employee_bands: ['11 to 25'] }
  )
  assert.equal(out[0].email, 'b')
})

test('fitLines and filtersSummary are compact', () => {
  assert.equal(
    fitLines([{ job_title: 'CEO', seniority: 'cxo', department: 'executive', company_name: 'Acme', employee_count: '11 to 25' }]),
    'i=0 | title: CEO | seniority: cxo | dept: executive | company: Acme (11 to 25)'
  )
  assert.equal(filtersSummary({ seniority: ['cxo'], industries: [] }), 'Seniority: cxo')
})

test('runDate uses the Pacific business day', () => {
  assert.equal(runDate(new Date('2026-10-30T05:00:00Z')), '2026-10-29')
  assert.equal(runDate(new Date('2026-10-30T09:00:00Z')), '2026-10-30')
})
