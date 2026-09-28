import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Route,
  TrendingDown,
  TrendingUp,
  Minus,
  X,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// API health intro

const REVEAL_MS = 420
const RESOLVE_MS = 380

function statusOf(service, resolved) {
  if (!resolved || !service) return 'checking'
  return service.ok ? 'ok' : 'down'
}

function StatusDot({ status }) {
  if (status === 'checking') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
  }
  if (status === 'ok') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    )
  }
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white">
      <X className="h-2.5 w-2.5" strokeWidth={3} />
    </span>
  )
}

function docsLine(s, staleAfter) {
  if (s.docsAgeDays == null) return null
  const age = s.docsAgeDays === 0 ? 'today' : `${s.docsAgeDays}d ago`
  return s.docsStale
    ? `Endpoint map last verified ${age} — review due (>${staleAfter}d)`
    : `Endpoint map verified ${age}`
}

/**
 * Plays once per page load: services slide in one by one, each resolves to
 * green/red. Then collapses into a compact bar that can be expanded to see
 * every endpoint the data agent can reach.
 */
export function ApiHealthIntro({ health, loading, error, onRecheck }) {
  const reduce = useReducedMotion()
  const services = health?.services || []
  const placeholder = [
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'semrush', name: 'Semrush' },
    { id: 'dataforseo', name: 'DataForSEO' },
    { id: 'moz', name: 'Moz' },
  ]
  const list = services.length ? services : placeholder

  const [revealed, setRevealed] = useState(reduce ? list.length : 0)
  const [resolvedCount, setResolvedCount] = useState(reduce ? list.length : 0)
  const [expanded, setExpanded] = useState(false)
  const [phase, setPhase] = useState('intro') // intro | bar

  useEffect(() => {
    if (reduce || revealed >= list.length) return
    const t = setTimeout(() => setRevealed((n) => n + 1), revealed === 0 ? 120 : REVEAL_MS)
    return () => clearTimeout(t)
  }, [revealed, list.length, reduce])

  useEffect(() => {
    if (!health || reduce) {
      if (health) setResolvedCount(list.length)
      return
    }
    if (resolvedCount >= revealed) return
    const t = setTimeout(() => setResolvedCount((n) => n + 1), RESOLVE_MS)
    return () => clearTimeout(t)
  }, [health, revealed, resolvedCount, list.length, reduce])

  const allResolved = health && resolvedCount >= list.length
  const downCount = services.filter((s) => !s.ok).length
  const staleCount = services.filter((s) => s.docsStale).length
  const endpointTotal = services.reduce((n, s) => n + (s.endpointCount || 0), 0)

  useEffect(() => {
    if (!allResolved || phase !== 'intro') return
    const t = setTimeout(() => setPhase('bar'), reduce ? 0 : 1100)
    return () => clearTimeout(t)
  }, [allResolved, phase, reduce])

  if (error && !health) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
        <span>Couldn’t check data APIs: {error}</span>
        <Button size="sm" variant="outline" className="h-7" onClick={onRecheck}>
          Check again
        </Button>
      </div>
    )
  }

  return (
    <div className="border-b border-border">
      <AnimatePresence initial={false} mode="wait">
        {phase === 'intro' ? (
          <motion.div
            key="intro"
            initial={false}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="px-4 py-3"
          >
            <p className="text-xs text-muted-foreground">
              Checking the data sources this advisor can use
            </p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {list.slice(0, revealed).map((s, i) => {
                const status = statusOf(
                  services.find((x) => x.id === s.id),
                  health && i < resolvedCount
                )
                const svc = services.find((x) => x.id === s.id) || s
                return (
                  <motion.li
                    key={s.id}
                    initial={reduce ? false : { opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.28, ease: 'easeOut' }}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2.5 py-2 transition-colors duration-300',
                      status === 'ok' && 'border-emerald-500/40 bg-emerald-500/5',
                      status === 'down' && 'border-destructive/40 bg-destructive/5',
                      status === 'checking' && 'border-border bg-card'
                    )}
                  >
                    <StatusDot status={status} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{s.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {status === 'checking'
                          ? 'Checking…'
                          : status === 'ok'
                            ? svc.detail || 'Healthy'
                            : svc.detail || 'Not reachable'}
                      </p>
                    </div>
                  </motion.li>
                )
              })}
            </ul>
          </motion.div>
        ) : (
          <motion.div
            key="bar"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-expanded={expanded}
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Data sources
              </button>
              {services.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      s.ok ? 'bg-emerald-500' : 'bg-destructive'
                    )}
                  />
                  {s.name}
                </span>
              ))}
              <span className="text-[11px] text-muted-foreground">
                {downCount === 0
                  ? `All healthy, ${endpointTotal} endpoints mapped`
                  : `${downCount} down — the data agent will route around it`}
              </span>
              {staleCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  Endpoint map review due
                </span>
              )}
              <button
                type="button"
                onClick={onRecheck}
                disabled={loading}
                className="ml-auto flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
                Recheck
              </button>
            </div>
            {expanded && (
              <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-3">
                {services
                  .filter((s) => s.endpointCount)
                  .map((s) => (
                    <div key={s.id} className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={s.ok ? 'ok' : 'down'} />
                        <p className="text-xs font-medium">{s.name}</p>
                        {s.latencyMs != null && (
                          <span className="text-[11px] text-muted-foreground">{s.latencyMs} ms</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{s.detail}</p>
                      <p
                        className={cn(
                          'mt-0.5 text-[11px]',
                          s.docsStale ? 'text-amber-700' : 'text-muted-foreground'
                        )}
                      >
                        {docsLine(s, health?.docsStaleAfterDays)}{' '}
                        <a
                          href={s.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                        >
                          Docs
                        </a>
                      </p>
                      <ul className="mt-1.5 space-y-0.5">
                        {s.endpoints.map((e) => (
                          <li key={e.id} className="text-[11px] leading-snug text-foreground/80">
                            {e.label}
                            <span className="text-muted-foreground"> — {e.answers.join(', ')}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data agent trace (inline in chat)

export function RouterTrace({ item }) {
  const endpoints = item.endpoints || []
  const calls = item.calls || []
  const rows = endpoints.length
    ? endpoints
    : calls.map((c, i) => ({
        id: `${c.endpoint}-${i}`,
        name: c.endpoint,
        provider: c.provider,
        state: c.ok ? 'ok' : 'fail',
      }))
  return (
    <div className="mr-auto w-full rounded-md border border-dashed border-border px-3 py-2 text-xs">
      <div className="flex items-start gap-1.5 text-muted-foreground">
        <Route className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          <span className="text-foreground">Data agent:</span> {item.question}
        </p>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]',
                r.state === 'fail'
                  ? 'border-destructive/40 text-destructive'
                  : 'border-border text-foreground/80'
              )}
            >
              {r.state === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : r.state === 'ok' ? (
                <Check className="h-3 w-3 text-emerald-600" />
              ) : (
                <X className="h-3 w-3" />
              )}
              {r.provider}: {r.label || r.name}
            </li>
          ))}
        </ul>
      ) : (
        !item.done && (
          <p className="mt-1 flex items-center gap-1 pl-5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Choosing endpoints…
          </p>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage 1 verdict

const VERDICT = {
  go: { label: 'Go', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-800' },
  cautious: { label: 'Go with caution', cls: 'border-amber-500/50 bg-amber-500/10 text-amber-900' },
  pass: { label: 'Pass', cls: 'border-border bg-muted text-foreground' },
}

export function IdeationVerdictCard({ card, disabled, onContinue }) {
  const v = VERDICT[card.verdict] || VERDICT.cautious
  const rows = [
    ['Demand', card.demand],
    ['Trend', card.trend],
    ['Competition', card.competition],
    ['Clear path', card.path],
  ]
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Idea check: {card.topic}</p>
        <span className={cn('rounded border px-2 py-0.5 text-xs font-medium', v.cls)}>{v.label}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([k, val]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="leading-relaxed">{val || 'No data'}</dd>
          </React.Fragment>
        ))}
        <dt className="text-muted-foreground">Next step</dt>
        <dd className="font-medium leading-relaxed">{card.next_step}</dd>
      </dl>
      {card.verdict !== 'pass' && onContinue && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" disabled={disabled} onClick={() => onContinue(card)}>
            Pick core keywords
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage 2/3 keyword proposal

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString()
}

function TrendChip({ trend }) {
  if (!trend) return <span className="text-muted-foreground">—</span>
  const Icon = trend.direction === 'rising' ? TrendingUp : trend.direction === 'falling' ? TrendingDown : Minus
  const cls =
    trend.direction === 'rising'
      ? 'text-emerald-700'
      : trend.direction === 'falling'
        ? 'text-destructive'
        : 'text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center gap-1', cls)} title={trend.basis}>
      <Icon className="h-3.5 w-3.5" />
      {trend.changePct != null ? `${trend.changePct > 0 ? '+' : ''}${trend.changePct}%` : trend.direction}
    </span>
  )
}

function kdTone(kd) {
  if (kd == null) return ''
  if (kd >= 70) return 'text-destructive'
  if (kd >= 45) return 'text-amber-700'
  return 'text-emerald-700'
}

export function KeywordProposalCard({ card, disabled, onApprove, onSkip }) {
  const [busy, setBusy] = useState(false)
  const status = card.status || 'pending'
  const isCore = card.kind === 'core'
  const approvedAfter = (card.approvedCount || 0) + (status === 'approved' ? 1 : 0)
  const progress = isCore
    ? `${approvedAfter} of ${card.target?.min ?? 5}–${card.target?.max ?? 7} core keywords`
    : `${approvedAfter} of ${card.target?.max ?? 5} clusters for ${card.core_keyword}`

  async function run(fn) {
    if (busy || disabled) return
    setBusy(true)
    try {
      await fn(card)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      layout
      className={cn(
        'rounded-lg border bg-card p-3',
        status === 'pending' && 'border-primary/40',
        status === 'approved' && 'border-emerald-500/40',
        status === 'skipped' && 'border-border opacity-60'
      )}
    >
      <p className="text-[11px] text-muted-foreground">
        {isCore ? 'Proposed core keyword' : `Proposed cluster under “${card.core_keyword}”`}
      </p>
      <p className="mt-0.5 text-lg font-semibold leading-snug">{card.keyword}</p>

      <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Volume</dt>
          <dd className="font-medium tabular-nums">{fmt(card.search_volume)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">KD</dt>
          <dd className={cn('font-medium tabular-nums', kdTone(card.difficulty))}>{fmt(card.difficulty)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Trend</dt>
          <dd className="font-medium">
            <TrendChip trend={card.trend} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Intent</dt>
          <dd className="font-medium capitalize">{card.intent || '—'}</dd>
        </div>
      </dl>

      {card.rationale && <p className="mt-2 text-xs leading-relaxed text-foreground/85">{card.rationale}</p>}
      {card.sources?.length > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">Numbers from {card.sources.join(', ')}</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{progress}</p>
        {status === 'pending' ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => run(onSkip)}>
              Skip
            </Button>
            <Button size="sm" disabled={busy || disabled} onClick={() => run(onApprove)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {isCore ? 'Approve core keyword' : 'Approve cluster'}
            </Button>
          </div>
        ) : (
          <p
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              status === 'approved' ? 'text-emerald-700' : 'text-muted-foreground'
            )}
          >
            {status === 'approved' ? (
              <>
                <Check className="h-3.5 w-3.5" /> Saved to Company Intelligence
              </>
            ) : (
              'Skipped'
            )}
          </p>
        )}
      </div>
    </motion.div>
  )
}
