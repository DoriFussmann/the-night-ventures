import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Play } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CATEGORIES, categoryById } from '../../../lib/audit/categories.js'
import ScoreGauge from './audit/ScoreGauge'
import ConnectionsCheck from './audit/ConnectionsCheck'
import CategoryGrid, { formatRunAt, formatCost } from './audit/CategoryGrid'
import IssueList from './audit/IssueList'
import { useAuditRunner } from './audit/useAuditRunner'

/** Metrics shown per category: [metrics key, label]. */
const METRIC_LABELS = {
  crawl: [
    ['pagesCrawled', 'Pages crawled'],
    ['indexablePages', 'Indexable pages'],
    ['nonIndexablePages', 'Non-indexable'],
    ['sitemapUrlCount', 'Sitemap URLs'],
    ['maxClickDepth', 'Max click depth'],
    ['onpageScore', 'DataForSEO on-page score'],
  ],
  schema: [
    ['pagesChecked', 'Pages checked'],
    ['pagesWithJsonLd', 'Pages with JSON-LD'],
    ['articlePages', 'Article pages'],
    ['articlesWithSchema', 'Articles with Article schema'],
  ],
}

/** @param {{ entry: any }} props */
function RunNotes({ entry }) {
  const metrics = entry.latest?.metrics || {}
  const notes = []
  if (metrics.crawlStopReason === 'limit_exceeded') notes.push('Crawl stopped at the 150-page cap.')
  if (metrics.urlsCapped) notes.push(`Checked the first 150 of ${metrics.urlsFound} URLs found.`)
  if (metrics.pagesFailed) notes.push(`${metrics.pagesFailed} page(s) could not be fetched.`)
  for (const warning of metrics.warnings || []) notes.push(warning)
  if (!notes.length) return null
  return (
    <ul className="space-y-0.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  )
}

/**
 * @param {{
 *   categoryId: string,
 *   entry: any,
 *   pendingAccept: Set<string>,
 *   onToggleAccepted: (issues: any[], accepted: boolean) => void,
 * }} props
 */
function CategoryDetail({ categoryId, entry, pendingAccept, onToggleAccepted }) {
  const meta = categoryById(categoryId)
  const latest = entry.latest
  const metrics = latest?.metrics || {}
  const labels = METRIC_LABELS[categoryId] || []
  const typeCounts = categoryId === 'schema' ? Object.entries(metrics.typeCounts || {}) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold">{meta?.label}</h2>
          <p className="text-xs text-muted-foreground">{meta?.description}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Last run {formatRunAt(latest?.finished_at || latest?.started_at)}
          {meta?.paid ? ` · ${formatCost(latest?.cost_usd)}` : ''}
          {entry.previous ? ` · compared with ${formatRunAt(entry.previous.started_at)}` : ' · first run (baseline)'}
        </p>
      </div>

      {labels.length ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {labels.map(([key, label]) => (
            <div key={key} className="rounded-md border border-border px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="text-base font-semibold tabular-nums">{metrics[key] ?? '—'}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {typeCounts.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Schema types found">
          {typeCounts
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .map(([type, count]) => (
              <span key={type} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {type} · {String(count)}
              </span>
            ))}
        </div>
      ) : null}

      <RunNotes entry={entry} />

      <IssueList
        issues={entry.issues || []}
        fixed={entry.fixed || []}
        accepted={entry.accepted || []}
        hasPrevious={Boolean(entry.previous)}
        pendingAccept={pendingAccept}
        onToggleAccepted={onToggleAccepted}
      />
    </div>
  )
}

export default function Audit() {
  const { companyId } = useParams()
  const audit = useAuditRunner(companyId)
  const { state, loading, batch } = audit
  const [selected, setSelected] = useState('')

  const stateCategories = state?.categories || {}
  const withResults = CATEGORIES.filter((c) => stateCategories[c.id]?.latest)
  const runnableCount = CATEGORIES.filter((c) => audit.runnable(c.id)).length

  useEffect(() => {
    if (!withResults.length) return
    if (!selected || !stateCategories[selected]?.latest) setSelected(withResults[0].id)
  }, [withResults, selected, stateCategories])

  const scoredCount = CATEGORIES.filter((c) => typeof stateCategories[c.id]?.score === 'number').length
  const batchLabel = batch
    ? `Running ${batch.index + 1}/${batch.categories.length} — ${categoryById(batch.categories[batch.index])?.label || ''}`
    : ''

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {state?.company?.name ? `${state.company.name} — Audit` : 'Audit'}
          </h1>
          <p className="break-all text-sm text-muted-foreground">
            {state?.company?.siteUrl || (loading ? 'Loading…' : 'No domain set — add it in Company Intelligence')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => audit.runAll()}
          disabled={audit.busy || audit.connectionsChecking || runnableCount === 0}
          className={cn(buttonVariants({ variant: 'default' }), 'shrink-0')}
        >
          {batch ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          {batch ? batchLabel : `Run all (${runnableCount})`}
        </button>
      </header>

      <ConnectionsCheck
        connections={audit.connections}
        checking={audit.connectionsChecking}
        onRecheck={audit.checkConnections}
      />

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
          <section aria-label="Scores" className="flex flex-col gap-4 lg:flex-row">
            <div className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card/40 p-4 lg:w-48">
              <ScoreGauge label="Overall" score={state?.overall ?? null} />
              <p className="text-center text-[11px] text-muted-foreground">
                Weighted across {scoredCount} of {CATEGORIES.length} categories
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <CategoryGrid
                stateCategories={stateCategories}
                liveRuns={audit.liveRuns}
                runErrors={audit.runErrors}
                busy={audit.busy || audit.connectionsChecking}
                runnable={audit.runnable}
                blockedBy={audit.blockedBy}
                onRun={audit.runOne}
                onCancel={audit.cancel}
                onSelect={setSelected}
                selected={selected}
              />
            </div>
          </section>

          {withResults.length ? (
            <section aria-label="Category results" className="space-y-4">
              <div role="tablist" aria-label="Categories" className="flex flex-wrap gap-1 border-b border-border">
                {withResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    id={`audit-tab-${c.id}`}
                    aria-selected={selected === c.id}
                    aria-controls={`audit-panel-${c.id}`}
                    onClick={() => setSelected(c.id)}
                    className={cn(
                      '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                      selected === c.id
                        ? 'border-primary font-medium text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {c.short}
                    {stateCategories[c.id]?.issues?.length ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {stateCategories[c.id].issues.length}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              {selected && stateCategories[selected]?.latest ? (
                <div role="tabpanel" id={`audit-panel-${selected}`} aria-labelledby={`audit-tab-${selected}`}>
                  <CategoryDetail
                    categoryId={selected}
                    entry={stateCategories[selected]}
                    pendingAccept={audit.pendingAccept}
                    onToggleAccepted={audit.toggleAccepted}
                  />
                </div>
              ) : null}
            </section>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              No results yet. Run all categories, or run one from its card.
            </p>
          )}
        </>
      )}
    </div>
  )
}
