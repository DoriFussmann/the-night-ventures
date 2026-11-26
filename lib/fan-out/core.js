// Fan-Out Engine: the parts with no server or database in them.
// A situation -> a persona -> prompts -> runs on real ChatGPT -> topics -> briefs.
// "Fan-out" is the set of web searches ChatGPT runs while it answers one prompt.

import { nameMatchers, normalizeQuery, outcomeFor } from '../prompt-tests/derive.js'

/** The real-ChatGPT engine takes one prompt of at most 2,000 characters. */
export const PROMPT_MAX = 2000
export const FORMS = ['medium', 'short', 'long']
export const FORM_LABELS = { medium: 'Medium', short: 'Short', long: 'Long' }
export const STEPS = ['describe', 'persona', 'prompts', 'run', 'topics', 'push']
export const STEP_LABELS = { describe: 'Describe', persona: 'Persona', prompts: 'Prompts', run: 'Run', topics: 'Topics', push: 'Push' }

export const ACTIONS = {
  won: 'Nothing to do',
  page_fix: 'Page fix',
  improve_page: 'Improve a page',
  commercial_page: 'Commercial page or FAQ',
  existing_group: 'Existing topic',
  new_article: 'New article',
  skip: 'Skip',
}
/** Only these two become briefs in AEO Generation. */
export const PUSHABLE = new Set(['existing_group', 'new_article'])

const list = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v)).trim()

/** The first later step that already has data, or '' when nothing later exists. */
export function staleAfter(step, has) {
  const i = STEPS.indexOf(step)
  for (const s of STEPS.slice(i + 1)) if (has?.[s]) return s
  return ''
}

/** JSON object out of a model reply that may wrap it in a code fence or a sentence. */
export function parseJsonReply(text) {
  const cleaned = str(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The reply came back incomplete. Try again.')
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('The reply came back incomplete. Try again.')
  }
}

/** The parts of the Strategic ICP the persona needs: the customer line, Ideal Customer, Buyer Situations, Alternatives. */
export function icpExcerpt(md, max = 9000) {
  const text = str(md)
  if (!text) return ''
  const lines = text.split('\n')
  const wanted = /ideal customer|buyer situations|alternatives|problem & reasons/i
  const out = []
  let keep = true // the title and the one-line summary under it
  let level = 0 // heading depth of the section being kept or skipped; 0 = still in the title block
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const depth = h[1].length
      if (depth === 1) {
        keep = true
        level = 0
      } else if (!level || depth <= level) {
        keep = wanted.test(h[2])
        level = depth
      } // else: a sub-heading inside the current section; no change
    }
    if (keep) out.push(line)
  }
  return out.join('\n').slice(0, max)
}

export function buildPersonaPrompt({ description, icpMd, icpShort, companyName, earlier }) {
  const lines = [
    'A user describes a situation in the life of one person. Build that person, so that later we can write what they would type to an AI assistant at this moment.',
    '',
    `The company this is for: ${companyName || '(not named)'}. Its buyers:`,
    icpExcerpt(icpMd) || icpShort || '(no ICP on file)',
    '',
    'The situation, in the user\'s words:',
    description,
    '',
    list(earlier).length ? 'Situations already run for this company:' : '',
    ...list(earlier).map((s) => `- ${s.code}: ${s.title || s.description.slice(0, 120)}`),
    '',
    'Rules:',
    '- Use only what the description says or plainly implies. Do not add numbers, events or feelings it does not contain.',
    '- Every person is somewhere. If the description names no place, choose a plausible large city in the company\'s market for this buyer and say it was assumed.',
    '- situation_id is the ID (S1, S2, ...) of the closest Buyer Situation in the ICP above, or "" when the ICP lists none.',
    '- outside_icp is true when this person is not a buyer the ICP describes; say why in fit_note. Otherwise fit_note says in one line why that buyer situation fits.',
    '- duplicate_of is the code of an earlier situation that is nearly the same person at the same moment, or "".',
    '',
    'Reply with JSON only:',
    '{"title": "4 to 8 words naming the person and the moment", "who": "who they are, one or two sentences", "where_they_stand": "the facts of their position, one or two sentences", "inside": "what is going on inside them, one sentence", "location": "City, State or Country", "location_assumed": true, "situation_id": "S1", "fit_note": "one line", "outside_icp": false, "duplicate_of": ""}',
  ]
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
}

