import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { History, Loader2, MessageSquarePlus, Send, Sparkles, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  DEFAULT_MARKET,
  LANGUAGES,
  MARKETS,
  resolveLanguage,
  resolveMarket,
} from '../../../lib/seo-advisor/markets.js'
import { slugifyKeyword } from '../../../lib/seo-advisor/pillars.js'
import {
  deleteSession,
  getKeywordTree,
  getSession,
  keywordAction,
  listSessions,
  messagesToUi,
  streamChat,
} from './seoAdvisor/api'
import KeywordTree from './seoAdvisor/KeywordTree'
import { AssistantMessage } from './seoAdvisor/ChatParts'

const MARKET_STORAGE_KEY = 'seoAdvisor.locale'

function readStoredLocale() {
  try {
    const raw = window.localStorage.getItem(MARKET_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed?.market) return parsed
  } catch {
    // storage unavailable
  }
  return { market: DEFAULT_MARKET, language: resolveMarket(DEFAULT_MARKET).language }
}

function storeLocale(locale) {
  try {
    window.localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify(locale))
  } catch {
    // storage unavailable
  }
}

function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days < 1) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Apply one SSE event to the streaming assistant message's parts. */
function applyEvent(parts, event, data) {
  const next = [...parts]
  if (event === 'text_delta') {
    const last = next[next.length - 1]
    if (last?.type === 'text') {
      next[next.length - 1] = { ...last, text: last.text + (data.text || '') }
    } else {
      next.push({ type: 'text', text: data.text || '' })
    }
  } else if (event === 'tool_start') {
    next.push({
      type: 'tool',
      id: data.id,
      name: data.name,
      provider: data.provider,
      input: data.input,
      status: 'running',
      result: null,
    })
  } else if (event === 'tool_end') {
    const i = next.findIndex((p) => p.type === 'tool' && p.id === data.id)
    if (i >= 0) {
      next[i] = { ...next[i], status: data.ok ? 'ok' : 'error', result: data.result }
    }
  } else if (event === 'recommendation') {
    const { id, ...card } = data
    if (!next.some((p) => p.type === 'rec' && p.id === id)) {
      next.push({ type: 'rec', id, card })
    }
  }
  return next
}

