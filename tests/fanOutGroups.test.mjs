import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS } from '../lib/fan-out/core.js'
import { scoreRuns } from '../lib/fan-out/score.js'
import { briefFromCard, buildCardPrompt, buildGroupsPrompt, buyerPrompts, closestPage, groupStats, howTheyGotThere, parseCard, parseGroups, plainTakeaway, runQueries, summarizeGroups, takeawayFacts, takeawayOk, ungrouped } from '../lib/fan-out/groups.js'
import { htmlToText, readableUrl } from '../lib/fan-out/pages.js'

const OWN = { id: 'own', name: 'Rupert', name_patterns: ['Rupert'], domains: ['heyrupert.com'], is_own: true }
const RIVAL = { id: 'riv', name: 'RivalCo', name_patterns: [], domains: ['rivalco.com'], is_own: false }
const brands = [OWN, RIVAL]
let n = 0
const run = (form, fanOut, answer, cited = [], promptId = 'p1') => ({ id: `r${(n += 1)}`, status: 'ok', prompt_id: promptId, prompt_form: form, fan_out: fanOut, answer, cited, brand_entities: [], mention_labels: {} })
const A = 'investor outreach agency for startups'
const B = 'seed fundraising consultant pricing 2026'
const C = 'what is a SAFE note'
const runs = [
  run('short', [A, B], 'RivalCo is good. Foundersuite too.', [{ url: 'https://rivalco.com/outreach', domain: 'rivalco.com', title: 'Outreach' }, { url: 'https://lists.com/best', domain: 'lists.com', title: 'Best agencies' }]),
  run('short', [A], 'RivalCo again.', [{ url: 'https://rivalco.com/outreach', domain: 'rivalco.com', title: 'Outreach' }]),
  run('medium', ['Investor Outreach agency for startups 2026'], 'RivalCo and Rupert.', [{ url: 'https://lists.com/best', domain: 'lists.com', title: 'Best agencies' }], 'p2'),
  run('medium', [B], 'Rupert is the pick.', [{ url: 'https://heyrupert.com/pricing', domain: 'heyrupert.com', title: 'Pricing' }], 'p2'),
  run('long', [], 'No search here.', [], 'p3'),
  run('long', [B], 'Rupert.', [], 'p3'),
  run('long', [], 'Nothing.', [], 'p3'),
  run('long', [], 'Nothing.', [], 'p3'),
  run('long', [], 'Nothing.', [], 'p3'),
  run('long', [C], 'A SAFE is a note.', [], 'p3'),
  { id: 'failed', status: 'failed', fan_out: [A] },
]
const groups = [
  { id: 'gA', label: 'Agencies that run investor outreach', norms: runQueries(runs).filter((q) => /outreach/.test(q.norm)).map((q) => q.norm) },
  { id: 'gB', label: 'What a fundraising consultant costs', norms: runQueries(runs).filter((q) => /pricing/.test(q.norm)).map((q) => q.norm) },
  { id: 'gC', label: 'What a SAFE is', norms: runQueries(runs).filter((q) => /safe/.test(q.norm)).map((q) => q.norm), is_new: true },
]

test('the searches of a Run are merged across wordings and counted by run; only ungrouped ones are sent for grouping', () => {
  const q = runQueries(runs)
  assert.equal(q.length, 3) // the 2026 variant of A is the same search
  assert.deepEqual([q[0].runs, q[0].forms.sort()], [3, ['medium', 'short']])
  assert.deepEqual(ungrouped(q, [groups[0]]).map((x) => x.norm).sort(), [groups[1].norms[0], groups[2].norms[0]].sort())
  const req = buildGroupsPrompt({ situation: { description: 'A founder' }, queries: q, groups: [groups[0]], template: DEFAULT_SETTINGS.prompt_groups })
  assert.ok(req.includes('g1 · Agencies that run investor outreach') && req.includes(`q1 · 3 · ${q[0].q}`) && !/\{[a-z]+\}/.test(req))
  assert.ok(buildGroupsPrompt({ situation: {}, queries: q, template: DEFAULT_SETTINGS.prompt_groups }).includes('Group every search'))
})

test('the grouping reply puts every search in exactly one group, keeps what the AI left out, and strips brand names from labels', () => {
  const q = runQueries(runs)
  const reply = JSON.stringify({ existing: [{ group: 'g1', queries: ['q1', 'q9'] }, { group: 'g7', queries: ['q2'] }], new: [{ label: 'Why RivalCo costs more', queries: ['q2', 'q1'] }] })
  const out = parseGroups(reply, q, [groups[0]], ['RivalCo'])
  assert.deepEqual(out.into, [{ groupId: 'gA', norms: [q[0].norm] }])
  assert.deepEqual(out.created, [{ label: 'Untitled group', norms: [q[1].norm] }, { label: 'Other searches', norms: [q[2].norm] }])
})