export function parsePersona(text) {
  const p = parseJsonReply(text)
  const persona = {
    who: str(p.who),
    where_they_stand: str(p.where_they_stand),
    inside: str(p.inside),
    location: str(p.location),
    location_assumed: Boolean(p.location_assumed),
    outside_icp: Boolean(p.outside_icp),
    duplicate_of: str(p.duplicate_of),
  }
  if (!persona.who) throw new Error('The persona came back empty. Try again.')
  return { title: str(p.title).slice(0, 120), persona, situation_id: str(p.situation_id).slice(0, 12), fit_note: str(p.fit_note).slice(0, 400) }
}

export function buildPromptsPrompt({ description, persona, ownNames }) {
  const lines = [
    'Write what this person would type to an AI assistant (ChatGPT) at this moment, in their own voice. Two versions of the same ask.',
    '',
    `Who they are: ${persona.who}`,
    `Where they stand: ${persona.where_they_stand}`,
    `What is going on inside: ${persona.inside}`,
    `Where they are: ${persona.location}`,
    '',
    'The situation as first described:',
    description,
    '',
    'medium: one message of 400 to 700 characters. The core of the situation and the 2 or 3 questions that matter most to them. It may use short paragraphs.',
    'short: one line of at most 160 characters. What most people would type first, with almost no context.',
    '',
    'Rules for both:',
    '- First person, the way a real person types: plain, a little uneven, no headings, no bullet lists of more than 3 items.',
    '- Only facts from the situation above. No new numbers or events.',
    '- The medium one mentions where they are, naturally, once.',
    '- Ask for 2 or 3 things, not a full plan with a timeline: a prompt that asks for everything gets no answer in time.',
    list(ownNames).length ? `- Never mention: ${ownNames.join(', ')}. Name no company or product at all unless the situation names it.` : '- Name no company or product unless the situation names it.',
    '- Do not use the characters % or +. Write "percent" and "and".',
    '',
    'Reply with JSON only: {"medium": "...", "short": "..."}',
  ]
  return lines.join('\n')
}

export function parsePrompts(text) {
  const p = parseJsonReply(text)
  const medium = str(p.medium).slice(0, PROMPT_MAX)
  const short = str(p.short).replace(/\s*\n\s*/g, ' ').slice(0, PROMPT_MAX)
  if (!medium || !short) throw new Error('The prompts came back empty. Try again.')
  return { medium, short }
}

/**
 * What is wrong with one prompt before it runs. `block` problems stop the run.
 * @returns {{ block: string[], warn: string[] }}
 */
export function promptIssues(prompt, ownNames = []) {
  const text = str(prompt)
  const block = []
  const warn = []
  if (!text) block.push('The prompt is empty.')
  if (text.length > PROMPT_MAX) block.push(`${text.length.toLocaleString('en-US')} characters: the engine takes ${PROMPT_MAX.toLocaleString('en-US')} at most.`)
  const named = list(ownNames).filter((n) => nameMatchers([n]).some((re) => re.test(text)))
  if (named.length) block.push(`It names ${named.join(', ')}. A prompt that names the company makes the test meaningless.`)
  if (/[%+]/.test(text)) warn.push('It contains % or +, which the engine can misread. Write "percent" or "and".')
  if (text.length > 900) warn.push('Long prompts that ask for a lot often time out on this engine (about 100 seconds).')
  return { block, warn }
}

/** Calls for one run: run 1 of every prompt, then run 2, ... so a prompt's runs happen one after another. */
export function planRuns(prompts, runs, done = []) {
  const have = new Set(list(done).filter((r) => r.status === 'ok').map((r) => `${r.prompt_id}|${r.run_no}`))
  const steps = []
  for (let runNo = 1; runNo <= runs; runNo += 1) {
    const calls = list(prompts).filter((p) => !have.has(`${p.id}|${runNo}`)).map((p) => ({ promptId: p.id, runNo }))
    if (calls.length) steps.push(calls)
  }
  return steps
}