export default function SeoAiAdvisor() {
  const { companyId } = useParams()
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [sessionTitle, setSessionTitle] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pillars, setPillars] = useState([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [busyKey, setBusyKey] = useState(null)
  const [highlight, setHighlight] = useState(null)
  const [locale, setLocale] = useState(readStoredLocale)
  const [providerHealth, setProviderHealth] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const scrollRef = useRef(null)
  const stickToBottom = useRef(true)
  const abortRef = useRef(null)
  const sessionIdRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const loadTree = useCallback(async () => {
    if (!companyId) return
    try {
      const data = await getKeywordTree(companyId)
      setPillars(data.pillars || [])
    } catch (err) {
      setError(err.message || 'Failed to load keywords')
    } finally {
      setTreeLoading(false)
    }
  }, [companyId])

  const refreshSessions = useCallback(async () => {
    if (!companyId) return
    try {
      const data = await listSessions(companyId)
      setSessions(data.sessions || [])
      if (data.providerHealth) setProviderHealth(data.providerHealth)
    } catch (err) {
      setError(err.message || 'Failed to load chats')
    }
  }, [companyId])

  useEffect(() => {
    setTreeLoading(true)
    loadTree()
    refreshSessions()
    return () => abortRef.current?.abort()
  }, [loadTree, refreshSessions])

  // Keep the view pinned to the newest message unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function changeLocale(patch) {
    setLocale((prev) => {
      const market = patch.market || prev.market
      const language = patch.market
        ? resolveMarket(patch.market).language
        : patch.language || prev.language
      const next = { market, language }
      storeLocale(next)
      return next
    })
  }

  async function openSession(id) {
    if (!companyId || !id || sending) return
    setLoadingSession(true)
    setError('')
    setNotice('')
    try {
      const data = await getSession(companyId, id)
      setSessionId(data.session.id)
      setSessionTitle(data.session.title)
      setMessages(messagesToUi(data.messages))
      if (data.session.market) {
        setLocale({
          market: resolveMarket(data.session.market).code,
          language: resolveLanguage(data.session.language, data.session.market).code,
        })
      }
      stickToBottom.current = true
    } catch (err) {
      setError(err.message || 'Failed to open chat')
    } finally {
      setLoadingSession(false)
    }
  }

  function startNewChat() {
    abortRef.current?.abort()
    setSessionId(null)
    setSessionTitle(null)
    setMessages([])
    setInput('')
    setError('')
    setNotice('')
    setLocale(readStoredLocale())
    inputRef.current?.focus()
  }

  async function handleSend(overrideText) {
    const text = String(overrideText ?? input).trim()
    if (!text || !companyId || sending) return

    setSending(true)
    setError('')
    setNotice('')
    setInput('')
    stickToBottom.current = true

    const asstId = `local-asst-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: `local-user-${Date.now()}`, role: 'user', text },
      { id: asstId, role: 'assistant', parts: [], streaming: true },
    ])

    const updateAssistant = (fn) =>
      setMessages((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)))

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await streamChat({
        companyId,
        sessionId,
        message: text,
        market: locale.market,
        language: locale.language,
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === 'session') {
            sessionIdRef.current = data.id
            setSessionId(data.id)
            if (data.title) setSessionTitle(data.title)
          } else if (event === 'title') {
            setSessionTitle(data.title)
          } else if (
            event === 'text_delta' ||
            event === 'tool_start' ||
            event === 'tool_end' ||
            event === 'recommendation'
          ) {
            updateAssistant((m) => ({ ...m, parts: applyEvent(m.parts, event, data) }))
          } else if (event === 'status') {
            setNotice(data.message || '')
          } else if (event === 'error') {
            setError(data.error || 'Chat error')
          } else if (event === 'done') {
            if (data.providerHealth) setProviderHealth(data.providerHealth)
          }
        },
      })
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Chat failed')
    } finally {
      updateAssistant((m) => ({
        ...m,
        streaming: false,
        parts: m.parts.map((p) =>
          p.type === 'tool' && p.status === 'running'
            ? { ...p, status: 'error', result: { available: false, reason: 'Stopped' } }
            : p
        ),
      }))
      setMessages((prev) => prev.filter((m) => m.role !== 'assistant' || m.parts.length > 0))
      setSending(false)
      abortRef.current = null
      refreshSessions()
    }
  }

  function flash(key) {
    setHighlight(key)
    window.setTimeout(() => setHighlight((h) => (h === key ? null : h)), 1600)
  }

  async function handleAdd({ type, keyword, core, searchVolume, difficulty }) {
    try {
      const data = await keywordAction(
        companyId,
        type === 'core' ? 'add_core' : 'add_supporting',
        { keyword, core, searchVolume, difficulty }
      )
      setPillars(data.pillars || [])
      flash(
        type === 'core'
          ? `core:${slugifyKeyword(keyword)}`
          : `sup:${slugifyKeyword(core)}/${slugifyKeyword(keyword)}`
      )
    } catch (err) {
      if (err.status === 409 || err.status === 404) loadTree()
      throw err
    }
  }

  async function handleRemove({ type, core, keyword }) {
    const key =
      type === 'core'
        ? `core:${slugifyKeyword(core)}`
        : `sup:${slugifyKeyword(core)}/${slugifyKeyword(keyword)}`
    setBusyKey(key)
    try {
      const data = await keywordAction(
        companyId,
        type === 'core' ? 'remove_core' : 'remove_supporting',
        { core, keyword }
      )
      setPillars(data.pillars || [])
    } catch (err) {
      toast({ title: 'Couldn’t remove keyword', description: err.message, variant: 'destructive' })
      loadTree()
    } finally {
      setBusyKey(null)
    }
  }

  async function handleDeleteChat() {
    if (!sessionId) return
    try {
      await deleteSession({ companyId, sessionId })
      startNewChat()
      refreshSessions()
    } catch (err) {
      setError(err.message || 'Failed to delete chat')
    }
  }

  const deadProviders = providerHealth
    ? Object.entries(providerHealth)
        .filter(([, v]) => v?.ok === false)
        .map(([k]) => k)
    : []

  const starters = [
    'I have a theory about this site — let me walk you through it.',
    'Based on Company Intelligence, which Core keywords should we own?',
    pillars[0]
      ? `Find strong supporting keywords for “${pillars[0].keyword}”.`
      : 'Who are our real organic competitors, and what do they rank for?',
  ]

  const marketLabel = resolveMarket(locale.market).label

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-lg tracking-tight">
            <Sparkles className="h-4 w-4 text-primary" />
            SEO Advisor
          </h1>
          <p className="text-xs text-muted-foreground">
            Decide Core and Supporting keywords with live Semrush, DataForSEO and Moz data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={locale.market} onValueChange={(market) => changeLocale({ market })}>
            <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Research market">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MARKETS.map((m) => (
                <SelectItem key={m.code} value={m.code} className="text-xs">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locale.language} onValueChange={(language) => changeLocale({ language })}>
            <SelectTrigger className="h-8 w-[110px] text-xs" aria-label="Research language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code} className="text-xs">
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu onOpenChange={(open) => open && refreshSessions()}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={sending}>
                <History className="h-3.5 w-3.5" />
                Chats
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Recent chats</DropdownMenuLabel>
              {sessions.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No chats yet</p>
              ) : (
                sessions.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => openSession(s.id)}
                    className={cn('flex justify-between gap-3 text-xs', s.id === sessionId && 'bg-muted')}
                  >
                    <span className="truncate">{s.title || 'Untitled chat'}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatWhen(s.updated_at || s.created_at)}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              {sessionId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setDeleteOpen(true)}
                    className="gap-2 text-xs text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete this chat
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button size="sm" className="h-8 gap-1.5" onClick={startNewChat} disabled={sending}>
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New chat
          </Button>
        </div>
      </header>

      {deadProviders.length > 0 && (
        <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-1.5 text-[11px] text-amber-900 dark:text-amber-200">
          Last call failed for: {deadProviders.join(', ')}. The Advisor will say when data is
          unavailable.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,32vh)_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="min-h-0 border-b border-border bg-muted/20 lg:border-b-0 lg:border-r">
          <KeywordTree
            pillars={pillars}
            loading={treeLoading}
            highlight={highlight}
            busyKey={busyKey}
            onRemove={handleRemove}
          />
        </aside>

        <section className="flex min-h-0 flex-col">
          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
              {loadingSession ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading chat…
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10">
                  <h2 className="font-display text-xl tracking-tight">What are you thinking?</h2>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                    Bring an idea or a theory about the site. The Advisor knows the Company
                    Intelligence and your current keywords, pulls live data when it matters, and
                    offers an Add button when it’s confident about a keyword.
                  </p>
                  <div className="mt-5 flex flex-col items-start gap-2">
                    {starters.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setInput(s)
                          inputRef.current?.focus()
                        }}
                        className="rounded-md border border-border px-3 py-1.5 text-left text-sm text-foreground/80 transition-colors hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {sessionTitle && (
                    <p className="-mb-2 truncate text-xs text-muted-foreground">{sessionTitle}</p>
                  )}
                  {messages.map((m) =>
                    m.role === 'user' ? (
                      <div
                        key={m.id}
                        className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm leading-relaxed"
                      >
                        {m.text}
                      </div>
                    ) : (
                      <AssistantMessage key={m.id} message={m} pillars={pillars} onAdd={handleAdd} />
                    )
                  )}
                </>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-background">
            <div className="mx-auto max-w-3xl px-4 py-3">
              {(error || notice) && (
                <p className={cn('mb-2 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
                  {error || notice}
                </p>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-1.5 focus-within:ring-1 focus-within:ring-ring">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask the Advisor…"
                  rows={1}
                  className="max-h-48 min-h-[40px] flex-1 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                />
                {sending ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9 shrink-0"
                    onClick={() => abortRef.current?.abort()}
                    aria-label="Stop"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => handleSend()}
                    disabled={!input.trim()}
                    aria-label="Send"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Research market: {marketLabel} · {resolveLanguage(locale.language, locale.market).label}
              </p>
            </div>
          </div>
        </section>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              The conversation is deleted. Keywords you added stay in the tree.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteChat}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
