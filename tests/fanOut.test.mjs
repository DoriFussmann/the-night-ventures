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
  STAGE_TIER,
  buildCheckPrompt,
  buildStructurePrompt,
  isPersona,
  mergeSettings,
  missingFields,
  parseCheck,
  parseJsonReply,
  parsePageTypes,
  parsePersona,
  parsePrompts,
  parseStructure,
  parseTopics,
  personLine,
  planRuns,
  promptIssues,
  promptLabel,
  scrubNames,
  situationText,
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

const SITUATION = { who: 'Founder and CEO of a three-person B2B SaaS', trigger_event: 'Three weeks of cold outreach to investors got no reply', goal: 'Raise a seed round', stage: 'comparing', direction: 'recommend', comments: '' }

test('a Situation needs Who, Trigger, Goal and a known Stage; its text is one paragraph', () => {
  assert.deepEqual(missingFields(SITUATION), [])
  assert.deepEqual(missingFields({ who: 'x', stage: 'later' }), ['Trigger', 'Goal', 'Stage'])
  assert.equal(situationText(SITUATION), 'Founder and CEO of a three-person B2B SaaS. Three weeks of cold outreach to investors got no reply. Goal: Raise a seed round. Stage: Comparing')
})

test('free text is sorted into the fields; fields the text does not cover are flagged, not guessed', () => {
  assert.ok(buildStructurePrompt({ text: 'a tired solo founder' }).includes('a tired solo founder'))
  const out = parseStructure('{"who":"A solo founder","trigger":"","goal":"Raise money","stage":"Ready to buy","direction":"nonsense","additional_comments":"tired"}')
  assert.deepEqual(out.fields, { who: 'A solo founder', trigger_event: '', goal: 'Raise money', stage: 'ready_to_buy', direction: 'recommend', comments: 'tired' })
  assert.deepEqual(out.missing, ['Trigger'])
})

test('the overlap check lists the bank and keeps at most three matches, "same" first, from the bank only', () => {
  const bank = [
    { id: 'a', code: 'F001', title: 'Stuck after cold outreach', ...SITUATION },
    { id: 'b', code: 'F002', title: 'Old one', description: 'A founder, free text', who: '', trigger_event: '', goal: '', stage: null },
    { id: 'c', code: 'F003', title: 'Third', ...SITUATION, stage: 'exploring' },
    { id: 'd', code: 'F004', title: 'Fourth', ...SITUATION, stage: 'ready_to_buy' },
  ]
  const req = buildCheckPrompt({ fields: SITUATION, bank })
  assert.ok(req.includes('F001 · Stuck after cold outreach · trigger: Three weeks') && req.includes('F002 · Old one · (older, free text) A founder, free text'))
  assert.ok(/mainly on trigger, goal and stage/.test(req))
  assert.ok(buildCheckPrompt({ fields: SITUATION, bank: [] }).includes('(the bank is empty)'))
  const out = parseCheck('{"name":"Founder stuck after cold outreach","matches":[{"code":"F003","match":"variant","why":"other stage"},{"code":"f001","match":"same","why":"same all"},{"code":"F999","match":"same","why":"x"},{"code":"F002","match":"distinct","why":"x"},{"code":"F004","match":"variant","why":"y"},{"code":"F001","match":"variant","why":"dup"}]}', bank)
  assert.equal(out.name, 'Founder stuck after cold outreach')
  assert.deepEqual(out.matches.map((m) => [m.code, m.match]), [['F001', 'same'], ['F003', 'variant'], ['F004', 'variant']])
  assert.equal(out.matches[0].id, 'a')
})

test('the persona is three tight fields, built without the Alternatives of the ICP, and brand-blind', () => {
  const req = buildPersonaPrompt({ situation: SITUATION, icpMd: '# ICP\nline\n## Buyer Situations\n| S1 | x |\n## Alternatives\nRivalCo' })
  assert.ok(req.includes('| S1 | x |') && req.includes('Three weeks of cold outreach') && req.includes('/ Comparing'))
  assert.ok(!req.includes('RivalCo'))
  const p = parsePersona('{"knowledge_level":"Novice","what_matters":["speed","cost","not wasting time","a fourth"],"vocabulary":["raise money","investors","Rupert","pitch","warm intro","seed","extra"]}', ['Rupert'])
  assert.equal(p.knowledge_level, 'novice')
  assert.deepEqual(p.what_matters, ['speed', 'cost', 'not wasting time'])
  assert.deepEqual(p.vocabulary, ['raise money', 'investors', 'pitch', 'warm intro'])
  assert.ok(isPersona(p) && !isPersona({ who: 'an older persona' }))
  assert.equal(parsePersona('{"knowledge_level":"guru","what_matters":["x"],"vocabulary":[]}').knowledge_level, 'informed')
  assert.throws(() => parsePersona('{"knowledge_level":"novice","what_matters":[],"vocabulary":[]}'), /empty/)
})