test('a Query Group is measured from the runs that searched it: signal, standing as a count, who wins, score and difficulty', () => {
  const a = groupStats(groups[0], runs, brands)
  assert.deepEqual([a.runs, a.signal.x, a.signal.n, a.signal.label], [3, 3, 10, 'Occasional'])
  assert.deepEqual(a.standing, { named: 1, of: 3 })
  assert.deepEqual(a.leader, { name: 'RivalCo', brandId: 'riv', runs: 3 })
  assert.equal(a.difficulty, 'Dominated')
  assert.equal(a.score, 20) // signal 30% x gap 2/3
  assert.equal(a.verdict, 'Opportunity')
  assert.deepEqual(a.cited.map((p) => [p.domain, p.runs]), [['lists.com', 2], ['rivalco.com', 2]])
  assert.deepEqual(a.triggeredBy, [{ form: 'short', runs: 2 }, { form: 'medium', runs: 1 }])
  assert.deepEqual(a.promptIds.sort(), ['p1', 'p2'])
  assert.equal(a.searches[0].runs, 3)
  const b = groupStats(groups[1], runs, brands)
  assert.deepEqual([b.standing, b.verdict, b.difficulty], [{ named: 2, of: 3 }, 'Win', 'Open'])
  assert.equal(b.ownCited[0].url, 'https://heyrupert.com/pricing')
  const c = groupStats(groups[2], runs, brands)
  assert.deepEqual([c.signal.label, c.verdict, c.isNew], ['Noise', 'Skip', true])
  // The cut-offs come from the admin settings.
  assert.equal(groupStats(groups[0], runs, brands, { cutoffs: { opportunity: 0.3, open: 0.5, dominated: 0.75 } }).verdict, 'Win')
})

test('the summary lists Opportunities (Open first, then by score), Wins and Skips, and marks the 80/20 groups', () => {
  const s = summarizeGroups(groups, runs, brands)
  assert.deepEqual([s.opportunities.map((g) => g.id), s.wins.map((g) => g.id), s.skips.map((g) => g.id)], [['gA'], ['gB'], ['gC']])
  assert.equal(s.totalSearches, 7)
  assert.deepEqual(s.all.filter((g) => g.core).map((g) => g.id).sort(), ['gA', 'gB'])
  const open = { id: 'o', label: 'o', norms: ['x'] }
  const dom = { id: 'd', label: 'd', norms: ['y'] }
  const rs = [run('short', ['x', 'y'], 'RivalCo.'), run('short', ['x', 'y'], 'RivalCo.'), run('short', ['x'], 'none'), run('short', ['x'], 'none')]
  assert.deepEqual(summarizeGroups([dom, open], rs, brands).opportunities.map((g) => [g.id, g.difficulty]), [['o', 'Open'], ['d', 'Dominated']])
})

test('the closest page is an own page ChatGPT cited, or the Content Map topic that shares the most words, or none', () => {
  const a = groupStats(groups[0], runs, brands)
  const topics = [{ id: 't1', code: 'A01', name: 'Investor outreach agencies compared', status: 'new' }, { id: 't2', code: 'A02', name: 'SAFE notes explained', status: 'live', live_slug: 'safe' }]
  assert.deepEqual([closestPage(a, topics).kind, closestPage(a, topics).code], ['topic', 'A01'])
  assert.equal(closestPage(a, [topics[1]]).kind, 'none')
  assert.equal(closestPage(groupStats(groups[1], runs, brands), topics).kind, 'cited')
  assert.equal(closestPage(groupStats(groups[2], runs, brands), topics).kind, 'live')
})

test('how the winner got there comes from what was cited: their own page, third-party pages that name them, or neither', () => {
  const a = groupStats(groups[0], runs, brands)
  assert.equal(howTheyGotThere(a.leader, a, brands).how, 'own_page')
  const noOwn = { ...a, cited: a.cited.filter((p) => p.domain !== 'rivalco.com') }
  assert.equal(howTheyGotThere(a.leader, noOwn, brands, [{ ok: true, url: 'https://lists.com/best', domain: 'lists.com', title: 'Best', runs: 2, text: 'Top pick: RivalCo' }]).how, 'third_party')
  assert.equal(howTheyGotThere(a.leader, noOwn, brands, [{ ok: true, url: 'https://lists.com/best', domain: 'lists.com', text: 'Nobody named' }]).how, 'neither')
  assert.equal(howTheyGotThere({ name: 'Foundersuite', brandId: '', runs: 2 }, { cited: [{ domain: 'foundersuite.com', url: 'u' }] }, brands).how, 'own_page')
  assert.equal(howTheyGotThere(null, a, brands).how, 'neither')
})

