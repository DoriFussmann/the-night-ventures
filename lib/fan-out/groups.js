// Fan-Out Engine: the search queries of a Run ("fan-out"), grouped into Query Groups, and what to do about them.
// Measurement (signal, standing, who wins, opportunity score, difficulty, Opportunity / Skip) is counted here by
// fixed rules. Interpretation (why, what to cover, the action, the takeaway) is written by the AI inside fixed
// formats, and never touches a number.

import { normalizeQuery, nameMatchers } from '../prompt-tests/derive.js'
import { FORMS, STAGE_TIER, fill, parseJsonReply, personLine } from './core.js'
import { namedOrder, share, signalLabel } from './score.js'

const list = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v)).trim()
export const normOf = (q) => normalizeQuery(q) || str(q).toLowerCase()

/** The fixed reason list. The AI picks from it; it does not write freely. */
export const REASONS = {
  direct_match: { label: 'Direct match', text: 'the page answers the exact search' },
  format: { label: 'Format', text: 'a comparison, table or list ChatGPT can lift from' },
  specific: { label: 'Specific to this person', text: 'speaks to their size, role or situation' },
  fresh: { label: 'Fresh', text: 'recently dated or updated' },
  third_party: { label: 'Third-party proof', text: 'named on independent pages' },
  no_page: { label: 'No page', text: 'nothing of yours exists on this' }, // Opportunity cards only
}
export const CARD_ACTIONS = { new_article: 'New article', fix_existing: 'Fix existing page', off_site: 'Off-site' }
export const HOW = { own_page: 'Their own page is cited', third_party: 'Third-party pages that name them are cited', neither: 'Neither: ChatGPT already knew them' }
/** The group for searches the AI left out of every group. It is measured like any other, but never written as an article. */
export const OTHER_GROUP = 'Other searches'
export const DEFAULT_CUTOFFS = { opportunity: 0.5, open: 0.5, dominated: 0.75 }

/**
 * Every distinct search of a Run, strongest first.
 * @returns {Array<{ id: string, q: string, norm: string, runs: number, forms: string[], runIds: string[] }>}
 */
export function runQueries(runs) {
  const by = new Map()
  for (const r of list(runs)) {
    if (r.status !== 'ok') continue
    for (const q of new Set(list(r.fan_out).map(str).filter(Boolean))) {
      const norm = normOf(q)
      const row = by.get(norm) || { q, norm, runIds: new Set(), forms: new Set() }
      row.runIds.add(r.id)
      if (r.prompt_form) row.forms.add(r.prompt_form)
      by.set(norm, row)
    }
  }
  return [...by.values()]
    .map((x) => ({ q: x.q, norm: x.norm, runs: x.runIds.size, forms: [...x.forms], runIds: [...x.runIds] }))
    .sort((a, b) => b.runs - a.runs || a.q.localeCompare(b.q))
    .map((x, i) => ({ id: `q${i + 1}`, ...x }))
}

/** The searches of a Run that no Query Group holds yet. */
export function ungrouped(queries, groups) {
  const have = new Set(list(groups).flatMap((g) => list(g.norms)))
  return list(queries).filter((q) => !have.has(q.norm))
}

/**
 * The grouping request. With no groups yet (the Baseline), every search is grouped. Later, new searches are
 * sorted into the existing groups, and only what fits none becomes a new group.
 */
export function buildGroupsPrompt({ situation, queries, groups = [], template }) {
  const existing = list(groups)
  // `fill` puts each value in as it is: text from a search or a page cannot expand into the template.
  return fill(template, {
    person: personLine(situation),
    mode: existing.length
      ? 'Query Groups already exist for this person (below). Put each search into the existing group with the same intent. Only a search that fits none of them goes into a new group.'
      : 'Group every search. One level of grouping only.',
    groups: existing.length ? existing.map((g, i) => `g${i + 1} · ${g.label} · e.g. ${list(g.norms).slice(0, 3).join(' | ')}`).join('\n') : '(none yet)',
    queries: list(queries).map((q) => `${q.id} · ${q.runs} · ${q.q}`).join('\n'),
  })
}

