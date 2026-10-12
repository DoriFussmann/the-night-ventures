import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Lock, X } from 'lucide-react'
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
import { cn } from '@/lib/utils'

export function formatVolume(value) {
  if (value == null) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (n >= 10000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

function Metrics({ item }) {
  const vol = formatVolume(item.searchVolume)
  const kd = item.difficulty != null ? Math.round(item.difficulty) : null
  if (vol == null && kd == null) return null
  return (
    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
      {vol != null && <span title="Monthly search volume">{vol}</span>}
      {vol != null && kd != null && <span className="mx-1 opacity-50">·</span>}
      {kd != null && <span title="Keyword difficulty">KD {kd}</span>}
    </span>
  )
}

function RemoveButton({ label, busy, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`Remove ${label}`}
      title="Remove"
      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
    </button>
  )
}

function LockMark() {
  return (
    <span
      className="shrink-0 p-0.5 text-muted-foreground/70"
      title="Has articles or planned articles — can’t be removed"
      aria-label="Locked: has content"
    >
      <Lock className="h-3 w-3" />
    </span>
  )
}

/**
 * Left panel: live Core → Supporting keyword tree from content_coverage.
 */
export default function KeywordTree({ pillars = [], loading, highlight, busyKey, onRemove }) {
  const [collapsed, setCollapsed] = useState({})
  const [confirm, setConfirm] = useState(null)
  const supportingTotal = pillars.reduce((n, p) => n + (p.supporting?.length || 0), 0)

  function requestRemoveCore(pillar) {
    if ((pillar.supporting || []).length > 0) {
      setConfirm(pillar)
      return
    }
    onRemove({ type: 'core', core: pillar.keyword })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Keywords</h2>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {pillars.length} core · {supportingTotal} supporting
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading keywords…
          </div>
        ) : pillars.length === 0 ? (
          <div className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            No Core keywords yet. Talk it through with the Advisor — when it makes a strong
            recommendation you’ll get an <span className="font-medium text-foreground">Add</span>{' '}
            button, and the keyword lands here.
          </div>
        ) : (
          <ul className="space-y-1">
            {pillars.map((pillar) => {
              const isCollapsed = Boolean(collapsed[pillar.slug])
              const supporting = pillar.supporting || []
              const coreKey = `core:${pillar.slug}`
              return (
                <li key={pillar.slug}>
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/60',
                      highlight === coreKey && 'animate-pulse bg-primary/10'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((prev) => ({ ...prev, [pillar.slug]: !isCollapsed }))
                      }
                      className="flex min-w-0 flex-1 items-center gap-1 text-left"
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-[13px] font-medium" title={pillar.keyword}>
                        {pillar.keyword}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {supporting.length}
                      </span>
                    </button>
                    <Metrics item={pillar} />
                    {pillar.locked ? (
                      <LockMark />
                    ) : (
                      <RemoveButton
                        label={pillar.keyword}
                        busy={busyKey === coreKey}
                        onClick={() => requestRemoveCore(pillar)}
                      />
                    )}
                  </div>

                  {!isCollapsed && (
                    <ul className="ml-[18px] border-l border-border pl-2">
                      {supporting.length === 0 ? (
                        <li className="px-1.5 py-1 text-[11px] text-muted-foreground/80">
                          No supporting keywords yet
                        </li>
                      ) : (
                        supporting.map((item) => {
                          const key = `sup:${pillar.slug}/${item.slug}`
                          return (
                            <li
                              key={item.slug}
                              className={cn(
                                'group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/60',
                                highlight === key && 'animate-pulse bg-primary/10'
                              )}
                            >
                              <span
                                className="min-w-0 flex-1 truncate text-xs text-foreground/90"
                                title={item.keyword}
                              >
                                {item.keyword}
                              </span>
                              <Metrics item={item} />
                              {item.locked ? (
                                <LockMark />
                              ) : (
                                <RemoveButton
                                  label={item.keyword}
                                  busy={busyKey === key}
                                  onClick={() =>
                                    onRemove({
                                      type: 'supporting',
                                      core: pillar.keyword,
                                      keyword: item.keyword,
                                    })
                                  }
                                />
                              )}
                            </li>
                          )
                        })
                      )}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{confirm?.keyword}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This also removes its {confirm?.supporting?.length} supporting keyword
              {confirm?.supporting?.length === 1 ? '' : 's'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onRemove({ type: 'core', core: confirm.keyword })
                setConfirm(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
