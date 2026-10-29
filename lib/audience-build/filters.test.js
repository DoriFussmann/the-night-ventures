// Run: node --test lib/audience-build/filters.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_FILTERS,
  audienceMakeup,
  filtersToProfileColumns,
  filtersUserMessage,
  hasAnyFilter,
  impactLayers,
  normalizeFilters,
  normalizeReasons,
  profileColumnsToFilters,
  toAudienceLabFilters,
} from './filters.js'

const allowed = {
  seniority: ['cxo', 'vp', 'director', 'owner'],
  departments: ['finance', 'executive', 'sales'],
  industries: ['accounting', 'financial services', 'higher education'],
}

test('normalizeFilters keeps only allowed values in canonical spelling and order', () => {
  const f = normalizeFilters(
    {
      seniority: ['Owner', 'CXO', 'intern'],
      departments: ['finance', 'Finance', 'legal'],
      titles: ['  Controller ', 'controller', 'x'],
      title_match: 'EXACT',
      employee_bands: ['51 to 100', '11 to 25', '9 to 10'],
      revenue_bands: ['Under 1 Million'],
      industries: ['Accounting'],
      exclude_industries: ['higher education', 'made up'],
    },
    allowed
  )
  assert.deepEqual(f.seniority, ['cxo', 'owner'])
  assert.deepEqual(f.departments, ['finance'])
  assert.deepEqual(f.titles, ['Controller'])
  assert.equal(f.title_match, 'exact')
  assert.deepEqual(f.employee_bands, ['11 to 25', '51 to 100'])
  assert.deepEqual(f.revenue_bands, ['Under 1 Million'])
  assert.deepEqual(f.industries, ['accounting'])
  assert.deepEqual(f.exclude_industries, ['higher education'])
  assert.equal(normalizeFilters({ title_match: 'fuzzy' }, allowed).title_match, 'semantic')
})

test('toAudienceLabFilters maps to businessProfile and skips empties', () => {
  assert.deepEqual(toAudienceLabFilters(EMPTY_FILTERS), {})
  assert.deepEqual(
    toAudienceLabFilters({
      ...EMPTY_FILTERS,
      seniority: ['cxo'],
      departments: ['finance'],
      exclude_titles: ['student'],
      employee_bands: ['11 to 25'],
      exclude_industries: ['higher education'],
    }),
    {
      businessProfile: {
        seniority: ['cxo'],
        department: ['finance'],
        excludeJobTitle: ['student'],
        jobTitleMatchMode: 'semantic',
        employeeCount: ['11 to 25'],
        excludeIndustry: ['higher education'],
      },
    }
  )
})

test('impactLayers are cumulative and skip empty groups', () => {
  const layers = impactLayers({ ...EMPTY_FILTERS, seniority: ['cxo'], industries: ['accounting'] })
  assert.deepEqual(
    layers.map((l) => l.key),
    ['base', 'seniority', 'industries']
  )
  assert.equal(hasAnyFilter(layers[0].filters), false)
  assert.deepEqual(layers[2].filters.seniority, ['cxo'])
  assert.deepEqual(layers[2].filters.industries, ['accounting'])
})

test('profile columns round-trip', () => {
  const f = { ...EMPTY_FILTERS, seniority: ['vp'], titles: ['controller'], revenue_bands: ['Under 1 Million'] }
  assert.deepEqual(profileColumnsToFilters(filtersToProfileColumns(f)), f)
})

test('audienceMakeup keeps distributions and known shares', () => {
  const m = audienceMakeup({
    reach: 200,
    distributions: { seniority_level: [['cxo', 50]], company_revenue: { 'Under 1 Million': 30, '1 Billion and Over': 70 } },
    coverage: { total: 200, has_seniority_level: 180, has_department: 100 },
  })
  assert.equal(m.reach, 200)
  assert.deepEqual(m.seniority, [{ value: 'cxo', count: 50 }])
  assert.equal(m.revenue[0].value, '1 Billion and Over')
  assert.equal(m.known.seniority, 90)
  assert.equal(m.known.department, 50)
  assert.equal(m.known.revenue, 0)
})

test('filtersUserMessage includes makeup, volume and allowed values', () => {
  const msg = filtersUserMessage({
    profileText: '# Acme',
    segments: [{ topic: 'Bench', segment_id: 'b2b_1' }],
    makeup: audienceMakeup({ reach: 10, distributions: { seniority_level: [['owner', 4]] }, coverage: { total: 10, has_seniority_level: 9 } }),
    allowed,
    current: null,
    need: 60,
    target: 180,
  })
  assert.match(msg, /- Bench \(b2b_1\)/)
  assert.match(msg, /seniority \(known 90%\): owner 4/)
  assert.match(msg, /60 new people per weekday and wants about 180/)
  assert.match(msg, /industries: accounting, financial services, higher education/)
})

test('normalizeReasons keeps known fields only', () => {
  assert.deepEqual(normalizeReasons({ seniority: ' owners buy ', bogus: 'x', titles: '' }), { seniority: 'owners buy' })
})
