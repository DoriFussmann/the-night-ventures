/**
 * Company positioning for the writer and the AI-visibility audit, read from the
 * AEO Playbook (Brand Facts + ICP). The Company tab supplies domain, product
 * name, market, language, customer evidence & proof and the image style.
 *
 * Pure module: no I/O, safe in the browser bundle and in API routes.
 */

function text(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean)
}

/** Empty Brand Facts keys this module reads (mirrors EMPTY_BRAND_FACTS in the Playbook UI). */
export const BRAND_FACT_KEYS = [
  'offer',
  'customer',
  'problem',
  'triggers',
  'difference',
  'conversion',
  'conversion_action',
  'conversion_url',
  'voice',
  'approved_claims',
  'never_claims',
  'out_of_scope',
  'competitors',
]

/** Brand Facts competitors → { name, url } (what the writer and audit need). */
export function playbookCompetitors(brandFacts) {
  const rows = Array.isArray(brandFacts?.competitors) ? brandFacts.competitors : []
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({ name: text(row.name), url: text(row.url) }))
    .filter((row) => row.name || row.url)
}

/**
 * @param {{
 *   brandFacts?: Record<string, any>,
 *   icp?: string,
 *   settings?: { domain?: string, seo_market?: string, seo_language?: string, gtm_customer_evidence?: string, image_style?: string },
 * }} input
 */
export function positioningFromPlaybook({ brandFacts, icp, settings } = {}) {
  const bf = brandFacts && typeof brandFacts === 'object' ? brandFacts : {}
  const s = settings || {}
  const audience = text(icp) || text(bf.customer)
  const edge = [text(bf.difference), text(s.gtm_customer_evidence)].filter(Boolean).join('\n\n')
  return {
    abstract: text(bf.offer),
    shortDescription: '',
    competitors: playbookCompetitors(bf),
    audience,
    domain: text(s.domain),
    imageStyle: text(s.image_style),
    seoControls: {
      primaryOffer: '',
      targetSearcher: audience,
      buyerProblems: [text(bf.problem), text(bf.triggers)].filter(Boolean).join('\n\n'),
      contentEdge: edge,
      outOfScope: list(bf.out_of_scope).join('\n'),
      conversionAction: text(bf.conversion_action) || text(bf.conversion),
      commercialUrl: text(bf.conversion_url),
      market: text(s.seo_market),
      language: text(s.seo_language),
      voice: text(bf.voice),
      approvedClaims: list(bf.approved_claims).join('\n'),
      neverClaims: list(bf.never_claims).join('\n'),
    },
  }
}