/**
 * The grouping reply, checked: every search lands in exactly one group, a search the AI left out gets a group
 * of its own kind ("Other searches"), and labels carry no brand name.
 * @returns {{ into: Array<{ groupId: string, norms: string[] }>, created: Array<{ label: string, norms: string[] }>, leftOver: number }}
 */
export function parseGroups(text, queries, groups = [], brandNames = []) {
  const p = parseJsonReply(text)
  const byId = Object.fromEntries(list(queries).map((q) => [q.id, q]))
  const used = new Set()
  const take = (ids) => [...new Set(list(ids).map(str))].filter((id) => byId[id] && !used.has(id) && used.add(id)).map((id) => byId[id].norm)
  const into = []
  for (const a of list(p.existing)) {
    const g = list(groups)[Number(str(a?.group).replace(/^g/i, '')) - 1]
    const norms = g ? take(a?.queries) : []
    const same = g ? into.find((x) => x.groupId === g.id) : null
    if (same) same.norms.push(...norms) // the AI listed one group twice: one entry, so no assignment is lost
    else if (g && norms.length) into.push({ groupId: g.id, norms })
  }
  const res = nameMatchers(list(brandNames))
  const created = []
  for (const n of list(p.new)) {
    const label = str(n?.label).slice(0, 140)
    const norms = label ? take(n?.queries) : []
    // A label never carries a company name.
    if (norms.length) created.push({ label: res.some((re) => re.test(label)) ? 'Untitled group' : label, norms })
  }
  const left = list(queries).filter((q) => !used.has(q.id)).map((q) => q.norm)
  if (left.length) created.push({ label: OTHER_GROUP, norms: left })
  return { into, created, leftOver: left.length }
}

const domainMatches = (domain, brand) => list(brand?.domains).some((d) => { const x = str(d).toLowerCase().replace(/^www\./, ''); return x && (str(domain).toLowerCase() === x || str(domain).toLowerCase().endsWith(`.${x}`)) })

/**
 * The numbers of one Query Group in one Run. A run contains several searches, so a mention cannot be tied to
 * one query: "standing" shows a link between the two, not a proven cause.
 */
