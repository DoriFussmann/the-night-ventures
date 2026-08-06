import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Check,
  Loader2,
  Camera,
  X,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import ScoreGauge, { scoreTone } from './auditSnapshot/ScoreGauge'
import { listSnapshots, runSnapshot } from './auditSnapshot/api'

const CATEGORY_LABELS = [
  { key: 'performance', label: 'Performance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'bestPractices', label: 'Best Practices' },
  { key: 'seo', label: 'SEO' },
]

const CHART_CONFIG = {
  performance: { label: 'Performance', color: 'hsl(142 71% 35%)' },
  accessibility: { label: 'Accessibility', color: 'hsl(221 70% 50%)' },
  bestPractices: { label: 'Best Practices', color: 'hsl(38 92% 45%)' },
  seo: { label: 'SEO', color: 'hsl(280 60% 45%)' },
}

function formatRunAt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function scoreCellClass(score) {
  const tone = scoreTone(score)
  if (tone === 'green') return 'text-emerald-600 dark:text-emerald-400'
  if (tone === 'yellow') return 'text-amber-600 dark:text-amber-400'
  if (tone === 'red') return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function CwVitalsSummary({ cwv }) {
  const origin = cwv?.origin || cwv?.url
  if (!origin?.overallCategory && !origin?.metrics) {
    return (
      <p className="text-xs text-muted-foreground">
        No Chrome UX Report field data for this URL/origin.
      </p>
    )
  }

  const metrics = origin.metrics || {}
  const rows = [
    { key: 'lcp', label: 'LCP' },
    { key: 'inp', label: 'INP' },
    { key: 'cls', label: 'CLS' },
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Core Web Vitals</span>
        {origin.overallCategory && (
          <Badge variant="outline" className="text-[10px]">
            {origin.overallCategory}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {rows.map(({ key, label }) => {
          const m = metrics[key]
          if (!m) return null
          return (
            <span key={key} className="tabular-nums text-foreground/80">
              <span className="text-muted-foreground">{label}</span>{' '}
              {m.percentile ?? '—'}
              {m.category ? (
                <span className="text-muted-foreground"> · {m.category}</span>
              ) : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function PagespeedPanel({ title, result }) {
  if (!result) {
    return (
      <section className="rounded-lg border border-border bg-card/40 p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-2 text-xs text-muted-foreground">No data</p>
      </section>
    )
  }

  if (!result.ok) {
    return (
      <section className="rounded-lg border border-border bg-card/40 p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="mt-3 flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{result.error || 'PageSpeed check failed'}</span>
        </div>
      </section>
    )
  }

  const scores = result.scores || {}

  return (
    <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {result.finalUrl && (
          <a
            href={result.finalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-[55%] items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{result.finalUrl}</span>
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {CATEGORY_LABELS.map(({ key, label }) => (
          <ScoreGauge key={key} label={label} score={scores[key]} />
        ))}
      </div>
      <div className="mt-5 border-t border-border/60 pt-3">
        <CwVitalsSummary cwv={result.coreWebVitals} />
      </div>
    </section>
  )
}

function BotAccessTable({ botAccess }) {
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

  const bots = botAccess.bots || {}
  const rows = Object.entries(bots)

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

function JsonLdPanel({ jsonld, sampleUrl }) {
  if (!jsonld) {
    return (
      <p className="text-xs text-muted-foreground">No JSON-LD data</p>
    )
  }

  if (!jsonld.ok) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{jsonld.error || 'JSON-LD check failed'}</span>
        </div>
        {(sampleUrl || jsonld.sampleUrl) && (
          <p className="text-[11px] text-muted-foreground">
            Sample URL: {sampleUrl || jsonld.sampleUrl}
          </p>
        )}
      </div>
    )
  }

  const types = jsonld.types || {}
  const typeRows = Object.entries(types)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(sampleUrl || jsonld.sampleUrl) && (
          <a
            href={sampleUrl || jsonld.sampleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            <span className="truncate max-w-[420px]">
              {sampleUrl || jsonld.sampleUrl}
            </span>
          </a>
        )}
        <Badge variant="outline" className="text-[10px]">
          {jsonld.blockCount ?? 0} script
          {(jsonld.blockCount ?? 0) === 1 ? '' : 's'}
        </Badge>
        {jsonld.allBlocksValidJson ? (
          <Badge
            variant="outline"
            className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400"
          >
            Valid JSON
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="border-red-500/40 text-[10px] text-red-600 dark:text-red-400"
          >
            {jsonld.parseFailures || 0} parse error
            {(jsonld.parseFailures || 0) === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Expected @type</TableHead>
            <TableHead className="w-[120px]">Status</TableHead>
            <TableHead>Matched as</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {typeRows.map(([type, info]) => {
            const present = Boolean(info?.present)
            return (
              <TableRow key={type}>
                <TableCell className="font-medium">
                  {type}
                  {type === 'Article' && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      (Article or BlogPosting)
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-xs font-medium',
                      present
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {present ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    {present ? 'Present' : 'Missing'}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {info?.matchedAs || '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function HistorySection({ snapshots, onSelect, selectedId }) {
  const chartData = useMemo(() => {
    const chronological = [...snapshots].reverse()
    return chronological.map((s) => {
      const scores = s.pagespeed_mobile?.scores || {}
      return {
        id: s.id,
        label: formatRunAt(s.run_at),
        performance: scores.performance ?? null,
        accessibility: scores.accessibility ?? null,
        bestPractices: scores.bestPractices ?? null,
        seo: scores.seo ?? null,
      }
    })
  }, [snapshots])

  if (snapshots.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No past snapshots yet. Run a snapshot to start the trend history.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {chartData.length >= 2 && (
        <ChartContainer config={CHART_CONFIG} className="aspect-[16/7] w-full">
          <LineChart data={chartData} margin={{ left: 8, right: 12, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={28}
              className="text-[10px]"
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              width={32}
              className="text-[10px]"
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {Object.keys(CHART_CONFIG).map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ChartContainer>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Past runs (mobile scores)
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Perf</TableHead>
              <TableHead className="text-right">A11y</TableHead>
              <TableHead className="text-right">BP</TableHead>
              <TableHead className="text-right">SEO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((s) => {
              const scores = s.pagespeed_mobile?.scores || {}
              const active = s.id === selectedId
              return (
                <TableRow
                  key={s.id}
                  className={cn(
                    'cursor-pointer',
                    active && 'bg-accent/50'
                  )}
                  onClick={() => onSelect?.(s)}
                >
                  <TableCell className="text-xs font-medium">
                    {formatRunAt(s.run_at)}
                  </TableCell>
                  {CATEGORY_LABELS.map(({ key }) => (
                    <TableCell
                      key={key}
                      className={cn(
                        'text-right text-xs tabular-nums font-medium',
                        scoreCellClass(scores[key])
                      )}
                    >
                      {scores[key] ?? '—'}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
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
  const [snapshots, setSnapshots] = useState([])
  const [active, setActive] = useState(null)
  const [meta, setMeta] = useState(null)

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

  const handleRun = async () => {
    if (!companyId || running) return
    setRunning(true)
    setError('')
    try {
      const data = await runSnapshot({
        companyId,
        siteUrl: siteUrl.trim() || undefined,
        sampleUrl: sampleUrl.trim() || undefined,
      })
      setMeta(data.meta || null)
      setActive(data.snapshot)
      setSnapshots((prev) => {
        const rest = prev.filter((s) => s.id !== data.snapshot.id)
        return [data.snapshot, ...rest]
      })
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Snapshot failed')
    } finally {
      setRunning(false)
    }
  }

  const title = companyName
    ? `${companyName} — External Audit Snapshot`
    : 'External Audit Snapshot'

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-1 pb-16 pt-2">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Point-in-time PageSpeed scores, AI/search bot access via robots.txt,
          and JSON-LD schema checks — stored for trend comparison.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="siteUrl">Site URL</Label>
            <Input
              id="siteUrl"
              placeholder={domain || 'https://example.com'}
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              disabled={running || loading}
            />
            <p className="text-[11px] text-muted-foreground">
              Defaults to Company Data domain when left as-is.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sampleUrl">Sample article URL (optional)</Label>
            <Input
              id="sampleUrl"
              placeholder="Auto: most recently published from coverage"
              value={sampleUrl}
              onChange={(e) => setSampleUrl(e.target.value)}
              disabled={running || loading}
            />
            <p className="text-[11px] text-muted-foreground">
              Used for JSON-LD validation. Leave blank to auto-select.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleRun} disabled={running || loading || !companyId}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running snapshot…
              </>
            ) : (
              <>
                <Camera className="mr-2 h-4 w-4" />
                Run Snapshot
              </>
            )}
          </Button>
          {running && (
            <span className="text-xs text-muted-foreground">
              PageSpeed can take 30–60s for mobile + desktop…
            </span>
          )}
          {meta?.siteUrl && !running && (
            <span className="text-xs text-muted-foreground">
              Last run against {meta.siteUrl}
              {meta.sampleSource === 'content_coverage' && meta.sampleTitle
                ? ` · article: ${meta.sampleTitle}`
                : ''}
            </span>
          )}
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : active ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-foreground/90">
              Snapshot results
            </h2>
            <span className="text-xs text-muted-foreground">
              {formatRunAt(active.run_at)}
            </span>
          </div>

          <PagespeedPanel
            title="PageSpeed — Mobile"
            result={active.pagespeed_mobile}
          />
          <PagespeedPanel
            title="PageSpeed — Desktop"
            result={active.pagespeed_desktop}
          />

          <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold">Bot access (robots.txt)</h3>
            <BotAccessTable botAccess={active.bot_access} />
          </section>

          <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold">JSON-LD validity</h3>
            <JsonLdPanel
              jsonld={active.jsonld_check}
              sampleUrl={active.sample_url}
            />
          </section>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No snapshots yet. Enter a site URL and run your first audit.
        </p>
      )}

      <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold">History & trends</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Mobile category scores over time. Click a past run to view its full
          snapshot above.
        </p>
        <HistorySection
          snapshots={snapshots}
          selectedId={active?.id}
          onSelect={setActive}
        />
      </section>
    </div>
  )
}
