/**
 * Cross-article figure check: the same claim stated with a different number in
 * two articles on one site ("raised $14.4M" here, "$12M" there). Heuristic and
 * advisory: a match becomes a Review note, it never blocks publishing.
 */
import { findStatistics } from '../generate-article/sources.js'

const STOP = new Set(
  'about above after again against among because before being below between could every first from have having into itself might other their there these those through under until where which while would your yours they them than then that this with what when will also just more most much over such only very each been were does doing should'.split(
    ' '
  )
)

const MIN_SHARED_WORDS = 4
const MAX_NOTES = 5

function mainBody(body) {
  return String(body || '').split(/^## Where Things Stand/m)[0]
}

function sentences(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function words(sentence) {
  return new Set(
    (sentence.toLowerCase().match(/[a-z][a-z'-]{4,}/g) || []).filter((w) => !STOP.has(w))
  )
}

function kind(stat) {
  if (/%/.test(stat)) return '%'
  if (/\$/.test(stat)) return '$'
  if (/x$/i.test(stat)) return 'x'
  return 'n'
}

function numbers(stat) {
  return (String(stat).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((d) => d.replace(/,/g, ''))
}

function statSentences(body) {
  const out = []
  for (const sentence of sentences(mainBody(body))) {
    const stats = findStatistics(sentence)
    if (stats.length) out.push({ sentence, stats, words: words(sentence) })
  }
  return out
}

/**
 * @param {string} body new article body
 * @param {Array<{ slug: string, body: string }>} others live articles on the site
 * @param {{ slug?: string }} [opts]
 * @returns {Array<{ kind: 'figure', message: string, slug: string }>}
 */
export function figureConflicts(body, others, { slug = '' } = {}) {
  const mine = statSentences(body)
  if (!mine.length) return []
  const notes = []
  const seen = new Set()
  for (const other of Array.isArray(others) ? others : []) {
    if (!other?.body || other.slug === slug) continue
    for (const theirs of statSentences(other.body)) {
      for (const own of mine) {
        let shared = 0
        for (const w of own.words) if (theirs.words.has(w)) shared += 1
        if (shared < MIN_SHARED_WORDS) continue
        for (const a of own.stats) {
          for (const b of theirs.stats) {
            if (kind(a) !== kind(b)) continue
            const na = numbers(a)
            const nb = numbers(b)
            if (na.some((n) => nb.includes(n))) continue
            const key = `${a}|${b}|${other.slug}`
            if (seen.has(key)) continue
            seen.add(key)
            notes.push({
              kind: 'figure',
              slug: other.slug,
              message: `Check figure: “${a}” here, “${b}” in /articles/${other.slug}/ for what reads like the same claim.`,
            })
            if (notes.length >= MAX_NOTES) return notes
          }
        }
      }
    }
  }
  return notes
}