export function groupStats(group, runs, brands, options = {}) {
  const thresholds = options.thresholds
  const cutoffs = options.cutoffs || DEFAULT_CUTOFFS
  const pc = (v) => `${Math.round(v * 100)}%`
  const ok = list(runs).filter((r) => r.status === 'ok')
  const norms = new Set(list(group.norms))
  const mine = ok.filter((r) => list(r.fan_out).some((q) => norms.has(normOf(q))))
  const n = mine.length
  const own = list(brands).find((b) => b.is_own) || null
  const orders = mine.map((r) => namedOrder(r, brands))
  const named = new Map()
  orders.forEach((order) => {
    for (const o of order) {
      const row = named.get(o.key) || { name: o.name, brandId: o.brandId, own: o.own, tracked: o.tracked, runs: 0 }
      row.runs += 1
      named.set(o.key, row)
    }
  })
  const whoNamed = [...named.values()].sort((a, b) => b.runs - a.runs || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name))
  const ownNamed = own ? named.get(`b:${own.id}`)?.runs || 0 : 0
  const rivals = whoNamed.filter((w) => !w.own)
  const top = rivals[0] || null
  const pages = new Map()
  for (const r of mine) {
    for (const c of new Map(list(r.cited).map((x) => [x.url || x.domain, x])).values()) {
      const key = c.url || c.domain
      const row = pages.get(key) || { url: c.url || '', domain: str(c.domain), title: str(c.title), runs: 0 }
      row.runs += 1
      pages.set(key, row)
    }
  }
  const cited = [...pages.values()].sort((a, b) => b.runs - a.runs || a.domain.localeCompare(b.domain)).map((p) => ({ ...p, own: own ? domainMatches(p.domain, own) : false }))
  const byDomain = new Map()
  for (const r of mine) for (const d of new Set(list(r.cited).map((c) => str(c.domain)).filter(Boolean))) byDomain.set(d, (byDomain.get(d) || 0) + 1)
  const domains = [...byDomain.entries()].map(([domain, n]) => ({ domain, runs: n })).sort((a, b) => b.runs - a.runs || a.domain.localeCompare(b.domain))
  const queries = new Map()
  for (const r of mine) for (const q of new Set(list(r.fan_out).map(str).filter((x) => norms.has(normOf(x))))) queries.set(normOf(q), { q: queries.get(normOf(q))?.q || q, runs: (queries.get(normOf(q))?.runs || 0) + 1 })
  const signal = ok.length ? n / ok.length : 0
  const gap = n ? 1 - ownNamed / n : 0
  const topShare = n && top ? top.runs / n : 0
  const sig = signalLabel(signal, thresholds)
  const won = n > 0 && ownNamed / n >= cutoffs.opportunity
  const label = sig === 'Noise' ? 'Skip' : won ? 'Win' : 'Opportunity'
  return {
    id: group.id,
    label: group.label,
    isNew: Boolean(group.is_new),
    searches: [...queries.values()].sort((a, b) => b.runs - a.runs || a.q.localeCompare(b.q)),
    searchCount: [...queries.values()].reduce((a, q) => a + q.runs, 0),
    runs: n,
    signal: { ...share(n, ok.length), label: sig },
    standing: { named: ownNamed, of: n }, // shown as a count: "4 of 19"
    whoNamed: whoNamed.slice(0, 8),
    cited: cited.slice(0, 8),
    citedDomains: domains.slice(0, 6), // in how many of those runs each site was cited, whatever the page
    ownCited: cited.filter((p) => p.own).slice(0, 3),
    promptIds: [...new Set(mine.map((r) => r.prompt_id).filter(Boolean))], // the prompts whose runs led to this search
    triggeredBy: FORMS.map((f) => ({ form: f, runs: mine.filter((r) => r.prompt_form === f).length })).filter((t) => t.runs > 0).sort((a, b) => b.runs - a.runs),
    // Opportunity score = Signal x Gap, where Gap is the share of those runs in which the brand is not named.
    score: Math.round(signal * gap * 100),
    difficulty: !n ? '' : topShare >= cutoffs.dominated ? 'Dominated' : topShare > cutoffs.open ? 'Contested' : 'Open',
    leader: top ? { name: top.name, brandId: top.brandId, runs: top.runs } : null,
    // Opportunity: Signal is Strong or Occasional and the brand is named in fewer than half of those runs.
    // Win: the brand is already named in half or more. Skip: Noise.
    verdict: label,
    skipReason: label === 'Skip' ? `Noise: ChatGPT searched this in fewer than ${pc(thresholds?.occasional ?? 0.2)} of the runs.` : label === 'Win' ? `Already named in ${pc(cutoffs.opportunity)} or more of these runs.` : '',
    other: group.label === OTHER_GROUP,
  }
}

/**
 * Every Query Group of a Run, with the lists the summary shows: Opportunities (Open first, then by opportunity
 * score), Wins, Skips, and the 80/20 marker (the groups that account for 80% of all searches).
 */
export function summarizeGroups(groups, runs, brands, options = {}) {
  const all = list(groups).map((g) => groupStats(g, runs, brands, options)).filter((g) => g.runs > 0)
  const total = all.reduce((a, g) => a + g.searchCount, 0)
  let acc = 0
  const core = new Set()
  for (const g of [...all].sort((a, b) => b.searchCount - a.searchCount)) {
    if (total && acc / total >= 0.8) break
    core.add(g.id)
    acc += g.searchCount
  }
  for (const g of all) g.core = core.has(g.id)
  const rank = { Open: 0, Contested: 1, Dominated: 2, '': 3 }
  return {
    all,
    opportunities: all.filter((g) => g.verdict === 'Opportunity').sort((a, b) => rank[a.difficulty] - rank[b.difficulty] || b.score - a.score || b.runs - a.runs),
    wins: all.filter((g) => g.verdict === 'Win').sort((a, b) => b.runs - a.runs || b.standing.named - a.standing.named),
    skips: all.filter((g) => g.verdict === 'Skip').sort((a, b) => b.runs - a.runs),
    totalSearches: total,
  }
}

