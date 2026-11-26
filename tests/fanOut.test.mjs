import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROMPT_MAX,
  STEPS,
  answerHeadings,
  briefFromTopic,
  buildPersonaPrompt,
  buildPromptsPrompt,
  buildTopicsPrompt,
  collectQueries,
  decideAction,
  icpExcerpt,
  isWeak,
  parseJsonReply,
  parsePersona,
  parsePrompts,
  parseTopics,
  planRuns,
  promptIssues,
  staleAfter,
  topicStats,
} from '../lib/fan-out/core.js'

const OWN = 'brand-own'
const prompts = [
  { id: 'p-m', form: 'medium', prompt: 'I run a small SaaS in Austin. Should I raise money?' },
  { id: 'p-s', form: 'short', prompt: 'Should a tiny SaaS raise money?' },
]
const run = (id, promptId, runNo, fanOut, cited = [], brands = {}) => ({
  id, prompt_id: promptId, run_no: runNo, status: 'ok', fan_out: fanOut, cited, searched: fanOut.length > 0, brands,
  answer: '## 1\\. Can you raise with 7 customers?\n\ntext\n\n### Option B: An SBA microloan\n\n## $4,500\n',
})
// Shapes taken from the manual test of 2026-11-26.
const runs = [
  run('r1', 'p-m', 1, ['2025 pre-seed SaaS fundraising benchmarks SAFE valuation cap Carta', 'Florida angel investor networks Tampa Bay early stage startups 2026'], [{ domain: 'carta.com', url: 'https://carta.com/data/state-of-pre-seed-2025/', title: 'State of Pre-Seed' }]),
  run('r2', 'p-m', 2, ['Pre-seed SaaS fundraising benchmarks SAFE valuation cap Carta 2026', 'Y Combinator SAFE financing valuation cap dilution guide'], [{ domain: 'carta.com', url: 'https://carta.com/x', title: 'x' }, { domain: 'ycombinator.com', url: 'https://www.ycombinator.com/safe', title: 'SAFE' }]),
  run('r3', 'p-s', 1, ['pre-seed SaaS fundraising benchmarks SAFE valuation cap Carta'], [{ domain: 'carta.com', url: 'https://carta.com/x', title: 'x' }]),
  { id: 'r4', prompt_id: 'p-s', run_no: 2, status: 'failed', fan_out: [], cited: [], brands: {} },
]

test('staleAfter names the first later step that has data', () => {
  assert.equal(staleAfter('describe', { persona: true, prompts: true }), 'persona')
  assert.equal(staleAfter('persona', { prompts: false, run: true }), 'run')
  assert.equal(staleAfter('prompts', {}), '')
  assert.equal(staleAfter('topics', { push: true }), 'push')
  assert.deepEqual(STEPS, ['describe', 'persona', 'prompts', 'run', 'topics', 'push'])
})

