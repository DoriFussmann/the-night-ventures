// Keyword cannibalization check, run before an article is created or published.
//
// Pure and dependency-free so the browser (Compose) and the publish API share
// one definition. An article overlaps an existing one when:
//   1. target-keyword    its target keyword matches another article's target keyword
//   2. pillar-keyword    its target keyword matches the pillar keyword of an
//                        existing pillar article
//   3. second-pillar     it is a pillar for a pillar keyword that already has one
//   4. slug              its slug matches another slug
//
// Terms match "exact", on the "same-words" (order, plurals, "pre seed"/"pre-seed"
// and filler words like "what is", "funding", "guide" ignored), or "near" (at
// least 75% shared words). A comparison ("x vs y") never matches a non-comparison.
// Exact and same-words matches (and second pillars) are blocking; near matches
// are warnings, because a planned cluster article often extends its pillar's
// keyword by one word ("seed pitch deck examples" under "seed pitch deck").

import { stripNoVolumeTag } from './stripNoVolumeTag.js'

// Words that do not change search intent. "a" is kept on purpose ("series a").
const FILLER = new Set([
  'the', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'your', 'my',
  'how', 'what', 'is', 'are', 'do', 'does', 'vs', 'versus', 'guide', 'complete',
  'explained', 'funding', 'round',
])

export const NEAR_MATCH = 0.75

// Words that look plural but are not.
const INVARIANT = new Set(['series', 'species', 'news', 'analysis', 'basis', 'saas', 'aws'])

function singular(word) {
  if (INVARIANT.has(word)) return word
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function normalizeKeyword(value) {
  return stripNoVolumeTag(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bpre seed\b/g, 'preseed')
    .trim()
}

function isComparison(value) {
  return /\b(vs|versus)\b/.test(normalizeKeyword(String(value || '').replace(/-/g, ' ')))
}

/** Intent words of a keyword or slug: lowercased, singular, filler removed. */
export function intentWords(value) {
  const words = normalizeKeyword(String(value || '').replace(/-/g, ' '))
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .filter((word) => !FILLER.has(word))
  return [...new Set(words)]
}

/** 'exact' | 'same-words' | 'near' | null */
export function compareTerms(a, b) {
  const na = normalizeKeyword(a)
  const nb = normalizeKeyword(b)
  if (!na || !nb) return null
  if (na === nb) return 'exact'
  if (isComparison(a) !== isComparison(b)) return null
  const wa = intentWords(a)
  const wb = intentWords(b)
  if (!wa.length || !wb.length) return null
  const shared = wa.filter((word) => wb.includes(word)).length
  const union = new Set([...wa, ...wb]).size
  if (shared === union) return 'same-words'
  if (Math.min(wa.length, wb.length) >= 2 && shared / union >= NEAR_MATCH) return 'near'
  return null
}

export function isPillarArticle(article) {
  return (
    String(article?.articleType || '').trim().toLowerCase() === 'comprehensive' &&
    !String(article?.supportingKeyword || '').trim()
  )
}

const STRENGTH = { exact: 3, 'same-words': 2, near: 1 }

function describe(rule, match, candidate, other) {
  const how = match === 'exact' ? 'the same' : match === 'same-words' ? 'the same words as' : 'nearly the same as'
  switch (rule) {
    case 'target-keyword':
      return `target keyword "${candidate.targetKeyword}" is ${how} "${other.targetKeyword}"`
    case 'pillar-keyword':
      return `target keyword "${candidate.targetKeyword}" is ${how} the pillar keyword of pillar article "${other.slug}"`
    case 'second-pillar':
      return `"${other.slug}" is already the pillar for "${other.pillarKeyword}"`
    case 'slug':
    default:
      return `slug "${candidate.slug}" is ${how} "${other.slug}"`
  }
}

/**
 * @param {{ slug?: string, title?: string, targetKeyword?: string, pillarKeyword?: string, supportingKeyword?: string, articleType?: string }} candidate
 * @param {Array<{ slug?: string, title?: string, targetKeyword?: string, pillarKeyword?: string, supportingKeyword?: string, articleType?: string, url?: string, status?: string, where?: string }>} existing
 * @returns {Array<{ slug: string, title: string, url: string, status: string, where: string, rule: string, match: string, message: string }>}
 */
export function findKeywordOverlaps(candidate, existing) {
  const self = String(candidate?.slug || '').trim().toLowerCase()
  const candidatePillar = isPillarArticle(candidate)
  const findings = new Map()

  for (const other of Array.isArray(existing) ? existing : []) {
    const slug = String(other?.slug || '').trim().toLowerCase()
    if (self && slug && slug === self) continue

    const checks = [
      ['target-keyword', compareTerms(candidate?.targetKeyword, other?.targetKeyword)],
      ['pillar-keyword', isPillarArticle(other) ? compareTerms(candidate?.targetKeyword, other?.pillarKeyword) : null],
      [
        'second-pillar',
        candidatePillar && isPillarArticle(other) && compareTerms(candidate?.pillarKeyword, other?.pillarKeyword) === 'exact'
          ? 'exact'
          : null,
      ],
      ['slug', compareTerms(self, slug)],
    ]
    let best = null
    for (const [rule, match] of checks) {
      if (match && (!best || STRENGTH[match] > STRENGTH[best.match])) best = { rule, match }
    }
    if (!best) continue

    const key = slug || String(other?.title || '')
    findings.set(key, {
      slug,
      title: String(other?.title || slug),
      url: String(other?.url || ''),
      status: String(other?.status || ''),
      where: String(other?.where || ''),
      rule: best.rule,
      match: best.match,
      blocking: best.match !== 'near',
      message: describe(best.rule, best.match, { ...candidate, slug: self }, { ...other, slug }),
    })
  }

  return [...findings.values()].sort((a, b) => STRENGTH[b.match] - STRENGTH[a.match])
}

/** Findings that should stop a publish unless the user overrides. */
export function blockingOverlaps(findings) {
  return (Array.isArray(findings) ? findings : []).filter((f) => f.blocking)
}

/** One line for an error banner: "Keyword overlap with a, b — <first reason>." */
export function summarizeOverlaps(findings) {
  const list = Array.isArray(findings) ? findings : []
  if (!list.length) return ''
  const names = list.map((f) => f.slug || f.title).slice(0, 3).join(', ')
  const more = list.length > 3 ? ` and ${list.length - 3} more` : ''
  return `Keyword overlap with ${names}${more} — ${list[0].message}.`
}
