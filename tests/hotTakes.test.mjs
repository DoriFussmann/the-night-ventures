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

import { findDuplicate, similarity, splitTakes, takesNotInBank } from '../lib/aeo/hotTakesBank.js'

test('splitTakes: paragraphs and bullets, no headings or short labels', () => {
  const field = 'From Dori (first-hand view):\n- Embed AI into the natural steps people already take. Do not try to change how they work.\n- Avoid revolutions; map where AI fits and where it does not.\n\nA single paragraph\nover two lines that is long enough to count as a take.\n\nToo short.'
  assert.deepEqual(splitTakes(field), [
    'Embed AI into the natural steps people already take. Do not try to change how they work.',
    'Avoid revolutions; map where AI fits and where it does not.',
    'A single paragraph over two lines that is long enough to count as a take.',
  ])
  assert.deepEqual(splitTakes(''), [])
})
test('findDuplicate: same words, punctuation and case aside; one inside the other; reworded lightly', () => {
  const bank = [
    { code: 'R001', take: 'Founders should not give up equity for a fundraising service, or pay a percentage of the raise for it.' },
    { code: 'R002', take: 'Do not send multiple follow-ups. One is enough.', status: 'dropped' },
  ]
  assert.equal(findDuplicate('founders should not give up equity for a fundraising service or pay a percentage of the raise for it', bank).code, 'R001')
  assert.equal(findDuplicate('Founders should not give up equity for a fundraising service, or pay a percentage of the raise for it. Cash comes back, equity does not.', bank).code, 'R001')
  assert.equal(findDuplicate('Founders should never give up equity for a fundraising service, or pay a percentage of the raise for it.', bank).code, 'R001')
  assert.equal(findDuplicate('Do not send multiple follow-ups. One is enough.', bank).code, 'R002')
  assert.equal(findDuplicate('A flat monthly fee keeps the advisor focused on the work, not on the size of the round.', bank), null)
  assert.equal(findDuplicate('', bank), null)
  assert.ok(similarity('a b c d', 'a b c d') === 1 && similarity('a b c d', 'w x y z') === 0)
})
test('takesNotInBank lists only what the bank lacks', () => {
  const bank = [{ code: 'N001', take: 'Start with the workflow, not the technology. Understand the problem first.' }]
  const field = 'Start with the workflow, not the technology. Understand the problem first.\n\nHourly billing rewards time spent, which is the wrong thing to reward in an AI build.'
  assert.deepEqual(takesNotInBank(field, bank), ['Hourly billing rewards time spent, which is the wrong thing to reward in an AI build.'])
})
test('findDuplicate: text a take was made from is already in the bank', () => {
  const bank = [{ code: 'R051', take: 'Fundraising is a time-consuming project. Outsource it.', original: 'fund raising is a time consuming project which will eat a lot of the founder\'s time, who needs to run a grow a company. outsource this, for two main reasons' }]
  assert.equal(findDuplicate('fund raising is a time consuming project which will eat a lot of the founder\'s time', bank).code, 'R051')
})

import { buildThemeConnectionPrompt, parseConnections } from '../lib/aeo/hotTakes.js'

test('theme connection: the prompt carries the bank, the articles and the view so far', () => {
  const p = buildThemeConnectionPrompt({ takes, pillar: { name: 'Fees' }, articles: ['Success fees'], prompts: ['Is a success fee fair?'], view: 'my view so far' })
  for (const s of ['[R002] (Fees · Opinion) A flat fee aligns incentives. {note: check}', '- Success fees', 'Is a success fee fair?', 'my view so far', 'Never change what the take says']) assert.ok(p.includes(s), s)
  assert.ok(!buildThemeConnectionPrompt({ takes, pillar: null, articles: [], prompts: [], view: '' }).includes('The view as written so far'))
})
test('parseConnections keeps known codes, needs text, carries the original takes', () => {
  const out = parseConnections('{"connections":[{"codes":["R001","R002","ZZ"],"text":" merged ","serves":"fees article"},{"codes":["ZZ"],"text":"x"},{"codes":["R010"],"text":""},{"code":"R010","text":"one follow-up"}]}', takes)
  assert.deepEqual(out.map((c) => [c.codes.join('+'), c.text, c.serves]), [['R001+R002', 'merged', 'fees article'], ['R010', 'one follow-up', '']])
  assert.equal(out[0].from[1].note, 'check')
  assert.equal(out[1].from[0].take, 'One follow-up is enough.')
})
test('parseMatches carries the reworded text when there is one', () => {
  const out = parseMatches('{"matches":[{"code":"R001","text":"reworded","why":"w"},{"code":"R002"}]}', takes)
  assert.deepEqual(out.matches.map((m) => [m.code, m.text]), [['R001', 'reworded'], ['R002', '']])
})