/* ---------- cards ---------- */

/** The words of a text that carry meaning, with a plain plural folded into its singular ("notes" and "note" are one word). */
const words = (s) => new Set(normOf(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))

/**
 * The company's closest page for a Query Group: an own page ChatGPT already cited in those runs, or else the
 * Content Map topic whose name shares the most words with the group. "None found" when nothing is close.
 */
export function closestPage(stats, topics = []) {
  if (stats.ownCited?.length) return { kind: 'cited', url: stats.ownCited[0].url, title: stats.ownCited[0].title || stats.ownCited[0].url, note: `cited in ${stats.ownCited[0].runs} of ${stats.runs} runs` }
  const want = new Set([...words(stats.label), ...list(stats.searches).slice(0, 4).flatMap((q) => [...words(q.q)])])
  let best = null
  for (const t of list(topics)) {
    const have = new Set([...words(t.name), ...words(t.primary_keyword || '')])
    if (!have.size) continue
    const hit = [...have].filter((w) => want.has(w)).length
    const fit = hit / have.size
    if (hit >= 2 && fit >= 0.5 && (!best || fit > best.fit || (fit === best.fit && hit > best.hit))) best = { fit, hit, t }
  }
  if (!best) return { kind: 'none' }
  const live = ['live', 'published'].includes(best.t.status)
  return { kind: live ? 'live' : 'topic', topicId: best.t.id, code: best.t.code, title: best.t.name, status: best.t.status, slug: best.t.live_slug || '', note: live ? 'live' : `Content Map topic, ${best.t.status}` }
}

/**
 * How the winner got named, from what was cited in those runs: their own page, third-party pages that name
 * them (checked in the pages that could be read), or neither.
 */
export function howTheyGotThere(winner, stats, brands, pagesRead = []) {
  if (!winner) return { how: 'neither', pages: [] }
  const brand = list(brands).find((b) => b.id === winner.brandId) || null
  const slug = str(winner.name).toLowerCase().replace(/[^a-z0-9]+/g, '')
  const isTheirs = (p) => (brand ? domainMatches(p.domain, brand) : slug.length >= 4 && str(p.domain).toLowerCase().replace(/[^a-z0-9]+/g, '').includes(slug))
  const theirs = list(stats.cited).filter(isTheirs)
  if (theirs.length) return { how: 'own_page', pages: theirs.slice(0, 3) }
  const res = nameMatchers(brand && list(brand.name_patterns).length ? brand.name_patterns : [winner.name])
  const naming = list(pagesRead).filter((p) => p.ok && !isTheirs(p) && res.some((re) => re.test(p.text)))
  if (naming.length) return { how: 'third_party', pages: naming.map((p) => ({ url: p.url, domain: p.domain, title: p.title, runs: p.runs })) }
  return { how: 'neither', pages: [] }
}

export function buildCardPrompt({ kind, situation, stats, winner, how, yourPage, pagesRead, pillars = [], template }) {
  const pageBlocks = list(pagesRead).map((p, i) => (p.ok ? `<page ${i + 1} · ${p.domain} · cited in ${p.runs} of ${stats.runs} runs · ${p.title}>\n${p.text}\n</page ${i + 1}>` : `<page ${i + 1} · ${p.domain}> could not be read </page ${i + 1}>`))
  return fill(template, {
    kind: kind === 'win' ? 'WIN: the company is already named for this search. Explain why it works, so it can be repeated.' : 'OPPORTUNITY: the company is rarely or never named for this search. Explain why the winner is named, and what a page must cover to compete.',
    person: personLine(situation),
    group: stats.label,
    searches: list(stats.searches).slice(0, 12).map((q) => `- ${q.q} (${q.runs}×)`).join('\n'),
    standing: `${stats.standing.named} of ${stats.standing.of} runs name the company`,
    winner: winner ? `${winner.name}, named in ${winner.runs} of ${stats.runs} runs` : 'no brand stands out',
    how: HOW[how.how],
    your_page: yourPage.kind === 'none' ? 'none found' : `${yourPage.title} (${yourPage.note})`,
    pillars: list(pillars).map((p) => `${p.code} ${p.name}`).join('; ') || '(none)',
    reasons: Object.entries(REASONS).filter(([k]) => kind !== 'win' || k !== 'no_page').map(([k, r]) => `- ${k}: ${r.label}: ${r.text}`).join('\n'),
    pages: pageBlocks.join('\n\n') || '(no page was cited in these runs)',
  })
}

