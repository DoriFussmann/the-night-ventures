import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Check,
  Loader2,
  Camera,
  X,
  AlertTriangle,
  Circle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import ScoreGauge, { scoreTone } from './auditSnapshot/ScoreGauge'
import { listSnapshots, runPanel, persistSnapshot } from './auditSnapshot/api'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { filterSemrushBots, TAB_SOURCES, SOURCE_IDS } from './auditSnapshot/botCategories'

// The tabs shown across the top of the Analytics page, in order.
const ANALYTICS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'speed', label: 'Speed' },
  { id: 'authority', label: 'Authority' },
  { id: 'ai', label: 'AI Discoverability' },
  { id: 'crawlability', label: 'Crawlability' },
  { id: 'technical', label: 'Technical' },
  { id: 'traffic', label: 'Traffic' },
]

// Small presentational Scan button used in each tab header. No hooks.
function ScanButton({ label = 'Scan', sources, onScan, running, activePanel }) {
  const isActive = running && activePanel && sources.includes(activePanel)
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={running}
      onClick={() => onScan(sources)}
    >
      {isActive ? (
        <>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Scanning…
        </>
      ) : (
        <>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {label}
        </>
      )}
    </Button>
  )
}

// Header row inside a category tab: title + last-run + its own Scan button.
function TabHeader({ title, hint, sources, onScan, running, activePanel, runAt }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold tracking-wide text-foreground/90">
          {title}
        </h2>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {runAt ? (
          <span className="text-[11px] text-muted-foreground">{runAt}</span>
        ) : null}
        <ScanButton
          sources={sources}
          onScan={onScan}
          running={running}
          activePanel={activePanel}
        />
      </div>
    </div>
  )
}

// Compact clickable score card for the Overview grid. No hooks.
function OverviewCard({ title, value, subtitle, tone = 'muted', onClick }) {
  const toneText =
    tone === 'green'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'yellow'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'red'
          ? 'text-red-600 dark:text-red-400'
          : 'text-foreground'
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border bg-card/40 p-4 text-left transition-colors hover:bg-accent/40"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', toneText)}>
        {value}
      </p>
      {subtitle ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      ) : null}
    </button>
  )
}

// Count allowed / total from a filtered bot-access view.
function botAllowedStats(semrush, kind) {
  const view = filterSemrushBots(semrush, kind)
  const bots = view?.botAccess?.bots || {}
  const names = Object.keys(bots)
  const allowed = names.filter((n) => bots[n]?.status === 'allowed').length
  return { allowed, total: names.length }
}

const PANELS = [
  {
    id: 'semrush',
    label: 'AI Bot Access',
    hint: 'robots.txt allow/block for search & AI bots',
  },
  { id: 'pagespeed', label: 'PageSpeed Insights', hint: 'Mobile + desktop scores' },
  { id: 'moz', label: 'Moz', hint: 'Authority + crawl freshness' },
  {
    id: 'dataforseo',
    label: 'DataForSEO',
    hint: 'Domain visibility + pillar keyword volumes',
  },
  { id: 'technical', label: 'Technical Checks', hint: 'Meta, sitemap, robots, JSON-LD' },
]

