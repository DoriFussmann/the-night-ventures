import React, { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ChevronRight, Copy, Table2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { humanizeColumn, rowsToCsv } from './dataCards'

function DataCard({ card }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  async function copyCsv() {
    const csv = rowsToCsv(card.columns, card.rows)
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
                        className="max-w-[180px] truncate border-b border-border/50 px-2 py-1 align-top"
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
        </div>
      )}
    </motion.article>
  )
}

export default function DataPanel({ cards }) {
  if (!cards?.length) {
    return (
      <p className="px-1 py-3 text-xs text-muted-foreground">
        Live tool outputs (keywords, competitors, SERPs) appear here as tables you
        can copy and reuse.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground">
        <Table2 className="h-3 w-3" />
        {cards.length} data set{cards.length === 1 ? '' : 's'}
      </p>
      <AnimatePresence initial={false}>
        {[...cards].reverse().map((card) => (
          <DataCard key={card.id} card={card} />
        ))}
      </AnimatePresence>
    </div>
  )
}