const short = (v, max) => str(v).replace(/\s+/g, ' ').slice(0, max)

/** The card reply, kept inside its fixed formats: reasons from the list (two at most), 3 to 6 lines to cover, one of three actions. */
export function parseCard(text, { kind, yourPage, pillars = [], brandNames = [] }) {
  const p = parseJsonReply(text)
  const allowed = Object.keys(REASONS).filter((k) => kind !== 'win' || k !== 'no_page')
  let reasons = [...new Set(list(p.reasons).map((r) => str(r).toLowerCase()))].filter((r) => allowed.includes(r)).slice(0, 2)
  // "No page" is a fact the app knows: it holds only when no page of the company was found.
  if (kind !== 'win') reasons = reasons.filter((r) => r !== 'no_page' || yourPage.kind === 'none')
  const res = nameMatchers(list(brandNames))
  const clean = (line) => !res.some((re) => re.test(line))
  let action = str(p.action).toLowerCase()
  if (!CARD_ACTIONS[action]) action = yourPage.kind === 'live' || yourPage.kind === 'cited' ? 'fix_existing' : 'new_article'
  // AEO Generation writes new articles only: a page that is already live is fixed by hand.
  if (action === 'new_article' && (yourPage.kind === 'live' || yourPage.kind === 'cited')) action = 'fix_existing'
  const pillar = list(pillars).find((x) => x.code.toLowerCase() === str(p.theme).toLowerCase()) || null
  return {
    reasons,
    why: short(p.why, 300),
    cover: kind === 'win' ? [] : list(p.what_to_cover).map((l) => short(l, 200)).filter((l) => l && clean(l)).slice(0, 6),
    action: kind === 'win' ? '' : action,
    actionLine: kind === 'win' ? '' : short(p.action_line, 240),
    repeatThis: kind === 'win' ? short(p.repeat_this, 300) : '',
    comparison: kind !== 'win' && Boolean(p.comparison) && reasons.includes('format'),
    pillarId: pillar?.id || null,
  }
}

/* ---------- takeaway ---------- */

/** The numbers the takeaway may point to, as the app calculated them. */
export function takeawayFacts(score, groups) {
  const own = score?.own
  const facts = []
  if (own) {
    facts.push(`Mentioned: ${own.mentioned.pct}% (${own.mentioned.x} of ${own.mentioned.n} runs), margin ±${own.mentioned.margin}`)
    facts.push(`First named: ${own.first.pct}% (${own.first.x} of ${own.first.n})`)
    facts.push(`Recommended: ${own.recommended.pct}% (${own.recommended.x} of ${own.recommended.n})`)
    // With nobody named there is no ranking to speak of.
    if (own.mentioned.x > 0) facts.push(`Rank among tracked brands: ${own.rank} of ${score.brands.length}`)
    if (score.leader && !score.leader.own) facts.push(`Leader: ${score.leader.name} at ${score.leader.pct}%, ${score.gap} points ahead`)
  }
  facts.push(`ChatGPT searched the web in ${score.searched.x} of ${score.searched.n} runs`)
  facts.push(`Query Groups: ${groups.opportunities.length} opportunities, ${groups.wins.length} wins, ${groups.skips.length} skipped`)
  if (!groups.opportunities.length) facts.push('There is no opportunity in this Run: nothing here calls for new content')
  for (const g of groups.opportunities.slice(0, 3)) facts.push(`Opportunity "${g.label}": searched in ${g.signal.x} of ${g.signal.n} runs, company named in ${g.standing.named} of ${g.standing.of}, ${g.difficulty}${g.leader ? `, most named: ${g.leader.name} (${g.leader.runs})` : ''}`)
  for (const g of groups.wins.slice(0, 2)) facts.push(`Win "${g.label}": company named in ${g.standing.named} of ${g.standing.of}`)
  return facts
}