test('the prompt request fills every dynamic field, follows the Direction, and can ask for one prompt on a new angle', () => {
  const persona = { knowledge_level: 'novice', what_matters: ['speed', 'cost'], vocabulary: ['raise money', 'investors'] }
  const req = buildPromptsPrompt({ situation: SITUATION, persona, icpShort: 'Founders raising a first round' })
  assert.ok(!/\{[a-z_]+\}/.test(req), 'no unfilled field')
  assert.ok(req.includes('PERSON: Founders raising a first round') && req.includes('knowledge level novice; what matters: speed; cost; vocabulary: raise money, investors'))
  assert.ok(req.includes('Write 3 prompts of each type') && req.includes('SHORT: 1–2 sentences') && req.includes('LONG: 4–6 sentences'))
  assert.ok(req.includes(DIRECTIONS.recommend.rule) && /Never name any company, product or brand/.test(req) && /% or \+/.test(req))
  assert.ok(req.includes('ADDITIONAL CONTEXT: (none)'))
  const adv = buildPromptsPrompt({ situation: { ...SITUATION, direction: 'advise' }, persona })
  assert.ok(adv.includes(DIRECTIONS.advise.rule) && !adv.includes(DIRECTIONS.recommend.rule))
  assert.ok(buildPromptsPrompt({ situation: { ...SITUATION, direction: 'nonsense' }, persona }).includes(DIRECTIONS.recommend.rule))
  const custom = mergeSettings({ prompts_per_type: 2, ranges: { long: '5–7' }, prompt_prompts: '' })
  const req2 = buildPromptsPrompt({ situation: SITUATION, persona, settings: custom })
  assert.ok(req2.includes('Write 2 prompts of each type') && req2.includes('LONG: 5–7 sentences') && req2.includes('SHORT: 1–2 sentences'))
  const one = buildPromptsPrompt({ situation: SITUATION, persona, only: { form: 'medium', taken: ['cost of a raise', 'finding investors'] } })
  assert.ok(one.includes('Write 1 prompts of each type') && one.includes('only ONE prompt, of type MEDIUM') && one.includes('- finding investors'))
})

test('the prompts reply is read as a list, capped per type and ordered Short, Medium, Long', () => {
  const reply = '```json\n[{"type":"long","angle":"a","text":"l1"},{"type":"SHORT","angle":"b","text":"one\\nline"},{"type":"short","angle":"c","text":"s2"},{"type":"short","angle":"d","text":"s3"},{"type":"short","angle":"e","text":"s4"},{"type":"essay","angle":"f","text":"x"},{"type":"medium","angle":"g","text":""}]\n```'
  const out = parsePrompts(reply, { perType: 3 })
  assert.deepEqual(out.map((p) => [p.form, p.prompt]), [['short', 'one line'], ['short', 's2'], ['short', 's3'], ['long', 'l1']])
  assert.equal(parsePrompts('{"prompts":[{"type":"short","angle":"a","text":"hi"}]}').length, 1)
  assert.throws(() => parsePrompts('[]'), /empty/)
  assert.throws(() => parsePrompts('no json here'), /incomplete/)
  const three = [{ id: '2', form: 'short', sort: 1 }, { id: '1', form: 'short', sort: 0 }, { id: '3', form: 'long', sort: 0 }]
  assert.equal(promptLabel(three[0], three), 'Short 2')
  assert.equal(promptLabel(three[2], three), 'Long')
})

test('promptIssues blocks an over-long prompt and one that names any tracked brand, and warns on % and + and on length', () => {
  assert.equal(promptIssues('x'.repeat(PROMPT_MAX)).block.length, 0)
  assert.match(promptIssues('x'.repeat(PROMPT_MAX + 1)).block[0], /2,001 characters/)
  assert.match(promptIssues('Is Rupert any good for outreach?', ['Rupert', 'RivalCo']).block[0], /names Rupert/)
  assert.match(promptIssues('Is RivalCo any good?', ['Rupert', 'RivalCo']).block[0], /names RivalCo/)
  assert.equal(promptIssues('my friend rupert said so', ['Rupert']).block.length, 0) // a single word matches as a proper noun only
  assert.equal(promptIssues('growing 15% a month').warn.length, 1)
  assert.match(promptIssues('x'.repeat(901)).warn[0], /Over 900 characters/)
  assert.equal(promptIssues('').block.length, 1)
})

