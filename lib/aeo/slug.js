/**
 * AEO Generation: which slug a new article may take.
 * Pure; the caller checks each candidate against the Articles library.
 */

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Slugs to try, in order: the writer's own, then the primary keyword, then "<keyword> guide".
 *
 * `hubSlug` is the slug of the pillar's topic. Only the pillar article may use it:
 * a supporting article at that URL would read as the hub topic, not as itself.
 * Pass '' for the pillar article.
 */
export function slugCandidates({ proposed, primaryKeyword, hubSlug = '' }) {
  const seen = new Set()
  return [slugify(proposed), slugify(primaryKeyword), slugify(`${primaryKeyword || ''} guide`)]
    .filter((slug) => slug && slug !== 'guide' && slug !== hubSlug)
    .filter((slug) => (seen.has(slug) ? false : seen.add(slug)))
}
