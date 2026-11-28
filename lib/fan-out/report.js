// Fan-Out Engine: one Scenario and one of its Runs as a Markdown document, steps 1 to 5.
// Everything in it is what the page shows: the app's counts as counted, the AI's lines marked as estimates.

import { DIRECTIONS, FORM_LABELS, STAGES, TYPE_ORDER, isPersona, promptLabel, sortPrompts } from './core.js'
import { CARD_ACTIONS, HOW, REASONS } from './groups.js'
import { MENTION_LABELS, brandKey } from './score.js'
import { compareRuns } from './compare.js'

const list = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v)).trim()
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')
const cell = (v) => str(v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n') : '')
const share = (v) => (v ? `${v.pct}% ±${v.margin} (${v.x} of ${v.n})` : '–')
const signed = (n) => `${n > 0 ? '+' : ''}${n}`
const runName = (run, baselineId) => (run.legacy ? 'Earlier runs' : run.id === baselineId ? 'Baseline' : `Run ${run.seq}`)

/** A file name for the report: "fan-out-F001-baseline-2026-11-27.md". */
export function reportFileName(situation, run, baselineId) {
  const name = runName(run, baselineId).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `fan-out-${str(situation.code) || 'scenario'}-${name}-${day(run.started_at) || 'run'}.md`
}

function groupBlock(g, card, own, prompts = []) {
  const out = [`#### ${g.label}`, '']
  const tags = [g.signal.label, g.verdict === 'Opportunity' ? g.difficulty : '', g.isNew ? 'New' : '', g.recommendation ? 'Who should I use' : '', g.core ? '80/20' : ''].filter(Boolean)
  out.push(`- **Signal:** searched in ${g.signal.x} of ${g.signal.n} runs (${tags.join(', ')})`)
  const opp = g.verdict === 'Opportunity'
  if (opp) out.push(`- **Where you are missing:** searched in ${g.missed.x} of the ${g.missed.n} runs where you were not named${g.standing.named ? `, and in ${g.standing.named} where you were` : ''}. The lines below are counted in those ${g.missed.x} runs.`)
  else out.push(`- **Your standing:** named in ${g.standing.named} of ${g.standing.of} of those runs`)
  if (opp) out.push(`- **Opportunity score:** ${g.score}`)
  const rivals = list(g.whoNamed).filter((w) => !w.own)
  out.push(`- **${opp ? 'Named instead of you' : 'Who wins'}:** ${rivals.length ? rivals.slice(0, 6).map((w) => `${w.name} (${w.runs})`).join(', ') : 'no other brand is named'}`)
  if (list(g.citedDomains).length) out.push(`- **Sites cited most:** ${g.citedDomains.slice(0, 6).map((p) => `${p.domain} (${p.runs})`).join(', ')}`)
  const nameOf = (id) => {
    const p = list(prompts).find((x) => x.id === id)
    return p ? promptLabel(p, prompts) : ''
  }
  const byPrompt = list(g.byPrompt).map((t) => ({ name: nameOf(t.promptId), runs: t.runs })).filter((t) => t.name)
  out.push(`- **Triggered by:** ${byPrompt.length ? byPrompt.map((t) => `${t.name} (${t.runs})`).join(', ') : list(g.triggeredBy).map((t) => `${FORM_LABELS[t.form]} prompts (${t.runs})`).join(', ')}`)
  if (card) {
    const mine = card.kind === 'win'
    const how = mine ? HOW[card.how].replace('Their own page is', 'Your own page is').replace('name them', 'name you').replace('knew them', 'knew you') : HOW[card.how]
    out.push(`- **How ${mine ? 'you' : 'they'} got there:** ${how}${list(card.how_pages).length ? `: ${card.how_pages.slice(0, 3).map((p) => p.url || p.domain).join(', ')}` : ''}`)
    const unread = list(card.pages).filter((p) => !p.ok)
    if (unread.length) out.push(`- **Pages that could not be read:** ${unread.map((p) => `${p.domain} (${p.error})`).join('; ')}`)
    out.push(`- **Why (AI estimate):** ${[list(card.reasons).map((r) => REASONS[r]?.label || r).join(', '), str(card.why)].filter(Boolean).join('. ') || 'no reason could be given'}`)
    if (!mine) {
      const page = card.your_page || {}
      out.push(`- **Your page:** ${!page.kind || page.kind === 'none' ? 'none found' : page.kind === 'cited' ? `${page.url} (${page.note})` : `${page.code} ${page.title} (${page.note})`}`)
      if (list(card.cover).length) out.push('- **What to cover (AI estimate):**', ...card.cover.map((l) => `  - ${l}`))
      const status = { open: '', pushed: ' · sent to AEO Generation', acted_on: ` · acted on${card.acted_url ? `: ${card.acted_url}` : ''}`, done: ' · done' }[card.status] || ''
      out.push(`- **Action:** ${CARD_ACTIONS[card.action] || '–'}${status}${card.action_line ? `. ${card.action_line}` : ''}`)
    } else if (card.repeat_this) out.push(`- **Repeat this (AI estimate):** ${card.repeat_this}`)
  } else if (g.verdict !== 'Skip') out.push('- *Not analyzed: outside the top groups of this Run.*')
  out.push('', `Searches (${g.searches.length}):`, ...g.searches.slice(0, 25).map((q) => `- \`${str(q.q).replace(/`/g, "'")}\` · ${q.runs}×`))
  if (g.searches.length > 25) out.push(`- and ${g.searches.length - 25} more`)
  void own
  return out.join('\n')
}

