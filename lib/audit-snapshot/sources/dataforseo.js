import {
  keywordData,
  backlinksSummary,
} from '../../seo-advisor/providers/dataforseo.js'
import { apexDomain } from '../domain.js'

function normalizeKeywords(coreKeywords) {
  if (!Array.isArray(coreKeywords)) return []
  return coreKeywords
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        return String(item.keyword || item.term || item.name || '').trim()
      }
      return ''
    })
    .filter(Boolean)
    .slice(0, 10)
}

/**
 * DataForSEO panel: domain-level visibility summary + pillar keyword volumes.
 * Used as the Visibility source (Semrush Domain Overview requires v3 API).
 */
export async function runDataforseoPanel({ siteUrl, coreKeywords }) {
  const domain = apexDomain(siteUrl)
  const keywords = normalizeKeywords(coreKeywords)

  try {
    const [domainResult, keywordResult] = await Promise.all([
      domain ? backlinksSummary({ domain }) : Promise.resolve(null),
      keywords.length > 0
        ? keywordData({ keywords })
        : Promise.resolve({
            available: false,
            reason:
              'No pillar keywords found in company_profiles.core_keywords — add them in Company Data',
          }),
    ])

    const domainOk = Boolean(domainResult?.available)
    const keywordsOk = Boolean(keywordResult?.available)

    if (!domainOk && !keywordsOk) {
      return {
        ok: false,
        error:
          keywordResult?.reason ||
          domainResult?.reason ||
          'DataForSEO panel failed',
        panel: 'dataforseo',
        domain,
        requestedKeywords: keywords,
        domainSummary: null,
        keywords: [],
      }
    }

    const summary = domainOk ? domainResult.summary || {} : null

    return {
      ok: true,
      panel: 'dataforseo',
      domain,
      requestedKeywords: keywords,
      domainSummary: summary
        ? {
            rank: summary.rank ?? null,
            backlinks: summary.backlinks ?? null,
            referringDomains: summary.referringDomains ?? null,
            referringMainDomains: summary.referringMainDomains ?? null,
          }
        : null,
      domainError: domainOk ? null : domainResult?.reason || null,
      keywords: keywordsOk ? keywordResult.keywords || [] : [],
      keywordsError: keywordsOk ? null : keywordResult?.reason || null,
    }
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'DataForSEO panel failed',
      panel: 'dataforseo',
      domain,
      requestedKeywords: keywords,
    }
  }
}
