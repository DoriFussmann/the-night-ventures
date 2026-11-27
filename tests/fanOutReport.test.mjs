import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreRuns } from '../lib/fan-out/score.js'
import { runQueries, summarizeGroups } from '../lib/fan-out/groups.js'
import { buildReport, reportFileName } from '../lib/fan-out/report.js'

const OWN = { id: 'own', name: 'Rupert', name_patterns: ['Rupert'], domains: ['heyrupert.com'], is_own: true }
const RIVAL = { id: 'riv', name: 'RivalCo', name_patterns: [], domains: ['rivalco.com'], is_own: false }
const brands = [OWN, RIVAL]
let n = 0
const cap = (form, fanOut, answer, entities = []) => ({ id: `r${(n += 1)}`, status: 'ok', prompt_id: 'p1', prompt_form: form, fan_out: fanOut, answer, cited: [{ url: 'https://rivalco.com/x', domain: 'rivalco.com' }], brand_entities: entities.map((name) => ({ name })), mention_labels: { own: { label: 'recommended', quote: 'Rupert is the **pick**' } }, searched: fanOut.length > 0, model: 'gpt-6' })
const make = (answers) => {
  const caps = answers.map(([a, e]) => cap('short', ['investor outreach agency | pricing'], a, e))
  const groups = [{ id: 'g1', label: 'Agencies that run investor outreach', norms: runQueries(caps).map((q) => q.norm), recommendation: true }]
  return { caps, score: scoreRuns(caps, brands), groups: summarizeGroups(groups, caps, brands) }
}
const situation = { code: 'F001', title: '1 | Founder Ready to Raise | Stage: Exploring | Direction: Recommend', who: 'A founder', trigger_event: 'No replies', goal: 'Raise a round', stage: 'exploring', direction: 'recommend', comments: '', baseline_run_id: 'run1', persona: { knowledge_level: 'novice', what_matters: ['speed'], vocabulary: ['investors'] }, persona_confirmed_at: '2026-11-27T10:00:00Z', prompts_confirmed_at: '2026-11-27T10:05:00Z' }
const prompts = [{ id: 'p1', form: 'short', sort: 0, angle: 'who does this', prompt: 'Who can run investor outreach for me?' }, { id: 'p2', form: 'long', sort: 0, origin: 'user', prompt: 'A long one | with a pipe.' }]

test('the report covers steps 1 to 5 with the numbers the page shows', () => {
  const a = make([['RivalCo is good. Foundersuite too.', ['Foundersuite']], ['RivalCo again.', ['Foundersuite', 'Ignored Inc']], ['RivalCo, then Rupert is the pick.', []], ['Nobody.', []]])
  const run = { id: 'run1', seq: 1, status: 'done', legacy: false, started_at: '2026-11-27T20:00:00Z', takeaway: 'Rupert is named in 25% of the answers.', score: a.score, groups: a.groups }
  const cards = [{ id: 'c1', scenario_run_id: 'run1', group_id: 'g1', kind: 'opportunity', status: 'open', how: 'own_page', how_pages: [{ url: 'https://rivalco.com/x' }], pages: [{ ok: false, domain: 'x.com', error: 'the site answered 403' }], reasons: ['format'], why: 'They use a table.', your_page: { kind: 'none' }, cover: ['What an agency does', 'What it costs'], action: 'commercial_page', action_line: 'Say it on the pricing page.', stats: {} }]
  const md = buildReport({ company: 'Rupert', situation, prompts, run, allRuns: [run], scenarioRuns: [{ id: 'run1', seq: 1, runs_per_prompt: 7, prompt_ids: ['p1', 'p2'], cost: 0.252, est_cost: 0.252 }], cards, ignored: [{ name: 'ignored inc' }], signal: { occasional: 0.2 }, cutoff: 0.5, generatedAt: '2026-11-27T21:00:00Z' })
  for (const h of ['# Fan-Out report: 1 | Founder Ready to Raise', '## 1. Situation', '## 2. Persona', '## 3. Prompts', '## 4. Run', '## 5. Summary', '### Where you stand', '### Tracked brands', '### How Rupert is named', '### Discovered competition', '### Fan-Out search queries', '### Opportunities']) assert.ok(md.includes(h), h)
  assert.ok(md.includes('**Rupert** · Scenario F001 · Baseline of 2026-11-27 · 4 runs on ChatGPT (gpt-6)'))
  assert.ok(md.includes('> Rupert is named in 25% of the answers.'))
  assert.ok(md.includes('| Mentioned | 25% ±') && md.includes('(1 of 4)'))
  assert.ok(md.includes('| 1 | RivalCo | 75% (3 of 4) |') && md.includes('| 2 | Rupert (you) | 25% (1 of 4) |'))
  assert.ok(md.includes('- **Recommended:** "Rupert is the pick"')) // markdown marks out of the quote
  assert.ok(md.includes('| Foundersuite | 2 of 4 runs | Strong |') && md.includes('Ignored: Ignored Inc (1).') && !md.includes('| Ignored Inc |'))
  assert.ok(md.includes('#### Agencies that run investor outreach') && md.includes('named in 1 of 4 of those runs') && md.includes('Who should I use'))
  assert.ok(md.includes('- **Why (AI estimate):** Format. They use a table.') && md.includes('- **Action:** Commercial page or FAQ. Say it on the pricing page.') && md.includes('  - What it costs'))
  assert.ok(md.includes('x.com (the site answered 403)') && md.includes('`investor outreach agency | pricing` · 4×'))
  assert.ok(md.includes('> A long one | with a pipe.') && md.includes('**Long** (your own)'))
  assert.ok(md.includes('| Captures | 4 returned of 14 |') && md.includes('$0.25 (estimated $0.25)'))
  assert.ok(!md.includes('Did it move?') && !/undefined|NaN|\[object/.test(md))
  assert.equal(reportFileName(situation, run, 'run1'), 'fan-out-F001-baseline-2026-11-27.md')
})

test('a later Run adds the comparison with the Baseline', () => {
  const before = make([['Nobody.', []], ['RivalCo.', []], ['RivalCo.', []], ['RivalCo.', []]])
  const after = make([['Rupert is the pick.', []], ['Rupert is the pick.', []], ['Rupert is the pick. RivalCo.', []], ['Rupert is the pick.', []]])
  const r1 = { id: 'run1', seq: 1, status: 'done', legacy: false, started_at: '2026-11-27T20:00:00Z', score: before.score, groups: before.groups }
  const r2 = { id: 'run2', seq: 2, status: 'done', legacy: false, started_at: '2026-12-27T20:00:00Z', score: after.score, groups: after.groups }
  const md = buildReport({ situation, prompts, run: r2, allRuns: [r1, r2], scenarioRuns: [] })
  assert.ok(md.includes('### Did it move? Run 2 versus the Baseline of 2026-11-27'))
  assert.ok(/\| Mentioned \| 0% ±\d+ \| 100% ±\d+ \| \+100 points \| Real move \|/.test(md))
  assert.ok(md.includes('### Wins') && !/undefined|NaN/.test(md))
  assert.equal(reportFileName(situation, r2, 'run1'), 'fan-out-F001-run-2-2026-12-27.md')
})