test('planRuns orders run 1 of every prompt before run 2, in steps of four at most, and skips captures that already returned', () => {
  assert.deepEqual(planRuns(prompts, 2), [
    [{ promptId: 'p-m', runNo: 1 }, { promptId: 'p-s', runNo: 1 }],
    [{ promptId: 'p-m', runNo: 2 }, { promptId: 'p-s', runNo: 2 }],
  ])
  // r4 failed, so it is planned again; the three ok runs are not.
  assert.deepEqual(planRuns(prompts, 2, runs), [[{ promptId: 'p-s', runNo: 2 }]])
  assert.deepEqual(planRuns(prompts, 1, runs), [])
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}` }))
  const steps = planRuns(nine, 7)
  assert.equal(steps.reduce((a, s) => a + s.length, 0), 63)
  assert.ok(steps.every((s) => s.length <= 4 && new Set(s.map((c) => c.runNo)).size === 1))
  assert.deepEqual(steps.slice(0, 3).map((s) => s.length), [4, 4, 1])
})

test('the person line reads a structured Situation, or the persona of a situation from before v2', () => {
  assert.match(personLine(SITUATION), /^Founder and CEO .*What happened: Three weeks.*They want: Raise a seed round\.$/)
  assert.equal(personLine({ description: 'd', persona: { who: 'A founder.', where_they_stand: '7 customers.', location: 'Austin, Texas' } }), 'A founder. 7 customers. Located in Austin, Texas.')
  assert.equal(STAGE_TIER.exploring, 'Learn')
  assert.equal(STAGE_TIER.comparing, 'Problem')
  assert.equal(STAGE_TIER.ready_to_buy, 'Buy')
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
  const req = buildTopicsPrompt({ situation: { persona: { who: 'w', where_they_stand: 's', location: 'Austin, Texas' } }, prompts, queries, runs, pillars: [{ code: 'A', name: 'Raising' }], groups: [{ code: 'A01', name: 'SAFE basics' }], ownNames: ['Rupert'], companyName: 'Rupert' })
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
    { status: 'ok', brands: { 'b-o': { named: true } }, brand_entities: [{ name: 'openvc', title: 'Investor database' }, { markdown: 'Signal NFX', title: 'Investor network' }, { name: 'Signal NFX' }] },
    { status: 'ok', brands: { 'b-o': { named: true }, [OWN]: { named: true } }, brand_entities: [] },
    { status: 'failed', brands: { 'b-o': { named: true } }, brand_entities: [{ name: 'Ghost' }] },
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

test('brand names are scrubbed from what goes to the AI, and a prompt that names one is dropped', () => {
  const names = ['Rupert', 'Hey Rupert', 'RivalCo']
  assert.equal(scrubNames('Strategic ICP for Hey Rupert. Rupert sells to founders; rupert is a name. RivalCo too.', names), 'Strategic ICP for the company. the company sells to founders; rupert is a name. the company too.')
  const persona = { knowledge_level: 'novice', what_matters: ['speed'], vocabulary: ['investors'] }
  const situation = { who: 'Founder who heard of Rupert', trigger_event: 'RivalCo raised prices', goal: 'Raise a seed round', stage: 'comparing', direction: 'recommend', comments: 'Rupert user' }
  const a = buildPromptsPrompt({ situation, persona, icpShort: 'Rupert sells to founders', names })
  const b = buildPersonaPrompt({ situation, icpMd: '# ICP: Rupert\nRupert sells to founders.\n## Ideal Customer\nFounders', names })
  for (const req of [a, b]) assert.ok(!/Rupert|RivalCo/.test(req), req)
  const out = parsePrompts('[{"type":"short","angle":"a","text":"Is Rupert good?"},{"type":"short","angle":"b","text":"Who helps founders raise?"}]', { names })
  assert.deepEqual(out.map((p) => p.prompt), ['Who helps founders raise?'])
  assert.equal(parsePrompts('Note {x}: [{"type":"short","angle":"a","text":"hi"}]').length, 1)
})
