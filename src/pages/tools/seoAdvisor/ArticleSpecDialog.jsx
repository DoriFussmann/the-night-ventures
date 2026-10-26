import React, { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ARTICLE_FORMATS,
  ARTICLE_STATUSES,
  ARTICLE_STATUS_LABELS,
  MAX_KEY_MESSAGES,
  MAX_SUPPORTING_PER_CORE,
  MIN_KEY_MESSAGES,
} from '../../../../lib/seo-advisor/pillars.js'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground'

function draftFrom(spec = {}) {
  return {
    primaryKeyword: spec.primaryKeyword || '',
    angle: spec.angle || '',
    keyMessages: (spec.keyMessages || []).length ? [...spec.keyMessages] : [''],
    status: spec.status || 'approved',
    url: spec.url || '',
    format: spec.format || '',
    secondaryKeywords: (spec.secondaryKeywords || []).join('\n'),
    expertNotes: spec.expertNotes || '',
  }
}

export function specFromDraft(draft, type) {
  const spec = {
    primaryKeyword: draft.primaryKeyword.trim(),
    angle: draft.angle.trim(),
    keyMessages: draft.keyMessages.map((m) => m.trim()).filter(Boolean),
    status: draft.status,
    url: draft.url.trim(),
  }
  if (type === 'supporting') spec.format = draft.format
  spec.secondaryKeywords = draft.secondaryKeywords
    .split('\n')
    .map((k) => k.trim())
    .filter(Boolean)
  spec.expertNotes = draft.expertNotes.trim()
  return spec
}

/** Key messages editor: 3–5 points, add / edit / delete / reorder by typing. */
export function KeyMessagesEditor({ messages, onChange, disabled }) {
  const filled = messages.filter((m) => m.trim()).length
  return (
    <div className="space-y-2">
      {messages.map((message, index) => (
        <div key={index} className="flex items-start gap-2">
          <span className="mt-2 w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <Textarea
            value={message}
            disabled={disabled}
            rows={2}
            className="min-h-[44px] text-sm"
            onChange={(e) => {
              const next = [...messages]
              next[index] = e.target.value
              onChange(next)
            }}
            aria-label={`Key message ${index + 1}`}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = messages.filter((_, i) => i !== index)
              onChange(next.length ? next : [''])
            }}
            className="mt-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
            aria-label={`Delete key message ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 pl-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={disabled || messages.length >= MAX_KEY_MESSAGES}
          onClick={() => onChange([...messages, ''])}
        >
          <Plus className="h-3 w-3" /> Add key message
        </Button>
        <span
          className={`text-xs ${filled < MIN_KEY_MESSAGES ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
        >
          {filled} of {MIN_KEY_MESSAGES}–{MAX_KEY_MESSAGES}
        </span>
      </div>
    </div>
  )
}

/**
 * Edit the article spec of one keyword. Every Core and Supporting keyword
 * is exactly one article.
 *
 * target: { type: 'core' | 'supporting', core, keyword, spec, backlog?, supportingCount? }
 * onSave(spec) → Promise. Backlog handlers are optional (Core only).
 */
export default function ArticleSpecDialog({
  target,
  onClose,
  onSave,
  onAddBacklog,
  onRemoveBacklog,
  onPromoteBacklog,
}) {
  const [draft, setDraft] = useState(() => draftFrom(target?.spec))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [backlogInput, setBacklogInput] = useState('')
  const [backlogBusy, setBacklogBusy] = useState('')

  const targetKey = target ? `${target.type}:${target.core}:${target.keyword}` : ''
  useEffect(() => {
    setDraft(draftFrom(target?.spec))
    setError('')
    setBacklogInput('')
    // Reset only when a different keyword is opened, not on every tree refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])

  if (!target) return null
  const isSupporting = target.type === 'supporting'
  const backlog = target.backlog || []
  const full = (target.supportingCount || 0) >= MAX_SUPPORTING_PER_CORE

  async function save() {
    setSaving(true)
    setError('')
    try {
      await onSave(specFromDraft(draft, target.type))
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function runBacklog(key, fn) {
    setBacklogBusy(key)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message || 'Backlog update failed')
    } finally {
      setBacklogBusy('')
    }
  }

  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }))

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[min(96vw,720px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isSupporting ? `Supporting article · under “${target.core}”` : 'Pillar article · Core keyword'}
          </p>
          <DialogTitle>{target.keyword}</DialogTitle>
          <DialogDescription>
            This keyword is one article. The spec tells the writer what it must say.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Primary keyword</label>
            <Input
              value={draft.primaryKeyword}
              onChange={(e) => set({ primaryKeyword: e.target.value })}
              placeholder={`Defaults to “${target.keyword}”`}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Angle</label>
            <Textarea
              value={draft.angle}
              onChange={(e) => set({ angle: e.target.value })}
              rows={2}
              placeholder="What the article argues or answers, and for whom."
              className="min-h-[56px]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Key messages</label>
            <p className="mb-2 text-xs text-muted-foreground">
              The points the article must make. Use facts the company can back up.
            </p>
            <KeyMessagesEditor
              messages={draft.keyMessages}
              onChange={(keyMessages) => set({ keyMessages })}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Status</label>
              <select
                value={draft.status}
                onChange={(e) => set({ status: e.target.value })}
                className={selectClass}
              >
                {ARTICLE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {ARTICLE_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            {isSupporting ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Format</label>
                <select
                  value={draft.format}
                  onChange={(e) => set({ format: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Not set</option>
                  {ARTICLE_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Expert notes</label>
            <Textarea
              value={draft.expertNotes}
              onChange={(e) => set({ expertNotes: e.target.value })}
              rows={3}
              placeholder="Optional. First-hand experience, examples or opinions the writer should build this article around."
            />
          </div>

          <div>
              <label className="mb-1.5 block text-sm font-medium">Secondary keywords</label>
              <Textarea
                value={draft.secondaryKeywords}
                onChange={(e) => set({ secondaryKeywords: e.target.value })}
                rows={3}
                placeholder="One per line. Covered inside this article, no separate article."
              />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Live URL</label>
            <Input
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://… (once published)"
            />
          </div>

          {!isSupporting && onAddBacklog ? (
            <div className="rounded-lg border border-border px-3 py-3">
              <p className="text-sm font-medium">Backlog</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Supporting ideas parked for later. Promote one when there is room (
                {target.supportingCount || 0} of {MAX_SUPPORTING_PER_CORE} used).
              </p>
              {backlog.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {backlog.map((item) => (
                    <li key={item.keyword} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{item.keyword}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={Boolean(backlogBusy) || full}
                        onClick={() =>
                          runBacklog(`p:${item.keyword}`, () => onPromoteBacklog(item.keyword))
                        }
                      >
                        {backlogBusy === `p:${item.keyword}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Promote'
                        )}
                      </Button>
                      <button
                        type="button"
                        disabled={Boolean(backlogBusy)}
                        onClick={() =>
                          runBacklog(`r:${item.keyword}`, () => onRemoveBacklog(item.keyword))
                        }
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                        aria-label={`Remove ${item.keyword} from backlog`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Input
                  value={backlogInput}
                  onChange={(e) => setBacklogInput(e.target.value)}
                  placeholder="Add an idea"
                  className="h-8 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!backlogInput.trim() || Boolean(backlogBusy)}
                  onClick={() =>
                    runBacklog('add', async () => {
                      await onAddBacklog(backlogInput.trim())
                      setBacklogInput('')
                    })
                  }
                >
                  Park
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save spec'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
