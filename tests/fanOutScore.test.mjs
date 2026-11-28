import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../lib/fan-out/core.js'
import { brandKey, brandSites, buildLabelPrompt, labelBatches, quoteFits, margin, mentionExcerpt, mentionIndex, namedOrder, parseLabels, scoreRuns, share, signalLabel, unlabeled, verdict } from '../lib/fan-out/score.js'

const OWN = { id: 'own', name: 'Rupert', name_patterns: ['Rupert', 'Hey Rupert'], is_own: true }
const RIVAL = { id: 'riv', name: 'RivalCo', name_patterns: [], is_own: false }
const OTHER = { id: 'oth', name: 'Thirdly', name_patterns: [], is_own: false }
const brands = [OWN, RIVAL, OTHER]
const run = (id, form, answer, entities = [], labels = {}, extra = {}) => ({ id, status: 'ok', prompt_form: form, answer, brand_entities: entities.map((name) => ({ name, title: 'a kind of company' })), mention_labels: labels, searched: true, model: 'gpt-6', ...extra })

test('signal labels follow the thresholds', () => {
  assert.equal(signalLabel(0.5), 'Strong')
  assert.equal(signalLabel(0.49), 'Occasional')
  assert.equal(signalLabel(0.2), 'Occasional')
  assert.equal(signalLabel(0.19), 'Noise')
  assert.equal(signalLabel(0.3, { strong: 0.25, occasional: 0.1 }), 'Strong')
})

test('the margin comes from the counts: about ±12 at 63 runs, about ±21 at 21, and never zero at 0%', () => {
  assert.equal(margin(32, 63), 12)
  assert.ok(margin(10, 21) >= 19 && margin(10, 21) <= 21)
  assert.ok(margin(0, 63) >= 3 && margin(0, 63) <= 6)
  assert.equal(margin(0, 0), 0)
  assert.deepEqual(share(4, 19), { x: 4, n: 19, pct: 21, margin: margin(4, 19) })
})

test('a change is a Real move only when it exceeds the margin', () => {
  assert.deepEqual(verdict(share(20, 63), share(26, 63)), { change: 9, margin: 12, real: false })
  assert.equal(verdict(share(10, 63), share(30, 63)).real, true)
  assert.equal(verdict(share(30, 63), share(10, 63)).change, -32)
})

test('brands are ordered as they appear in the answer; a tagged brand that is an alias of a tracked one is not "discovered"', () => {
  const r = run('1', 'short', 'You could try Foundersuite first. RivalCo is also good, and Hey Rupert does this for you.', ['Foundersuite', 'Hey Rupert', 'RivalCo', 'OpenVC'])
  assert.deepEqual(namedOrder(r, brands).map((o) => o.name), ['Foundersuite', 'RivalCo', 'Rupert', 'OpenVC'])
  assert.equal(mentionIndex('ask rupert, a friend', OWN), -1) // a single word matches as a proper noun only
  assert.ok(mentionIndex('Then Rupert.', OWN) > 0)
})

test('the score counts Mentioned, First named, Recommended and Mentioned by type, ranks the brands and lists discovered ones', () => {
  const runs = [
    run('1', 'short', 'Rupert is the strongest fit. RivalCo is an option.', [], { own: { label: 'recommended', quote: 'strongest fit' }, riv: { label: 'listed', quote: '' } }),
    run('2', 'short', 'RivalCo, then Rupert.', ['Foundersuite'], { own: { label: 'listed' } }),
    run('3', 'medium', 'RivalCo only. Also Foundersuite.', ['Foundersuite']),
    run('4', 'long', 'No names here.', []),
    { id: '5', status: 'failed', prompt_form: 'long' },
  ]
  const s = scoreRuns(runs, brands)
  assert.equal(s.runs, 4)
  assert.equal(s.failed, 1)
  assert.deepEqual([s.own.mentioned.x, s.own.mentioned.pct], [2, 50])
  assert.deepEqual([s.own.first.x, s.own.recommended.x], [1, 1])
  assert.deepEqual(s.own.byType, { medium: share(0, 1), short: share(2, 2), long: share(0, 1) })
  assert.deepEqual(s.own.labels, { recommended: 1, listed: 1, qualified: 0, unlabeled: 0 })
  assert.deepEqual(s.brands.map((b) => [b.name, b.rank, b.mentioned.x]), [['RivalCo', 1, 3], ['Rupert', 2, 2], ['Thirdly', 3, 0]])
  assert.equal(s.brands[0].labels.unlabeled, 2)
  assert.equal(s.gap, 25)
  assert.deepEqual(s.leader, { name: 'RivalCo', own: false, pct: 75 })
  assert.deepEqual(s.discovered, [{ name: 'Foundersuite', runs: 2, pct: 50, signal: 'Strong', site: '' }])
  assert.equal(s.model, 'gpt-6')
  // First named counts discovered brands too: a discovered brand ahead of ours means we are not first.
  const d = scoreRuns([run('1', 'short', 'Foundersuite first, then Rupert.', ['Foundersuite'])], brands)
  assert.equal(d.own.first.x, 0)
  assert.equal(d.own.mentioned.x, 1)
})

