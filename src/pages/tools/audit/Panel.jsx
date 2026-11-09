import React, { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Collapsible section: a one-line header (title + summary) that opens to its body.
 * Collapsed by default. `actions` render beside the header, outside the toggle.
 * @param {{
 *   title: React.ReactNode,
 *   summary?: React.ReactNode,
 *   actions?: React.ReactNode,
 *   defaultOpen?: boolean,
 *   className?: string,
 *   children: React.ReactNode,
 * }} props
 */
export default function Panel({ title, summary, actions, defaultOpen = false, className, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  return (
    <section className={cn('rounded-lg border border-border', className)}>
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          <span className="shrink-0 text-sm font-semibold">{title}</span>
          {summary ? <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span> : null}
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {open ? (
        <div id={bodyId} className="border-t border-border px-4 py-3">
          {children}
        </div>
      ) : null}
    </section>
  )
}
