import React from 'react'
import { Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

function formatVolume(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString() : String(value)
}

export default function Shortlist({
  items = [],
  onRemove,
  onScore,
  onSaveInsight,
  onPush,
  onClear,
  saving,
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          Shortlist
        </p>
        <span className="text-[10px] text-muted-foreground">
          {items.length} kept
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <Star className="mx-auto mb-2 h-4 w-4" />
            <p className="font-medium text-foreground/80">Nothing kept</p>
            <p className="mt-1">
              Star keywords from the results to stage them here, then score, save,
              or push to Company Intelligence.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item) => (
              <div
                key={item.keyword}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {item.keyword}
                </span>
                {item.score != null && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                    {item.score}
                  </span>
                )}
                <span className="tabular-nums text-muted-foreground">
                  {formatVolume(item.search_volume)}
                </span>
                <button
                  type="button"
                  title="Remove"
                  onClick={() => onRemove(item.keyword)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5 border-t border-border p-2">
          <Button
            type="button"
            className="w-full"
            size="sm"
            onClick={onPush}
          >
            Push to Company Intelligence
          </Button>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onScore}
              disabled={scoring}
            >
              Score opportunity
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onSaveInsight}
              disabled={saving}
            >
              Save as insight
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
