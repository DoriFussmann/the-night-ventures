import React, { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const ROLES = [
  { id: 'pillar', label: 'Pillar' },
  { id: 'supporting', label: 'Supporting' },
  { id: 'skip', label: 'Skip' },
]

function keywordList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      return String(item?.keyword || '').trim()
    })
    .filter(Boolean)
}

function flagForKeyword(keyword, core, supporting) {
  const needle = keyword.toLowerCase()
  if (core.some((item) => item.toLowerCase() === needle)) {
    return { type: 'warn', text: 'Already a pillar in CI' }
  }
  if (supporting.some((item) => item.toLowerCase() === needle)) {
    return { type: 'warn', text: 'Already supporting in CI' }
  }
  const overlap = [...core, ...supporting].find((existing) => {
    const hay = existing.toLowerCase()
    return hay.includes(needle) || needle.includes(hay)
  })
  if (overlap) {
    return { type: 'warn', text: `Overlaps ‘${overlap}’` }
  }
  return { type: 'new', text: 'New — no conflict' }
}

export default function PushToCiModal({
  open,
  onOpenChange,
  items = [],
  ci,
  onConfirm,
  confirming,
}) {
  const core = keywordList(ci?.core_keywords)
  const supporting = keywordList(ci?.supporting_keywords)

  const initialRoles = useMemo(() => {
    const next = {}
    for (const item of items) {
      next[item.keyword] =
        Number(item.search_volume) >= 15000 ? 'pillar' : 'supporting'
    }
    return next
  }, [items])

  const [roles, setRoles] = useState(initialRoles)

  React.useEffect(() => {
    if (open) setRoles(initialRoles)
  }, [open, initialRoles])

  const rows = items.map((item) => ({
    ...item,
    role: roles[item.keyword] || 'supporting',
    flag: flagForKeyword(item.keyword, core, supporting),
  }))
  const flagged = rows.filter((row) => row.flag.type === 'warn').length
  const ready = rows.filter((row) => row.role !== 'skip').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Push to Company Intelligence</DialogTitle>
          <DialogDescription>
            Review roles and overlaps before writing keywords into the company brief.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.keyword} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{row.keyword}</p>
                <p className="text-[11px] text-muted-foreground">
                  {row.search_volume != null
                    ? Number(row.search_volume).toLocaleString()
                    : '—'}{' '}
                  · KD {row.difficulty ?? '—'}
                </p>
              </div>
              <div className="mt-2 inline-flex rounded-md border border-border p-0.5">
                {ROLES.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() =>
                      setRoles((prev) => ({ ...prev, [row.keyword]: role.id }))
                    }
                    className={cn(
                      'rounded px-2 py-1 text-[11px]',
                      row.role === role.id
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {role.label}
                  </button>
                ))}
              </div>
              <p
                className={cn(
                  'mt-2 text-[11px]',
                  row.flag.type === 'warn'
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                )}
              >
                {row.flag.text}
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {ready} ready · {flagged} overlap{flagged === 1 ? '' : 's'} flagged.
          CI is designed for 5 pillars; extras still write with a warning.
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={confirming || ready === 0}
            onClick={() => onConfirm(rows)}
          >
            Confirm & write
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
