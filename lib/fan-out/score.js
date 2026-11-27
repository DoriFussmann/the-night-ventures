// Fan-Out Engine: the score. Measurement only: everything here is counted by fixed rules from the
// stored runs, so a Run can be recalculated when the brand list or the thresholds change.
// The one AI input is the mention label of a run (Recommended / Listed / Qualified), which is set once and saved.

import { isNamed, nameMatchers } from '../prompt-tests/derive.js'
import { FORMS, entityNames, parseJsonReply } from './core.js'

export const MENTION_LABELS = { recommended: 'Recommended', listed: 'Listed', qualified: 'Qualified' }
/** Labels per labeling request. */
export const LABEL_BATCH = 20
export const DEFAULT_THRESHOLDS = { strong: 0.5, occasional: 0.2 }

const list = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v)).trim()
const patternsOf = (b) => (list(b?.name_patterns).length ? b.name_patterns : [b?.name])

/** Strong / Occasional / Noise, from the share of runs something appears in. */
export function signalLabel(share, t = DEFAULT_THRESHOLDS) {
  if (share >= t.strong) return 'Strong'
  if (share >= t.occasional) return 'Occasional'
  return 'Noise'
}

/**
 * The margin of a share, in points (95%), from the actual counts. Two pseudo-runs each way keep it
 * honest at 0% and 100%: 0 of 63 is "about 0", not "certainly 0". At 63 runs it is roughly ±12.
 */
export function margin(x, n) {
  if (!n) return 0
  const p = (x + 2) / (n + 4)
  return Math.round(1.96 * Math.sqrt((p * (1 - p)) / (n + 4)) * 100)
}

/** A share with everything needed to show it: count, runs, percent and margin. */
export function share(x, n) {
  return { x, n, pct: n ? Math.round((x / n) * 100) : 0, margin: margin(x, n) }
}

/** A change is a Real move only if it exceeds the margin (the wider of the two); otherwise it is Within noise. */
export function verdict(before, now) {
  const change = now.pct - before.pct
  return { change, margin: Math.max(before.margin, now.margin), real: Math.abs(change) > Math.max(before.margin, now.margin) }
}

/** Where in the answer a tracked brand is first named, or -1. Uses the same match as "is it named". */
export function mentionIndex(answer, brand) {
  const raw = str(answer)
  if (!isNamed(raw, brand)) return -1
  // Lines the brand's exclude patterns rule out are blanked (not removed), so positions stay comparable between brands.
  const excludes = list(brand?.exclude_patterns).map((p) => str(p).toLowerCase()).filter(Boolean)
  const text = excludes.length ? raw.split('\n').map((line) => (excludes.some((x) => line.toLowerCase().includes(x)) ? ' '.repeat(line.length) : line)).join('\n') : raw
  const at = nameMatchers(patternsOf(brand)).map((re) => text.search(re)).filter((i) => i >= 0)
  return at.length ? Math.min(...at) : -1
}

const escapeRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A name as a whole word, any case: "Bench" does not match inside "benchmark". */
const wholeWord = (name) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu')

/**
 * Every brand in one answer, in the order it appears: tracked brands (own and competitors, by name match)
 * and the brands ChatGPT itself tagged that are not on the tracked list ("discovered").
 * @returns {Array<{ key: string, name: string, brandId: string, own: boolean, tracked: boolean, pos: number }>}
 */
export function namedOrder(run, brands) {
  const answer = str(run?.answer)
  const out = []
  // A tagged brand that is a tracked brand under any of its names, in any case, is that tracked brand.
  const trackedNames = new Set(list(brands).flatMap((b) => [b.name, ...list(b.name_patterns)]).map((x) => str(x).toLowerCase()).filter(Boolean))
  const trackedRes = list(brands).map((b) => nameMatchers(patternsOf(b)))
  for (const b of list(brands)) {
    const pos = mentionIndex(answer, b)
    if (pos >= 0) out.push({ key: `b:${b.id}`, name: str(b.name), brandId: b.id, own: Boolean(b.is_own), tracked: true, pos })
  }
  const seen = new Set()
  for (const name of entityNames(run)) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (trackedNames.has(key) || trackedRes.some((res) => res.some((re) => re.test(name)))) continue
    const m = wholeWord(name).exec(answer)
    const at = m ? m.index + m[1].length : -1
    // Tagged by ChatGPT but not found as plain text (for example inside a link): it is in the answer, after the ones we can place.
    out.push({ key: `d:${key}`, name, brandId: '', own: false, tracked: false, pos: at >= 0 ? at : answer.length + out.length })
  }
  return out.sort((a, b) => a.pos - b.pos)
}

