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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

function ApprovalCard({ card, disabled, onDecide }) {
  const [provider, setProvider] = useState(
    card.recommended_provider || 'DataForSEO'
  )
  const running = card.status === 'running'

  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        Running approved data pull…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-card p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-800">
        Data request · needs your approval
      </p>
      {card.rationale && (
        <p className="mt-2 text-xs leading-relaxed text-foreground/85">
          {card.rationale}
        </p>
      )}
      <div className="mt-3 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Source</span>
          <Select value={provider} onValueChange={setProvider} disabled={disabled}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DataForSEO">DataForSEO</SelectItem>
              <SelectItem value="Semrush">Semrush</SelectItem>
              <SelectItem value="Moz">Moz</SelectItem>
              <SelectItem value="Both">Both</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Fetches</span>
          <span className="text-right">
            {card.summary || `${card.plan?.length || 0} provider calls`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Estimated credits</span>
          <Badge variant="outline">{card.estCredits ?? '—'} credits</Badge>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onDecide({ decision: 'decline', provider })}
        >
          Not now
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onDecide({
              decision: 'approve',
              provider,
              plan: card.plan,
              requestId: card.requestId,
            })
          }
        >
          Approve & run
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

function PromptCards({ onPick, disabled }) {
  return (
    <div className="space-y-1.5 p-2">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        Prompts
      </p>
      {PROMPTS.map((prompt) => (
        <button
          key={prompt.id}
          type="button"
          disabled={disabled}
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
            {prompt.desc}
          </p>
        </button>
      ))}
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
  const bottomRef = useRef(null)
  const abortRef = useRef(null)
  const sessionIdRef = useRef(null)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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
      setMessages(messagesToUi(data.messages))
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

  async function handleSend(overrideText, approval) {
    const text = String(overrideText ?? (approval ? '' : input)).trim()
    if ((!text && !approval) || !companyId || sending) return

    setSending(true)
    setError('')
    if (!approval) setInput('')
    setActiveTools([])

    const tempUserId = `local-user-${Date.now()}`
    const tempAsstId = `local-asst-${Date.now()}`
    if (text) {
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: 'user', text },
        { id: tempAsstId, role: 'assistant', text: '', streaming: true },
      ])
    } else {
      setMessages((prev) => [
        ...prev,
        { id: tempAsstId, role: 'assistant', text: '', streaming: true },
      ])
    }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat({
        companyId,
        sessionId,
        message: text || undefined,
        approval,
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
          } else if (event === 'data_request') {
            setMessages((prev) => [
              ...prev.filter((m) => m.id !== tempAsstId || (m.text && m.text.trim())),
              {
                id: `approval-${data.requestId}`,
                role: 'approval',
                status: 'pending',
                ...data,
              },
            ])
          } else if (event === 'spend') {
            setSessionSpend((n) => n + (Number(data.estCredits) || 0))
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
      setMessages((prev) =>
        prev.map((m) =>
          m.role === 'approval' && m.status === 'running'
            ? { ...m, status: 'done' }
            : m
        )
      )
    }
  }

  function handleApproval(card, payload) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === card.id
          ? { ...m, status: payload.decision === 'approve' ? 'running' : 'declined' }
          : m
      )
    )
    handleSend(null, {
      requestId: payload.requestId || card.requestId,
      decision: payload.decision,
      provider: payload.provider,
      plan: payload.plan || card.plan,
    })
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

  const chatPane = (
    <section className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
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
      <ScrollArea className="flex-1 px-4 py-4">
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
              if (m.role === 'approval') {
                return (
                  <ApprovalCard
                    key={m.id}
                    card={m}
                    disabled={sending}
                    onDecide={(payload) => handleApproval(m, payload)}
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
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>
      <div className="border-t border-border px-4 py-3">
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
    <div className="flex h-[calc(100vh-3rem)] min-h-[560px] flex-col">
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

      <div className="hidden min-h-0 flex-1 lg:flex">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={25} minSize={16}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={55} minSize={20}>
                <ScrollArea className="h-full">
                  <PromptCards
                    disabled={sending}
                    onPick={(prompt) => {
                      setComposerPrompt(prompt)
                      setComposerOpen(true)
                    }}
                  />
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
          onPick={(prompt) => {
            setComposerPrompt(prompt)
            setComposerOpen(true)
          }}
        />
        <div className="min-h-[480px] border-y border-border">{chatPane}</div>
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
        ci={ciFields}
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
