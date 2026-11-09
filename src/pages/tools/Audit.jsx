import React from 'react'
import { useParams } from 'react-router-dom'
import { Download, Loader2, Play } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CATEGORIES, categoryById } from '../../../lib/audit/categories.js'
import { ReadinessOverview, RecommendedActions, ChecksBySection } from './audit/Readiness'
import ConnectionsCheck from './audit/ConnectionsCheck'
import SourcePanels from './audit/SourcePanels'
import { buildAuditMarkdown, buildActionsMarkdown, downloadFile, reportFilename } from './audit/report'
import { useAuditRunner } from './audit/useAuditRunner'

const MARKDOWN = 'text/markdown;charset=utf-8'

/** Live status of the current Run all / single run: step, message, progress bar. */
function RunStatus({ batch, liveRuns }) {
  const categoryId = batch ? batch.categories[batch.index] : Object.keys(liveRuns)[0]
  if (!categoryId) return null
  const progress = liveRuns[categoryId]?.progress || {}
  const total = Number(progress.total) || 0
  const pct = total > 0 ? Math.min(100, Math.round(((Number(progress.done) || 0) / total) * 100)) : null
  const step = batch ? `Step ${batch.index + 1} of ${batch.categories.length} · ` : ''
  return (
    <div className="space-y-1.5 rounded-lg border border-border px-4 py-3" aria-live="polite">
      <p className="text-xs">
        <span className="font-medium">
          {step}
          {categoryById(categoryId)?.label}
        </span>
        <span className="text-muted-foreground"> — {progress.message || 'Starting…'}</span>
      </p>
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
    </div>
  )
}

export default function Audit() {
  const { companyId } = useParams()
  const audit = useAuditRunner(companyId)
  const { state, loading, batch } = audit
  const company = state?.company || null
  const readiness = state?.readiness || null
  const stateCategories = state?.categories || {}
  const hasResults = CATEGORIES.some((c) => stateCategories[c.id]?.latest)
  const runnableCount = CATEGORIES.filter((c) => audit.runnable(c.id)).length
  const downloadClass = cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9')

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{company?.name ? `${company.name} — Audit` : 'Audit'}</h1>
          <p className="break-all text-sm text-muted-foreground">
            {company?.siteUrl || (loading ? 'Loading…' : 'No domain set — add it in AEO Playbook → Company')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!hasResults}
            onClick={() =>
              downloadFile(reportFilename(company, 'audit'), buildAuditMarkdown({ company, readiness, categories: stateCategories }), MARKDOWN)
            }
            className={downloadClass}
            title="Full audit: scores, actions, every check and each data source"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Report
          </button>
          <button
            type="button"
            disabled={!readiness}
            onClick={() => downloadFile(reportFilename(company, 'audit-actions'), buildActionsMarkdown({ company, readiness }), MARKDOWN)}
            className={downloadClass}
            title="Recommended actions in priority order"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Actions
          </button>
          <button
            type="button"
            onClick={() => audit.runAll()}
            disabled={audit.busy || audit.connectionsChecking || runnableCount === 0}
            className={cn(buttonVariants({ variant: 'default' }), 'h-9')}
          >
            {batch ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {batch ? `Running ${batch.index + 1}/${batch.categories.length}` : `Run all (${runnableCount})`}
          </button>
        </div>
      </header>

      <RunStatus batch={batch} liveRuns={audit.liveRuns} />

      <ConnectionsCheck connections={audit.connections} checking={audit.connectionsChecking} onRecheck={audit.checkConnections} />

      {audit.error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {audit.error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading audit…
        </div>
      ) : (
        <>
          {hasResults ? (
            <>
              <ReadinessOverview readiness={readiness} />
              <RecommendedActions actions={readiness?.actions || []} />
              <ChecksBySection checks={readiness?.checks || []} />
            </>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              No results yet. Click Run all to audit the site.
            </p>
          )}
          <SourcePanels
            stateCategories={stateCategories}
            companyId={companyId}
            liveRuns={audit.liveRuns}
            runErrors={audit.runErrors}
            busy={audit.busy || audit.connectionsChecking}
            runnable={audit.runnable}
            blockedBy={audit.blockedBy}
            onRun={audit.runOne}
            onCancel={audit.cancel}
            pendingAccept={audit.pendingAccept}
            onToggleAccepted={audit.toggleAccepted}
          />
        </>
      )}
    </div>
  )
}