const labelOf = (run, brandId) => {
  const l = str(run?.mention_labels?.[brandId]?.label).toLowerCase()
  return MENTION_LABELS[l] ? l : ''
}

/**
 * The score of one Run, for every tracked brand.
 * Mentioned: % of runs where the brand is named. First named: % of runs where it is the first of all brands
 * seen, tracked and discovered. Recommended: % of runs labeled "recommended" for it. By prompt type: Mentioned.
 * @param {Array<object>} runs captures of one Run (failed ones are ignored)
 * @param {Array<object>} brands tracked brands
 */
export function scoreRuns(runs, brands, thresholds = DEFAULT_THRESHOLDS) {
  const ok = list(runs).filter((r) => r.status === 'ok')
  const n = ok.length
  const orders = ok.map((r) => namedOrder(r, brands))
  const rows = list(brands).map((b) => {
    const key = `b:${b.id}`
    const namedIn = ok.map((r, i) => orders[i].some((o) => o.key === key))
    const count = (f) => ok.filter((r, i) => f(r, i)).length
    const labels = { recommended: 0, listed: 0, qualified: 0, unlabeled: 0 }
    const quotes = []
    ok.forEach((r, i) => {
      if (!namedIn[i]) return
      const l = labelOf(r, b.id)
      labels[l || 'unlabeled'] += 1
      const quote = str(r.mention_labels?.[b.id]?.quote)
      if (l && quote && quotes.length < 20) quotes.push({ label: l, quote, form: r.prompt_form || '' })
    })
    const byType = {}
    for (const form of FORMS) {
      const of = ok.map((r, i) => i).filter((i) => ok[i].prompt_form === form)
      if (of.length) byType[form] = share(of.filter((i) => namedIn[i]).length, of.length)
    }
    return {
      id: b.id,
      name: str(b.name),
      own: Boolean(b.is_own),
      mentioned: share(count((r, i) => namedIn[i]), n),
      first: share(count((r, i) => orders[i][0]?.key === key), n),
      recommended: share(labels.recommended, n),
      byType,
      labels,
      quotes, // the phrases behind the labels, as quoted from the answers
    }
  })
  const ranked = [...rows].sort((a, b) => b.mentioned.x - a.mentioned.x || b.first.x - a.first.x || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name))
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].mentioned.x === r.mentioned.x ? ranked[i - 1].rank : i + 1 })
  const own = ranked.find((r) => r.own) || null
  const leader = ranked[0] || null
  const found = new Map()
  orders.forEach((order) => {
    for (const o of order) {
      if (o.tracked) continue
      const row = found.get(o.key) || { name: o.name, runs: 0 }
      row.runs += 1
      found.set(o.key, row)
    }
  })
  const models = {}
  for (const r of ok) if (r.model) models[r.model] = (models[r.model] || 0) + 1
  return {
    runs: n,
    failed: list(runs).length - n,
    searched: share(ok.filter((r) => r.searched).length, n),
    brands: ranked,
    own,
    leader: leader && leader.mentioned.x > 0 ? { name: leader.name, own: leader.own, pct: leader.mentioned.pct } : null,
    gap: own && leader ? leader.mentioned.pct - own.mentioned.pct : null,
    discovered: [...found.values()]
      .map((d) => ({ ...d, pct: n ? Math.round((d.runs / n) * 100) : 0, signal: signalLabel(n ? d.runs / n : 0, thresholds) }))
      .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, 30),
    model: Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    models,
  }
}

/* ---------- mention labels (AI, fixed labels with a quote) ---------- */

