// lib/coherence.js
//
// Template item — slug ↔ pillarKeyword ↔ title coherence check.
// Pure, no I/O. Flags articles whose slug/title/pillar don't line up, or that
// still carry the "(no volume data)" marker (which should be stripped at source).
//
// Low-false-positive by design: slugs are curated short forms, so we do NOT
// require slug === slugify(title). Instead we require the slug to be well-formed
// and its words to come from the title, and the pillar keyword to be reflected
// in the title.

import { slugify } from './slugify.js'
import { stripNoVolumeTag } from './stripNoVolumeTag.js'

const MARKER_RE = /\(\s*no volume data\s*\)/i

function tokens(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []
}

export function checkCoherence({ slug, title, pillarKeyword, targetKeyword } = {}) {
  const warnings = []
  const cleanTitle = stripNoVolumeTag(title)
  const cleanPillar = stripNoVolumeTag(pillarKeyword)
  const cleanTarget = stripNoVolumeTag(targetKeyword)
  const s = String(slug || '').trim()

  if (!s) warnings.push('slug-empty')
  if (!cleanTitle) warnings.push('title-empty')
  if (!cleanPillar) warnings.push('pillar-empty')

  // Marker should have been stripped at the generation source.
  if (MARKER_RE.test(`${title || ''} ${pillarKeyword || ''} ${targetKeyword || ''} ${slug || ''}`)) {
    warnings.push('no-volume-marker-present')
  }

  // Slug must be well-formed (idempotent under slugify).
  if (s && slugify(s) !== s) warnings.push('slug-malformed')

  // Every slug word should come from the title.
  if (s && cleanTitle) {
    const titleTokens = new Set(tokens(cleanTitle))
    const slugWords = tokens(s.replace(/-/g, ' '))
    if (slugWords.some((w) => !titleTokens.has(w))) warnings.push('slug-title-mismatch')
  }

  // Pillar keyword should be reflected in the title.
  if (cleanPillar && cleanTitle) {
    const titleTokens = new Set(tokens(cleanTitle))
    const pillarTokens = tokens(cleanPillar)
    const missing = pillarTokens.filter((t) => !titleTokens.has(t))
    if (pillarTokens.length && missing.length === pillarTokens.length) {
      warnings.push('pillar-absent-from-title')
    } else if (missing.length) {
      warnings.push('pillar-partial-in-title')
    }
  }

  return {
    ok: warnings.length === 0,
    warnings,
    cleaned: { slug: s, title: cleanTitle, pillarKeyword: cleanPillar, targetKeyword: cleanTarget },
  }
}

/** Run coherence over a list; return only the ones with warnings. */
export function checkArticlesCoherence(articles) {
  return (Array.isArray(articles) ? articles : [])
    .map((a) => {
      const slug = a?.slug ?? a?.data?.slug
      const title = a?.title ?? a?.data?.title
      const pillarKeyword = a?.pillarKeyword ?? a?.pillar_keyword ?? a?.data?.pillarKeyword
      const targetKeyword = a?.targetKeyword ?? a?.target_keyword ?? a?.data?.targetKeyword
      return { slug, ...checkCoherence({ slug, title, pillarKeyword, targetKeyword }) }
    })
    .filter((r) => !r.ok)
}
