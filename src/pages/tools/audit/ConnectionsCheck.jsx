import React, { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Info, Loader2, RefreshCw, X } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CONNECTIONS } from '../../../../lib/audit/categories.js'

const COLLAPSE_AFTER_MS = 1500

const STATUS_STYLE = {
  checking: { icon: Loader2, className: 'text-muted-foreground animate-spin', dot: 'bg-muted-foreground/50' },
  ok: { icon: Check, className: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' },
  warn: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
  fail: { icon: X, className: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  info: { icon: Info, className: 'text-muted-foreground', dot: 'bg-sky-500' },
}

const STATUS_WORD = {
  checking: 'Checking',
  ok: 'Connected',
  warn: 'Warning',
  fail: 'Failed',
  info: 'Info',
}

/** @param {{ status: string }} props */
function StatusIcon({ status }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.checking
  const Icon = style.icon
  return <Icon className={cn('h-4 w-4 shrink-0', style.className)} aria-hidden="true" />
}

/**
 * Live connection checklist. Expands while checking, then collapses to a
 * one-line status strip (stays open when something failed).
 * @param {{
 *   connections: Record<string, { status: string, detail: string }>,
 *   checking: boolean,
 *   onRecheck: () => void,
 * }} props
 */
export default function ConnectionsCheck({ connections, checking, onRecheck }) {
  const [expanded, setExpanded] = useState(true)
  const results = CONNECTIONS.map((c) => ({ ...c, ...(connections[c.id] || { status: 'checking', detail: '' }) }))
  const failed = results.filter((r) => r.status === 'fail').length
  const warned = results.filter((r) => r.status === 'warn').length
  const okCount = results.filter((r) => r.status === 'ok').length

  useEffect(() => {
    if (checking) {
      setExpanded(true)
      return undefined
    }
    if (failed > 0) return undefined
    const timer = setTimeout(() => setExpanded(false), COLLAPSE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [checking, failed])

  const groups = [...new Set(CONNECTIONS.map((c) => c.group))]
  const summary = checking
    ? 'Checking connections…'
    : `${okCount} connected${warned ? ` · ${warned} warning${warned === 1 ? '' : 's'}` : ''}${
        failed ? ` · ${failed} failed` : ''
      }`

  return (
    <section aria-label="Connections" className="rounded-lg border border-border bg-card/40">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="audit-connections-list"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="text-sm font-semibold">Connections</span>
          <span
            className={cn(
              'text-xs',
              failed && !checking ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
            )}
            aria-live="polite"
          >
            {summary}
          </span>
          {!expanded ? (
            <span className="ml-1 hidden flex-wrap items-center gap-1.5 sm:flex" aria-hidden="true">
              {results.map((r) => (
                <span
                  key={r.id}
                  title={`${r.label}: ${STATUS_WORD[r.status] || r.status}`}
                  className={cn('h-2 w-2 rounded-full', (STATUS_STYLE[r.status] || STATUS_STYLE.checking).dot)}
                />
              ))}
            </span>
          ) : null}
          <ChevronDown
            className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onRecheck}
          disabled={checking}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', checking && 'animate-spin')} aria-hidden="true" />
          Re-check
        </button>
      </div>

      {expanded ? (
        <div id="audit-connections-list" className="grid gap-4 border-t border-border px-4 py-3 md:grid-cols-2">
          {groups.map((group) => (
            <div key={group} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
              <ul className="space-y-1">
                {results
                  .filter((r) => r.group === group)
                  .map((r, i) => (
                    <li
                      key={r.id}
                      className="flex items-start gap-2 rounded-md px-1 py-1 animate-in fade-in slide-in-from-left-1"
                      style={{ animationDelay: `${i * 70}ms`, animationFillMode: 'both' }}
                    >
                      <StatusIcon status={r.status} />
                      <div className="min-w-0">
                        <p className="text-sm leading-tight">
                          {r.label}
                          <span className="sr-only"> — {STATUS_WORD[r.status] || r.status}</span>
                        </p>
                        {r.detail ? (
                          <p className="break-words text-xs text-muted-foreground">{r.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