test('a card stays inside its formats: reasons from the fixed list, 3 to 6 lines to cover, one of three actions', () => {
  const a = groupStats(groups[0], runs, brands)
  const none = { kind: 'none' }
  const req = buildCardPrompt({ kind: 'opportunity', situation: { description: 'A founder' }, stats: a, winner: a.leader, how: { how: 'own_page' }, yourPage: none, pagesRead: [{ ok: true, domain: 'rivalco.com', runs: 2, title: 'Outreach', text: 'We run outreach.' }, { ok: false, domain: 'x.com' }], pillars: [{ code: 'A', name: 'Raising' }], template: DEFAULT_SETTINGS.prompt_card })
  assert.ok(req.includes('OPPORTUNITY') && req.includes('RivalCo, named in 3 of 3 runs') && req.includes('We run outreach.') && req.includes('could not be read') && req.includes('- no_page: No page') && !/\{[a-z_]+\}/.test(req))
  const reply = JSON.stringify({ reasons: ['format', 'made_up', 'no_page', 'fresh'], why: 'Their page lists options in a table.', what_to_cover: ['What an agency does', 'What it costs', 'Why Rupert is best', 'How long it takes'], action: 'new_article', action_line: 'Write a comparison.', comparison: true, theme: 'a' })
  const card = parseCard(reply, { kind: 'opportunity', yourPage: none, pillars: [{ id: 'pA', code: 'A', name: 'Raising' }], brandNames: ['Rupert'] })
  assert.deepEqual(card.reasons, ['format', 'no_page'])
  assert.deepEqual(card.cover, ['What an agency does', 'What it costs', 'How long it takes'])
  assert.deepEqual([card.action, card.comparison, card.pillarId], ['new_article', true, 'pA'])
  // A live page is fixed by hand, never rewritten by AEO Generation; and "no page" is false when a page exists.
  const live = parseCard(reply, { kind: 'opportunity', yourPage: { kind: 'live' }, pillars: [] })
  assert.deepEqual([live.action, live.reasons], ['fix_existing', ['format']])
  const win = parseCard(JSON.stringify({ reasons: ['no_page', 'direct_match'], why: 'w', what_to_cover: ['x'], action: 'new_article', repeat_this: 'Do it again.' }), { kind: 'win', yourPage: { kind: 'cited' } })
  assert.deepEqual([win.reasons, win.cover, win.action, win.repeatThis], [['direct_match'], [], '', 'Do it again.'])
  assert.ok(buildCardPrompt({ kind: 'win', situation: {}, stats: a, winner: null, how: { how: 'neither' }, yourPage: none, pagesRead: [], template: DEFAULT_SETTINGS.prompt_card }).includes('- no_page') === false)
})

test('the takeaway may only use numbers the app calculated', () => {
  const s = scoreRuns(runs, brands)
  const g = summarizeGroups(groups, runs, brands)
  const facts = takeawayFacts(s, g)
  assert.ok(facts[0].startsWith('Mentioned: 30% (3 of 10 runs)'))
  assert.equal(takeawayOk('Rupert is named in 30% of answers, 3 of 10 runs. RivalCo is ahead. Start with outreach agencies.', facts), true)
  assert.equal(takeawayOk('Rupert is named in 45% of answers.', facts), false)
  assert.equal(takeawayOk('One. Two. Three. Four. Five.', facts), false)
  assert.match(plainTakeaway(s, g), /named in 30% of the answers \(3 of 10 runs\).*first opportunity is "Agencies that run investor outreach"/)
})

test('a brief takes its title from the group, its keyword from the top search, its outline from What to cover; merged cards add theirs', () => {
  const a = groupStats(groups[0], runs, brands)
  const card = { cover: ['What an agency does', 'What it costs.'], reasons: ['format'], why: 'They use a table.', comparison: true }
  const brief = briefFromCard(card, a, [{ cover: ['What it costs.', 'How long it takes'] }])
  assert.equal(brief.title, 'Agencies that run investor outreach')
  assert.equal(brief.primary_keyword, a.searches[0].q)
  assert.deepEqual(brief.outline.map((o) => o.heading), ['What an agency does', 'What it costs', 'How long it takes'])
  assert.equal(brief.article_type, 'comparison')
  assert.match(brief.angle, /Named most today: RivalCo \(3 of 3 runs\)\. Why \(estimate\): Format\. They use a table\./)
  const prompts = [{ id: 'p1', form: 'short', prompt: 's' }, { id: 'p2', form: 'medium', prompt: 'm' }, { id: 'p3', form: 'long', prompt: 'l' }]
  assert.deepEqual(buyerPrompts(prompts, a, 'ready_to_buy').map((p) => [p.id, p.intent_tier]), [['p1', 'Buy'], ['p2', 'Buy']])
})

test('pages are read only from public web addresses, and HTML becomes plain text with table rows kept', () => {
  assert.equal(readableUrl('https://example.com/a?utm_source=x&b=1#top'), 'https://example.com/a?b=1')
  for (const bad of ['http://localhost/x', 'http://127.0.0.1/', 'http://10.0.0.5/a', 'http://192.168.1.1', 'file:///etc/passwd', 'http://intranet/', 'http://169.254.169.254/latest', 'nonsense']) assert.equal(readableUrl(bad), '', bad)
  const text = htmlToText('<html><head><style>p{}</style><script>alert(1)</script></head><body><nav>Menu</nav><h2>Pricing</h2><p>From &amp; to $5&nbsp;k</p><table><tr><td>Plan</td><td>Price</td></tr></table></body></html>')
  assert.ok(text.includes('## Pricing') && text.includes('From & to $5 k') && text.includes('Plan | Price') && !/alert|Menu|p\{\}/.test(text))
})
