import React from 'react'
import { cn } from '@/lib/utils'

export function scoreTone(score) {
  if (score == null || Number.isNaN(score)) return 'muted'
  if (score >= 90) return 'green'
  if (score >= 50) return 'yellow'
  return 'red'
}

const TONE_CLASSES = {
  green: {
    ring: 'stroke-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    track: 'stroke-emerald-500/15',
  },
  yellow: {
    ring: 'stroke-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    track: 'stroke-amber-500/15',
  },
  red: {
    ring: 'stroke-red-500',
    text: 'text-red-600 dark:text-red-400',
    track: 'stroke-red-500/15',
  },
  muted: {
    ring: 'stroke-muted-foreground/40',
    text: 'text-muted-foreground',
    track: 'stroke-muted/40',
  },
}

export default function ScoreGauge({ label, score, size = 112 }) {
  const tone = scoreTone(score)
  const colors = TONE_CLASSES[tone]
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped =
    typeof score === 'number' && !Number.isNaN(score)
      ? Math.max(0, Math.min(100, score))
      : null
  const offset =
    clamped == null
      ? circumference
      : circumference - (clamped / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className={colors.track}
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
            className={cn(
              colors.ring,
              'transition-[stroke-dashoffset] duration-700 ease-out'
            )}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-2xl font-semibold tabular-nums', colors.text)}>
            {clamped == null ? '—' : clamped}
          </span>
        </div>
      </div>
      <p className="text-center text-xs font-medium text-foreground/80">
        {label}
      </p>
    </div>
  )
}
