import test from 'node:test'
import assert from 'node:assert/strict'
import { appendTake, hasTake, nextCode, parseImport, groupByTopic } from '../lib/aeo/hotTakesBank.js'
import { bankLines, buildMatchPrompt, buildNewTakePrompt, parseMatches, parseNewTake } from '../lib/aeo/hotTakes.js'
import { buildKeyPointsPrompt } from '../lib/aeo/briefOutline.js'

const takes = [
  { code: 'R001', topic: 'Fees', kind: 'Opinion', take: 'No equity for a fundraising service.', note: '' },
  { code: 'R002', topic: 'Fees', kind: 'Opinion', take: 'A flat fee aligns incentives.', note: 'check' },
  { code: 'R010', topic: 'Outreach', kind: 'Method', take: 'One follow-up is enough.', note: '' },
]
const article = { title: 'Flat fee', angle: 'a', outline: [{ heading: 'Why' }], group: { name: 'G' }, pillar: { name: 'P' }, prompts: [{ prompt: 'Is a success fee fair?' }] }

test('appendTake adds a paragraph and never adds a take twice', () => {
  assert.equal(appendTake('', 'A.'), 'A.')
  assert.equal(appendTake('A.', 'B.'), 'A.\n\nB.')
  assert.equal(appendTake('A.\n\nB.', ' B. '), 'A.\n\nB.')
  assert.ok(hasTake('x  A  flat\nfee y', 'A flat fee'))
  assert.ok(!hasTake('x', ''))
})
test('nextCode continues the bank, or starts from the company initial', () => {
  assert.equal(nextCode(takes), 'R011')
  assert.equal(nextCode([], 'No Black Swan'), 'N001')
  assert.equal(nextCode([{ code: 'odd' }], ''), 'T001')
})
test('parseImport keeps this company only, needs code and take, maps id to code', () => {
  const file = JSON.stringify([
    { id: 'R001', company: 'Rupert', topic: 'Fees', kind: 'Opinion', take: 'A', original: 'a' },
    { id: 'N001', company: 'No Black Swan', take: 'B' },
    { id: 'R002', company: 'rupert', kind: 'Nonsense', take: 'C' },
    { id: 'R002', company: 'Rupert', take: 'again' },
    { id: 'R003', company: 'Rupert', take: ' ' },
  ])
  const { rows, otherCompany, incomplete } = parseImport(file, 'Rupert')
  assert.deepEqual(rows.map((r) => [r.code, r.kind, r.status]), [['R001', 'Opinion', 'active'], ['R002', 'Opinion', 'active']])
  assert.equal(otherCompany, 1)
  assert.equal(incomplete, 2)
  assert.throws(() => parseImport('{}', 'Rupert'), /list of takes/)
  assert.throws(() => parseImport('nope', 'Rupert'), /valid JSON/)
})
test('groupByTopic keeps first-seen order', () => {
  assert.deepEqual(groupByTopic(takes).map((g) => [g.topic, g.items.length]), [['Fees', 2], ['Outreach', 1]])
})
test('prompts carry the whole bank with codes and notes', () => {
  assert.equal(bankLines(takes)[1], '[R002] (Fees · Opinion) A flat fee aligns incentives. {note: check}')
  for (const p of [buildMatchPrompt({ takes, ...article }), buildNewTakePrompt({ voice: 'v', takes, current: 'x', ...article })]) {
    assert.ok(p.includes('[R010] (Outreach · Method) One follow-up is enough.'))
    assert.ok(p.includes('Is a success fee fair?'))
  }
})
test('parseMatches drops unknown and repeated codes', () => {
  const out = parseMatches('```json\n{"matches":[{"code":"R002","why":"w"},{"code":"X9"},{"code":"R002"},{"code":"R001"}],"conflicts":[{"codes":["R001","X9"],"why":"n"},{"codes":["R001","R002"],"why":"y"}]}\n```', takes)
  assert.deepEqual(out.matches.map((m) => m.code), ['R002', 'R001'])
  assert.deepEqual(out.conflicts, [{ codes: ['R001', 'R002'], why: 'y' }])
  assert.throws(() => parseMatches('sorry', takes), /incomplete/)
})
test('parseNewTake keeps only codes that are in the bank', () => {
  assert.deepEqual(parseNewTake('{"take":" T ","basedOn":["R001","Z"],"why":"w"}', takes), { take: 'T', basedOn: ['R001'], why: 'w' })
})
test('Monthly Plan key points: the bank is added when there is one, and the prompt is unchanged without it', () => {
  const base = { voice: 'v', view: 'my view', title: 't', angle: '', outline: [], group: { name: 'G' }, pillar: { name: 'P' }, prompts: [], brandFacts: {} }
  const without = buildKeyPointsPrompt(base)
  assert.ok(!without.includes('standing hot takes (their bank)'))
  const withBank = buildKeyPointsPrompt({ ...base, takes })
  assert.ok(withBank.includes('[R001] (Fees · Opinion) No equity for a fundraising service.'))
  assert.ok(withBank.indexOf('my view') < withBank.indexOf('[R001]'))
})
