/** Header labels the third column so it is never confused with Semrush KD. */
export const OUTPUT_HEADER = 'Keyword;Volume;DFS Comp Index'

/**
 * Map DataForSEO competition fields to a single paste-column value.
 * Prefer competition_index (0–100). Else competition (0–1) × 100.
 * Fall back to competition_level (LOW/MEDIUM/HIGH).
 */
export function competitionColumn(row) {
  if (typeof row?.competitionIndex === 'number' && Number.isFinite(row.competitionIndex)) {
    return String(Math.round(row.competitionIndex))
  }
  if (typeof row?.competition === 'number' && Number.isFinite(row.competition)) {
    return String(Math.round(row.competition * 100))
  }
  if (typeof row?.competitionLevel === 'string' && row.competitionLevel.trim()) {
    return row.competitionLevel.trim().toUpperCase()
  }
  return ''
}

export function formatKeywordBlock(rows) {
  const lines = [OUTPUT_HEADER]
  for (const row of rows) {
    const keyword = String(row.keyword || '').trim()
    if (!keyword) continue
    const volume =
      typeof row.searchVolume === 'number' && Number.isFinite(row.searchVolume)
        ? Math.round(row.searchVolume)
        : ''
    lines.push(`${keyword};${volume};${competitionColumn(row)}`)
  }
  return lines.join('\n')
}

export function mergeKeywordRows(lists) {
  const map = new Map()
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const row of list) {
      const keyword = String(row?.keyword || '').trim()
      if (!keyword) continue
      const key = keyword.toLowerCase().replace(/\s+/g, ' ')
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { ...row, keyword })
        continue
      }
      const nextVol = row.searchVolume ?? -1
      const prevVol = existing.searchVolume ?? -1
      if (nextVol > prevVol) map.set(key, { ...existing, ...row, keyword })
    }
  }
  return [...map.values()].sort(
    (a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0)
  )
}
