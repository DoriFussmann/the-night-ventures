import React from 'react'
import { Loader2, Play, Square } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CATEGORIES } from '../../../../lib/audit/categories.js'
import Panel from './Panel'
import IssueList from './IssueList'
import AiVisibilityPanel from './AiVisibilityPanel'
import AeoPanel from './AeoPanel'
import { METRIC_LABELS } from './metrics.js'

/** @param {string | null | undefined} iso */
function formatRunAt(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** @param {number | null | undefined} value */
function formatCost(value) {
  const n = Number(value) || 0
  return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}

const TH = 'px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground'
const TD = 'px-3 py-1.5 tabular-nums'

/** @param {number | null | undefined} score */
function perfClass(score) {
  if (typeof score !== 'number') return ''
  if (score >= 90) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

/** @param {string} url */
function shortPath(url) {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

/** Per-template PageSpeed results. @param {{ pages: any[] }} props */
function SpeedPages({ pages }) {
  if (!pages?.length) return null
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className={TH}>Template</th>
            <th className={TH}>Page</th>
            <th className={TH}>Perf</th>
            <th className={TH}>SEO</th>
            <th className={TH}>A11y</th>
            <th className={TH}>Lab LCP</th>
            <th className={TH}>Lab CLS</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.url} className="border-t border-border">
              <td className={`${TD} capitalize`}>{p.kind}</td>
              <td className={`${TD} max-w-[18rem] truncate`}>
                <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline" title={p.url}>
                  {shortPath(p.url)}
                </a>
              </td>
              {p.error ? (
                <td colSpan={5} className={`${TD} text-red-600 dark:text-red-400`}>
                  {p.error}
                </td>
              ) : (
                <>
                  <td className={cn(TD, 'font-semibold', perfClass(p.performance))}>{p.performance ?? '—'}</td>
                  <td className={TD}>{p.seo ?? '—'}</td>
                  <td className={TD}>{p.accessibility ?? '—'}</td>
                  <td className={TD}>{p.labLcpMs != null ? `${(p.labLcpMs / 1000).toFixed(1)} s` : '—'}</td>
                  <td className={TD}>{p.labCls != null ? Number(p.labCls).toFixed(2) : '—'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One row per cluster. @param {{ rows: any[] }} props */
function ClusterTable({ rows }) {
  if (!rows?.length) return null
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className={TH}>Pillar</th>
            <th className={TH}>Pillar page</th>
            <th className={TH}>Articles</th>
            <th className={TH} title="Supporting articles the pillar links to">Pillar → articles</th>
            <th className={TH} title="Articles that link back to the pillar">Articles → pillar</th>
            <th className={TH} title="Articles linking to at least one sibling (clusters of 3+)">Sibling links</th>
            <th className={TH}>Unpublished planned</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className={`${TD} font-medium`}>{r.keyword}</td>
              <td className={`${TD} max-w-[16rem] truncate`}>
                {r.pillarUrl ? (
                  <a href={r.pillarUrl} target="_blank" rel="noreferrer" className="hover:underline" title={r.pillarUrl}>
                    {shortPath(r.pillarUrl)}
                  </a>
                ) : (
                  <span className="text-red-600 dark:text-red-400">Not published</span>
                )}
              </td>
              <td className={TD}>{r.articles}</td>
              <td className={TD}>{r.pillarLinksOut ?? '—'}</td>
              <td className={TD}>{r.linksBack ?? '—'}</td>
              <td className={TD}>{r.siblingLinked ?? '—'}</td>
              <td className={TD}>{r.plannedUnpublished || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Site vs competitors (Moz). @param {{ metrics: any }} props */
function AuthorityCompetitors({ metrics }) {
  const competitors = metrics?.competitors || []
  if (!competitors.length) return null
  const rows = [
    {
      key: '__site',
      name: 'You',
      domain: metrics.target,
      domainAuthority: metrics.domainAuthority,
      linkingRootDomains: metrics.linkingRootDomains,
      spamScore: metrics.spamScore,
      self: true,
    },
    ...competitors.map((c) => ({ ...c, key: c.domain })),
  ]
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className={TH}>Site</th>
            <th className={TH}>Domain</th>
            <th className={TH}>DA</th>
            <th className={TH}>Linking roots</th>
            <th className={TH}>Spam %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn('border-t border-border', r.self && 'bg-accent/40 font-medium')}>
              <td className={TD}>{r.name}</td>
              <td className={`${TD} text-muted-foreground`}>{r.domain || '—'}</td>
              {r.error ? (
                <td colSpan={3} className={`${TD} text-muted-foreground`}>
                  {r.error}
                </td>
              ) : (
                <>
                  <td className={TD}>{r.domainAuthority ?? '—'}</td>
                  <td className={TD}>{r.linkingRootDomains?.toLocaleString?.() ?? '—'}</td>
                  <td className={TD}>{r.spamScore ?? '—'}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** @param {{ entry: any }} props */
function RunNotes({ entry }) {
  const metrics = entry.latest?.metrics || {}
  const notes = []
  if (metrics.crawlStopReason === 'limit_exceeded') notes.push('Crawl stopped at the 150-page cap.')
  if (metrics.urlsCapped) notes.push(`Checked the first 150 of ${metrics.urlsFound} URLs found.`)
  if (metrics.pagesFailed) notes.push(`${metrics.pagesFailed} page(s) could not be fetched.`)
  if (entry.latest?.category === 'speed' && metrics.hasFieldData === false) {
    notes.push('No real-user (CrUX) data for this site yet — speed findings are from lab runs only.')
  }
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

/** Metrics, evidence tables, notes and issues of one source's latest run. */
function SourceDetail({ category, companyId, entry, pendingAccept, onToggleAccepted }) {
  const metrics = entry.latest?.metrics || {}
  const labels = METRIC_LABELS[category.id] || []
  const typeCounts = category.id === 'schema' ? Object.entries(metrics.typeCounts || {}) : []
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {category.description}
        {entry.previous ? ` Compared with ${formatRunAt(entry.previous.started_at)}.` : ' First run (baseline).'}
      </p>

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

      {category.id === 'clusters' ? <ClusterTable rows={metrics.clusters} /> : null}
      {category.id === 'speed' ? <SpeedPages pages={metrics.pages} /> : null}
      {category.id === 'authority' ? <AuthorityCompetitors metrics={metrics} /> : null}
      {category.id === 'aeo_readiness' ? <AeoPanel metrics={metrics} /> : null}
      {category.id === 'ai_visibility' ? <AiVisibilityPanel metrics={metrics} companyId={companyId} /> : null}

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

/** One-line header summary: last run, two key metrics, open issues. */
function sourceSummary(category, entry, live, reason) {
  if (live) return live.progress?.message || 'Running…'
  if (!entry.latest) return reason || 'Not run yet'
  const metrics = entry.latest.metrics || {}
  const keyMetrics = (METRIC_LABELS[category.id] || [])
    .filter(([key]) => metrics[key] != null && metrics[key] !== '—')
    .slice(0, 2)
    .map(([key, label]) => `${label}: ${metrics[key]}`)
  const open = entry.issues?.length || 0
  return [
    formatRunAt(entry.latest.finished_at || entry.latest.started_at),
    category.paid ? formatCost(entry.latest.cost_usd) : null,
    ...keyMetrics,
    `${open} issue${open === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Every data-collection run as a collapsed panel with its own Run / Cancel.
 * @param {{
 *   stateCategories: Record<string, any>,
 *   companyId: string,
 *   liveRuns: Record<string, any>,
 *   runErrors: Record<string, string>,
 *   busy: boolean,
 *   runnable: (id: string) => boolean,
 *   blockedBy: (id: string) => string[],
 *   onRun: (id: string) => void,
 *   onCancel: (id: string) => void,
 *   pendingAccept: Set<string>,
 *   onToggleAccepted: (issues: any[], accepted: boolean) => void,
 * }} props
 */
export default function SourcePanels({
  stateCategories,
  companyId,
  liveRuns,
  runErrors,
  busy,
  runnable,
  blockedBy,
  onRun,
  onCancel,
  pendingAccept,
  onToggleAccepted,
}) {
  return (
    <section aria-label="Data sources" className="space-y-2">
      <h2 className="text-sm font-semibold">Data sources</h2>
      {CATEGORIES.map((category) => {
        const entry = stateCategories?.[category.id] || {}
        const live = liveRuns[category.id]
        const blocked = blockedBy(category.id)
        const reason = blocked.length ? `Blocked: ${blocked.join(', ')} failing` : ''
        const runError = runErrors[category.id]
        return (
          <Panel
            key={category.id}
            title={category.label}
            summary={
              runError && !live ? (
                <span className="text-red-600 dark:text-red-400">{runError}</span>
              ) : (
                sourceSummary(category, entry, live, reason)
              )
            }
            actions={
              live ? (
                <button
                  type="button"
                  onClick={() => onCancel(category.id)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <Square className="h-3 w-3" aria-hidden="true" />
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onRun(category.id)}
                  disabled={busy || !runnable(category.id)}
                  title={reason || `Run ${category.label}`}
                  aria-label={`Run ${category.label}`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  Run
                </button>
              )
            }
          >
            {entry.latest ? (
              <SourceDetail
                category={category}
                companyId={companyId}
                entry={entry}
                pendingAccept={pendingAccept}
                onToggleAccepted={onToggleAccepted}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{category.description}</p>
            )}
          </Panel>
        )
      })}
    </section>
  )
}
