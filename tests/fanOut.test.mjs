import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIRECTIONS,
  PROMPT_MAX,
  PUSHABLE,
  STEPS,
  answerHeadings,
  briefFromTopic,
  buildPersonaPrompt,
  buildPromptsPrompt,
  buildTopicsPrompt,
  collectCited,
  collectQueries,
  decideAction,
  icpExcerpt,
  isWeak,
  listsToGetOn,
  namedIn,
  parseJsonReply,
  parsePageTypes,
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

test('the direction decides what the prompts ask for; recommend is the default and asks for names', () => {
  const persona = { who: 'w', where_they_stand: 's', inside: 'i', location: 'Denver' }
  const rec = buildPromptsPrompt({ description: 'd', persona, ownNames: [] })
  assert.ok(rec.includes(DIRECTIONS.recommend.rule) && /who or what to use/.test(rec) && /names and options/.test(rec))
  const adv = buildPromptsPrompt({ description: 'd', persona, ownNames: [], direction: 'advise' })
  assert.ok(adv.includes(DIRECTIONS.advise.rule) && !adv.includes(DIRECTIONS.recommend.rule))
  const exp = buildPromptsPrompt({ description: 'd', persona, ownNames: [], direction: 'explain' })
  assert.ok(exp.includes(DIRECTIONS.explain.rule))
  assert.ok(buildPromptsPrompt({ description: 'd', persona, ownNames: [], direction: 'nonsense' }).includes(DIRECTIONS.recommend.rule))
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
  assert.ok(req.includes('c1 · carta.com · x · https://carta.com/x') && req.includes('A01 · SAFE basics') && req.includes('Never write Rupert'))
  assert.ok(req.includes('"pages": [{"id": "c1", "type": "vendor"}]'))
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

test('cited pages get ids, most cited first, and a type from the reply; an unknown type is "other"', () => {
  const cited = collectCited(runs)
  assert.deepEqual(cited.map((c) => [c.id, c.url, c.runs]), [['c1', 'https://carta.com/x', 2], ['c2', 'https://carta.com/data/state-of-pre-seed-2025/', 1], ['c3', 'https://www.ycombinator.com/safe', 1]])
  const types = parsePageTypes('{"topics": [], "pages": [{"id": "c1", "type": "Data"}, {"id": "c3", "type": "blog"}]}', cited)
  assert.deepEqual(types, { 'https://carta.com/x': 'data', 'https://carta.com/data/state-of-pre-seed-2025/': 'other', 'https://www.ycombinator.com/safe': 'other' })
})

test('namedIn counts tracked brands and the brands ChatGPT tagged, once per run, most named first', () => {
  const brands = [{ id: OWN, name: 'Rupert', is_own: true }, { id: 'b-o', name: 'OpenVC', is_own: false }]
  const rs = [
    { status: 'ok', brands: { 'b-o': { named: true } }, brand_entities: [{ title: 'openvc' }, { title: 'Signal NFX' }, { title: 'Signal NFX' }] },
    { status: 'ok', brands: { 'b-o': { named: true }, [OWN]: { named: true } }, brand_entities: [] },
    { status: 'failed', brands: { 'b-o': { named: true } }, brand_entities: [{ title: 'Ghost' }] },
  ]
  assert.deepEqual(namedIn(rs, brands), [
    { name: 'OpenVC', runs: 2, tracked: true, own: false },
    { name: 'Rupert', runs: 1, tracked: true, own: true },
    { name: 'Signal NFX', runs: 1, tracked: false, own: false },
  ])
  assert.deepEqual(namedIn([], brands), [])
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
  // page types and who is named ride along when given
  const typed = topicStats({ queryIds: ['q1'] }, queries, named, prompts, OWN, { brands: [{ id: OWN, name: 'Rupert', is_own: true }], pageTypes: { 'https://carta.com/x': 'data', 'https://www.ycombinator.com/safe': 'vendor' } })
  assert.equal(typed.winners[0].type, 'data')
  assert.deepEqual(typed.winners[0].pages.map((p) => [p.url, p.type, p.cited]), [['https://carta.com/x', 'data', 2], ['https://carta.com/data/state-of-pre-seed-2025/', 'other', 1]])
  assert.deepEqual(typed.named, [{ name: 'Rupert', runs: 1, tracked: true, own: true }])
})

test('listsToGetOn gathers list and directory pages across topics, skipping removed topics', () => {
  const topics = [
    { title: 'T1', status: 'proposed', winners: [{ domain: 'a.com', pages: [{ url: 'https://a.com/best', title: 'Best tools', type: 'list', cited: 3 }, { url: 'https://a.com/guide', title: 'Guide', type: 'guide', cited: 5 }] }] },
    { title: 'T2', status: 'approved', winners: [{ domain: 'a.com', pages: [{ url: 'https://a.com/best', title: 'Best tools', type: 'list', cited: 2 }] }, { domain: 'dir.io', pages: [{ url: 'https://dir.io/', title: '', type: 'directory', cited: 1 }] }] },
    { title: 'T3', status: 'removed', winners: [{ domain: 'x.com', pages: [{ url: 'https://x.com/top', title: 'Top', type: 'list', cited: 9 }] }] },
  ]
  assert.deepEqual(listsToGetOn(topics), [
    { url: 'https://a.com/best', domain: 'a.com', title: 'Best tools', type: 'list', cited: 3, topics: ['T1', 'T2'] },
    { url: 'https://dir.io/', domain: 'dir.io', title: 'dir.io', type: 'directory', cited: 1, topics: ['T2'] },
  ])
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
  assert.equal(b.article_type, null)
})

test('a comparison article is pushable, never chosen by rule, and its brief compares the named options without the own brand', () => {
  assert.ok(PUSHABLE.has('comparison_article'))
  for (const s of ['Named', 'Cited, not named', 'Retrieved, not cited', 'Absent']) {
    for (const recommendation of [true, false]) assert.notEqual(decideAction({ standing: s, local: false, recommendation, matchGroup: null }).action, 'comparison_article')
  }
  const b = briefFromTopic({
    title: 'Who can run investor outreach for a seed round',
    action: 'comparison_article',
    queries: [{ q: 'investor outreach service for startups', runs: 4 }],
    answer_points: ['What each option costs'],
    named: [{ name: 'OpenVC', runs: 4, tracked: true, own: false }, { name: 'Rupert', runs: 1, tracked: true, own: true }],
    winners: [{ domain: 'openvc.app', cited: 4 }],
  })
  assert.equal(b.article_type, 'comparison')
  assert.deepEqual(b.outline.map((s) => s.heading), ['The short story', 'The options compared', 'What each option costs'])
  assert.ok(b.outline[1].points.some((p) => p.includes('OpenVC')) && !JSON.stringify(b.outline).includes('Rupert'))
  assert.ok(b.angle.includes('Named today: OpenVC.'))
})
