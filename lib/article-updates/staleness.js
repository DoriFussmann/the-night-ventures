/**
 * Calendar-day difference from an ISO date (YYYY-MM-DD or similar) to today.
 * Returns null when the date cannot be parsed.
 */
export function daysSinceUpdate(dateValue, now = new Date()) {
  const raw = String(dateValue || '').trim()
  if (!raw) return null

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || !month || !day) return null

  const then = new Date(year, month - 1, day)
  if (Number.isNaN(then.getTime())) return null

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffMs = today.getTime() - then.getTime()
  return Math.max(0, Math.round(diffMs / 86400000))
}

export const STALENESS_BUCKETS = ['0-14', '15-30', '30-60', '60-90', '90+']
export const STALE_CHECK_BUCKETS = ['30-60', '60-90', '90+']
export const UNKNOWN_BUCKET = 'unknown'

export function stalenessBucket(days) {
  if (days == null || !Number.isFinite(days)) return UNKNOWN_BUCKET
  if (days <= 14) return '0-14'
  if (days <= 30) return '15-30'
  if (days <= 60) return '30-60'
  if (days <= 90) return '60-90'
  return '90+'
}

export function bucketNeedsUpdateCheck(bucket) {
  return STALE_CHECK_BUCKETS.includes(bucket)
}

export function emptyBucketCounts() {
  const counts = {}
  for (const id of STALENESS_BUCKETS) counts[id] = 0
  counts[UNKNOWN_BUCKET] = 0
  return counts
}

export function summarizeBuckets(articles) {
  const counts = emptyBucketCounts()
  for (const article of Array.isArray(articles) ? articles : []) {
    const bucket = article?.bucket || UNKNOWN_BUCKET
    if (counts[bucket] == null) counts[UNKNOWN_BUCKET] += 1
    else counts[bucket] += 1
  }
  return counts
}
