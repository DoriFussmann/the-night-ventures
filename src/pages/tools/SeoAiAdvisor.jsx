import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bot,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  X,
  AlertTriangle,
  Check,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Lock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  deleteSession,
  getComposerFields,
  getSession,
  listSessions,
  messagesToUi,
  patchInsight,
  pushKeywords,
  saveAudience,
  saveClusters,
  savePillars,
  saveSessionShortlist,
  saveShortlistInsight,
  streamChat,
} from './seoAdvisor/api'
import { PROMPTS } from './seoAdvisor/constants'
import {
  dataCardsFromMessages,
  toolResultToDataCard,
} from './seoAdvisor/dataCards'
import ChatMarkdown from './seoAdvisor/ChatMarkdown'
import DataPanel from './seoAdvisor/DataPanel'
import PromptComposer from './seoAdvisor/PromptComposer'
import Shortlist from './seoAdvisor/Shortlist'
import PushToCiModal from './seoAdvisor/PushToCiModal'

function formatSessionLabel(session) {
  if (session?.title) return session.title
  if (!session?.updated_at && !session?.created_at) return 'New session'
  const d = new Date(session.updated_at || session.created_at)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function scoreShortlist(items) {
  const volumes = items.map((item) => Number(item.search_volume) || 0)
  const maxVolume = Math.max(10, ...volumes, 10)
  return items
    .map((item) => {
      const volume = Math.max(Number(item.search_volume) || 0, 10)
      const demand = Math.log10(volume) / Math.log10(maxVolume)
      const attain =
        item.difficulty == null ? 0.5 : (100 - Number(item.difficulty)) / 100
      const intent = String(item.intent || '').toLowerCase()
      const fit = !intent ? 0.85 : intent.includes('commercial') ? 1 : 0.72
      const score = Math.round((demand * 0.4 + attain * 0.35 + fit * 0.25) * 100)
      return { ...item, score }
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0))
}

function ToolStatusBar({ activeTools }) {
  return (
    <AnimatePresence>
      {activeTools.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.22 }}
          className="flex flex-wrap gap-2 px-1 pb-2"
        >
          {activeTools.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2.5 py-1 text-xs text-foreground/80"
            >
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span>Checking {t.provider}…</span>
            </motion.div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const ADVISOR_STEPS = [
  {
    mode: 'seo_approach',
    label: 'SEO Approach',
    lockedHint: '',
  },
  {
    mode: 'pillar_advisory',
    label: 'Pillars',
    lockedHint: 'Complete SEO Approach (audience) first.',
  },
  {
    mode: 'cluster_advisory',
    label: 'Clusters',
    lockedHint: 'Add at least 4 pillars first.',
  },
]

function stepStatus(mode, { hasAudience, pillarCount, hasCluster }) {
  if (mode === 'seo_approach') return hasAudience ? 'done' : 'available'
  if (mode === 'pillar_advisory') {
    if (!hasAudience) return 'locked'
    return pillarCount >= 4 ? 'done' : 'available'
  }
  if (mode === 'cluster_advisory') {
    if (pillarCount < 4) return 'locked'
    return hasCluster ? 'done' : 'available'
  }
  return 'locked'
}

function AdvisorStepper({
  activeMode,
  hasAudience,
  pillarCount = 0,
  hasCluster = false,
  disabled,
  onSelect,
}) {
  return (
    <div className="border-b border-border px-4 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Advisor
      </p>
      <ol className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {ADVISOR_STEPS.map((step, index) => {
          const status = stepStatus(step.mode, {
            hasAudience,
            pillarCount,
            hasCluster,
          })
          const active = activeMode === step.mode
          const clickable = status !== 'locked' && !disabled
          return (
            <li key={step.mode} className="flex items-center gap-1.5">
              {index > 0 && (
                <span className="text-muted-foreground/50" aria-hidden>
                  →
                </span>
              )}
              <button
                type="button"
                disabled={!clickable}
                title={status === 'locked' ? step.lockedHint : undefined}
                onClick={() => onSelect(step.mode)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] transition-colors',
                  status === 'locked' &&
                    'cursor-not-allowed border-dashed border-border text-muted-foreground',
                  status === 'available' &&
                    'border-border bg-card text-foreground hover:bg-accent/60',
                  status === 'done' &&
                    'border-emerald-500/40 bg-emerald-500/10 text-foreground hover:bg-emerald-500/15',
                  active && 'ring-1 ring-foreground/30'
                )}
              >
                {step.label}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {status === 'locked'
                    ? `· ${step.lockedHint}`
                    : status === 'done'
                      ? '· done'
                      : '· available'}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function AudienceProposalCard({ card, disabled, onConfirm }) {
  const [phase, setPhase] = useState(card.confirmed ? 'confirmed' : 'ready')
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPhase(card.confirmed ? 'confirmed' : 'ready')
  }, [card.confirmed, card.id])

  async function confirm(override) {
    if (busy || disabled) return
    setBusy(true)
    try {
      const data = await onConfirm({
        audience_text: card.audience_text,
        override,
      })
      if (data?.needsOverride) {
        setCurrent(data.current || '')
        setPhase('override')
        return
      }
      setPhase('confirmed')
    } catch {
      // parent surfaces the error
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'confirmed') {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Audience proposal
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5" /> Saved to Company Intelligence
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
        Audience proposal
      </p>
      {card.brief && (
        <div className="mt-2">
          <p className="text-[11px] font-medium text-muted-foreground">Brief</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {card.brief}
          </p>
        </div>
      )}
      {card.audience_text && (
        <div className="mt-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            Audience
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {card.audience_text}
          </p>
        </div>
      )}
      {phase === 'override' && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <p className="font-medium text-amber-900">
            Company Intelligence already has a target audience.
          </p>
          <p className="mt-1 whitespace-pre-wrap text-foreground/80">{current}</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setPhase('ready')}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setPhase('ready')}
            >
              Keep existing
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => confirm(true)}
            >
              {busy ? 'Saving…' : 'Override'}
            </Button>
          </div>
        </div>
      )}
      {phase === 'ready' && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={busy || disabled}
            onClick={() => confirm(false)}
          >
            {busy ? 'Saving…' : 'Confirm — save to Company Intelligence'}
          </Button>
        </div>
      )}
    </div>
  )
}

function formatMetric(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString()
}

function PillarsProposalCard({ card, disabled, onConfirm, existingSlugs = [] }) {
  const [phase, setPhase] = useState(card.confirmed ? 'confirmed' : 'ready')
  const [busy, setBusy] = useState(false)
  const saved = new Set(existingSlugs)

  useEffect(() => {
    setPhase(card.confirmed ? 'confirmed' : 'ready')
  }, [card.confirmed, card.id])

  async function confirm() {
    if (busy || disabled) return
    setBusy(true)
    try {
      await onConfirm({ pillars: card.pillars || [] })
      setPhase('confirmed')
    } catch {
      // parent surfaces the error
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'confirmed') {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Pillar proposal
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5" /> Pillars saved
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
        Pillar proposal
      </p>
      {card.rationale && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
          {card.rationale}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {(card.pillars || []).map((pillar) => {
          const already = saved.has(
            String(pillar.keyword || '')
              .toLowerCase()
              .trim()
              .replace(/[^\w\s-]/g, '')
              .replace(/[\s_-]+/g, '-')
              .replace(/^-+|-+$/g, '')
          )
          return (
            <li
              key={pillar.keyword}
              className="rounded-md border border-border/80 px-2.5 py-2 text-sm"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">{pillar.keyword}</p>
                {already && (
                  <span className="text-[10px] text-muted-foreground">
                    already saved
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                vol {formatMetric(pillar.search_volume)} · KD{' '}
                {formatMetric(pillar.difficulty)}
              </p>
              {pillar.note && (
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                  {pillar.note}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" disabled={busy || disabled} onClick={confirm}>
          {busy ? 'Saving…' : 'Confirm — save pillars'}
        </Button>
      </div>
    </div>
  )
}

function CoverageTree({ pillars = [] }) {
  return (
    <div className="mb-3">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Coverage ({pillars.length} pillars)
      </p>
      {pillars.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          No pillars saved yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {pillars.map((pillar) => {
            const supporting = Array.isArray(pillar.supporting)
              ? pillar.supporting
              : []
            return (
              <li
                key={pillar.slug || pillar.keyword}
                className="rounded-md border border-border/80 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5 text-xs">
                  {pillar.locked && (
                    <Lock
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      aria-label="Locked pillar"
                    />
                  )}
                  <span className="min-w-0 truncate font-medium">
                    {pillar.keyword}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {supporting.length}
                  </span>
                </div>
                {supporting.length > 0 && (
                  <ul className="mt-1 space-y-0.5 border-l border-border/70 pl-2">
                    {supporting.map((item) => (
                      <li
                        key={item.slug || item.keyword}
                        className="flex items-center gap-1.5 text-[11px] text-foreground/85"
                      >
                        {item.locked && (
                          <Lock
                            className="h-3 w-3 shrink-0 text-muted-foreground"
                            aria-label="Locked supporting"
                          />
                        )}
                        <span className="min-w-0 truncate">{item.keyword}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ClusterPillarPicker({ pillars = [], selectedSlug, disabled, onSelect }) {
  return (
    <div className="space-y-1.5 border-t border-border px-2 py-2">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Work on a pillar
      </p>
      {pillars.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          Save at least 4 pillars first.
        </p>
      ) : (
        <ul className="space-y-1">
          {pillars.map((pillar) => {
            const supporting = Array.isArray(pillar.supporting)
              ? pillar.supporting
              : []
            const selected = selectedSlug === (pillar.slug || '')
            return (
              <li key={pillar.slug || pillar.keyword}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(pillar)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                    selected
                      ? 'border-border bg-accent'
                      : 'border-transparent hover:bg-accent/50'
                  )}
                >
                  {pillar.locked && (
                    <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {pillar.keyword}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {supporting.length} supporting
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ClustersProposalCard({ card, disabled, onConfirm, existingSlugs = [] }) {
  const [phase, setPhase] = useState(card.confirmed ? 'confirmed' : 'ready')
  const [busy, setBusy] = useState(false)
  const saved = new Set(existingSlugs)

  useEffect(() => {
    setPhase(card.confirmed ? 'confirmed' : 'ready')
  }, [card.confirmed, card.id])

  async function confirm() {
    if (busy || disabled) return
    setBusy(true)
    try {
      await onConfirm({
        pillarSlug: card.pillar_slug,
        pillarKeyword: card.pillar_keyword,
        clusters: card.clusters || [],
      })
      setPhase('confirmed')
    } catch {
      // parent surfaces the error
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'confirmed') {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Cluster proposal · {card.pillar_keyword || 'pillar'}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5" /> Clusters saved
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
        Cluster proposal · {card.pillar_keyword || 'pillar'}
      </p>
      {card.rationale && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
          {card.rationale}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {(card.clusters || []).map((item) => {
          const already = saved.has(
            String(item.keyword || '')
              .toLowerCase()
              .trim()
              .replace(/[^\w\s-]/g, '')
              .replace(/[\s_-]+/g, '-')
              .replace(/^-+|-+$/g, '')
          )
          return (
            <li
              key={item.keyword}
              className="rounded-md border border-border/80 px-2.5 py-2 text-sm"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">{item.keyword}</p>
                {already && (
                  <span className="text-[10px] text-muted-foreground">
                    already saved
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                vol {formatMetric(item.search_volume)} · KD{' '}
                {formatMetric(item.difficulty)}
              </p>
              {item.note && (
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                  {item.note}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button type="button" size="sm" disabled={busy || disabled} onClick={confirm}>
          {busy ? 'Saving…' : 'Confirm — save clusters'}
        </Button>
      </div>
    </div>
  )
}

function InsightCard({ insight, onDismiss, onApply, busy }) {
  const conflict = Boolean(insight.conflicts_with_profile)
  const canApply =
    conflict && insight.status === 'new' && insight.profile_patch?.field

  return (
    <motion.article
      layout
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'rounded-lg border bg-card p-3 shadow-sm',
        conflict ? 'border-amber-500/70' : 'border-border'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{insight.title}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-[10px] font-normal">
              {insight.insight_type}
            </Badge>
            {insight.source_tool && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {insight.source_tool}
              </Badge>
            )}
            {conflict && (
              <Badge className="border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-800">
                Profile conflict
              </Badge>
            )}
          </div>
        </div>
        {insight.status === 'new' && (
          <button
            type="button"
            title="Dismiss"
            disabled={busy}
            onClick={() => onDismiss(insight)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
        {insight.body}
      </p>
      {canApply && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-7 border-amber-500/50 text-xs"
          disabled={busy}
          onClick={() => onApply(insight)}
        >
          <AlertTriangle className="h-3 w-3" />
          Update Profile
        </Button>
      )}
      {insight.status === 'applied' && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="h-3 w-3" /> Applied to profile
        </p>
      )}
    </motion.article>
  )
}

function PromptCards({ onPick, disabled, hasAudience, pillarCount = 0 }) {
  return (
    <div className="space-y-1.5 p-2">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Prompts
      </p>
      {PROMPTS.map((prompt) => {
        const needsAudience = Boolean(prompt.requiresAudience && !hasAudience)
        const needsPillars = Boolean(
          prompt.requiresMinPillars && pillarCount < prompt.requiresMinPillars
        )
        const locked = needsAudience || needsPillars
        return (
          <button
            key={prompt.id}
            type="button"
            disabled={disabled || locked}
            onClick={() => onPick(prompt)}
            className="w-full rounded-lg border border-border bg-card/60 p-3 text-left transition-colors hover:bg-accent/60 disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-foreground">{prompt.title}</p>
              {prompt.badge && (
                <Badge className="text-[9px] font-normal">{prompt.badge}</Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
              {needsAudience
                ? 'Complete SEO Approach (audience) first.'
                : needsPillars
                  ? 'Add at least 4 pillars first.'
                  : prompt.desc}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function SessionList({ loadingList, sessions, sessionId, sending, onOpen }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Topics
      </p>
      <ScrollArea className="flex-1 px-2 pb-3">
        {loadingList ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No past topics yet.
          </p>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpen(s.id)}
                disabled={sending}
                className={cn(
                  'w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
                  sessionId === s.id
                    ? 'border-border bg-accent'
                    : 'border-transparent hover:bg-accent/50'
                )}
              >
                <span className="line-clamp-2 leading-snug">
                  {formatSessionLabel(s)}
                </span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

export default function SeoAiAdvisor() {
  const { companyId } = useParams()
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [sessionTitle, setSessionTitle] = useState(null)
  const [messages, setMessages] = useState([])
  const [insights, setInsights] = useState([])
  const [dataCards, setDataCards] = useState([])
  const [shortlist, setShortlist] = useState([])
  const [sessionSpend, setSessionSpend] = useState(0)
  const [ciFields, setCiFields] = useState(null)
  const [composerPrompt, setComposerPrompt] = useState(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [input, setInput] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingSession, setLoadingSession] = useState(false)
  const [sending, setSending] = useState(false)
  const [savingShortlist, setSavingShortlist] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState('')
  const [activeTools, setActiveTools] = useState([])
  const [insightBusyId, setInsightBusyId] = useState(null)
  const [providerHealth, setProviderHealth] = useState(null)
  const [advisorMode, setAdvisorMode] = useState('seo_approach')
  const [focusPillar, setFocusPillar] = useState(null)
  const chatScrollRef = useRef(null)
  const abortRef = useRef(null)
  const sessionIdRef = useRef(null)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    setFocusPillar((prev) => {
      if (!prev?.slug) return prev
      const next = (ciFields?.pillars || []).find(
        (pillar) => pillar.slug === prev.slug
      )
      return next || prev
    })
  }, [ciFields])

  const refreshSessions = useCallback(async () => {
    if (!companyId) return
    const data = await listSessions(companyId)
    setSessions(data.sessions || [])
    if (data.providerHealth) setProviderHealth(data.providerHealth)
  }, [companyId])

  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoadingList(true)
      setError('')
      try {
        await refreshSessions()
        try {
          const fields = await getComposerFields(companyId)
          if (!cancelled) setCiFields(fields)
        } catch (ciErr) {
          console.error('Failed to load composer fields:', ciErr)
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load sessions')
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    }
    init()
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [companyId, refreshSessions])

  useEffect(() => {
    const el = chatScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, activeTools, sending])

  useEffect(() => {
    const sid = sessionIdRef.current
    if (!companyId || !sid) return undefined
    const timer = setTimeout(() => {
      saveSessionShortlist({
        companyId,
        sessionId: sid,
        shortlist,
      }).catch(() => {})
    }, 400)
    return () => clearTimeout(timer)
  }, [shortlist, companyId])

  async function openSession(id) {
    if (!companyId || !id) return
    setLoadingSession(true)
    setError('')
    try {
      const data = await getSession(companyId, id)
      setSessionId(data.session.id)
      setSessionTitle(data.session.title)
      setMessages(
        messagesToUi(data.messages, {
          targetAudience: ciFields?.target_audience,
          pillars: ciFields?.pillars,
        })
      )
      setInsights(data.insights || [])
      setDataCards(dataCardsFromMessages(data.messages))
      setShortlist(Array.isArray(data.session.shortlist) ? data.session.shortlist : [])
      setSessionSpend(0)
      if (data.providerHealth) setProviderHealth(data.providerHealth)
    } catch (err) {
      setError(err.message || 'Failed to open session')
    } finally {
      setLoadingSession(false)
    }
  }

  function startNewSession() {
    abortRef.current?.abort()
    setSessionId(null)
    setSessionTitle(null)
    setMessages([])
    setInsights([])
    setDataCards([])
    setShortlist([])
    setSessionSpend(0)
    setInput('')
    setActiveTools([])
    setError('')
  }

  async function handleSend(overrideText) {
    const text = String(overrideText ?? input).trim()
    if (!text || !companyId || sending) return
    if (advisorMode === 'cluster_advisory' && !focusPillar?.slug) {
      setError('Pick a pillar first.')
      return
    }

    setSending(true)
    setError('')
    setInput('')
    setActiveTools([])

    const tempUserId = `local-user-${Date.now()}`
    const tempAsstId = `local-asst-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: 'user', text },
      { id: tempAsstId, role: 'assistant', text: '', streaming: true },
    ])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat({
        companyId,
        sessionId,
        message: text,
        mode: advisorMode,
        pillarSlug:
          advisorMode === 'cluster_advisory' ? focusPillar?.slug : undefined,
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === 'session') {
            sessionIdRef.current = data.id
            setSessionId(data.id)
            if (data.title) setSessionTitle(data.title)
          } else if (event === 'title') {
            setSessionTitle(data.title)
            const sid = sessionIdRef.current
            setSessions((prev) =>
              prev.map((s) => (s.id === sid ? { ...s, title: data.title } : s))
            )
          } else if (event === 'text_delta') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAsstId
                  ? { ...m, text: (m.text || '') + (data.text || '') }
                  : m
              )
            )
          } else if (event === 'tool_start') {
            setActiveTools((prev) => [
              ...prev.filter((t) => t.id !== data.id),
              { id: data.id, name: data.name, provider: data.provider },
            ])
          } else if (event === 'tool_end') {
            setActiveTools((prev) => prev.filter((t) => t.id !== data.id))
          } else if (event === 'tool_data') {
            const card = toolResultToDataCard(data.name, data.result, {
              id: data.id,
            })
            if (card) {
              setDataCards((prev) => {
                if (prev.some((c) => c.id === card.id)) return prev
                return [...prev, card]
              })
            }
          } else if (event === 'audience_proposal') {
            setMessages((prev) => [
              ...prev,
              {
                id: `audience-${Date.now()}`,
                role: 'audience_proposal',
                brief: data.brief || '',
                audience_text: data.audience_text || '',
                confirmed: false,
              },
            ])
          } else if (event === 'pillars_proposal') {
            setMessages((prev) => [
              ...prev,
              {
                id: `pillars-${Date.now()}`,
                role: 'pillars_proposal',
                rationale: data.rationale || '',
                pillars: Array.isArray(data.pillars) ? data.pillars : [],
                confirmed: false,
              },
            ])
          } else if (event === 'clusters_proposal') {
            setMessages((prev) => [
              ...prev,
              {
                id: `clusters-${Date.now()}`,
                role: 'clusters_proposal',
                pillar_slug: data.pillar_slug || '',
                pillar_keyword: data.pillar_keyword || '',
                rationale: data.rationale || '',
                clusters: Array.isArray(data.clusters) ? data.clusters : [],
                confirmed: false,
              },
            ])
          } else if (event === 'insight') {
            setInsights((prev) => {
              if (prev.some((i) => i.id === data.id)) return prev
              return [...prev, data]
            })
          } else if (event === 'error') {
            setError(data.error || 'Chat error')
          } else if (event === 'done') {
            if (data.providerHealth) setProviderHealth(data.providerHealth)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAsstId ? { ...m, streaming: false } : m
              )
            )
          }
        },
      })
      await refreshSessions()
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Chat failed')
        setMessages((prev) =>
          prev.filter((m) => m.id !== tempAsstId || (m.text && m.text.trim()))
        )
      }
    } finally {
      setActiveTools([])
      setSending(false)
      abortRef.current = null
    }
  }

  async function handleSaveAudience({ audience_text, override }) {
    try {
      const data = await saveAudience({
        companyId,
        audience_text,
        override,
      })
      if (data?.needsOverride) return data
      toast({ title: 'Saved to Company Intelligence' })
      setMessages((prev) =>
        prev.map((m) =>
          m.role === 'audience_proposal' && m.audience_text === audience_text
            ? { ...m, confirmed: true }
            : m
        )
      )
      try {
        const fields = await getComposerFields(companyId)
        setCiFields(fields)
      } catch {
        // keep the saved toast even if composer fields fail to refresh
      }
      return data
    } catch (err) {
      setError(err.message || 'Failed to save audience')
      throw err
    }
  }

  async function handleSavePillars({ pillars }) {
    try {
      const data = await savePillars({ companyId, pillars })
      toast({ title: `Pillars saved (${data.count ?? pillars.length})` })
      setMessages((prev) =>
        prev.map((m) =>
          m.role === 'pillars_proposal' ? { ...m, confirmed: true } : m
        )
      )
      try {
        const fields = await getComposerFields(companyId)
        setCiFields(fields)
      } catch {
        // keep the saved toast even if composer fields fail to refresh
      }
      return data
    } catch (err) {
      setError(err.message || 'Failed to save pillars')
      throw err
    }
  }

  async function handleSaveClusters({ pillarSlug, pillarKeyword, clusters }) {
    try {
      const data = await saveClusters({
        companyId,
        pillarSlug,
        clusters,
      })
      const label = pillarKeyword || data.pillar?.keyword || 'pillar'
      toast({
        title: `Clusters saved for ${label} (${data.supportingCount ?? clusters.length})`,
      })
      setMessages((prev) =>
        prev.map((m) =>
          m.role === 'clusters_proposal' &&
          (m.pillar_slug === pillarSlug || m.pillar_keyword === pillarKeyword)
            ? { ...m, confirmed: true }
            : m
        )
      )
      try {
        const fields = await getComposerFields(companyId)
        setCiFields(fields)
      } catch {
        // keep the saved toast even if composer fields fail to refresh
      }
      return data
    } catch (err) {
      setError(err.message || 'Failed to save clusters')
      throw err
    }
  }

  function toggleStar(item) {
    setShortlist((prev) => {
      const exists = prev.some(
        (row) => row.keyword.toLowerCase() === item.keyword.toLowerCase()
      )
      if (exists) {
        return prev.filter(
          (row) => row.keyword.toLowerCase() !== item.keyword.toLowerCase()
        )
      }
      return [...prev, item]
    })
  }

  async function handleDismiss(insight) {
    setInsightBusyId(insight.id)
    try {
      await patchInsight({
        companyId,
        insightId: insight.id,
        action: 'dismiss',
      })
      setInsights((prev) => prev.filter((i) => i.id !== insight.id))
    } catch (err) {
      setError(err.message || 'Failed to dismiss insight')
    } finally {
      setInsightBusyId(null)
    }
  }

  async function handleApply(insight) {
    setInsightBusyId(insight.id)
    try {
      const data = await patchInsight({
        companyId,
        insightId: insight.id,
        action: 'apply_profile',
      })
      setInsights((prev) =>
        prev.map((i) => (i.id === insight.id ? data.insight : i))
      )
    } catch (err) {
      setError(err.message || 'Failed to update profile')
    } finally {
      setInsightBusyId(null)
    }
  }

  async function handleSaveInsight() {
    if (!shortlist.length) return
    setSavingShortlist(true)
    try {
      const data = await saveShortlistInsight({
        companyId,
        sessionId,
        items: shortlist,
        title: `Shortlist: ${sessionTitle || 'topic'}`,
      })
      if (data.insight) {
        setInsights((prev) =>
          prev.some((i) => i.id === data.insight.id)
            ? prev
            : [...prev, data.insight]
        )
      }
      toast({ title: 'Saved as insight.' })
    } catch (err) {
      setError(err.message || 'Failed to save insight')
    } finally {
      setSavingShortlist(false)
    }
  }

  async function handlePush(rows) {
    setPushing(true)
    try {
      const data = await pushKeywords({
        companyId,
        items: rows.map((row) => ({
          keyword: row.keyword,
          role: row.role,
          search_volume: row.search_volume,
          difficulty: row.difficulty,
          intent: row.intent,
          source: row.source,
        })),
      })
      const n = data.pushed ?? rows.filter((r) => r.role !== 'skip').length
      toast({
        title: `Pushed ${n} keywords to Company Intelligence`,
        description: data.warning || undefined,
      })
      setShortlist([])
      setPushOpen(false)
      const fields = await getComposerFields(companyId)
      setCiFields(fields)
    } catch (err) {
      setError(err.message || 'Failed to push keywords')
    } finally {
      setPushing(false)
    }
  }

  async function handleClearTopic() {
    if (!sessionId) {
      startNewSession()
      setClearOpen(false)
      return
    }
    try {
      await deleteSession({ companyId, sessionId })
      startNewSession()
      await refreshSessions()
      toast({ title: 'Topic cleared' })
    } catch (err) {
      setError(err.message || 'Failed to clear topic')
    } finally {
      setClearOpen(false)
    }
  }

  function handleSaveTopic() {
    if (!sessionId) {
      toast({ title: 'Nothing to save yet' })
      return
    }
    saveSessionShortlist({ companyId, sessionId, shortlist }).catch(() => {})
    toast({ title: 'Saved' })
  }

  const deadProviders = providerHealth
    ? Object.entries(providerHealth)
        .filter(([, v]) => v?.ok === false)
        .map(([k]) => k)
    : []

  const coveragePillars = Array.isArray(ciFields?.pillars) ? ciFields.pillars : []
  const pillarCount = coveragePillars.length
  const hasAudience = Boolean(String(ciFields?.target_audience || '').trim())
  const hasCluster = coveragePillars.some(
    (pillar) =>
      Array.isArray(pillar?.supporting) && pillar.supporting.length > 0
  )
  const clusterPrompt = PROMPTS.find((prompt) => prompt.id === 'cluster_advisory')

  function handlePickPrompt(prompt) {
    setAdvisorMode(prompt.mode || '')
    setComposerPrompt(prompt)
    if (prompt.id === 'cluster_advisory') {
      if (focusPillar) setComposerOpen(true)
      return
    }
    setComposerOpen(true)
  }

  function handleSelectStep(mode) {
    const prompt = PROMPTS.find((item) => item.mode === mode)
    if (!prompt) return
    handlePickPrompt(prompt)
  }

  function handlePickClusterPillar(pillar) {
    setFocusPillar(pillar)
    setAdvisorMode('cluster_advisory')
    setComposerPrompt(clusterPrompt)
    setComposerOpen(true)
  }

  const chatPane = (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="truncate text-xs font-medium">
          {sessionTitle || 'New topic'}
        </p>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" variant="outline" onClick={handleSaveTopic}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setClearOpen(true)}
          >
            Clear topic
          </Button>
        </div>
      </div>
      <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loadingSession ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading session…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.length === 0 && !sending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="h-4 w-4" />
                Pick a prompt on the left, or type your own.
              </div>
            )}
            {messages.map((m) => {
              if (m.role === 'audience_proposal') {
                return (
                  <AudienceProposalCard
                    key={m.id}
                    card={m}
                    disabled={sending}
                    onConfirm={handleSaveAudience}
                  />
                )
              }
              if (m.role === 'pillars_proposal') {
                return (
                  <PillarsProposalCard
                    key={m.id}
                    card={m}
                    disabled={sending}
                    existingSlugs={(ciFields?.pillars || []).map(
                      (pillar) => pillar.slug
                    )}
                    onConfirm={handleSavePillars}
                  />
                )
              }
              if (m.role === 'clusters_proposal') {
                const pillar = (ciFields?.pillars || []).find(
                  (item) =>
                    item.slug === m.pillar_slug ||
                    item.keyword === m.pillar_keyword
                )
                return (
                  <ClustersProposalCard
                    key={m.id}
                    card={m}
                    disabled={sending}
                    existingSlugs={(pillar?.supporting || []).map(
                      (item) => item.slug
                    )}
                    onConfirm={handleSaveClusters}
                  />
                )
              }
              return (
                <div
                  key={m.id}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm',
                    m.role === 'user'
                      ? 'ml-auto max-w-[85%] bg-primary text-primary-foreground'
                      : 'mr-auto w-full max-w-full border border-border bg-card'
                  )}
                >
                  {m.role === 'assistant' ? (
                    <ChatMarkdown>
                      {m.text || (m.streaming ? '…' : '')}
                    </ChatMarkdown>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border px-4 py-3">
        <ToolStatusBar activeTools={activeTools} />
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about pillars, competitors, traffic, or technical SEO…"
            className="min-h-[72px] flex-1 resize-none text-sm"
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <Button
            onClick={() => handleSend()}
            disabled={sending || !input.trim()}
            className="h-[72px] px-4"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </section>
  )

  const resultsPane = (
    <div className="flex h-full min-h-0 flex-col">
      <p className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Live Results
      </p>
      <ScrollArea className="flex-1 px-2 pb-3 pt-2">
        <CoverageTree pillars={ciFields?.pillars || []} />
        <DataPanel
          cards={dataCards}
          shortlist={shortlist}
          onToggleStar={toggleStar}
        />
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setInsightsOpen((v) => !v)}
            className="flex w-full items-center gap-1 px-1 py-1 text-[11px] text-muted-foreground"
          >
            {insightsOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Lightbulb className="h-3 w-3" />
            Insights ({insights.length})
          </button>
          {insightsOpen && (
            <div className="mt-2 space-y-2">
              <AnimatePresence initial={false}>
                {insights.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    Insights appear here live when the advisor saves them.
                  </p>
                ) : (
                  insights.map((insight) => (
                    <InsightCard
                      key={insight.id}
                      insight={insight}
                      busy={insightBusyId === insight.id}
                      onDismiss={handleDismiss}
                      onApply={handleApply}
                    />
                  ))
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-lg tracking-tight">
            <Sparkles className="h-4 w-4 text-primary" />
            SEO AI Advisor
          </h1>
          <p className="text-xs text-muted-foreground">
            Company-scoped research chat with Semrush, DataForSEO, and Moz
            {sessionSpend > 0 ? ` · ~${sessionSpend} credits this topic` : ''}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={startNewSession}
          disabled={sending}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New chat
        </Button>
      </header>

      <AdvisorStepper
        activeMode={advisorMode}
        hasAudience={hasAudience}
        pillarCount={pillarCount}
        hasCluster={hasCluster}
        disabled={sending}
        onSelect={handleSelectStep}
      />

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {deadProviders.length > 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-[11px] text-amber-900">
          Provider degraded: {deadProviders.join(', ')} (last call failed — chat
          will skip or mark unavailable)
        </div>
      )}

      <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={25} minSize={16}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={55} minSize={20}>
                <ScrollArea className="h-full">
                  <PromptCards
                    disabled={sending}
                    hasAudience={hasAudience}
                    pillarCount={pillarCount}
                    onPick={handlePickPrompt}
                  />
                  {advisorMode === 'cluster_advisory' && (
                    <ClusterPillarPicker
                      pillars={coveragePillars}
                      selectedSlug={focusPillar?.slug || ''}
                      disabled={sending}
                      onSelect={handlePickClusterPillar}
                    />
                  )}
                </ScrollArea>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={45} minSize={18}>
                <SessionList
                  loadingList={loadingList}
                  sessions={sessions}
                  sessionId={sessionId}
                  sending={sending}
                  onOpen={openSession}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            {chatPane}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={25} minSize={16}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={55} minSize={20}>
                {resultsPane}
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={45} minSize={18}>
                <Shortlist
                  items={shortlist}
                  onRemove={(keyword) =>
                    setShortlist((prev) =>
                      prev.filter((item) => item.keyword !== keyword)
                    )
                  }
                  onScore={() => setShortlist((prev) => scoreShortlist(prev))}
                  onSaveInsight={handleSaveInsight}
                  onPush={() => setPushOpen(true)}
                  onClear={() => setShortlist([])}
                  saving={savingShortlist}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:hidden">
        <PromptCards
          disabled={sending}
          hasAudience={hasAudience}
          pillarCount={pillarCount}
          onPick={handlePickPrompt}
        />
        {advisorMode === 'cluster_advisory' && (
          <ClusterPillarPicker
            pillars={coveragePillars}
            selectedSlug={focusPillar?.slug || ''}
            disabled={sending}
            onSelect={handlePickClusterPillar}
          />
        )}
        <div className="h-[min(70vh,640px)] min-h-[480px] overflow-hidden border-y border-border">
          {chatPane}
        </div>
        <div className="min-h-[280px]">{resultsPane}</div>
        <div className="min-h-[240px] border-t border-border">
          <Shortlist
            items={shortlist}
            onRemove={(keyword) =>
              setShortlist((prev) =>
                prev.filter((item) => item.keyword !== keyword)
              )
            }
            onScore={() => setShortlist((prev) => scoreShortlist(prev))}
            onSaveInsight={handleSaveInsight}
            onPush={() => setPushOpen(true)}
            onClear={() => setShortlist([])}
            saving={savingShortlist}
          />
        </div>
        <SessionList
          loadingList={loadingList}
          sessions={sessions}
          sessionId={sessionId}
          sending={sending}
          onOpen={openSession}
        />
      </div>

      <PromptComposer
        prompt={composerPrompt}
        ci={{
          ...ciFields,
          parent_pillar: focusPillar?.keyword || '',
          existing_supporting: (focusPillar?.supporting || [])
            .map((item) =>
              item.locked ? `${item.keyword} (locked)` : item.keyword
            )
            .filter(Boolean)
            .join('\n'),
        }}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onFeed={(text) => handleSend(text)}
      />
      <PushToCiModal
        open={pushOpen}
        onOpenChange={setPushOpen}
        items={shortlist}
        ci={ciFields}
        confirming={pushing}
        onConfirm={handlePush}
      />
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this topic?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the chat, results, and shortlist for this topic.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearTopic}>
              Clear topic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
