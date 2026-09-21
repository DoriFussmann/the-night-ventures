import React, { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronRight, Copy, Star, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  humanizeColumn,
  parseFormattedNumber,
  rowsToCsv,
  shortlistItemFromRow,
} from './dataCards'
import { KEYWORD_STAR_TOOLS, NUMERIC_SORT_COLUMNS } from './constants'

function sortRows(rows, sortKey, dir) {
  if (!sortKey) return rows
  const numeric = NUMERIC_SORT_COLUMNS.has(sortKey)
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = a?.[sortKey]
    const bv = b?.[sortKey]
    if (numeric) {
      const an = parseFormattedNumber(av) ?? 0
      const bn = parseFormattedNumber(bv) ?? 0
      return (an - bn) * dir
    }
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, {
      sensitivity: 'base',
    }) * dir
  })
  return copy
}

function DataCard({ card, shortlist, onToggleStar }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(1)
  const starrable = KEYWORD_STAR_TOOLS.has(card.toolName)

  const rows = useMemo(
    () => sortRows(card.rows || [], sortKey, sortDir),
    [card.rows, sortKey, sortDir]
  )

  function onSort(col) {
    if (sortKey === col) setSortDir((d) => d * -1)
    else {
      setSortKey(col)
      setSortDir(NUMERIC_SORT_COLUMNS.has(col) ? -1 : 1)
    }
  }

  async function copyCsv() {
    const csv = rowsToCsv(card.columns, rows)
    try {
      await navigator.clipboard.writeText(csv)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      className={cn(
        'overflow-hidden rounded-lg border bg-card shadow-sm',
        card.available === false ? 'border-border/60 opacity-80' : 'border-border'
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{card.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-[10px] font-normal">
              {card.provider}
            </Badge>
            {card.subtitle && (
              <span className="truncate text-[10px] text-muted-foreground">
                {card.subtitle}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {card.rows?.length || 0} rows
            </span>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-2 pb-2 pt-1">
          <div className="mb-1.5 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={copyCsv}
              disabled={!card.rows?.length}
            >
              {copied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? 'Copied' : 'Copy CSV'}
            </Button>
          </div>
          <div className="max-h-64 overflow-auto rounded-md border border-border/80">
            <table className="w-full min-w-[280px] border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-muted/90 backdrop-blur">
                <tr>
                  {starrable && <th className="w-7 border-b border-border px-1 py-1.5" />}
                  {card.columns.map((col) => {
                    const active = sortKey === col
                    return (
                      <th
                        key={col}
                        className="cursor-pointer whitespace-nowrap border-b border-border px-2 py-1.5 font-medium text-muted-foreground hover:text-foreground"
                        onClick={() => onSort(col)}
                      >
                        {humanizeColumn(col)}
                        <span className="ml-1 text-[9px] opacity-70">
                          {active ? (sortDir < 0 ? '▼' : '▲') : '↕'}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const item = starrable ? shortlistItemFromRow(card, row) : null
                  const starred =
                    item &&
                    shortlist.some(
                      (s) =>
                        s.keyword?.toLowerCase() === item.keyword.toLowerCase()
                    )
                  return (
                    <tr key={i} className="odd:bg-background even:bg-muted/20">
                      {starrable && (
                        <td className="border-b border-border/50 px-1 py-1 align-middle">
                          {item ? (
                            <button
                              type="button"
                              title={starred ? 'Remove from shortlist' : 'Add to shortlist'}
                              onClick={() => onToggleStar?.(item)}
                              className={cn(
                                'rounded p-0.5',
                                starred
                                  ? 'text-amber-500'
                                  : 'text-muted-foreground hover:text-foreground'
                              )}
                            >
                              <Star
                                className="h-3 w-3"
                                fill={starred ? 'currentColor' : 'none'}
                              />
                            </button>
                          ) : null}
                        </td>
                      )}
                      {card.columns.map((col) => (
                        <td
                          key={col}
                          className="max-w-[180px] truncate border-b border-border/50 px-2 py-1 align-top"
                          title={String(row[col] ?? '')}
                        >
                          {row[col]}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.article>
  )
}

function keywordSummary(cards) {
  const items = []
  for (const card of cards || []) {
    if (!KEYWORD_STAR_TOOLS.has(card.toolName)) continue
    for (const row of card.rows || []) {
      const item = shortlistItemFromRow(card, row)
      if (item) items.push(item)
    }
  }
  const totalVolume = items.reduce((sum, item) => sum + (item.search_volume || 0), 0)
  const commercial = items.filter((item) =>
    String(item.intent || '').toLowerCase().includes('commercial')
  ).length
  return {
    count: items.length,
    totalVolume,
    commercial,
  }
}

export default function DataPanel({ cards, shortlist = [], onToggleStar }) {
  const summary = keywordSummary(cards)

  if (!cards?.length) {
    return (
      <div className="px-1 py-6 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground/80">No data pulled yet</p>
        <p className="mt-1">
          Approve a data request in the chat and results land here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {summary.count > 0 && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">{summary.count}</div>
              <div>keywords</div>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                {summary.totalVolume.toLocaleString()}
              </div>
              <div>total volume</div>
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">
                {summary.commercial}
              </div>
              <div>commercial</div>
            </div>
          </div>
        </div>
      )}
      <p className="flex items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground">
        <Table2 className="h-3 w-3" />
        {cards.length} data set{cards.length === 1 ? '' : 's'}
      </p>
      <AnimatePresence initial={false}>
        {[...cards].reverse().map((card) => (
          <DataCard
            key={card.id}
            card={card}
            shortlist={shortlist}
            onToggleStar={onToggleStar}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}
