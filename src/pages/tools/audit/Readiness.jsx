import React, { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, MinusCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import ScoreGauge, { scoreTone, TONE_TEXT } from './ScoreGauge'
import Panel from './Panel'
import { SECTIONS, SECTION_ORDER, EFFORT_LABELS } from '../../../../lib/audit/catalog.js'
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
    <section aria-label="Readiness overview" className="flex flex-col gap-3 lg:flex-row">
      <div className="flex shrink-0 items-center justify-center gap-4 rounded-lg border border-border bg-card/40 p-4 lg:w-72">
        <ScoreGauge label="Website readiness" score={readiness.overall} size={96} />
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <Delta now={readiness.overall} before={prev?.overall} />
          <p>
            {readiness.checksTested} of {readiness.checksTotal} checks tested
          </p>
          {prev && (resolved || introduced) ? (
            <p>
              <span className="text-emerald-600 dark:text-emerald-400">{resolved} resolved</span> ·{' '}
              <span className={introduced ? 'text-red-600 dark:text-red-400' : ''}>{introduced} new</span>
            </p>
          ) : null}
          {readiness.overallCapped ? <p className="text-red-600 dark:text-red-400">Capped by a critical issue</p> : null}
        </div>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {readiness.scores.map((s) => (
          <div key={s.id} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3" title={s.label}>
            <p className="truncate text-xs text-muted-foreground">{s.short}</p>
            <div className="flex items-baseline gap-1.5">
              <p className={cn('text-3xl font-semibold tabular-nums', TONE_TEXT[scoreTone(s.score)])}>{s.score ?? '—'}</p>
              <Delta now={s.score} before={prev?.scores?.[s.id]} />
            </div>
            <div
              className="mt-auto h-1 w-full rounded bg-muted"
              role="img"
              aria-label={`${s.checksTested} of ${s.checksTotal} checks tested`}
            >
              <div className="h-1 rounded bg-primary/60" style={{ width: `${Math.round((s.coverage || 0) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {s.checksTested}/{s.checksTotal} tested
              {s.fails ? ` · ${s.fails} fail` : ''}
              {s.warnings ? ` · ${s.warnings} warn` : ''}
            </p>
            {s.capped ? <p className="text-[11px] text-red-600 dark:text-red-400">Critical issue</p> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

const URLS_PREVIEW = 5

function affectedText(item) {
  return item.siteWide ? 'Site-wide' : `${item.affected} page${item.affected === 1 ? '' : 's'}`
}

function UrlList({ urls, affected }) {
  const [all, setAll] = useState(false)
  if (!urls?.length) return null
  const shown = all ? urls : urls.slice(0, URLS_PREVIEW)
  const unlisted = Math.max(0, (affected || 0) - urls.length)
  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {shown.map((u) => (
          <li key={u} className="truncate">
            <a href={u} target="_blank" rel="noreferrer" className="hover:underline" title={u}>{shortUrl(u)}</a>
          </li>
        ))}
      </ul>
      {urls.length > URLS_PREVIEW ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="text-primary hover:underline">
          {all ? 'Show fewer' : `Show all ${urls.length}`}
        </button>
      ) : null}
      {all && unlisted ? <p className="text-muted-foreground">+{unlisted} more (full list in the downloaded report)</p> : null}
    </div>
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
        className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className={cn('h-4 w-4 shrink-0', status.className)} aria-label={status.label} />
        <span className="min-w-0 flex-1 truncate text-sm">{action.title || action.label}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{affectedText(action)}</span>
        {action.kind === 'experimental' ? <Pill className="bg-muted text-muted-foreground">Experimental</Pill> : null}
        <Pill className={SEVERITY_STYLE[action.severity]}>{SEVERITY_LABELS[action.severity]}</Pill>
        <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2.5 text-xs">
          <p className="text-muted-foreground">
            {SECTIONS[action.section]} · {affectedText(action)} · {EFFORT_LABELS[action.effort]}
            {action.detail ? ` — ${action.detail}` : ''}
          </p>
          <p><span className="font-medium">Why it matters: </span>{action.why}</p>
          {action.fix ? <p><span className="font-medium">Fix: </span>{action.fix}</p> : null}
          <p><span className="font-medium">How to verify: </span>{action.verify}</p>
          <UrlList urls={action.urls} affected={action.affected} />
        </div>
      ) : null}
    </li>
  )
}

const TIERS = [
  { id: 'fix_first', label: 'Fix first' },
  { id: 'next', label: 'Fix next' },
  { id: 'improve', label: 'Improvements & experiments' },
  { id: 'outside', label: 'Content, AI visibility & authority (not in the scores)' },
]

/** Prioritized remediation list, collapsed by default. */
export function RecommendedActions({ actions }) {
  const list = actions || []
  const count = (...tiers) => list.filter((a) => tiers.includes(a.tier)).length
  const toFix = count('fix_first', 'next')
  const improve = count('improve')
  const outside = count('outside')
  const summary = list.length
    ? [
        toFix && `${toFix} to fix`,
        improve && `${improve} improvement${improve === 1 ? '' : 's'}`,
        outside && `${outside} content & visibility`,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Nothing to fix in the checks that ran'
  return (
    <Panel title="Recommended actions" summary={summary}>
      {list.length ? (
        <div className="space-y-4">
          {TIERS.map((tier) => {
            const items = list.filter((a) => a.tier === tier.id)
            if (!items.length) return null
            return (
              <div key={tier.id} className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {tier.label} ({items.length})
                </p>
                <ol className="space-y-1.5">
                  {items.map((a) => (
                    <ActionCard key={a.id} action={a} />
                  ))}
                </ol>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing to fix in the checks that ran.</p>
      )}
    </Panel>
  )
}

const FILTERS = [
  { id: 'issues', label: 'Issues', match: (r) => r.status === 'fail' || r.status === 'warning' },
  { id: 'working', label: "What's working", match: (r) => r.status === 'pass' },
  { id: 'not_tested', label: 'Not tested', match: (r) => r.status === 'not_tested' || r.status === 'na' },
  { id: 'all', label: 'All', match: () => true },
]

function rowDetail(r) {
  if (r.status === 'not_tested' || r.status === 'na') return r.reason
  if (r.status === 'pass') return null
  return [affectedText(r), r.detail].filter(Boolean).join(' · ')
}

/** Every check grouped by framework section, filterable. Collapsed by default. */
export function ChecksBySection({ checks }) {
  const [filter, setFilter] = useState('issues')
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, (checks || []).filter(f.match).length])),
    [checks]
  )
  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0]
  const visible = (checks || []).filter(active.match)
  return (
    <Panel
      title="Detailed audit"
      summary={`${counts.issues} issue${counts.issues === 1 ? '' : 's'} · ${counts.working} passing · ${counts.not_tested} not tested`}
    >
      <div className="space-y-3">
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
        {visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">No checks in this view.</p>
        ) : (
          <div className="space-y-3">
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
                      const detail = rowDetail(r)
                      return (
                        <li key={r.id} className="flex items-start gap-2 px-3 py-1.5 text-xs" title={r.why}>
                          <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.className)} aria-label={meta.label} />
                          <div className="min-w-0 flex-1">
                            <p>{r.status === 'fail' || r.status === 'warning' ? r.title || r.label : r.label}</p>
                            {detail ? <p className="truncate text-[11px] text-muted-foreground">{detail}</p> : null}
                          </div>
                          {r.kind === 'experimental' ? (
                            <Pill className="bg-muted text-muted-foreground">Experimental</Pill>
                          ) : !r.score ? (
                            <Pill className="bg-muted text-muted-foreground">Info only</Pill>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Panel>
  )
}
