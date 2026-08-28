// lib/article-updates/proof-link.js
//
// Slice 3 — WTS proof-link. The check-article-update step surfaces source URLs
// for a proposed Where Things Stand paragraph. This wires the best one as a
// TYPED external link (kind: "wts-proof"), replacing any prior proof rather than
// stacking, and keeps the article within the external-link cap of 5.
//
// Pure functions — no I/O. The handler applies the resulting link list to the
// live markdown via wire-internal-links/plan.js's applyExternalLinksToMarkdown,
// which renders the frontmatter array + the CMS-EXTERNAL body block.
//
// "Best" source = relevance. Recency is already implied by the check's 45-day
// search window, and per-source dates aren't in the payload, so we rank by
// allow-list authority + keyword overlap, with model order as the tiebreak.

export const PROOF_KIND = 'wts-proof'
export const MAX_EXTERNAL_LINKS = 5

function domainOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function tokens(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []
}

function normUrl(url) {
  return String(url || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./, '')
    .replace(/[#?].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function asSet(value) {
  if (value instanceof Set) return value
  return new Set((Array.isArray(value) ? value : []).map((d) => String(d).replace(/^www\./, '')))
}

/**
 * Relevance score for one candidate source. -Infinity => ineligible
 * (no/invalid URL, own host, deny-listed).
 */
export function scoreSource(source, ctx = {}) {
  const url = String(source?.url || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) return -Infinity

  const domain = domainOf(url)
  if (!domain) return -Infinity

  const host = String(ctx.host || '').replace(/^www\./, '').toLowerCase()
  if (host && domain === host) return -Infinity // never cite ourselves

  const deny = asSet(ctx.deny)
  if (deny.has(domain)) return -Infinity

  const allow = asSet(ctx.allow)
  const keywordTokens = new Set([...tokens(ctx.targetKeyword), ...tokens(ctx.pillarKeyword)])
  const hay = new Set([...tokens(source?.title), ...tokens(source?.label), ...tokens(url)])

  let overlap = 0
  for (const t of keywordTokens) if (hay.has(t)) overlap++

  const authority = allow.size && allow.has(domain) ? 5 : 0
  return authority + overlap
}

/** Pick the single best source, or null if none are eligible. Stable on ties. */
export function pickBestSource(sources, ctx = {}) {
  const list = Array.isArray(sources) ? sources : []
  let best = null
  let bestScore = -Infinity
  let bestIdx = Infinity
  list.forEach((source, i) => {
    const score = scoreSource(source, ctx)
    if (score === -Infinity) return
    if (score > bestScore || (score === bestScore && i < bestIdx)) {
      best = source
      bestScore = score
      bestIdx = i
    }
  })
  if (!best) return null
  const url = String(best.url).trim()
  return { label: String(best.title || best.label || url).trim(), url }
}

/**
 * Return the next externalLinks array with `proof` wired as the WTS proof link.
 * - drops any prior wts-proof link and any duplicate of the proof URL
 * - adds the new proof (kind: wts-proof, addedAt: today)
 * - the proof counts toward the cap; if over cap, evict the oldest NON-proof
 *   link by addedAt (the fresh proof is always kept)
 */
export function wireProofLink(existingLinks, proof, { today, max = MAX_EXTERNAL_LINKS } = {}) {
  const list = (Array.isArray(existingLinks) ? existingLinks : []).map((l) => ({ ...l }))
  if (!proof || !proof.url) return list

  const proofUrl = String(proof.url).trim()
  const kept = list.filter(
    (l) => l.kind !== PROOF_KIND && normUrl(l.url) !== normUrl(proofUrl)
  )
  const newProof = {
    label: String(proof.label || proofUrl),
    url: proofUrl,
    addedAt: today || '',
    kind: PROOF_KIND,
  }
  const next = [...kept, newProof]
  if (next.length <= max) return next

  const nonProof = next
    .filter((l) => l.kind !== PROOF_KIND)
    .sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || '')))
  const drop = new Set(nonProof.slice(0, next.length - max))
  return next.filter((l) => !drop.has(l))
}