/** Markdown headings of an answer: the sub-questions it covered. */
export function answerHeadings(answer, max = 14) {
  return str(answer)
    .split('\n')
    .map((l) => /^#{1,4}\s+(.*)$/.exec(l.trim())?.[1] || /^\*\*(.{6,90})\*\*:?$/.exec(l.trim())?.[1] || '')
    .map((h) => h.replace(/\\/g, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((h) => h.length >= 6 && !/^[$~\d.,k%\s-]+$/i.test(h))
    .slice(0, max)
}

/**
 * Every distinct search query of the ok runs, strongest first.
 * @returns {Array<{ id: string, q: string, runs: number, forms: string[], runKeys: string[] }>}
 */
export function collectQueries(runs, prompts) {
  const formOf = Object.fromEntries(list(prompts).map((p) => [p.id, p.form]))
  const byNorm = new Map()
  for (const r of list(runs)) {
    if (r.status !== 'ok') continue
    for (const q of new Set(list(r.fan_out).map(str).filter(Boolean))) {
      const norm = normalizeQuery(q) || q.toLowerCase()
      const row = byNorm.get(norm) || { q, runKeys: new Set(), forms: new Set() }
      row.runKeys.add(r.id)
      if (formOf[r.prompt_id]) row.forms.add(formOf[r.prompt_id])
      byNorm.set(norm, row)
    }
  }
  return [...byNorm.values()]
    .map((row) => ({ q: row.q, runs: row.runKeys.size, forms: [...row.forms], runKeys: [...row.runKeys] }))
    .sort((a, b) => b.runs - a.runs || a.q.localeCompare(b.q))
    .map((row, i) => ({ id: `q${i + 1}`, ...row }))
}

export function buildTopicsPrompt({ persona, prompts, queries, runs, pillars, groups, ownNames, companyName }) {
  const okRuns = list(runs).filter((r) => r.status === 'ok')
  const cited = new Map()
  for (const r of okRuns) for (const c of list(r.cited)) cited.set(c.url || c.domain, c)
  const headings = [...new Set(okRuns.flatMap((r) => answerHeadings(r.answer)))].slice(0, 60)
  const lines = [
    `ChatGPT was asked the prompts below by one person, several times. While answering it ran web searches. Group those searches into topics for ${companyName || 'a company'}'s content team: a topic is a set of searches that one web page could answer.`,
    '',
    `The person: ${persona.who} ${persona.where_they_stand} Located in ${persona.location || '(not stated)'}.`,
    '',
    'The prompts:',
    ...list(prompts).map((p) => `[${p.form}] ${p.prompt}`),
    '',
    'The searches ChatGPT ran (id, how many of the runs produced it, the query):',
    ...queries.map((q) => `${q.id} · ${q.runs} · ${q.q}`),
    '',
    'Pages ChatGPT cited in its answers (domain · title):',
    ...[...cited.values()].slice(0, 60).map((c) => `- ${c.domain} · ${c.title || c.url}`),
    '',
    'Headings of its answers (the sub-questions it covered):',
    ...headings.map((h) => `- ${h}`),
    '',
    `Content themes (pillars) of ${companyName || 'the company'}: ${list(pillars).map((p) => `${p.code} ${p.name}`).join('; ') || '(none)'}`,
    'Topics it already has (code · name):',
    ...list(groups).slice(0, 200).map((g) => `- ${g.code} · ${g.name}`),
    '',
    'Rules:',
    '- Every search id goes into exactly one topic. 2 to 8 topics.',
    '- title: the topic as an article title a buyer would click, under 70 characters. No company names.',
    '- local is true when the searches are about a city, state or region that neither the prompts nor the person\'s stated location mention (the engine\'s own location leaking in).',
    '- recommendation is true when the searches look for who or what to use (providers, tools, services, lists of them), false when they look for facts or how something works.',
    '- owner_note: one sentence on who owns this ground in the cited pages (official body, data publisher, vendor, media) and whether there is an opening for a specialist page, for example a narrower audience nobody addresses. Say "no clear opening" when there is none.',
    '- answer_points: 3 to 6 short lines. What a page on this topic must answer for this person: the sub-questions from the headings that belong to it and the facts the searches went looking for. Questions and facts to cover, not opinions. No invented numbers.',
    '- match_group: the code of an existing topic above that already covers this one, or "".',
    '- pillar: the code of the content theme this belongs under, or "" when none fits.',
    list(ownNames).length ? `- Never write ${ownNames.join(' or ')} in a title or an answer point.` : '',
    '',
    'Reply with JSON only:',
    '{"topics": [{"title": "", "queries": ["q1"], "local": false, "recommendation": false, "owner_note": "", "answer_points": [""], "match_group": "", "pillar": ""}]}',
  ]
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
}

export function parseTopics(text, queries) {
  const known = new Set(queries.map((q) => q.id))
  const used = new Set()
  const topics = list(parseJsonReply(text).topics)
    .map((t) => {
      const ids = [...new Set(list(t.queries).map(str))].filter((id) => known.has(id) && !used.has(id))
      ids.forEach((id) => used.add(id))
      return {
        title: str(t.title).slice(0, 140),
        queryIds: ids,
        local: Boolean(t.local),
        recommendation: Boolean(t.recommendation),
        owner_note: str(t.owner_note).slice(0, 400),
        answer_points: list(t.answer_points).map(str).filter(Boolean).slice(0, 8),
        match_group: str(t.match_group),
        pillar: str(t.pillar),
      }
    })
    .filter((t) => t.title && t.queryIds.length)
  if (!topics.length) throw new Error('No topics came back. Try again.')
  // A search the model left out is kept, in a topic of its own, so nothing is dropped silently.
  const left = queries.filter((q) => !used.has(q.id))
  if (left.length) {
    topics.push({ title: 'Other searches', queryIds: left.map((q) => q.id), local: false, recommendation: false, owner_note: '', answer_points: [], match_group: '', pillar: '' })
  }
  return topics
}

/**
 * Numbers for one topic, from the runs that produced any of its searches.
 * Citations belong to a whole answer, not to one search, so "winners" is approximate.
 */
export function topicStats(topic, queries, runs, prompts, ownBrandId) {
  const byId = Object.fromEntries(queries.map((q) => [q.id, q]))
  const mine = topic.queryIds.map((id) => byId[id]).filter(Boolean)
  const runKeys = new Set(mine.flatMap((q) => q.runKeys))
  const myRuns = list(runs).filter((r) => runKeys.has(r.id))
  const formOf = Object.fromEntries(list(prompts).map((p) => [p.id, p.form]))
  const winners = new Map()
  for (const r of myRuns) {
    for (const c of new Map(list(r.cited).map((x) => [x.domain, x])).values()) {
      const w = winners.get(c.domain) || { domain: c.domain, url: c.url || '', title: c.title || '', cited: 0 }
      w.cited += 1
      winners.set(c.domain, w)
    }
  }
  return {
    queries: mine.map((q) => ({ q: q.q, runs: q.runs, forms: q.forms })),
    runs_seen: myRuns.length,
    forms_seen: new Set(myRuns.map((r) => formOf[r.prompt_id]).filter(Boolean)).size,
    winners: [...winners.values()].sort((a, b) => b.cited - a.cited).slice(0, 8),
    standing: ownBrandId ? outcomeFor(myRuns, ownBrandId).label : 'Absent',
  }
}

/** The action for one topic, by rule. The reason is shown to the user next to it. */
export function decideAction({ standing, local, recommendation, matchGroup, hasOwnBrand = true }) {
  if (local) return { action: 'skip', reason: 'The searches are about a place the prompt never named: the engine\'s location, not the person\'s.' }
  if (standing === 'Named') return { action: 'won', reason: 'The company is named in these answers → nothing to do.' }
  if (standing === 'Cited, not named') return { action: 'page_fix', reason: 'An own page is cited but the company is not named → put the claim on a commercial page.' }
  if (standing === 'Retrieved, not cited') return { action: 'improve_page', reason: 'An own page was found but not cited → improve that page.' }
  const absent = hasOwnBrand ? 'Absent' : 'No own brand is tracked, so the company counts as absent'
  if (recommendation) return { action: 'commercial_page', reason: `${absent} + a "who should I use" topic → a commercial page or FAQ, not an article.` }
  if (matchGroup) return { action: 'existing_group', reason: `${absent} + topic ${matchGroup.code} already covers it → write or improve that one.` }
  return { action: 'new_article', reason: `${absent} + nothing covers it → new article.` }
}

/** Seen in one run only, when there were at least three: shown, not offered for push by default. */
export function isWeak(topic, okRuns) {
  return okRuns >= 3 && Number(topic.runs_seen) < 2
}

/** The brief fields a topic fills. Hot takes are left to the user. */
export function briefFromTopic(topic) {
  const queries = list(topic.queries)
  const points = list(topic.answer_points)
  const outline = [
    { heading: 'The short story', points: ['Answer these searches directly, in close to their own words:', ...queries.slice(0, 4).map((q) => q.q)] },
    ...points.map((p) => ({ heading: p.replace(/[.:]\s*$/, ''), points: [] })),
  ]
  const winners = list(topic.winners).slice(0, 4).map((w) => w.domain).join(', ')
  return {
    title: str(topic.title),
    primary_keyword: str(queries[0]?.q).slice(0, 120),
    angle: [topic.owner_note, winners ? `Cited today: ${winners}.` : ''].filter(Boolean).join(' '),
    outline,
  }
}
