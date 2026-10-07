import React, { useMemo, useState } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SEVERITIES, SEVERITY_LABELS } from '../../../../lib/audit/categories.js'

const ROW_LIMIT = 50

const SEVERITY_STYLE = {
  critical: 'bg-red-600 text-white',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  low: 'bg-muted text-muted-foreground',
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

/** @param {{ severity: string }} props */
function SeverityPill({ severity }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        SEVERITY_STYLE[severity] || SEVERITY_STYLE.low
      )}
    >
      {SEVERITY_LABELS[severity] || severity}
    </span>
  )
}

/** @param {{ diff?: string }} props */
function DiffTag({ diff }) {
  if (diff === 'new') {
    return <span className="text-[10px] font-semibold uppercase text-red-600 dark:text-red-400">New</span>
  }
  if (diff === 'persisting') {
    return <span className="text-[10px] uppercase text-muted-foreground">Persisting</span>
  }
  return null
}

/** @param {string | null | undefined} url */
function shortUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}` || '/'
  } catch {
    return url
  }
}

/** @param {any[]} issues */
function groupByCheck(issues) {
  const map = new Map()
  for (const issue of issues) {
    const group = map.get(issue.check_id) || {
      checkId: issue.check_id,
      title: issue.title,
      severity: issue.severity,
      fixHint: issue.fix_hint || '',
      items: [],
    }
    if (SEVERITY_RANK[issue.severity] < SEVERITY_RANK[group.severity]) group.severity = issue.severity
    if (!group.fixHint && issue.fix_hint) group.fixHint = issue.fix_hint
    group.items.push(issue)
    map.set(issue.check_id, group)
  }
  return [...map.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.items.length - a.items.length
  )
}

/**
 * @param {{
 *   group: { checkId: string, title: string, severity: string, fixHint: string, items: any[] },
 *   pendingAccept: Set<string>,
 *   onToggleAccepted: (issues: any[], accepted: boolean) => void,
 * }} props
 */
function IssueGroup({ group, pendingAccept, onToggleAccepted }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const newCount = group.items.filter((i) => i.diff === 'new').length
  const siteWide = group.items.length === 1 && !group.items[0].url
  const rows = showAll ? group.items : group.items.slice(0, ROW_LIMIT)
  const panelId = `issue-group-${group.checkId}`

  return (
    <li className="rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          <SeverityPill severity={group.severity} />
          <span className="min-w-0 truncate text-sm font-medium">{group.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {siteWide ? 'site-wide' : `${group.items.length} URL${group.items.length === 1 ? '' : 's'}`}
          </span>
          {newCount ? (
            <span className="shrink-0 text-[11px] text-red-600 dark:text-red-400">{newCount} new</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => onToggleAccepted(group.items, true)}
          disabled={group.items.some((i) => pendingAccept.has(i.fingerprint))}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          Accept all
        </button>
      </div>

      {open ? (
        <div id={panelId} className="border-t border-border px-3 py-2">
          {group.fixHint ? <p className="mb-2 text-xs text-muted-foreground">Fix: {group.fixHint}</p> : null}
          <ul className="divide-y divide-border">
            {rows.map((issue) => (
              <li key={issue.fingerprint} className="flex flex-wrap items-start gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  {issue.url ? (
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 text-xs font-medium hover:underline"
                    >
                      <span className="truncate">{shortUrl(issue.url)}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="sr-only">(opens in new tab)</span>
                    </a>
                  ) : null}
                  {issue.detail ? (
                    <p className="break-words text-xs text-muted-foreground">{issue.detail}</p>
                  ) : null}
                </div>
                <DiffTag diff={issue.diff} />
                <button
                  type="button"
                  disabled={pendingAccept.has(issue.fingerprint)}
                  onClick={() => onToggleAccepted([issue], true)}
                  className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-6 px-2 text-[11px]')}
                >
                  Accept
                </button>
              </li>
            ))}
          </ul>
          {group.items.length > ROW_LIMIT ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'px-0')}
            >
              {showAll ? 'Show fewer' : `Show all ${group.items.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Issues for one category: filters, grouped by check, plus Fixed and Accepted lists.
 * @param {{
 *   issues: any[],
 *   fixed: any[],
 *   accepted: any[],
 *   hasPrevious: boolean,
 *   pendingAccept: Set<string>,
 *   onToggleAccepted: (issues: any[], accepted: boolean) => void,
 * }} props
 */
export default function IssueList({ issues, fixed, accepted, hasPrevious, pendingAccept, onToggleAccepted }) {
  const [severity, setSeverity] = useState('all')
  const [diffFilter, setDiffFilter] = useState('all')
  const [showFixed, setShowFixed] = useState(false)
  const [showAccepted, setShowAccepted] = useState(false)

  const filtered = useMemo(
    () =>
      (issues || []).filter(
        (i) => (severity === 'all' || i.severity === severity) && (diffFilter === 'all' || i.diff === diffFilter)
      ),
    [issues, severity, diffFilter]
  )
  const groups = useMemo(() => groupByCheck(filtered), [filtered])

  const selectClass =
    'h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Severity
          <select className={selectClass} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">All</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {hasPrevious ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Change
            <select className={selectClass} value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="new">New</option>
              <option value="persisting">Persisting</option>
            </select>
          </label>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {filtered.length} open issue{filtered.length === 1 ? '' : 's'} in {groups.length} check
          {groups.length === 1 ? '' : 's'}
        </span>
      </div>

      {groups.length ? (
        <ul className="space-y-2">
          {groups.map((group) => (
            <IssueGroup
              key={group.checkId}
              group={group}
              pendingAccept={pendingAccept}
              onToggleAccepted={onToggleAccepted}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {issues?.length ? 'No issues match these filters.' : 'No open issues.'}
        </p>
      )}

      {fixed?.length ? (
        <div>
          <button
            type="button"
            onClick={() => setShowFixed((v) => !v)}
            aria-expanded={showFixed}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {showFixed ? 'Hide' : 'Show'} {fixed.length} fixed since last run
          </button>
          {showFixed ? (
            <ul className="mt-2 space-y-1">
              {fixed.map((issue) => (
                <li key={issue.fingerprint} className="text-xs text-muted-foreground">
                  <span className="text-foreground/80">{issue.title}</span>
                  {issue.url ? ` — ${shortUrl(issue.url)}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {accepted?.length ? (
        <div>
          <button
            type="button"
            onClick={() => setShowAccepted((v) => !v)}
            aria-expanded={showAccepted}
            className="text-xs font-medium text-muted-foreground hover:underline"
          >
            {showAccepted ? 'Hide' : 'Show'} {accepted.length} accepted
          </button>
          {showAccepted ? (
            <ul className="mt-2 space-y-1">
              {accepted.map((issue) => (
                <li key={issue.fingerprint} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {issue.title}
                    {issue.url ? ` — ${shortUrl(issue.url)}` : ''}
                  </span>
                  <button
                    type="button"
                    disabled={pendingAccept.has(issue.fingerprint)}
                    onClick={() => onToggleAccepted([issue], false)}
                    className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-6 px-2 text-[11px]')}
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