test('only named brands without a label are sent for labeling, with the lines around each mention', () => {
  const runs = [
    run('1', 'short', 'Intro line.\n\nRupert is the strongest fit.\nIt runs outreach.\n\nFar away line.\nRivalCo is fine.', [], { own: { label: 'recommended', quote: 'strongest fit' } }),
    run('2', 'short', 'Nobody.'),
  ]
  const todo = unlabeled(runs, brands)
  assert.deepEqual(todo.map((x) => [x.run.id, x.brands.map((b) => b.name)]), [['1', ['RivalCo']]])
  const ex = mentionExcerpt(runs[0].answer, [OWN])
  assert.ok(ex.includes('Rupert is the strongest fit.') && ex.includes('It runs outreach.') && !ex.includes('Far away line.'))
  const req = buildLabelPrompt(todo, DEFAULT_SETTINGS.prompt_labels)
  assert.ok(req.includes('--- r1 · brands to label: RivalCo') && req.includes('RivalCo is fine.') && !req.includes('{answers}'))
})

test('a label counts only with a quote that is really in the answer and is about that brand; otherwise the mention is Listed', () => {
  const answer = 'For this, **Rupert** is the  strongest fit. RivalCo works, but is expensive for small teams. Thirdly too.'
  const batch = [{ run: run('1', 'short', answer), brands }]
  const reply = JSON.stringify({ labels: [
    { run: 'r1', brand: 'Hey Rupert', label: 'Recommended', quote: 'Rupert is the strongest fit' },
    { run: 'r1', brand: 'RivalCo', label: 'qualified', quote: 'works, but is cheap' },
  ] })
  assert.deepEqual(parseLabels(reply, batch, brands), [
    { runId: '1', brandId: 'own', label: 'recommended', quote: 'Rupert is the strongest fit' },
    { runId: '1', brandId: 'riv', label: 'listed', quote: '' },
  ]) // Thirdly was left out of the reply: it gets no label and is asked again
  assert.deepEqual(parseLabels('{"labels": []}', batch, brands), [])
  // A real phrase about another brand does not make ours Recommended.
  const other = 'RivalCo is the strongest fit for most teams. Rupert is also an option.'
  assert.equal(quoteFits(other, 'the strongest fit', OWN, brands), false)
  assert.equal(quoteFits(other, 'the strongest fit', RIVAL, brands), true)
  assert.equal(quoteFits(other, 'you.', OWN, brands), false)
  // A statement right under a heading that names the brand counts.
  assert.equal(quoteFits('### Best overall: Rupert\nStrongest fit for small teams.', 'Strongest fit for small teams', OWN, brands), true)
  assert.equal(quoteFits('### Best overall: Rupert\nRivalCo is the strongest fit.', 'the strongest fit', OWN, brands), false)
  const out = parseLabels(JSON.stringify({ labels: [{ run: 'r1', brand: 'Rupert', label: 'recommended', quote: 'the strongest fit' }] }), [{ run: run('2', 'short', other), brands: [OWN] }], brands)
  assert.deepEqual(out, [{ runId: '2', brandId: 'own', label: 'listed', quote: '' }])
})

