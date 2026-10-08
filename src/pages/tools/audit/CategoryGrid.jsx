import React from 'react'
import { Play, Square } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CATEGORIES } from '../../../../lib/audit/categories.js'
import { scoreTone, TONE_TEXT } from './ScoreGauge'

/** @param {string | null | undefined} iso */
export function formatRunAt(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** @param {number | null | undefined} value */
export function formatCost(value) {
  const n = Number(value) || 0
  return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}

/**
 * @param {{ progress?: { done?: number, total?: number | null, message?: string } }} props
 */
function RunProgress({ progress = {} }) {
  const total = Number(progress.total) || 0
  const done = Number(progress.done) || 0
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
  return (
    <div className="space-y-1.5">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-label="Run progress"
      >
        <div
          className={cn('h-full rounded-full bg-primary transition-all', pct == null && 'w-1/3 animate-pulse')}
          style={pct == null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="truncate text-[11px] text-muted-foreground" aria-live="polite">
        {progress.message || 'Working…'}
      </p>
    </div>
  )
}

/**
 * Score cards with per-category Run buttons.
 * @param {{
 *   stateCategories: Record<string, any>,
 *   liveRuns: Record<string, any>,
 *   runErrors: Record<string, string>,
 *   busy: boolean,
 *   runnable: (id: string) => boolean,
 *   blockedBy: (id: string) => string[],
 *   onRun: (id: string) => void,
 *   onCancel: (id: string) => void,
 *   onSelect: (id: string) => void,
 *   selected: string,
 * }} props
 */
export default function CategoryGrid({
  stateCategories,
  liveRuns,
  runErrors,
  busy,
  runnable,
  blockedBy,
  onRun,
  onCancel,
  onSelect,
  selected,
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CATEGORIES.map((category) => {
        const entry = stateCategories?.[category.id] || {}
        const live = liveRuns[category.id]
        const blocked = blockedBy(category.id)
        const canRun = runnable(category.id)
        const score = entry.score
        const tone = scoreTone(score)
        const diff = entry.diffCounts
        const reason = !category.implemented
          ? 'Coming in the next package'
          : blocked.length
            ? `Blocked: ${blocked.join(', ')} failing`
            : ''
        const runError = runErrors[category.id]

        return (
          <li
            key={category.id}
            className={cn(
              'flex flex-col gap-3 rounded-lg border bg-card/40 p-4',
              selected === category.id ? 'border-primary/60' : 'border-border',
              !category.implemented && 'opacity-60'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelect(category.id)}
                disabled={!entry.latest}
                className="min-w-0 text-left disabled:cursor-default"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category.label}
                </p>
                <p className={cn('mt-1 text-2xl font-semibold tabular-nums', TONE_TEXT[tone])}>
                  {score == null ? '—' : score}
                </p>
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground">weight {category.weight}%</span>
            </div>

            {live ? (
              <RunProgress progress={live.progress} />
            ) : (
              <div className="min-h-[2.25rem] space-y-0.5 text-[11px] text-muted-foreground">
                {entry.latest ? (
                  <p>
                    {formatRunAt(entry.latest.finished_at || entry.latest.started_at)}
                    {category.paid ? ` · ${formatCost(entry.latest.cost_usd)}` : ''}
                  </p>
                ) : (
                  <p>{category.implemented ? 'Not run yet' : category.description}</p>
                )}
                {diff ? (
                  <p>
                    <span className="text-red-600 dark:text-red-400">{diff.new} new</span> · {diff.persisting}{' '}
                    persisting · <span className="text-emerald-600 dark:text-emerald-400">{diff.fixed} fixed</span>
                  </p>
                ) : null}
              </div>
            )}

            {runError && !live ? (
              <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">
                {runError}
              </p>
            ) : null}

            <div className="mt-auto">
              {live ? (
                <button
                  type="button"
                  onClick={() => onCancel(category.id)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
                >
                  <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onRun(category.id)}
                  disabled={busy || !canRun}
                  title={reason || undefined}
                  aria-describedby={reason ? `audit-reason-${category.id}` : undefined}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Run
                </button>
              )}
              {reason && !live ? (
                <p id={`audit-reason-${category.id}`} className="mt-1 text-[11px] text-muted-foreground">
                  {reason}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