const CATEGORY_LABELS = [
  { key: 'performance', label: 'Performance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'bestPractices', label: 'Best Practices' },
  { key: 'seo', label: 'SEO' },
]

function formatRunAt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatNumber(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString()
}

function formatLcp(lcpMs) {
  if (lcpMs == null || !Number.isFinite(Number(lcpMs))) return '—'
  return `${(Number(lcpMs) / 1000).toFixed(1)} s`
}

function formatCls(cls) {
  if (cls == null || !Number.isFinite(Number(cls))) return '—'
  return Number(cls).toFixed(2)
}

function formatInp(inpMs) {
  if (inpMs == null || !Number.isFinite(Number(inpMs))) return '—'
  return `${Math.round(Number(inpMs))} ms`
}

function vitalCategoryClass(category) {
  const key = String(category || '')
    .toLowerCase()
    .replace(/_/g, '-')
  if (key === 'fast' || key === 'good') {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (key === 'average' || key === 'needs-improvement') {
    return 'text-amber-600 dark:text-amber-400'
  }
  if (key === 'slow' || key === 'poor') {
    return 'text-red-600 dark:text-red-400'
  }
  return ''
}

function finiteOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function fieldHasVitals(block) {
  const metrics = block?.metrics
  if (!metrics) return false
  return (
    finiteOrNull(metrics.lcp?.percentile) != null ||
    finiteOrNull(metrics.cls?.percentile) != null ||
    finiteOrNull(metrics.inp?.percentile) != null
  )
}

function vitalsFromField(block, source) {
  const metrics = block?.metrics || {}
  const clsRaw = finiteOrNull(metrics.cls?.percentile)
  return {
    lcpMs: finiteOrNull(metrics.lcp?.percentile),
    cls: clsRaw != null ? clsRaw / 100 : null,
    inpMs: finiteOrNull(metrics.inp?.percentile),
    source,
    categories: {
      lcp: metrics.lcp?.category || null,
      cls: metrics.cls?.category || null,
      inp: metrics.inp?.category || null,
    },
  }
}

function resolveCoreWebVitals(coreWebVitals) {
  if (fieldHasVitals(coreWebVitals?.url)) {
    return vitalsFromField(coreWebVitals.url, 'field (page)')
  }
  if (fieldHasVitals(coreWebVitals?.origin)) {
    return vitalsFromField(coreWebVitals.origin, 'field (origin)')
  }
  const lab = coreWebVitals?.lab
  if (lab && (lab.lcpMs != null || lab.cls != null)) {
    return {
      lcpMs: finiteOrNull(lab.lcpMs),
      cls: finiteOrNull(lab.cls),
      inpMs: null,
      source: 'lab',
      categories: {},
    }
  }
  return { lcpMs: null, cls: null, inpMs: null, source: null, categories: {} }
}

function scoreCellClass(score) {
  const tone = scoreTone(score)
  if (tone === 'green') return 'text-emerald-600 dark:text-emerald-400'
  if (tone === 'yellow') return 'text-amber-600 dark:text-amber-400'
  if (tone === 'red') return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function StatusIcon({ status }) {
  if (status === 'loading') {
    return <Loader2 className="h-4 w-4 animate-spin text-foreground/70" />
  }
  if (status === 'done') {
    return <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
  }
  if (status === 'error') {
    return <X className="h-4 w-4 text-red-600 dark:text-red-400" />
  }
  return <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
}

function SourceList({ panelState, activePanel }) {
  return (
    <ul className="space-y-1">
      {PANELS.map((panel) => {
        const state = panelState[panel.id] || { status: 'pending' }
        const active = activePanel === panel.id
        return (
          <li
            key={panel.id}
            className={cn(
              'flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors',
              active && 'bg-accent/60',
              state.status === 'done' && 'bg-emerald-500/5',
              state.status === 'error' && 'bg-red-500/5'
            )}
          >
            <div className="mt-0.5 shrink-0">
              <StatusIcon status={state.status} />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-medium',
                  state.status === 'pending' && 'text-muted-foreground'
                )}
              >
                {panel.label}
              </p>
              <p className="text-[11px] text-muted-foreground">{panel.hint}</p>
              {(state.status === 'error' || state.warning) && state.error && (
                <p
                  className={cn(
                    'mt-1 text-[11px]',
                    state.status === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-amber-700 dark:text-amber-400'
                  )}
                >
                  {state.error}
                </p>
              )}
              {state.status === 'loading' && (
                <p className="mt-1 text-[11px] text-muted-foreground">Running…</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function MetricTile({ label, value, category }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums',
          vitalCategoryClass(category)
        )}
      >
        {value}
      </p>
    </div>
  )
}

function VisibilitySection({ dataforseo }) {
  if (!dataforseo) {
    return (
      <p className="text-xs text-muted-foreground">Waiting for DataForSEO…</p>
    )
  }

  if (!dataforseo.ok) {
    return (
      <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{dataforseo.error || 'DataForSEO failed'}</span>
      </div>
    )
  }

  const summary = dataforseo.domainSummary

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Domain metrics from DataForSEO (Semrush Domain Overview needs API v3
        units, which are not configured).
      </p>
      {dataforseo.domainError && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Domain summary: {dataforseo.domainError}
        </p>
      )}
      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricTile label="DFS rank" value={formatNumber(summary.rank)} />
          <MetricTile
            label="Referring domains"
            value={formatNumber(summary.referringDomains)}
          />
          <MetricTile
            label="Referring main domains"
            value={formatNumber(summary.referringMainDomains)}
          />
          <MetricTile
            label="Backlinks"
            value={formatNumber(summary.backlinks)}
          />
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground/80">
          Pillar keywords (DataForSEO)
        </p>
        {dataforseo.keywordsError && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {dataforseo.keywordsError}
          </p>
        )}
        {(dataforseo.keywords || []).length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Keyword</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">Competition</TableHead>
                <TableHead className="text-right">CPC</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(dataforseo.keywords || []).map((row) => (
                <TableRow key={row.keyword || Math.random()}>
                  <TableCell className="text-xs font-medium">
                    {row.keyword || '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatNumber(row.searchVolume)}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {row.competition ?? '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {row.cpc != null ? `$${Number(row.cpc).toFixed(2)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          !dataforseo.keywordsError && (
            <p className="text-xs text-muted-foreground">No keyword rows</p>
          )
        )}
      </div>
    </div>
  )
}

function TechnicalSection({ technical }) {
  if (!technical) {
    return (
      <p className="text-xs text-muted-foreground">
        Waiting for technical checks…
      </p>
    )
  }
  if (!technical.ok) {
    return (
      <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{technical.error || 'Technical checks failed'}</span>
      </div>
    )
  }

  const checks = technical.checks || []
  return (
    <ul className="space-y-2">
      {checks.map((check) => (
        <li key={check.id} className="flex items-start gap-2 text-xs">
          {check.pass ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
          )}
          <span className={check.pass ? 'text-foreground/85' : 'text-red-700 dark:text-red-400'}>
            {check.finding}
          </span>
        </li>
      ))}
    </ul>
  )
}

function PerformanceScores({ result }) {
  const vitals = resolveCoreWebVitals(result.coreWebVitals)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATEGORY_LABELS.map(({ key, label }) => (
          <ScoreGauge
            key={key}
            label={label}
            score={result.scores?.[key]}
            size={96}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricTile
          label="LCP"
          value={formatLcp(vitals.lcpMs)}
          category={vitals.categories.lcp}
        />
        <MetricTile
          label="CLS"
          value={formatCls(vitals.cls)}
          category={vitals.categories.cls}
        />
        <MetricTile
          label="INP"
          value={formatInp(vitals.inpMs)}
          category={vitals.categories.inp}
        />
      </div>
      {vitals.source ? (
        <p className="text-[11px] text-muted-foreground">{vitals.source}</p>
      ) : null}
    </div>
  )
}

function PerformanceSection({ pagespeed }) {
  if (!pagespeed) {
    return (
      <p className="text-xs text-muted-foreground">Waiting for PageSpeed…</p>
    )
  }
  if (!pagespeed.ok) {
    return (
      <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{pagespeed.error || 'PageSpeed failed'}</span>
      </div>
    )
  }

  const blocks = [
    { title: 'Mobile', result: pagespeed.mobile },
    { title: 'Desktop', result: pagespeed.desktop },
  ]

  return (
    <div className="space-y-5">
      {blocks.map(({ title, result }) => (
        <div key={title}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium">{title}</p>
            {result?.finalUrl && (
              <a
                href={result.finalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-[60%] items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{result.finalUrl}</span>
              </a>
            )}
          </div>
          {!result?.ok ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              {result?.error || `${title} check failed`}
            </p>
          ) : (
            <PerformanceScores result={result} />
          )}
        </div>
      ))}
    </div>
  )
}

function AuthoritySection({ moz }) {
  if (!moz) {
    return <p className="text-xs text-muted-foreground">Waiting for Moz…</p>
  }
  if (!moz.ok && !moz.metrics) {
    return (
      <div className="space-y-3">
        {moz.stale?.isStale && moz.stale?.banner && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Stale / unmatched crawl data</AlertTitle>
            <AlertDescription>{moz.stale.banner}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{moz.error || 'Moz failed'}</span>
        </div>
      </div>
    )
  }

  const m = moz.metrics || {}
  return (
    <div className="space-y-4">
      {moz.stale?.isStale && moz.stale?.banner && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Stale / unmatched crawl data</AlertTitle>
          <AlertDescription>
            <p>{moz.stale.banner}</p>
            {Array.isArray(moz.stale.reasons) && moz.stale.reasons.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-xs">
                {moz.stale.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Domain Authority" value={formatNumber(m.domainAuthority)} />
        <MetricTile label="Page Authority" value={formatNumber(m.pageAuthority)} />
        <MetricTile label="Spam Score" value={formatNumber(m.spamScore)} />
        <MetricTile
          label="Linking root domains"
          value={formatNumber(m.linkingRootDomains)}
        />
        <MetricTile
          label="External pages to domain"
          value={formatNumber(m.externalPagesToRootDomain)}
        />
      </div>
      <div className="space-y-1 text-[11px] text-muted-foreground">
        <p>
          Target: <span className="text-foreground/80">{moz.target}</span>
          {moz.fallbackUsed ? ' (fell back to apex)' : ''}
        </p>
        {m.lastCrawled && (
          <p>
            Last crawled: {m.lastCrawled}
            {moz.crawlAgeDays != null ? ` (${moz.crawlAgeDays} days ago)` : ''}
          </p>
        )}
        {m.title && <p>Moz title: {m.title}</p>}
      </div>
    </div>
  )
}

function AiSearchSection({ semrush }) {
  if (!semrush) {
    return (
      <p className="text-xs text-muted-foreground">
        Waiting for bot-access check…
      </p>
    )
  }

  const botAccess = semrush.botAccess
  if (!botAccess) {
    return (
      <p className="text-xs text-muted-foreground">No bot access data</p>
    )
  }
  if (!botAccess.ok) {
    return (
      <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{botAccess.error || 'robots.txt check failed'}</span>
      </div>
    )
  }

  const rows = Object.entries(botAccess.bots || {})
  return (
    <div className="space-y-2">
      {botAccess.robotsUrl && (
        <a
          href={botAccess.robotsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" />
          {botAccess.robotsUrl}
        </a>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Bot</TableHead>
            <TableHead className="w-[20%]">Access</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([bot, info]) => {
            const allowed = info?.status === 'allowed'
            return (
              <TableRow key={bot}>
                <TableCell className="font-medium">{bot}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-xs font-medium',
                      allowed
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {allowed ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    {allowed ? 'Allowed' : 'Blocked'}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {info?.reason || '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function DashboardSection({ title, hint, children, ready }) {
  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card/40 p-4 sm:p-5 transition-opacity',
        !ready && 'opacity-60'
      )}
    >
      <h3 className={`${hint ? 'mb-1' : 'mb-3'} text-xs font-semibold uppercase tracking-wide text-foreground/90`}>
        {title}
      </h3>
      {hint ? (
        <p className="mb-3 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
      {children}
    </section>
  )
}

function HistoryList({ snapshots, selectedId, onSelect }) {
  if (!snapshots.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No past snapshots yet. Run a snapshot to start history.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Perf (m)</TableHead>
          <TableHead className="text-right">DA</TableHead>
              <TableHead className="text-right">Ref. domains</TableHead>
          <TableHead>Moz</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshots.map((s) => {
          const results = s.results || {}
          const perf = results.pagespeed?.mobile?.scores?.performance
          const da = results.moz?.metrics?.domainAuthority
          const kw = results.dataforseo?.domainSummary?.referringDomains
          const stale = results.moz?.stale?.isStale
          const active = s.id === selectedId
          return (
            <TableRow
              key={s.id}
              className={cn('cursor-pointer', active && 'bg-accent/50')}
              onClick={() => onSelect?.(s)}
            >
              <TableCell className="text-xs font-medium">
                {formatRunAt(s.run_at)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right text-xs tabular-nums font-medium',
                  scoreCellClass(perf)
                )}
              >
                {perf ?? '—'}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {da ?? '—'}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {kw ?? '—'}
              </TableCell>
              <TableCell className="text-xs">
                {stale ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400"
                  >
                    Stale warn
                  </Badge>
                ) : results.moz ? (
                  <span className="text-muted-foreground">OK</span>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function emptyPanelState() {
  return Object.fromEntries(
    PANELS.map((p) => [p.id, { status: 'pending', error: null }])
  )
}

export default function ExternalAuditSnapshot() {
  const { companyId } = useParams()

  const [companyName, setCompanyName] = useState('')
  const [domain, setDomain] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [sampleUrl, setSampleUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [active, setActive] = useState(null)
  const [liveResults, setLiveResults] = useState(null)
  const [panelState, setPanelState] = useState(emptyPanelState)
  const [activePanel, setActivePanel] = useState(null)
  const [meta, setMeta] = useState(null)
  const [summary, setSummary] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [activeTab, setActiveTab] = useState('overview')

  const displayResults = useMemo(() => {
    if (running && liveResults) return liveResults
    if (liveResults && !active) return liveResults
    return active?.results || liveResults || null
  }, [running, liveResults, active])

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError('')

    const [companyResult, profileResult, historyResult] = await Promise.all([
      supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
      supabase
        .from('company_profiles')
        .select('domain')
        .eq('company_id', companyId)
        .maybeSingle(),
      listSnapshots(companyId).catch((err) => {
        console.error(err)
        return { error: err?.message || 'Failed to load history', snapshots: [] }
      }),
    ])

    if (companyResult.error) {
      setError(companyResult.error.message || 'Failed to load company')
      setLoading(false)
      return
    }
    if (profileResult.error) {
      setError(profileResult.error.message || 'Failed to load profile')
      setLoading(false)
      return
    }

    setCompanyName(companyResult.data?.name || '')
    const d = profileResult.data?.domain || ''
    setDomain(d)
    setSiteUrl((prev) => prev || d || '')

    if (historyResult.error && !historyResult.snapshots?.length) {
      setError(historyResult.error)
    }
    setNotice(historyResult.warning || '')

    const list = historyResult.snapshots || []
    setSnapshots(list)
    setActive((prev) => {
      if (prev && list.some((s) => s.id === prev.id)) {
        return list.find((s) => s.id === prev.id) || list[0] || null
      }
      return list[0] || null
    })
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  // Run one or more sources, then persist.
  // fresh=true  -> full snapshot, starts empty (the Overview "Run all" button).
  // fresh=false -> single-tab scan: keep the other sources' latest values
  //                visible, overwrite only what we re-fetch, and save the
  //                merged result so history stays complete.
  const runSources = async (sourceIds, { fresh } = {}) => {
    if (!companyId || running) return
    const ids = (sourceIds || []).filter((id) => SOURCE_IDS.includes(id))
    if (ids.length === 0) return

    setRunning(true)
    setError('')
    setNotice('')
    setMeta(null)
    setSummary('')
    setSummaryError('')
    setActivePanel(null)

    const base = fresh ? {} : { ...(displayResults || {}) }
    const collected = { ...base }
    if (fresh) setActive(null)
    setLiveResults({ ...collected })

    // Reset only the panels we're about to run; leave the rest as-is.
    setPanelState((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = { status: 'pending', error: null }
      return next
    })

    let runMeta = null
    const orderedPanels = PANELS.filter((p) => ids.includes(p.id))

    try {
      for (const panel of orderedPanels) {
        setActivePanel(panel.id)
        setPanelState((prev) => ({
          ...prev,
          [panel.id]: { status: 'loading', error: null },
        }))

        try {
          const data = await runPanel({
            companyId,
            panel: panel.id,
            siteUrl: siteUrl.trim() || undefined,
            sampleUrl: sampleUrl.trim() || undefined,
          })
          runMeta = data.meta || runMeta
          const result = data.result || { ok: false, error: 'Empty panel result' }
          collected[panel.id] = result
          setLiveResults({ ...collected })
          const warning =
            result.ok && (result.overviewError || result.stale?.isStale)
              ? result.overviewError || result.stale?.banner || null
              : null
          setPanelState((prev) => ({
            ...prev,
            [panel.id]: {
              status: result.ok ? 'done' : 'error',
              error: result.ok
                ? warning
                : result.error || 'Panel failed',
              warning: Boolean(warning),
            },
          }))
        } catch (err) {
          const message = err?.message || `${panel.label} failed`
          collected[panel.id] = { ok: false, error: message, panel: panel.id }
          setLiveResults({ ...collected })
          setPanelState((prev) => ({
            ...prev,
            [panel.id]: { status: 'error', error: message },
          }))
        }
      }

      setActivePanel(null)
      setMeta(runMeta)

      const persisted = await persistSnapshot({
        companyId,
        siteUrl: runMeta?.siteUrl || siteUrl.trim() || undefined,
        sampleUrl: runMeta?.sampleUrl || sampleUrl.trim() || undefined,
        results: collected,
      })

      setMeta(persisted.meta || runMeta)
      setActive(persisted.snapshot)
      setLiveResults(persisted.snapshot?.results || collected)
      if (persisted.meta?.warning) {
        setNotice(persisted.meta.warning)
      }
      if (persisted.snapshot?.id) {
        setSnapshots((prev) => {
          const rest = prev.filter((s) => s.id !== persisted.snapshot.id)
          return [persisted.snapshot, ...rest]
        })
      }
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Snapshot failed')
      // Keep any progressive results visible even if persist fails.
      if (Object.keys(collected).length > 0) {
        setLiveResults(collected)
      }
    } finally {
      setRunning(false)
      setActivePanel(null)
    }
  }

  const handleRun = () => runSources(TAB_SOURCES.overview, { fresh: true })
  const handleScan = (sourceIds) => runSources(sourceIds, { fresh: false })

  const handleSummarize = async () => {
    if (!companyId || summarizing || !displayResults) return
    setSummarizing(true)
    setSummaryError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Not signed in')
      const res = await fetch('/api/audit-summary', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companyId, results: displayResults }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || 'Summary failed')
      setSummary(String(payload.summary || '').trim())
    } catch (err) {
      setSummaryError(err?.message || 'Summary failed')
    } finally {
      setSummarizing(false)
    }
  }

  const title = companyName
    ? `${companyName} — Analytics`
    : 'Analytics'

  const historyPanelState = useMemo(() => {
    if (running || liveResults) return panelState
    if (!active?.results) return emptyPanelState()
    const next = emptyPanelState()
    for (const panel of PANELS) {
      const result = active.results[panel.id]
      if (!result) {
        next[panel.id] = { status: 'pending', error: null }
      } else if (result.ok) {
        const warning =
          result.overviewError ||
          (result.stale?.isStale ? result.stale.banner : null) ||
          null
        next[panel.id] = {
          status: 'done',
          error: warning,
          warning: Boolean(warning),
        }
      } else {
        next[panel.id] = {
          status: 'error',
          error: result.error || 'Failed',
        }
      }
    }
    return next
  }, [running, liveResults, panelState, active])

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Health across Speed, Authority, AI Discoverability, Crawlability,
          Technical, and Traffic. Run everything at once, or open a tab and
          scan just that area.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {notice && !error && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="siteUrl">Site URL</Label>
            <Input
              id="siteUrl"
              placeholder={domain || 'https://www.example.com'}
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              disabled={running || loading}
            />
            <p className="text-[11px] text-muted-foreground">
              Defaults to Company Data domain (www host preferred).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sampleUrl">Sample article URL (optional)</Label>
            <Input
              id="sampleUrl"
              placeholder="Auto: most recent published article"
              value={sampleUrl}
              onChange={(e) => setSampleUrl(e.target.value)}
              disabled={running || loading}
            />
            <p className="text-[11px] text-muted-foreground">
              Used for JSON-LD validation in technical checks.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleRun} disabled={running || loading || !companyId}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running sources…
              </>
            ) : (
              <>
                <Camera className="mr-2 h-4 w-4" />
                Run all sources
              </>
            )}
          </Button>
          {running && activePanel && (
            <span className="text-xs text-muted-foreground">
              Now: {PANELS.find((p) => p.id === activePanel)?.label}
              {activePanel === 'pagespeed' ? ' (can take 30–60s)…' : '…'}
            </span>
          )}
          {meta?.siteUrl && !running && (
            <span className="text-xs text-muted-foreground">
              Last run against {meta.siteUrl}
              {meta.sampleTitle ? ` · article: ${meta.sampleTitle}` : ''}
            </span>
          )}
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            {ANALYTICS_TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs data-[state=active]:bg-accent data-[state=active]:text-foreground"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {summaryError ? (
            <p className="text-sm text-destructive">{summaryError}</p>
          ) : null}
          {summary ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-foreground whitespace-pre-wrap">
              {summary}
            </div>
          ) : null}

          {/* Overview */}
          <TabsContent value="overview" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-foreground/90">
                Overview
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!displayResults || summarizing}
                  onClick={handleSummarize}
                >
                  {summarizing ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Summarizing…
                    </>
                  ) : (
                    'Summarize'
                  )}
                </Button>
                {(active?.run_at || running) && (
                  <span className="text-xs text-muted-foreground">
                    {running ? 'Live run' : formatRunAt(active.run_at)}
                  </span>
                )}
              </div>
            </div>

            {!displayResults ? (
              <p className="text-sm text-muted-foreground">
                No data yet. Run all sources above, or open a tab and scan it.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(() => {
                  const perf =
                    displayResults.pagespeed?.mobile?.scores?.performance
                  const da = displayResults.moz?.metrics?.domainAuthority
                  const ai = botAllowedStats(displayResults.semrush, 'ai')
                  const search = botAllowedStats(displayResults.semrush, 'search')
                  const refDomains =
                    displayResults.dataforseo?.domainSummary?.referringDomains
                  const techOk = displayResults.technical?.ok
                  const allowTone = (s) =>
                    !s.total
                      ? 'muted'
                      : s.allowed === s.total
                        ? 'green'
                        : s.allowed === 0
                          ? 'red'
                          : 'yellow'
                  return (
                    <>
                      <OverviewCard
                        title="Speed"
                        value={perf != null ? perf : '—'}
                        subtitle="PageSpeed performance (mobile)"
                        tone={perf != null ? scoreTone(perf) : 'muted'}
                        onClick={() => setActiveTab('speed')}
                      />
                      <OverviewCard
                        title="Authority"
                        value={da != null ? da : '—'}
                        subtitle="Moz Domain Authority"
                        tone={da != null ? scoreTone(da) : 'muted'}
                        onClick={() => setActiveTab('authority')}
                      />
                      <OverviewCard
                        title="AI Discoverability"
                        value={ai.total ? `${ai.allowed}/${ai.total}` : '—'}
                        subtitle="AI crawlers allowed"
                        tone={allowTone(ai)}
                        onClick={() => setActiveTab('ai')}
                      />
                      <OverviewCard
                        title="Crawlability"
                        value={search.total ? `${search.allowed}/${search.total}` : '—'}
                        subtitle="Search crawlers allowed"
                        tone={allowTone(search)}
                        onClick={() => setActiveTab('crawlability')}
                      />
                      <OverviewCard
                        title="Technical"
                        value={
                          displayResults.technical ? (techOk ? 'OK' : 'Issues') : '—'
                        }
                        subtitle="Meta, sitemap, robots, JSON-LD"
                        tone={
                          displayResults.technical
                            ? techOk
                              ? 'green'
                              : 'yellow'
                            : 'muted'
                        }
                        onClick={() => setActiveTab('technical')}
                      />
                      <OverviewCard
                        title="Traffic"
                        value={refDomains != null ? formatNumber(refDomains) : '—'}
                        subtitle="Referring domains · GSC soon"
                        tone="muted"
                        onClick={() => setActiveTab('traffic')}
                      />
                    </>
                  )
                })()}
              </div>
            )}
          </TabsContent>

          {/* Speed */}
          <TabsContent value="speed" className="space-y-4">
            <TabHeader
              title="Speed & Core Web Vitals"
              hint="Load speed and the vitals Google ranks on"
              sources={TAB_SOURCES.speed}
              onScan={handleScan}
              running={running}
              activePanel={activePanel}
              runAt={active?.run_at && !running ? formatRunAt(active.run_at) : null}
            />
            {displayResults?.pagespeed ? (
              <PerformanceSection pagespeed={displayResults.pagespeed} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No data yet. Click Scan to run PageSpeed.
              </p>
            )}
          </TabsContent>

          {/* Authority */}
          <TabsContent value="authority" className="space-y-4">
            <TabHeader
              title="Authority & Backlinks"
              hint="Domain strength and who links to you"
              sources={TAB_SOURCES.authority}
              onScan={handleScan}
              running={running}
              activePanel={activePanel}
              runAt={active?.run_at && !running ? formatRunAt(active.run_at) : null}
            />
            {displayResults?.moz ? (
              <AuthoritySection moz={displayResults.moz} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No data yet. Click Scan to run Moz.
              </p>
            )}
          </TabsContent>

          {/* AI Discoverability */}
          <TabsContent value="ai" className="space-y-4">
            <TabHeader
              title="AI Discoverability"
              hint="Whether AI crawlers (GPTBot, ClaudeBot, Perplexity…) can access the site"
              sources={TAB_SOURCES.ai}
              onScan={handleScan}
              running={running}
              activePanel={activePanel}
              runAt={active?.run_at && !running ? formatRunAt(active.run_at) : null}
            />
            {displayResults?.semrush ? (
              <AiSearchSection
                semrush={filterSemrushBots(displayResults.semrush, 'ai')}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No data yet. Click Scan to check robots.txt.
              </p>
            )}
          </TabsContent>

          {/* Crawlability */}
          <TabsContent value="crawlability" className="space-y-4">
            <TabHeader
              title="Google Crawlability"
              hint="Whether search crawlers (Googlebot, Bingbot…) can access the site"
              sources={TAB_SOURCES.crawlability}
              onScan={handleScan}
              running={running}
              activePanel={activePanel}
              runAt={active?.run_at && !running ? formatRunAt(active.run_at) : null}
            />
            {displayResults?.semrush ? (
              <AiSearchSection
                semrush={filterSemrushBots(displayResults.semrush, 'search')}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No data yet. Click Scan to check robots.txt.
              </p>
            )}
          </TabsContent>

          {/* Technical */}
          <TabsContent value="technical" className="space-y-4">
            <TabHeader
              title="Technical Health"
              hint="Meta, sitemap, robots, JSON-LD schema"
              sources={TAB_SOURCES.technical}
              onScan={handleScan}
              running={running}
              activePanel={activePanel}
              runAt={active?.run_at && !running ? formatRunAt(active.run_at) : null}
            />
            {displayResults?.technical ? (
              <TechnicalSection technical={displayResults.technical} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No data yet. Click Scan to run technical checks.
              </p>
            )}
          </TabsContent>

          {/* Traffic */}
          <TabsContent value="traffic" className="space-y-4">
            <TabHeader
              title="Rankings & Traffic"
              hint="Search visibility and link footprint"
              sources={TAB_SOURCES.traffic}
              onScan={handleScan}
              running={running}
              activePanel={activePanel}
              runAt={active?.run_at && !running ? formatRunAt(active.run_at) : null}
            />
            {displayResults?.dataforseo ? (
              <VisibilitySection dataforseo={displayResults.dataforseo} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No data yet. Click Scan to run DataForSEO.
              </p>
            )}

            {/* Google Search Console — skeleton, not wired yet */}
            <section className="rounded-lg border border-dashed border-border bg-card/20 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
                  Google Search Console
                </h3>
                <Badge
                  variant="outline"
                  className="text-[10px] text-muted-foreground"
                >
                  Coming soon
                </Badge>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Clicks, impressions, CTR, average position, and top queries —
                pulled straight from Google. Not connected yet.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {['Clicks', 'Impressions', 'Avg. CTR', 'Avg. position'].map(
                  (label) => (
                    <div
                      key={label}
                      className="rounded-lg border border-border bg-card/40 p-3 opacity-60"
                    >
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-muted-foreground">
                        —
                      </p>
                    </div>
                  )
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled
                className="mt-3"
              >
                Connect Google Search Console
              </Button>
            </section>
          </TabsContent>
        </Tabs>
      )}

      <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5">
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Past runs by date — click to view that snapshot&apos;s results above.
        </p>
        <HistoryList
          snapshots={snapshots}
          selectedId={active?.id}
          onSelect={(s) => {
            setActive(s)
            setLiveResults(null)
            setPanelState(emptyPanelState())
            setSummary('')
            setSummaryError('')
          }}
        />
      </section>
    </div>
  )
}