test('labeling requests hold a limited number of labels, and positions respect whole words and excluded lines', () => {
  const todo = Array.from({ length: 5 }, (_, i) => ({ run: { id: String(i) }, brands: [OWN, RIVAL, OTHER] }))
  assert.deepEqual(labelBatches(todo, 7).map((b) => b.length), [2, 2, 1])
  assert.deepEqual(labelBatches([], 7), [])
  const bench = run('1', 'short', 'A good benchmark first. Then Rupert. Bench is another.', ['Bench'])
  assert.deepEqual(namedOrder(bench, brands).map((o) => o.name), ['Rupert', 'Bench'])
  const tagged = run('2', 'short', 'Try Rivalco or RivalCo.', ['rivalco'])
  assert.deepEqual(namedOrder(tagged, brands).map((o) => o.name), ['RivalCo'])
  const excl = { ...OWN, exclude_patterns: ['murdoch'] }
  const r = run('3', 'short', 'Rupert Murdoch owns it.\nRivalCo is good. Rupert too.')
  assert.deepEqual(namedOrder(r, [excl, RIVAL]).map((o) => o.name), ['RivalCo', 'Rupert'])
})

test('a discovered brand gets its website from the Run: the tag\'s own address, or the site named after it', () => {
  const runs = [
    { ...run('1', 'short', 'A3M Consultants, Outriva & Partners, RaiseRunner, HubSpot and Jonathan Hua.', ['A3M Consultants', 'Outriva & Partners', 'RaiseRunner', 'HubSpot', 'Jonathan Hua', 'Affinity']),
      cited: [{ url: 'https://www.a3mconsultants.com/services', domain: 'a3mconsultants.com' }, { url: 'https://outriva.com/', domain: 'outriva.com' }, { domain: 'sec.gov' }],
      search_results: [{ url: 'https://blog.raiserunner.io/pricing' }, { url: 'https://www.hubspotusercontent.co.uk/x' }, { url: 'https://affinity.co/' }],
      raw_entities: [{ markdown: 'HubSpot', urls: ['https://www.hubspot.com/startups'] }, { markdown: 'A3M Consultants', urls: null }] },
  ]
  const site = brandSites(runs)
  assert.equal(site('A3M Consultants'), 'a3mconsultants.com')
  assert.equal(site('Outriva & Partners'), 'outriva.com')
  assert.equal(site('RaiseRunner'), 'blog.raiserunner.io')
  assert.equal(site('HubSpot'), 'hubspot.com') // from ChatGPT's own tag
  assert.equal(site('Affinity'), 'affinity.co')
  assert.equal(site('Jonathan Hua'), '')
  assert.equal(site('SEC'), '') // too short to match on
  const d = scoreRuns(runs, [OWN]).discovered
  assert.equal(d.find((x) => x.name === 'A3M Consultants').site, 'a3mconsultants.com')
  assert.equal(d.find((x) => x.name === 'HubSpot').site, 'hubspot.com')
})

test('one brand under different spellings is one discovered brand, shown under its most used spelling', () => {
  assert.equal(brandKey('Signal by NFX'), brandKey('NFX Signal'))
  assert.equal(brandKey('Streak CRM'), brandKey('Streak'))
  assert.equal(brandKey('Apollo.io'), brandKey('Apollo'))
  assert.notEqual(brandKey('Gmail'), brandKey('Google Sheets'))
  assert.equal(brandKey('CRM'), 'crm') // a name made only of generic words keeps them
  const runs = [
    run('1', 'short', 'Try Signal by NFX and Streak.', ['Signal by NFX', 'Streak']),
    run('2', 'short', 'Try NFX Signal, or Streak CRM.', ['NFX Signal', 'Streak CRM']),
    run('3', 'short', 'Signal by NFX again. Streak CRM too.', ['Signal by NFX', 'Streak CRM']),
  ]
  const d = scoreRuns(runs, [OWN]).discovered
  assert.deepEqual(d.map((x) => [x.name, x.runs]), [['Signal by NFX', 3], ['Streak CRM', 3]])
})