test('parseJsonReply reads JSON inside a fence or a sentence and refuses a cut reply', () => {
  assert.deepEqual(parseJsonReply('```json\n{"a": 1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonReply('Here it is: {"a": {"b": 2}} done'), { a: { b: 2 } })
  assert.throws(() => parseJsonReply('{"a": '), /incomplete/)
})

test('icpExcerpt keeps the customer line, Ideal Customer, Buyer Situations and Alternatives only', () => {
  const md = ['# ICP: Acme', 'Bootstrapped founders raising a first round.', '## Blocking Unknowns', 'secret-a', '## Ideal Customer', 'keep-ideal', '## Buyer Situations', '| S1 | First raise |', '### Notes', 'keep-note', '## Question Variables', 'secret-b', '## Alternatives', 'keep-alt'].join('\n')
  const out = icpExcerpt(md)
  for (const want of ['Bootstrapped founders', 'keep-ideal', '| S1 | First raise |', 'keep-note', 'keep-alt']) assert.ok(out.includes(want), want)
  for (const not of ['secret-a', 'secret-b']) assert.ok(!out.includes(not), not)
  assert.equal(icpExcerpt(''), '')
})

test('the persona request carries the description, the ICP and earlier situations; the reply is cleaned', () => {
  const req = buildPersonaPrompt({ description: 'a tired solo founder', icpMd: '# ICP\nline\n## Buyer Situations\n| S1 | x |', companyName: 'Acme', earlier: [{ code: 'F001', title: 'Panicked founder', description: 'd' }] })
  assert.ok(req.includes('a tired solo founder') && req.includes('| S1 | x |') && req.includes('F001: Panicked founder'))
  const p = parsePersona('{"title":"Tired solo founder weighs a raise","who":"A solo founder.","where_they_stand":"7 customers.","inside":"Tired.","location":"Austin, Texas","location_assumed":true,"situation_id":"S1","fit_note":"First raise.","outside_icp":false,"duplicate_of":""}')
  assert.equal(p.persona.location, 'Austin, Texas')
  assert.equal(p.persona.location_assumed, true)
  assert.equal(p.situation_id, 'S1')
  assert.throws(() => parsePersona('{"title":"x","who":""}'), /empty/)
})

test('the prompt request forbids the own brand and the characters the engine misreads', () => {
  const req = buildPromptsPrompt({ description: 'd', persona: { who: 'w', where_they_stand: 's', inside: 'i', location: 'Austin, Texas' }, ownNames: ['Rupert', 'heyrupert'] })
  assert.ok(req.includes('Never mention: Rupert, heyrupert'))
  assert.ok(req.includes('Austin, Texas'))
  assert.ok(/% or \+/.test(req))
  const out = parsePrompts('{"medium":"first line\\nsecond line","short":"one\\nline"}')
  assert.equal(out.medium, 'first line\nsecond line')
  assert.equal(out.short, 'one line')
})

test('promptIssues blocks an over-long prompt and one that names the company, and warns on % and +', () => {
  assert.equal(promptIssues('x'.repeat(PROMPT_MAX)).block.length, 0)
  assert.match(promptIssues('x'.repeat(PROMPT_MAX + 1)).block[0], /2,001 characters/)
  assert.match(promptIssues('Is Rupert any good for outreach?', ['Rupert']).block[0], /names Rupert/)
  assert.equal(promptIssues('my friend rupert said so', ['Rupert']).block.length, 0) // a single word matches as a proper noun only
  assert.equal(promptIssues('growing 15% a month').warn.length, 1)
  assert.equal(promptIssues('').block.length, 1)
})

test('planRuns orders run 1 of every prompt before run 2 and skips captures that already returned', () => {
  assert.deepEqual(planRuns(prompts, 2), [
    [{ promptId: 'p-m', runNo: 1 }, { promptId: 'p-s', runNo: 1 }],
    [{ promptId: 'p-m', runNo: 2 }, { promptId: 'p-s', runNo: 2 }],
  ])
  // r4 failed, so it is planned again; the three ok runs are not.
  assert.deepEqual(planRuns(prompts, 2, runs), [[{ promptId: 'p-s', runNo: 2 }]])
  assert.deepEqual(planRuns(prompts, 1, runs), [])
})

test('answerHeadings reads the sub-questions and leaves out figure tiles', () => {
  assert.deepEqual(answerHeadings(runs[0].answer), ['Can you raise with 7 customers?', 'Option B: An SBA microloan'])
})

test('collectQueries merges wordings that differ only in year, case and filler, and counts runs and forms', () => {
  const q = collectQueries(runs, prompts)
  assert.equal(q.length, 3)
  assert.equal(q[0].runs, 3)
  assert.deepEqual(q[0].forms.sort(), ['medium', 'short'])
  assert.deepEqual(q.map((x) => x.id), ['q1', 'q2', 'q3'])
  assert.ok(q.slice(1).every((x) => x.runs === 1))
})

test('the topics request lists every search with its id; the reply keeps each search in one topic and drops none', () => {
  const queries = collectQueries(runs, prompts)
  const req = buildTopicsPrompt({ persona: { who: 'w', where_they_stand: 's', location: 'Austin, Texas' }, prompts, queries, runs, pillars: [{ code: 'A', name: 'Raising' }], groups: [{ code: 'A01', name: 'SAFE basics' }], ownNames: ['Rupert'], companyName: 'Rupert' })
  for (const q of queries) assert.ok(req.includes(`${q.id} · ${q.runs} · ${q.q}`))
  assert.ok(req.includes('carta.com') && req.includes('A01 · SAFE basics') && req.includes('Never write Rupert'))
  const florida = queries.find((q) => /Florida/.test(q.q)).id
  const reply = JSON.stringify({ topics: [
    { title: 'Pre-seed benchmarks for SaaS', queries: ['q1', 'q1', 'q99'], local: false, recommendation: false, owner_note: 'Carta owns the data.', answer_points: ['Median cap', ''], match_group: '', pillar: 'A' },
    { title: 'Florida angels', queries: [florida, 'q1'], local: true, recommendation: true, owner_note: '', answer_points: [], match_group: '', pillar: '' },
  ] })
  const topics = parseTopics(reply, queries)
  assert.deepEqual(topics[0].queryIds, ['q1'])
  assert.deepEqual(topics[0].answer_points, ['Median cap'])
  assert.deepEqual(topics[1].queryIds, [florida]) // q1 already belongs to the first topic
  assert.equal(topics[2].title, 'Other searches') // the search the model left out is kept
  assert.equal(topics.flatMap((t) => t.queryIds).length, queries.length)
  assert.throws(() => parseTopics('{"topics": []}', queries), /No topics/)
})

test('topicStats counts runs, forms and who is cited, and labels where the company stands', () => {
  const queries = collectQueries(runs, prompts)
  const stats = topicStats({ queryIds: ['q1'] }, queries, runs, prompts, OWN)
  assert.equal(stats.runs_seen, 3)
  assert.equal(stats.forms_seen, 2)
  assert.deepEqual(stats.winners.map((w) => [w.domain, w.cited]), [['carta.com', 3], ['ycombinator.com', 1]])
  assert.equal(stats.standing, 'Absent')
  const named = runs.map((r) => (r.id === 'r1' ? { ...r, brands: { [OWN]: { named: true, cited: false, retrieved: false } } } : r))
  assert.equal(topicStats({ queryIds: ['q1'] }, queries, named, prompts, OWN).standing, 'Named')
})

test('decideAction follows the rules in order and gives the rule as the reason', () => {
  const base = { standing: 'Absent', local: false, recommendation: false, matchGroup: null }
  assert.equal(decideAction({ ...base, local: true, standing: 'Named' }).action, 'skip')
  assert.equal(decideAction({ ...base, standing: 'Named' }).action, 'won')
  assert.equal(decideAction({ ...base, standing: 'Cited, not named' }).action, 'page_fix')
  assert.equal(decideAction({ ...base, standing: 'Retrieved, not cited' }).action, 'improve_page')
  assert.equal(decideAction({ ...base, recommendation: true, matchGroup: { code: 'A01' } }).action, 'commercial_page')
  const existing = decideAction({ ...base, matchGroup: { code: 'A01' } })
  assert.equal(existing.action, 'existing_group')
  assert.ok(existing.reason.includes('A01'))
  assert.equal(decideAction(base).action, 'new_article')
  assert.ok(decideAction({ ...base, hasOwnBrand: false }).reason.includes('No own brand is tracked'))
})

test('a topic seen in one run is weak only when there were at least three runs', () => {
  assert.equal(isWeak({ runs_seen: 1 }, 3), true)
  assert.equal(isWeak({ runs_seen: 2 }, 10), false)
  assert.equal(isWeak({ runs_seen: 1 }, 2), false)
})

test('briefFromTopic fills title, keyword, angle and outline, and leaves hot takes out', () => {
  const b = briefFromTopic({
    title: 'Pre-seed benchmarks for SaaS',
    queries: [{ q: 'pre-seed SAFE valuation cap median', runs: 3 }, { q: 'carta state of pre-seed', runs: 1 }],
    answer_points: ['What cap is typical at $5k MRR.', 'How much dilution to expect'],
    owner_note: 'Carta owns the data; nobody answers it for solo founders.',
    winners: [{ domain: 'carta.com', cited: 3 }],
  })
  assert.equal(b.title, 'Pre-seed benchmarks for SaaS')
  assert.equal(b.primary_keyword, 'pre-seed SAFE valuation cap median')
  assert.ok(b.angle.includes('Carta owns the data') && b.angle.includes('Cited today: carta.com.'))
  assert.equal(b.outline[0].heading, 'The short story')
  assert.ok(b.outline[0].points.includes('pre-seed SAFE valuation cap median'))
  assert.deepEqual(b.outline.slice(1).map((s) => s.heading), ['What cap is typical at $5k MRR', 'How much dilution to expect'])
  assert.ok(!('key_points' in b))
})
