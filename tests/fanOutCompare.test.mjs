import test from 'node:test'
import assert from 'node:assert/strict'
import { compareRuns, dueForRerun, movedVerdict, sameUrl } from '../lib/fan-out/compare.js'
import { share } from '../lib/fan-out/score.js'

const brand = (id, name, own, x, n, rank, first = 0, rec = 0) => ({ id, name, own, rank, mentioned: share(x, n), first: share(first, n), recommended: share(rec, n), byType: { short: share(Math.min(x, 21), 21) } })
const scored = (model, brands, groups, started = '2026-12-27T00:00:00Z') => ({ started_at: started, score: { runs: 63, model, brands, own: brands.find((b) => b.own) }, groups: { all: groups } })
const group = (id, verdict, named, of, extra = {}) => ({ id, label: `Group ${id}`, verdict, standing: { named, of }, signal: share(of, 63), ownCited: [], ...extra })

test('Moved means going from under half to half or more of the runs for that Query Group', () => {
  assert.equal(movedVerdict({ named: 4, of: 19 }, { named: 10, of: 20 }), true)
  assert.equal(movedVerdict({ named: 4, of: 19 }, { named: 9, of: 20 }), false)
  assert.equal(movedVerdict({ named: 10, of: 20 }, { named: 20, of: 20 }), false) // it was not an Opportunity
  assert.equal(movedVerdict({ named: 0, of: 0 }, { named: 0, of: 0 }), false)
})

test('the comparison shows each score with Baseline, now, change and verdict, the rank, and competitors beside us', () => {
  const before = scored('gpt-6', [brand('r', 'RivalCo', false, 40, 63, 1), brand('o', 'Rupert', true, 10, 63, 2), brand('t', 'Thirdly', false, 5, 63, 3)], [group('a', 'Opportunity', 4, 19), group('w', 'Win', 12, 20)], '2026-11-27T00:00:00Z')
  const now = scored('gpt-7', [brand('o', 'Rupert', true, 35, 63, 1), brand('r', 'RivalCo', false, 30, 63, 2), brand('t', 'Thirdly', false, 6, 63, 3)], [group('a', 'Win', 12, 20, { ownCited: [{ url: 'https://www.heyrupert.com/articles/outreach/' }] }), group('w', 'Opportunity', 5, 20), group('n', 'Opportunity', 0, 15, { isNew: true })])
  const cards = [
    { id: 'c1', kind: 'opportunity', status: 'acted_on', group_id: 'a', action: 'new_article', acted_on_at: '2026-12-05T00:00:00Z', acted_url: 'https://heyrupert.com/articles/outreach', stats: { label: 'Group a', standing: { named: 4, of: 19 } } },
    { id: 'c2', kind: 'opportunity', status: 'pushed', group_id: 'w', stats: { standing: { named: 1, of: 9 } } }, // not live yet
    { id: 'c3', kind: 'opportunity', status: 'done', group_id: 'gone', action: 'off_site', acted_on_at: '2026-12-28T00:00:00Z', stats: { standing: { named: 1, of: 9 } } }, // done after the Run
  ]
  const c = compareRuns(before, now, { cards })
  const m = c.scores.find((s) => s.label === 'Mentioned')
  assert.deepEqual([m.before.pct, m.now.pct, m.change, m.real], [16, 56, 40, true])
  assert.equal(c.scores.find((s) => s.label === 'First named').real, false)
  assert.deepEqual(c.rank, { before: 2, now: 1, of: 3 })
  assert.equal(c.modelChanged, true)
  assert.deepEqual(c.acted.map((x) => [x.cardId, x.moved, x.cited, x.before.named, x.now.named]), [['c1', true, true, 4, 12]])
  assert.deepEqual(c.around.newGroups.map((g) => g.id), ['n'])
  assert.deepEqual(c.around.slipped.map((g) => g.id), ['w'])
  assert.deepEqual(c.around.fell.map((x) => x.name), ['RivalCo'])
  assert.equal(c.together, false) // the rival moved the other way
  const same = compareRuns(before, before)
  assert.ok(same.scores.every((s) => !s.real) && !same.modelChanged)
})

test('when competitors moved the same way as us, the comparison says so', () => {
  const before = scored('gpt-6', [brand('o', 'Rupert', true, 10, 63, 3), brand('r', 'RivalCo', false, 20, 63, 1), brand('t', 'Thirdly', false, 15, 63, 2)], [])
  const now = scored('gpt-6', [brand('o', 'Rupert', true, 40, 63, 3), brand('r', 'RivalCo', false, 50, 63, 1), brand('t', 'Thirdly', false, 45, 63, 2)], [])
  assert.equal(compareRuns(before, now).together, true)
  // With no rival named in either Run there is no "everyone".
  const alone = (x) => scored('gpt-6', [brand('o', 'Rupert', true, x, 63, 1), brand('r', 'RivalCo', false, 0, 63, 2), brand('t', 'Thirdly', false, 0, 63, 2)], [])
  assert.equal(compareRuns(alone(10), alone(40)).together, false)
})

test('addresses match across protocol, www and trailing slash; the re-run reminder is due after a month', () => {
  assert.equal(sameUrl('https://www.x.com/a/?utm=1', 'http://x.com/a'), true)
  assert.equal(sameUrl('https://x.com/a', 'https://x.com/b'), false)
  assert.equal(sameUrl('', ''), false)
  const today = new Date('2026-12-28T00:00:00Z')
  assert.equal(dueForRerun('2026-11-27T00:00:00Z', 30, today), true)
  assert.equal(dueForRerun('2026-12-10T00:00:00Z', 30, today), false)
  assert.equal(dueForRerun(null, 30, today), false)
})
