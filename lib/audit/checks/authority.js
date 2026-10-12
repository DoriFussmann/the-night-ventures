// Authority category: Moz domain metrics for the site, benchmarked against the
// company's configured competitors. Pure: takes Moz rows, returns { issues, metrics }.

import { makeIssue, dedupeIssues } from '../issues.js'

const CATEGORY = 'authority'

/** Max competitors benchmarked (one Moz request carries all targets). */
export const MAX_COMPETITORS = 5

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function median(values) {
  const xs = values.filter((v) => v != null).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/**
 * @param {object} input
 * @param {{ domainAuthority?: number, spamScore?: number, linkingRootDomains?: number,
 *           externalPagesToRootDomain?: number, target?: string }} input.site
 * @param {Array<{ name: string, domain: string, domainAuthority?: number|null,
 *                 linkingRootDomains?: number|null, error?: string }>} [input.competitors]
 * @param {{ isStale?: boolean, reasons?: string[] }} [input.stale]
 */
export function buildAuthorityIssues({ site, competitors = [], stale = null }) {
  const issues = []
  const da = num(site?.domainAuthority)
  const spam = num(site?.spamScore)
  const roots = num(site?.linkingRootDomains)

  if (da != null && da < 20) {
    const veryLow = da < 10
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: veryLow ? 'domain_authority_very_low' : 'domain_authority_low',
        severity: veryLow ? 'high' : 'medium',
        title: veryLow ? 'Domain Authority under 10' : 'Domain Authority under 20',
        detail: `Moz DA ${da}/100.`,
        target: 'da',
        evidence: { domainAuthority: da },
        fixHint: 'Earn links from relevant, established sites: original data, expert quotes, partner and directory listings.',
      })
    )
  }

  if (roots != null && roots < 50) {
    const thin = roots < 10
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: thin ? 'linking_roots_very_thin' : 'linking_roots_thin',
        severity: thin ? 'medium' : 'low',
        title: thin ? 'Fewer than 10 linking root domains' : 'Fewer than 50 linking root domains',
        detail: `${roots} unique domains link to the site.`,
        target: 'roots',
        evidence: { linkingRootDomains: roots },
        fixHint: 'Breadth of linking domains matters more than link count — aim for new referring domains each month.',
      })
    )
  }

  if (spam != null && spam > 30) {
    const high = spam > 60
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: high ? 'spam_score_high' : 'spam_score_elevated',
        severity: high ? 'high' : 'medium',
        title: high ? 'Moz Spam Score is high (> 60%)' : 'Moz Spam Score is elevated (31–60%)',
        detail: `Spam Score ${spam}%.`,
        target: 'spam',
        evidence: { spamScore: spam },
        fixHint: 'Review the backlink profile for toxic or irrelevant domains; disavow clear spam in Search Console.',
      })
    )
  }

  const benchmarked = competitors.filter((c) => num(c.domainAuthority) != null)
  const compDa = median(benchmarked.map((c) => num(c.domainAuthority)))
  const compRoots = median(benchmarked.map((c) => num(c.linkingRootDomains)))

  if (da != null && compDa != null && da < compDa) {
    const gap = Math.round(compDa - da)
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'da_below_competitors',
        severity: gap >= 15 ? 'high' : 'medium',
        title: 'Domain Authority below competitor median',
        detail: `DA ${da} vs competitor median ${compDa} (gap ${gap}).`,
        target: 'da_vs_competitors',
        evidence: { domainAuthority: da, competitorMedian: compDa },
        fixHint: "Look at which domains link to the top competitor and not to you; those are the first outreach targets.",
      })
    )
  }

  if (roots != null && compRoots != null && roots < compRoots * 0.5) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'roots_below_competitors',
        severity: 'medium',
        title: 'Linking root domains under half the competitor median',
        detail: `${roots} vs competitor median ${compRoots}.`,
        target: 'roots_vs_competitors',
        evidence: { linkingRootDomains: roots, competitorMedian: compRoots },
        fixHint: 'Close the referring-domain gap before chasing DA directly.',
      })
    )
  }

  if (stale?.isStale) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'moz_data_stale',
        severity: 'low',
        title: 'Moz data may be stale',
        detail: (stale.reasons || []).join('; ') || 'Moz has not recently crawled this site.',
        target: 'stale',
        fixHint: 'Treat these numbers as indicative until Moz recrawls the site.',
      })
    )
  }

  const warnings = []
  if (!competitors.length) warnings.push('No competitors configured — add them in Company Intelligence to benchmark authority.')
  for (const c of competitors) {
    if (c.error) warnings.push(`${c.domain}: ${c.error}`)
  }

  return {
    issues: dedupeIssues(issues),
    metrics: {
      domainAuthority: da,
      pageAuthority: num(site?.pageAuthority),
      linkingRootDomains: roots,
      spamScore: spam,
      competitorMedianDa: compDa,
      competitorMedianRoots: compRoots,
      target: site?.target || null,
      competitors: competitors.map((c) => ({
        name: c.name,
        domain: c.domain,
        domainAuthority: num(c.domainAuthority),
        linkingRootDomains: num(c.linkingRootDomains),
        spamScore: num(c.spamScore),
        error: c.error || null,
      })),
      warnings,
    },
  }
}