/** Markdown marks and odd quotes out, spaces collapsed; line breaks kept, because they separate statements. */
const plain = (s) => str(s).replace(/[*_`#>|]/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[ \t]+/g, ' ').replace(/ *\n+ */g, '\n').trim()

/**
 * Is this quote really in the answer, and is it about this brand? It must be at least two words, appear in the
 * answer word for word, and either name the brand itself or sit in a statement (sentence or line) that names it.
 * A statement right under a line that names the brand counts too, as long as it names no other brand.
 */
export function quoteFits(answer, quote, brand, others = []) {
  const text = plain(answer)
  const q = plain(quote).replace(/\n/g, ' ')
  if (q.split(' ').filter(Boolean).length < 2) return false
  const named = (t, b) => nameMatchers(patternsOf(b)).some((re) => re.test(t))
  const parts = text.split(/\n|(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean)
  const lower = q.toLowerCase()
  for (let i = 0; i < parts.length; i += 1) {
    // The quote may run over two statements.
    const here = parts[i]
    const pair = i + 1 < parts.length ? `${here} ${parts[i + 1]}` : here
    const inHere = here.toLowerCase().includes(lower)
    if (!inHere && (i + 1 >= parts.length || parts[i + 1].toLowerCase().includes(lower) || !pair.toLowerCase().includes(lower))) continue
    const span = inHere ? here : pair
    if (named(span, brand)) return true
    const rivals = list(others).filter((o) => o.id !== brand.id)
    if (i > 0 && named(parts[i - 1], brand) && !rivals.some((o) => named(span, o) || named(parts[i - 1], o))) return true
  }
  return false
}

/** The lines of an answer that name any of the brands, with the line before and after each, for the labeling request. */
export function mentionExcerpt(answer, brands, max = 4000) {
  const lines = str(answer).split('\n')
  const res = list(brands).flatMap((b) => nameMatchers(patternsOf(b)))
  const keep = new Set()
  lines.forEach((line, i) => {
    if (res.some((re) => re.test(line))) [i - 1, i, i + 1].forEach((k) => k >= 0 && k < lines.length && keep.add(k))
  })
  const out = []
  let last = -2
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > last + 1 && out.length) out.push('[…]')
    if (lines[i].trim()) out.push(lines[i])
    last = i
  }
  return out.join('\n').slice(0, max)
}

/** Which mentions of a set of runs still need a label: [{ run, brands: [brand] }]. */
export function unlabeled(runs, brands) {
  return list(runs)
    .filter((r) => r.status === 'ok')
    .map((r) => ({ run: r, brands: list(brands).filter((b) => mentionIndex(r.answer, b) >= 0 && !labelOf(r, b.id)) }))
    .filter((x) => x.brands.length)
}

/** Splits the mentions to label into requests of `max` labels at most, so a reply is never cut off. */
export function labelBatches(todo, max = LABEL_BATCH) {
  const out = []
  let batch = []
  let n = 0
  for (const x of list(todo)) {
    if (batch.length && n + x.brands.length > max) {
      out.push(batch)
      batch = []
      n = 0
    }
    batch.push(x)
    n += x.brands.length
  }
  if (batch.length) out.push(batch)
  return out
}

/** One labeling request for a batch of [{ run, brands }]. Runs are called r1, r2, … in the request. */
export function buildLabelPrompt(batch, template) {
  const blocks = batch.map((x, i) => [`--- r${i + 1} · brands to label: ${x.brands.map((b) => b.name).join(', ')}`, mentionExcerpt(x.run.answer, x.brands)].join('\n'))
  return str(template).replace('{answers}', blocks.join('\n\n'))
}

/**
 * The labels of a reply, checked. "Recommended" and "Qualified" count only with a quote that is really in that
 * answer and is about that brand; otherwise the mention is Listed with no quote (never Recommended on the AI's
 * word alone). A brand the reply left out gets no label, so it is asked again later.
 * @param {Array<object>} [allBrands] every tracked brand, to tell whose statement a quote is
 * @returns {Array<{ runId: string, brandId: string, label: string, quote: string }>}
 */
export function parseLabels(text, batch, allBrands = []) {
  const given = list(parseJsonReply(text).labels)
  const out = []
  batch.forEach((x, i) => {
    for (const b of x.brands) {
      const names = new Set([b.name, ...list(b.name_patterns)].map((n) => str(n).toLowerCase()).filter(Boolean))
      const hit = given.find((g) => str(g?.run).toLowerCase() === `r${i + 1}` && names.has(str(g?.brand).toLowerCase()))
      if (!hit) continue
      let label = str(hit.label).toLowerCase()
      let quote = str(hit.quote).slice(0, 300)
      if (!MENTION_LABELS[label]) label = 'listed'
      const fits = quoteFits(x.run.answer, quote, b, allBrands.length ? allBrands : x.brands)
      if (label !== 'listed' && !fits) label = 'listed'
      if (!fits) quote = ''
      out.push({ runId: x.run.id, brandId: b.id, label, quote })
    }
  })
  return out
}
