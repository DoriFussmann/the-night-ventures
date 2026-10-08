import React from 'react'
import { cn } from '@/lib/utils'

/** @param {number | null | undefined} score */
export function scoreTone(score) {
  if (score == null || Number.isNaN(score)) return 'muted'
  if (score >= 90) return 'green'
  if (score >= 50) return 'yellow'
  return 'red'
}

export const TONE_TEXT = {
  green: 'text-emerald-600 dark:text-emerald-400',
  yellow: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
  muted: 'text-muted-foreground',
}

const TONE_STROKE = {
  green: { ring: 'stroke-emerald-500', track: 'stroke-emerald-500/15' },
  yellow: { ring: 'stroke-amber-500', track: 'stroke-amber-500/15' },
  red: { ring: 'stroke-red-500', track: 'stroke-red-500/15' },
  muted: { ring: 'stroke-muted-foreground/40', track: 'stroke-muted/40' },
}

/**
 * Circular 0–100 score.
 * @param {{ label?: string, score: number | null | undefined, size?: number }} props
 */
export default function ScoreGauge({ label = '', score, size = 112 }) {
  const tone = scoreTone(score)
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped =
    typeof score === 'number' && !Number.isNaN(score) ? Math.max(0, Math.min(100, score)) : null
  const offset = clamped == null ? circumference : circumference - (clamped / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${label || 'Score'}: ${clamped == null ? 'not run' : clamped}`}
      >
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className={TONE_STROKE[tone].track}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn(TONE_STROKE[tone].ring, 'transition-[stroke-dashoffset] duration-700 ease-out')}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-2xl font-semibold tabular-nums', TONE_TEXT[tone])}>
            {clamped == null ? '—' : clamped}
          </span>
        </div>
      </div>
      {label ? <p className="text-center text-xs font-medium text-foreground/80">{label}</p> : null}
    </div>
  )
}
