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
  Table2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  getSession,
  listSessions,
  messagesToUi,
  patchInsight,
  streamChat,
} from './seoAdvisor/api'
import { SUGGESTED_PROMPTS, fillTrafficPrompt } from './seoAdvisor/constants'
import {
  dataCardsFromMessages,
  toolResultToDataCard,
} from './seoAdvisor/dataCards'
import ChatMarkdown from './seoAdvisor/ChatMarkdown'
import DataPanel from './seoAdvisor/DataPanel'

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

function SuggestedPrompts({ onPick, disabled }) {
  const [trafficUrl, setTrafficUrl] = useState('')

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SUGGESTED_PROMPTS.map((prompt) => (
        <button
          key={prompt.id}
          type="button"
          disabled={disabled}
          onClick={() => {
            const text = prompt.needsUrl
              ? fillTrafficPrompt(prompt.text, trafficUrl)
              : prompt.text
            onPick(text)
          }}
          className="rounded-lg border border-border bg-card/60 p-3 text-left transition-colors hover:bg-accent/60 disabled:opacity-50"
        >
          <p className="text-xs font-semibold text-foreground">{prompt.title}</p>
          <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
            {prompt.text}
          </p>
          {prompt.needsUrl && (
            <Input
              value={trafficUrl}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation()
                setTrafficUrl(e.target.value)
              }}
              placeholder="https://example.com/article"
              className="mt-2 h-8 text-xs"
              disabled={disabled}
            />
          )}
        </button>
      ))}
    </div>
  )
}

function InsightCard({ insight, onDismiss, onApply, busy }) {
  const conflict = Boolean(insight.conflicts_with_profile)
  const canApply =
    conflict &&
    insight.status === 'new' &&
    insight.profile_patch?.field

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

export default function SeoAiAdvisor() {
  const { companyId } = useParams()
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [sessionTitle, setSessionTitle] = useState(null)
  const [messages, setMessages] = useState([])
  const [insights, setInsights] = useState([])
  const [dataCards, setDataCards] = useState([])
  const [rightTab, setRightTab] = useState('data')
  const [input, setInput] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingSession, setLoadingSession] = useState(false)
  const [sending, setSending] = useState(false)
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
      if (data.providerHealth) setProviderHealth(data.providerHealth)
      setRightTab(
        (data.insights || []).length > 0 && dataCardsFromMessages(data.messages).length === 0
          ? 'insights'
          : 'data'
      )
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
    setRightTab('data')
    setInput('')
    setActiveTools([])
    setError('')
  }

  async function handleSend(overrideText) {
    const text = String(overrideText ?? input).trim()
    if (!text || !companyId || sending) return

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
              setRightTab('data')
            }
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

  const showPrompts = messages.length === 0 && !sending && !loadingSession
  const deadProviders = providerHealth
    ? Object.entries(providerHealth)
        .filter(([, v]) => v?.ok === false)
        .map(([k]) => k)
    : []

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

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_340px]">
        {/* Sessions */}
        <aside className="hidden min-h-0 flex-col border-r border-border lg:flex">
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            Sessions
          </p>
          <ScrollArea className="flex-1 px-2 pb-3">
            {loadingList ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : sessions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No past sessions yet.
              </p>
            ) : (
              <div className="space-y-1">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSession(s.id)}
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
        </aside>

        {/* Chat */}
        <section className="flex min-h-0 flex-col">
          <ScrollArea className="flex-1 px-4 py-4">
            {loadingSession ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading session…
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sessionTitle && (
                  <p className="text-center text-xs text-muted-foreground">
                    {sessionTitle}
                  </p>
                )}

                {showPrompts && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Bot className="h-4 w-4" />
                      Start with a suggested prompt, or type your own.
                    </div>
                    <SuggestedPrompts
                      disabled={sending}
                      onPick={(text) => setInput(text)}
                    />
                  </div>
                )}

                {messages.map((m) => (
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
                ))}
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

        {/* Research data + Insights */}
        <aside className="hidden min-h-0 flex-col border-l border-border lg:flex">
          <div className="flex gap-1 border-b border-border px-2 py-1.5">
            <button
              type="button"
              onClick={() => setRightTab('data')}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors',
                rightTab === 'data'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              <Table2 className="h-3 w-3" />
              Data
              {dataCards.length > 0 && (
                <span className="rounded bg-muted px-1 text-[10px]">
                  {dataCards.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setRightTab('insights')}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors',
                rightTab === 'insights'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              )}
            >
              <Lightbulb className="h-3 w-3" />
              Insights
              {insights.length > 0 && (
                <span className="rounded bg-muted px-1 text-[10px]">
                  {insights.length}
                </span>
              )}
            </button>
          </div>
          <ScrollArea className="flex-1 px-2 pb-3 pt-2">
            {rightTab === 'data' ? (
              <DataPanel cards={dataCards} />
            ) : (
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {insights.length === 0 ? (
                    <p className="px-1 py-3 text-xs text-muted-foreground">
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
          </ScrollArea>
        </aside>
      </div>
    </div>
  )
}
