// Fan-Out Engine: Baseline versus a later Run. Everything here is counted from the two Runs' measurements.

import { FORMS } from './core.js'
import { verdict } from './score.js'

const list = (v) => (Array.isArray(v) ? v : [])

/** "Moved" means the brand went from being named in fewer than half of the runs for that Query Group to half or more. */
export function movedVerdict(before, now, cutoff = 0.5) {
  const was = before?.of ? before.named / before.of : 0
  const is = now?.of ? now.named / now.of : 0
  return was < cutoff && is >= cutoff
}

const line = (label, before, now) => (before && now ? { label, before, now, ...verdict(before, now) } : null)

/**
 * The three parts of the comparison between two scored Runs (as the score action returns them):
 * 1. did the score move, 2. (with `cards`) did what we wrote work, 3. what changed around us.
 */
export function compareRuns(before, now, { cards = [], cutoff = 0.5 } = {}) {
  const a = before.score
  const b = now.score
  const own = a.own && b.own
  const scores = own
    ? [
        line('Mentioned', a.own.mentioned, b.own.mentioned),
        line('First named', a.own.first, b.own.first),
        line('Recommended', a.own.recommended, b.own.recommended),
        ...FORMS.map((f) => line(`Mentioned, ${f} prompts`, a.own.byType[f], b.own.byType[f])),
      ].filter(Boolean)
    : []
  const brands = list(b.brands)
    .map((nb) => {
      const ob = list(a.brands).find((x) => x.id === nb.id)
      return ob ? { id: nb.id, name: nb.name, own: nb.own, rankBefore: ob.mentioned.x ? ob.rank : null, rankNow: nb.mentioned.x ? nb.rank : null, ...verdict(ob.mentioned, nb.mentioned), before: ob.mentioned, now: nb.mentioned } : null
    })
    .filter(Boolean)
  const rivals = brands.filter((x) => !x.own)
  const ownRow = brands.find((x) => x.own) || null
  // If everyone moved the same way, the cause is probably ChatGPT, not us.
  const movedRivals = rivals.filter((x) => x.real)
  const active = rivals.filter((x) => x.before.x || x.now.x)
  const together = Boolean(ownRow?.real) && active.length >= 2 && movedRivals.filter((x) => Math.sign(x.change) === Math.sign(ownRow.change)).length >= Math.ceil(active.length / 2)
  const modelChanged = Boolean(a.model && b.model && a.model !== b.model)

  const nowGroups = Object.fromEntries(list(now.groups?.all).map((g) => [g.id, g]))
  const oldGroups = Object.fromEntries(list(before.groups?.all).map((g) => [g.id, g]))
  const acted = list(cards)
    // Every acted-on card is judged on its own Query Group, a merged one too: the same rule the Insights bank uses.
    .filter((c) => c.kind === 'opportunity' && ['acted_on', 'done'].includes(c.status) && c.acted_on_at && new Date(c.acted_on_at) < new Date(now.started_at))
    .map((c) => {
      const g = nowGroups[c.group_id]
      const was = c.stats?.standing || { named: 0, of: 0 }
      const is = g ? g.standing : { named: 0, of: 0 }
      return {
        cardId: c.id,
        label: c.stats?.label || g?.label || '',
        action: c.action,
        url: c.acted_url || '',
        actedAt: c.acted_on_at,
        before: was,
        now: is,
        searched: Boolean(g),
        cited: Boolean(g && c.acted_url && list(g.ownCited).some((p) => sameUrl(p.url, c.acted_url))),
        moved: Boolean(g) && movedVerdict(was, is, cutoff),
      }
    })

  const around = {
    newGroups: list(now.groups?.all).filter((g) => g.isNew && !oldGroups[g.id]).map((g) => ({ id: g.id, label: g.label, verdict: g.verdict, signal: g.signal })),
    slipped: list(now.groups?.all).filter((g) => oldGroups[g.id]?.verdict === 'Win' && g.verdict === 'Opportunity').map((g) => ({ id: g.id, label: g.label, before: oldGroups[g.id].standing, now: g.standing })),
    rose: rivals.filter((x) => x.real && x.change > 0).map((x) => ({ name: x.name, change: x.change, now: x.now.pct })),
    fell: rivals.filter((x) => x.real && x.change < 0).map((x) => ({ name: x.name, change: x.change, now: x.now.pct })),
  }
  return {
    scores,
    rank: ownRow ? { before: ownRow.rankBefore, now: ownRow.rankNow, of: list(b.brands).length } : null,
    brands,
    modelChanged,
    models: { before: a.model, now: b.model },
    together,
    acted,
    around,
    runs: { before: a.runs, now: b.runs },
  }
}

const clean = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
/** Two addresses of the same page, whatever the protocol, "www", a trailing slash or tracking parameters. */
export function sameUrl(a, b) {
  return Boolean(clean(a)) && clean(a) === clean(b)
}

/** Is a Scenario due for its re-run? Its latest Run ended more than `days` ago (the reminder shows in the tool only). */
export function dueForRerun(lastRunAt, days = 30, today = new Date()) {
  if (!lastRunAt) return false
  return (today.getTime() - new Date(lastRunAt).getTime()) / 86_400_000 >= days
}