/**
 * The takeaway may only point to numbers the app calculated. It must be exactly three sentences; every
 * percentage and every "N of M" in it must be one the facts state, every other number must appear in the facts,
 * and quantities in words ("half", "twice", "two of three") are refused, because they cannot be checked.
 */
export function takeawayOk(text, facts) {
  const t = str(text)
  const all = list(facts).join('\n')
  const found = (re, src) => [...src.matchAll(re)].map((m) => m[0].replace(/\s+/g, ' '))
  const PCT = /\d+(?:\.\d+)?%/g
  const PAIR = /\d+ of \d+/g
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (sentences.length !== 3) return false
  if (/\b(half|halves|twice|thrice|double[ds]?|triple[ds]?|quarter|third|thirds|majority|minority|most of|percent)\b/i.test(t)) return false
  if (/\b(two|three|four|five|six|seven|eight|nine|ten|both|several|dozen)\b/i.test(t) || /\bone\s+(of|in|out|time|point)\b/i.test(t)) return false
  const pcts = new Set(found(PCT, all))
  const pairs = new Set(found(PAIR, all))
  if (!found(PCT, t).every((x) => pcts.has(x)) || !found(PAIR, t).every((x) => pairs.has(x))) return false
  const rest = t.replace(PCT, ' ').replace(PAIR, ' ')
  const allowed = new Set(all.match(/\d+(?:\.\d+)?/g) || [])
  return (rest.match(/\d+(?:\.\d+)?/g) || []).every((n) => allowed.has(n))
}

/** A takeaway written by the app from the same facts, used when the AI's does not pass the check. */
export function plainTakeaway(score, groups) {
  const own = score?.own
  const a = own ? `${own.name} is named in ${own.mentioned.pct}% of the answers (${own.mentioned.x} of ${own.mentioned.n} runs).` : 'No own brand is tracked, so there is no score.'
  const b = score.leader && !score.leader.own ? `${score.leader.name} leads at ${score.leader.pct}%.` : own && own.mentioned.x ? 'No tracked brand is named more often.' : ''
  const c = groups.opportunities.length ? `The first opportunity is "${groups.opportunities[0].label}".` : 'No search stands out as an opportunity in this Run.'
  return [a, b, c].filter(Boolean).join(' ')
}

/* ---------- push ---------- */

/**
 * What AEO Generation needs for a brief, from an Opportunity card. Title: the Query Group label. Primary
 * keyword: the most frequent search. Outline: "What to cover". Angle: who wins and why. Hot takes stay empty.
 * `also` are cards merged into this one: two Opportunities best served by one page become one brief.
 */
export function briefFromCard(card, stats, also = []) {
  const cover = [...new Set([...list(card.cover), ...list(also).flatMap((c) => list(c.cover))])]
  const reasons = list(card.reasons).map((r) => REASONS[r]?.label).filter(Boolean)
  const outline = cover.map((line) => ({ heading: line.replace(/[.:]\s*$/, ''), points: [] }))
  return {
    title: str(stats.label),
    primary_keyword: str(stats.searches?.[0]?.q).slice(0, 120),
    article_type: card.comparison ? 'comparison' : null,
    angle: [stats.leader ? `Named most today: ${stats.leader.name} (${stats.leader.runs} of ${stats.runs} runs).` : '', reasons.length ? `Why (estimate): ${reasons.join(', ')}.` : '', str(card.why)].filter(Boolean).join(' '),
    outline,
  }
}

/** The Scenario prompts whose runs led to a Query Group, each with the intent tier from the Stage (the mapping is an admin setting). */
export function buyerPrompts(prompts, stats, stage, tiers = STAGE_TIER, also = []) {
  // Cards written together with this one bring the prompts that led to their searches.
  const ids = new Set([...list(stats.promptIds), ...list(also).flatMap((c) => list(c.stats?.promptIds))])
  return list(prompts).filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, form: p.form, prompt: p.prompt, intent_tier: tiers[stage] || STAGE_TIER[stage] || 'Problem' }))
}