/**
 * The report of one Run. `run` is a scored Run as the score action returns it (score, groups, takeaway);
 * `allRuns` are every scored Run of the Scenario, for the Baseline comparison.
 * @returns {string} Markdown
 */
export function buildReport({ company = '', situation, prompts = [], run, allRuns = [], scenarioRuns = [], cards = [], ignored = [], limits = {}, signal = {}, cutoff = 0.5, minMissed = 5, generatedAt = new Date().toISOString() }) {
  const s = run.score
  const own = s.own
  const g = run.groups || { all: [], opportunities: [], wins: [], skips: [], totalSearches: 0 }
  const baselineId = situation.baseline_run_id
  const record = list(scenarioRuns).find((r) => r.id === run.id) || {}
  const name = runName(run, baselineId)
  const dir = DIRECTIONS[situation.direction] || DIRECTIONS.recommend
  const cardOf = (id) => list(cards).find((c) => c.group_id === id && c.scenario_run_id === run.id) || null
  const pc = (v) => `${Math.round(v * 100)}%`
  const out = []
  const add = (...lines) => out.push(...lines)

  add(`# Fan-Out report: ${str(situation.title) || situation.code}`, '')
  add(`${company ? `**${company}** · ` : ''}Scenario ${situation.code} · ${name} of ${day(run.started_at)} · ${s.runs} runs on ChatGPT${s.model ? ` (${s.model})` : ''} · report made ${day(generatedAt)}`, '')
  if (run.takeaway) add(`> ${run.takeaway}`, '')
  if (run.status === 'running') add('> This Run is not finished. The numbers cover the runs that have returned so far.', '')

  add('## 1. Situation', '')
  add(table(['Field', 'Content'], [['Who', situation.who], ['Trigger', situation.trigger_event], ['Goal', situation.goal], ['Stage', STAGES[situation.stage] || '–'], ['Direction', `${dir.label}: ${dir.hint}`], ['Additional comments', situation.comments || '–']]), '')

  add('## 2. Persona', '')
  const p = situation.persona || {}
  if (isPersona(p)) {
    add(`- **Knowledge level:** ${p.knowledge_level}`, `- **What matters:** ${list(p.what_matters).join('; ') || '–'}`, `- **Vocabulary:** ${list(p.vocabulary).join(', ') || '–'}`)
    add(`- ${situation.persona_confirmed_at ? `Approved ${day(situation.persona_confirmed_at)}` : 'Not approved'}. Brand-blind: the persona does not know the company exists.`, '')
  } else add('No persona in the three-field format.', '')

  add('## 3. Prompts', '')
  const ordered = sortPrompts(prompts)
  add(`${ordered.length} prompts${situation.prompts_confirmed_at ? `, frozen ${day(situation.prompts_confirmed_at)}` : ', not confirmed'}. Unbranded: no company is named in any of them.`, '')
  for (const form of TYPE_ORDER) {
    const mine = ordered.filter((x) => x.form === form)
    if (!mine.length) continue
    add(`### ${FORM_LABELS[form]}`, '')
    for (const x of mine) add(`**${promptLabel(x, ordered)}**${x.origin === 'user' ? ' (your own)' : x.angle ? ` · ${x.angle}` : ''}`, '', `> ${str(x.prompt).replace(/\s*\n\s*/g, ' ')}`, '')
  }

  add('## 4. Run', '')
  const planned = list(record.prompt_ids).length * (record.runs_per_prompt || 0)
  add(table(['', ''], [
    ['Run', `${name}${record.seq ? ` (Run ${record.seq} of this Scenario)` : ''}`],
    ['Date', day(run.started_at)],
    ['Captures', `${s.runs} returned${planned ? ` of ${planned}` : ''}${s.failed ? `, ${s.failed} failed (not counted, not charged)` : ''}`],
    ['Runs per prompt', record.runs_per_prompt || '–'],
    ['ChatGPT model', s.model || '–'],
    ['Searched the web', `${s.searched.x} of ${s.searched.n} runs (search is not forced)`],
    ['Cost of the captures', record.cost != null ? `$${Number(record.cost).toFixed(2)}${Number(record.est_cost) ? ` (estimated $${Number(record.est_cost).toFixed(2)})` : ''}` : '–'],
  ]), '')

  add('## 5. Summary', '')
  add('### Where you stand', '')
  if (!own) add('No own brand is on the tracked list, so there is no score for the company.', '')
  else {
    add(table(['Score', 'Result', 'What it counts'], [
      ['Mentioned', share(own.mentioned), 'runs where the brand is named in the answer'],
      ['First named', share(own.first), 'runs where it is named before every other brand, tracked or not'],
      ['Recommended', share(own.recommended), 'runs where the answer explicitly favours it (AI label, with a quote)'],
    ]), '')
    add(`${own.mentioned.x === 0 ? `${own.name} is not named in this Run.` : `${own.name} is number ${own.rank} of ${s.brands.length} tracked brands.`}${s.leader && !s.leader.own && s.gap > 0 ? ` ${s.leader.name} leads at ${s.leader.pct}%, ${s.gap} points ahead.` : s.leader?.own ? ' No tracked brand is named more often.' : ''}`, '')
    if (situation.direction !== 'recommend') add(`Direction is ${dir.label}: ChatGPT names companies almost only when asked who or what to use, so a low Mentioned score is expected here.`, '')
    add(`By prompt type (directional only): ${TYPE_ORDER.filter((f) => own.byType[f]).map((f) => `${FORM_LABELS[f]} ${share(own.byType[f])}`).join(' · ')}`, '')
  }
  add('### Tracked brands', '')
  add(table(['Rank', 'Brand', 'Mentioned', 'First named', 'Recommended', ...TYPE_ORDER.map((f) => FORM_LABELS[f])], s.brands.map((b) => [b.mentioned.x ? b.rank : '–', `${b.name}${b.own ? ' (you)' : ''}`, `${b.mentioned.pct}% (${b.mentioned.x} of ${b.mentioned.n})`, `${b.first.pct}%`, `${b.recommended.pct}%`, ...TYPE_ORDER.map((f) => (b.byType[f] ? `${b.byType[f].pct}%` : '–'))])), '')
  if (own && own.mentioned.x > 0) {
    add(`### How ${own.name} is named`, '')
    add(`Recommended ${own.labels.recommended} · Listed ${own.labels.listed} · Qualified ${own.labels.qualified}${own.labels.unlabeled ? ` · not labeled ${own.labels.unlabeled}` : ''}. One label per run where it is named; each counts only with a phrase that is in the answer and about ${own.name}.`, '')
    for (const q of list(own.quotes)) add(`- **${MENTION_LABELS[q.label]}:** "${str(q.quote).replace(/\\/g, '').replace(/\*\*/g, '')}"`)
    if (list(own.quotes).length) add('')
  }

  add('### Discovered competition', '')
  const hidden = new Set(list(ignored).map((i) => brandKey(i.name)))
  const found = list(s.discovered).filter((d) => !hidden.has(brandKey(d.name)))
  if (!found.length) add('ChatGPT named no brand outside the tracked list (or all were ignored).', '')
  else add('Brands ChatGPT named that are not on the tracked list.', '', table(['Brand', 'Named in', 'Signal', 'Website'], found.map((d) => [d.name, `${d.runs} of ${s.runs} runs`, d.signal, d.site || '–'])), '')
  const shelved = list(s.discovered).filter((d) => hidden.has(brandKey(d.name)))
  if (shelved.length) add(`Ignored: ${shelved.map((d) => `${d.name} (${d.runs})`).join(', ')}.`, '')

  add('### Fan-Out search queries', '')
  if (!s.searched.x) add('ChatGPT ran no web search in this Run. It answered from memory.', '')
  else if (!g.all.length) add('The searches of this Run are not grouped yet.', '')
  else {
    const count = (xs) => `${xs.length} ${xs.length === 1 ? 'group' : 'groups'}, ${xs.reduce((a, x) => a + x.searchCount, 0)} searches`
    add(`${g.totalSearches} web searches ChatGPT ran while answering, in ${g.all.length} groups by intent.${own ? ` You were not named in ${g.all[0].missed.n} of ${s.runs} runs: the Opportunities are what ChatGPT searched in those runs.` : ''}`, '')
    add(table(['', 'Groups and searches', 'Meaning'], [
      ['Opportunities', count(g.opportunities), `searched in ${minMissed} or more of the runs where you were not named`],
      ['Wins', count(g.wins), `searched in ${pc(signal.occasional ?? 0.2)} or more of the runs, and in fewer than ${minMissed} where you were not named`],
      ['Skipped', count(g.skips), `noise: searched in fewer than ${pc(signal.occasional ?? 0.2)} of the runs, and in fewer than ${minMissed} where you were not named`],
    ]), '')
    for (const [title, xs] of [['Opportunities', g.opportunities], ['Wins', g.wins]]) {
      if (!xs.length) continue
      add(`### ${title}`, '')
      for (const x of xs) add(groupBlock(x, cardOf(x.id), own, ordered), '')
    }
    if (g.skips.length) add('### Skipped', '', ...g.skips.map((x) => `- **${x.label}:** ${x.signal.x} of ${x.signal.n} runs, named in ${x.standing.named} of ${x.standing.of}. ${x.searches.slice(0, 3).map((q) => `\`${str(q.q).replace(/`/g, "'")}\``).join(', ')}`), '')
    void limits
  }

  const scored = list(allRuns).filter((r) => !r.legacy && r.status !== 'running' && r.score.runs > 0)
  const baseline = scored.find((r) => r.id === baselineId)
  if (baseline && baseline.id !== run.id && !run.legacy) {
    const c = compareRuns(baseline, run, { cards, cutoff })
    add(`### Did it move? ${name} versus the Baseline of ${day(baseline.started_at)}`, '')
    if (c.modelChanged) add(`ChatGPT itself changed between these Runs (${c.models.before} then, ${c.models.now} now). A score can move for that reason alone.`, '')
    if (c.together) add('Most competitors moved the same way as you. When everyone moves together, the cause is probably ChatGPT.', '')
    add(table(['Score', 'Baseline', 'Now', 'Change', 'Verdict'], c.scores.map((x) => [x.label, `${x.before.pct}% ±${x.before.margin}`, `${x.now.pct}% ±${x.now.margin}`, `${signed(x.change)} points`, x.real ? 'Real move' : 'Within noise'])), '')
    if (c.rank) add(`Rank among tracked brands: ${c.rank.before ? `number ${c.rank.before}` : 'not named'} then, ${c.rank.now ? `number ${c.rank.now}` : 'not named'} now, of ${c.rank.of}.`, '')
    if (c.acted.length) add('Did what we wrote work?', '', ...c.acted.map((a) => `- **${a.moved ? 'Moved' : 'Not moved'}:** ${a.label}: named in ${a.before.named} of ${a.before.of} then, ${a.searched ? `${a.now.named} of ${a.now.of} now` : 'not searched in this Run'}${a.url ? `; your page is ${a.cited ? 'now cited' : 'not cited'}` : ''}`), '')
    const around = [
      c.around.newGroups.length ? `New searches: ${c.around.newGroups.map((x) => x.label).join('; ')}` : '',
      c.around.slipped.length ? `Wins where you slipped: ${c.around.slipped.map((x) => `${x.label} (${x.before.named} of ${x.before.of} then, ${x.now.named} of ${x.now.of} now)`).join('; ')}` : '',
      c.around.rose.length ? `Competitors that rose: ${c.around.rose.map((x) => `${x.name} ${signed(x.change)} to ${x.now}%`).join(', ')}` : '',
      c.around.fell.length ? `Competitors that fell: ${c.around.fell.map((x) => `${x.name} ${signed(x.change)} to ${x.now}%`).join(', ')}` : '',
    ].filter(Boolean)
    if (around.length) add('What changed around us:', '', ...around.map((x) => `- ${x}`), '')
  }

  add('---', '')
  add('**How to read this.** The counts are the app\'s, taken from the stored answers with fixed rules. ± is the margin at this number of runs: a later change counts as a real move only if it is larger. Lines marked "AI estimate" are the AI\'s reading of the pages ChatGPT cited; we can see what ChatGPT searched and cited, not why it chose those pages. A run contains several searches, so "your standing" on a search shows a link, not a proven cause.')
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}
