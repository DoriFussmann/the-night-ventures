import React, { useMemo, useState } from 'react'
import { AlertCircle, Check, ChevronRight, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { locateKeyword, slugifyKeyword } from '../../../../lib/seo-advisor/pillars.js'
import ChatMarkdown from './ChatMarkdown'
import { humanizeColumn, toolResultToDataCard } from './dataCards'
import { formatVolume } from './KeywordTree'
import { KeyMessagesEditor } from './ArticleSpecDialog'
import { Textarea } from '@/components/ui/textarea'
import { MAX_CORE_KEYWORDS, MAX_SUPPORTING_PER_CORE } from '../../../../lib/seo-advisor/pillars.js'

const TOOL_TITLES = {
  semrush_keyword_research: 'keyword research',
  semrush_domain_overview: 'domain overview',
  semrush_organic_research: 'organic keywords',
  semrush_competitors_research: 'competitors',
  dataforseo_keyword_volume: 'search volume',
  dataforseo_keyword_difficulty: 'keyword difficulty',
  dataforseo_keyword_ideas: 'keyword ideas',
  dataforseo_related_keywords: 'related keywords',
  dataforseo_serp_results: 'Google results',
  dataforseo_backlinks_summary: 'backlinks',
  dataforseo_onpage_audit: 'on-page check',
  moz_domain_metrics: 'domain authority',
  moz_keyword_metrics: 'keyword metrics',
  moz_link_data: 'linking domains',
}

function toolSubject(input = {}) {
  if (input.keyword) return input.keyword
  if (input.domain) return input.domain
  if (input.url) return input.url
  if (Array.isArray(input.keywords) && input.keywords.length) {
    const head = input.keywords.slice(0, 3).join(', ')
    return input.keywords.length > 3 ? `${head} +${input.keywords.length - 3}` : head
  }
  return ''
}

/** One data-tool call: a single line that expands into its result table. */
export function ToolCall({ part }) {
  const [open, setOpen] = useState(false)
  const running = part.status === 'running'
  const failed = part.status === 'error'
  const card = useMemo(
    () => (part.result && !failed ? toolResultToDataCard(part.name, part.result) : null),
    [part.name, part.result, failed]
  )
  const subject = toolSubject(part.input)
  const expandable = !running && (card || failed)

  return (
    <div className="my-1.5">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-left text-xs text-muted-foreground transition-colors',
          expandable && 'hover:bg-muted/70 hover:text-foreground'
        )}
        aria-expanded={open}
      >
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <AlertCircle className="h-3 w-3 shrink-0 text-amber-600" />
        ) : (
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
          />
        )}
        <span className="shrink-0 font-medium text-foreground/80">{part.provider}</span>
        <span className="shrink-0">{TOOL_TITLES[part.name] || part.name}</span>
        {subject && <span className="truncate">· {subject}</span>}
        {running && <span className="shrink-0">…</span>}
        {failed && <span className="shrink-0 text-amber-700">· unavailable</span>}
      </button>

      {open && failed && (
        <p className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200">
          {part.result?.reason || 'The tool returned no data.'}
        </p>
      )}

      {open && card && (
        <div className="mt-1.5 max-h-72 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {card.columns.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap border-b border-border px-2 py-1.5 font-medium text-muted-foreground"
                  >
                    {humanizeColumn(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row, i) => (
                <tr key={i} className="odd:bg-background even:bg-muted/20">
                  {card.columns.map((col) => (
                    <td
                      key={col}
                      className="max-w-[260px] truncate border-b border-border/60 px-2 py-1 tabular-nums"
                      title={String(row[col] ?? '')}
                    >
                      {row[col]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MetricChips({ card }) {
  const vol = formatVolume(card.searchVolume)
  const kd = card.difficulty != null ? Math.round(card.difficulty) : null
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
      {vol != null && <span className="rounded bg-muted px-1.5 py-0.5">{vol}/mo</span>}
      {kd != null && <span className="rounded bg-muted px-1.5 py-0.5">KD {kd}</span>}
    </div>
  )
}

/** "Add Core Keyword" / "Add Supporting Keyword" card. State comes from the live tree. */
export function RecommendationCard({ card, pillars = [], disabled, onAdd }) {
  const isSupporting = card.type === 'supporting'
  const placed = locateKeyword(pillars, card.keyword)
  const suggestedCore = isSupporting
    ? pillars.find((p) => p.slug === slugifyKeyword(card.core)) || null
    : null
  const [parentSlug, setParentSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [angle, setAngle] = useState(card.spec?.angle || '')
  const [messages, setMessages] = useState(
    card.spec?.keyMessages?.length ? [...card.spec.keyMessages] : ['']
  )

  const selectedSlug = parentSlug || suggestedCore?.slug || ''
  const selectedCore = pillars.find((p) => p.slug === selectedSlug) || null
  const coreFull = !isSupporting && pillars.length >= MAX_CORE_KEYWORDS
  const parentFull =
    isSupporting && (selectedCore?.supporting?.length || 0) >= MAX_SUPPORTING_PER_CORE

  async function add() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onAdd({
        type: card.type,
        keyword: card.keyword,
        core: isSupporting ? selectedCore?.keyword : undefined,
        searchVolume: card.searchVolume,
        difficulty: card.difficulty,
        spec: {
          ...(card.spec || {}),
          angle: angle.trim(),
          keyMessages: messages.map((m) => m.trim()).filter(Boolean),
          status: 'approved',
        },
      })
    } catch (err) {
      setError(err.message || 'Could not add keyword')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'my-2 rounded-lg border px-3 py-2.5',
        placed ? 'border-border bg-muted/20' : 'border-primary/30 bg-primary/[0.03]'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isSupporting ? 'Supporting keyword' : 'Core keyword'}
            {isSupporting && card.core && (
              <span className="normal-case tracking-normal"> · under “{card.core}”</span>
            )}
          </p>
          <p className="mt-0.5 text-sm font-medium">{card.keyword}</p>
        </div>
        <MetricChips card={card} />
      </div>

      {card.reason && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{card.reason}</p>
      )}

      {!placed && (angle || messages.some((m) => m.trim()) || editing) && (
        <div className="mt-2 rounded-md border border-border/70 bg-background/60 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Article spec{card.spec?.format ? ` · ${card.spec.format}` : ''}
            </p>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>
          {editing ? (
            <div className="mt-2 space-y-2">
              <Textarea
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
                rows={2}
                placeholder="Angle"
                className="min-h-[44px] text-xs"
              />
              <KeyMessagesEditor messages={messages} onChange={setMessages} />
            </div>
          ) : (
            <>
              {angle && <p className="mt-1 text-xs text-foreground/90">{angle}</p>}
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {messages
                  .filter((m) => m.trim())
                  .map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {placed ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            {placed.type === 'core' ? 'Added as Core keyword' : `Added under “${placed.core}”`}
          </span>
        ) : isSupporting && pillars.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Add a Core keyword first, then this can go under it.
          </span>
        ) : (
          <>
            {isSupporting && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Under
                <select
                  value={selectedSlug}
                  onChange={(e) => setParentSlug(e.target.value)}
                  disabled={busy || disabled}
                  className="h-7 max-w-[220px] rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
                >
                  {!selectedSlug && <option value="">Choose a Core keyword…</option>}
                  {pillars.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.keyword}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 px-2.5 text-xs"
              disabled={busy || disabled || (isSupporting && !selectedCore) || coreFull || parentFull}
              onClick={add}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {isSupporting ? 'Add Supporting Keyword' : 'Add Core Keyword'}
            </Button>
            {(coreFull || parentFull) && (
              <span className="text-[11px] text-muted-foreground">
                {coreFull
                  ? `Already ${MAX_CORE_KEYWORDS} Core keywords.`
                  : `That Core already has ${MAX_SUPPORTING_PER_CORE} Supporting keywords.`}
              </span>
            )}
            {isSupporting && card.core && !suggestedCore && (
              <span className="text-[11px] text-muted-foreground">
                “{card.core}” isn’t a Core keyword yet.
              </span>
            )}
          </>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function AssistantMessage({ message, pillars, onAdd }) {
  const parts = message.parts || []
  const isEmpty = parts.length === 0
  return (
    <div className="mr-auto w-full max-w-full">
      {isEmpty && message.streaming && (
        <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
        </div>
      )}
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <ChatMarkdown key={`t${i}`}>{part.text}</ChatMarkdown>
        }
        if (part.type === 'tool') {
          return <ToolCall key={part.id} part={part} />
        }
        if (part.type === 'rec') {
          return (
            <RecommendationCard
              key={part.id}
              card={part.card}
              pillars={pillars}
              onAdd={onAdd}
            />
          )
        }
        return null
      })}
    </div>
  )
}
