import React, { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, MinusCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import ScoreGauge, { scoreTone, TONE_TEXT } from './ScoreGauge'
import { SECTIONS, SECTION_ORDER, KIND_LABELS, EFFORT_LABELS } from '../../../../lib/audit/catalog.js'
import { SEVERITY_LABELS } from '../../../../lib/audit/categories.js'

const SEVERITY_STYLE = {
  critical: 'bg-red-600 text-white',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  low: 'bg-muted text-muted-foreground',
}

const STATUS_META = {
  fail: { label: 'Fail', icon: XCircle, className: 'text-red-600 dark:text-red-400' },
  warning: { label: 'Warning', icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400' },
  pass: { label: 'Pass', icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  not_tested: { label: 'Not tested', icon: CircleDashed, className: 'text-muted-foreground' },
  na: { label: 'Not applicable', icon: MinusCircle, className: 'text-muted-foreground' },
}

function Pill({ className, children }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium', className)}>
      {children}
    </span>
  )
}

function shortUrl(url) {
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return String(url || '')
  }
}

function Delta({ now, before }) {
  if (typeof now !== 'number' || typeof before !== 'number' || now === before) return null
  const up = now > before
  return (
    <span className={cn('text-[11px] font-medium tabular-nums', up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
      {up ? '▲' : '▼'} {Math.abs(now - before)}
    </span>
  )
}

/** Overall readiness + the five scores. */
export function ReadinessOverview({ readiness }) {
  if (!readiness) return null
  const prev = readiness.previous
  const resolved = readiness.changes?.resolved?.length || 0
  const introduced = readiness.changes?.introduced?.length || 0
  return (
    <section aria-label="Readiness overview" className="space-y-3">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card/40 p-4 lg:w-52">
          <ScoreGauge label="Website readiness" score={readiness.overall} />
          <Delta now={readiness.overall} before={prev?.overall} />
          <p className="text-center text-[11px] text-muted-foreground">
            {readiness.checksTested} of {readiness.checksTotal} checks tested
          </p>
          {readiness.overallCapped ? (
            <p className="text-center text-[11px] text-red-600 dark:text-red-400">Capped by a critical issue</p>
          ) : null}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {readiness.scores.map((s) => {
            const tone = scoreTone(s.score)
            return (
              <div key={s.id} className="min-w-0 space-y-1 rounded-lg border border-border p-3">
                <p className="truncate text-xs text-muted-foreground" title={s.label}>{s.short}</p>
                <div className="flex items-baseline gap-1.5">
                  <p className={cn('text-2xl font-semibold tabular-nums', TONE_TEXT[tone])}>{s.score ?? '—'}</p>
                  <Delta now={s.score} before={prev?.scores?.[s.id]} />
                </div>
                <div className="h-1 w-full rounded bg-muted" aria-hidden="true">
                  <div className="h-1 rounded bg-primary/60" style={{ width: `${Math.round((s.coverage || 0) * 100)}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {s.checksTested}/{s.checksTotal} tested
                  {s.fails ? ` · ${s.fails} fail` : ''}
                  {s.warnings ? ` · ${s.warnings} warn` : ''}
                </p>
                {s.capped ? <p className="text-[11px] text-red-600 dark:text-red-400">Critical issue</p> : null}
              </div>
            )
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {readiness.critical ? <span className="font-medium text-red-600 dark:text-red-400">{readiness.critical} critical · </span> : null}
        Scores count only checks that were run; untested checks earn nothing and lower coverage instead.
        {prev ? ` Since the previous runs: ${resolved} resolved, ${introduced} new.` : ''}
      </p>
    </section>
  )
}

function ActionCard({ action }) {
  const [open, setOpen] = useState(false)
  const status = STATUS_META[action.status]
  const Icon = status.icon
  return (
    <li className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', status.className)} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{action.title || action.label}</span>
            <Pill className={SEVERITY_STYLE[action.severity]}>{SEVERITY_LABELS[action.severity]}</Pill>
            <Pill className="bg-muted text-muted-foreground">{KIND_LABELS[action.kind]}</Pill>
          </div>
          <p className="text-xs text-muted-foreground">
            {SECTIONS[action.section]} · {action.siteWide ? 'Site-wide' : `${action.affected} page${action.affected === 1 ? '' : 's'}`} · {EFFORT_LABELS[action.effort]}
          </p>
        </div>
        <ChevronRight className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2.5 text-xs">
          {action.detail ? <p className="text-muted-foreground">{action.detail}</p> : null}
          <p><span className="font-medium">Why it matters: </span>{action.why}</p>
          {action.fix ? <p><span className="font-medium">Fix: </span>{action.fix}</p> : null}
          <p><span className="font-medium">How to verify: </span>{action.verify}</p>
          {action.urls?.length ? (
            <ul className="space-y-0.5">
              {action.urls.slice(0, 10).map((u) => (
                <li key={u} className="truncate">
                  <a href={u} target="_blank" rel="noreferrer" className="hover:underline" title={u}>{shortUrl(u)}</a>
                </li>
              ))}
              {action.affected > 10 ? <li className="text-muted-foreground">+{action.affected - 10} more in the run details below</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

const TIERS = [
  { id: 'fix_first', label: 'Fix first', hint: 'Critical and high-impact failures that affect the scores.' },
  { id: 'next', label: 'Then', hint: 'Medium-impact failures that affect the scores.' },
  { id: 'improve', label: 'Improvements & experiments', hint: 'Recommendations, low-impact warnings and emerging practices.' },
]

/** Prioritized remediation list. */
export function RecommendedActions({ actions }) {
  const list = actions || []
  if (!list.length) {
    return (
      <section aria-label="Recommended actions" className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Recommended actions</h2>
        <p className="mt-1 text-xs text-muted-foreground">Nothing to fix in the checks that ran.</p>
      </section>
    )
  }
  return (
    <section aria-label="Recommended actions" className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold">Recommended actions</h2>
      {TIERS.map((tier) => {
        const items = list.filter((a) => a.tier === tier.id)
        if (!items.length) return null
        return (
          <div key={tier.id} className="space-y-1.5">
            <div>
              <p className="text-xs font-medium">{tier.label} <span className="text-muted-foreground">({items.length})</span></p>
              <p className="text-[11px] text-muted-foreground">{tier.hint}</p>
            </div>
            <ol className="space-y-1.5">
              {items.map((a) => (
                <ActionCard key={a.id} action={a} />
              ))}
            </ol>
          </div>
        )
      })}
    </section>
  )
}

const FILTERS = [
  { id: 'issues', label: 'Issues', match: (r) => r.status === 'fail' || r.status === 'warning' },
  { id: 'working', label: "What's working", match: (r) => r.status === 'pass' },
  { id: 'not_tested', label: 'Not tested', match: (r) => r.status === 'not_tested' || r.status === 'na' },
  { id: 'all', label: 'All checks', match: () => true },
]

/** Every check grouped by framework section, filterable. */
export function ChecksBySection({ checks }) {
  const [filter, setFilter] = useState('issues')
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, (checks || []).filter(f.match).length])),
    [checks]
  )
  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0]
  const visible = (checks || []).filter(active.match)
  return (
    <section aria-label="Detailed audit" className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Detailed audit</h2>
        <div role="group" aria-label="Filter checks" className="inline-flex flex-wrap rounded-md border border-border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f.label} ({counts[f.id]})
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">No checks in this view.</p>
      ) : (
        <div className="space-y-4">
          {SECTION_ORDER.map((section) => {
            const rows = visible.filter((r) => r.section === section)
            if (!rows.length) return null
            return (
              <div key={section} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {/^[A-L]$/.test(section) ? `${section} · ` : ''}{SECTIONS[section]}
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {rows.map((r) => {
                    const meta = STATUS_META[r.status]
                    const Icon = meta.icon
                    return (
                      <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                        <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.className)} aria-label={meta.label} />
                        <div className="min-w-0 flex-1">
                          <p className={r.status === 'pass' ? '' : 'font-medium'}>
                            {r.status === 'fail' || r.status === 'warning' ? r.title || r.label : r.label}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {r.status === 'not_tested' || r.status === 'na'
                              ? r.reason
                              : r.status === 'pass'
                                ? r.why
                                : `${r.siteWide ? 'Site-wide' : `${r.affected} page(s)`} · ${r.why}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {!r.score ? <Pill className="bg-muted text-muted-foreground">Not scored</Pill> : null}
                          {r.kind !== 'confirmed' && r.kind !== 'info' ? (
                            <Pill className="bg-muted text-muted-foreground">{KIND_LABELS[r.kind]}</Pill>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
