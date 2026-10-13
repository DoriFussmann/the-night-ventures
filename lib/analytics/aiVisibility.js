// AI visibility via DataForSEO:
//  - Google SERP (live, advanced, async AI Overview) per core keyword: does an
//    AI Overview show, is the company cited, which competitors are cited, and
//    where the company ranks organically (top 10).
//  - LLM Mentions: questions in ChatGPT / Google AI Overviews whose answers cite
//    the company's domain.
// Parsers are pure; runners write rows to analytics_ai_checks / _mentions.

import { dfsPost } from '../seo-advisor/providers/dataforseo.js'
import { apexDomain } from '../audit-snapshot/domain.js'

const SERP_PATH = '/v3/serp/google/organic/live/advanced'
const MENTIONS_PATH = '/v3/ai_optimization/llm_mentions/search_mentions/live'
const LOCATION_CODE = 2840
const LANGUAGE_CODE = 'en'
const CONCURRENCY = 4
export const MAX_AI_KEYWORDS = 20

function domainMatches(host, apex) {
  const h = apexDomain(host)
  return Boolean(h && apex && (h === apex || h.endsWith(`.${apex}`)))
}

/** @param {Array<{ name?: string, url?: string }>} competitors */
export function competitorDomains(competitors) {
  return (Array.isArray(competitors) ? competitors : [])
    .map((c) => ({ name: String(c?.name || '').trim(), apex: apexDomain(c?.url || '') }))
    .filter((c) => c.apex)
    .map((c) => ({ name: c.name || c.apex, apex: c.apex }))
}

function collectReferences(aiItem) {
  const refs = []
  const push = (r) => {
    const url = String(r?.url || '').trim()
    if (url) refs.push({ url, domain: apexDomain(r?.domain || url), title: String(r?.title || '') })
  }
  for (const r of Array.isArray(aiItem?.references) ? aiItem.references : []) push(r)
  for (const el of Array.isArray(aiItem?.items) ? aiItem.items : []) {
    for (const r of Array.isArray(el?.references) ? el.references : []) push(r)
  }
  const seen = new Set()
  return refs.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
}

/**
 * @param {{ items?: object[] }} result one tasks[].result[] entry
 * @param {string} apex company apex domain
 * @param {Array<{ name: string, apex: string }>} competitors
 */
export function parseSerpForAi(result, apex, competitors = []) {
  const items = Array.isArray(result?.items) ? result.items : []
  const aiItem = items.find((i) => i?.type === 'ai_overview') || null
  const refs = aiItem ? collectReferences(aiItem) : []

  const ours = refs.filter((r) => domainMatches(r.domain, apex))
  const counts = new Map()
  for (const r of refs) {
    if (!r.domain || domainMatches(r.domain, apex)) continue
    counts.set(r.domain, (counts.get(r.domain) || 0) + 1)
  }
  const citedDomains = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([domain]) => domain)
  const competitorsCited = competitors
    .filter((c) => refs.some((r) => domainMatches(r.domain, c.apex)))
    .map((c) => c.name)

  const organic = items
    .filter((i) => i?.type === 'organic')
    .find((i) => domainMatches(i.domain || i.url, apex))

  return {
    hasAiOverview: Boolean(aiItem),
    cited: ours.length > 0,
    citedUrls: ours.map((r) => r.url).slice(0, 5),
    citedDomains,
    competitorsCited,
    organicPosition: organic ? Number(organic.rank_group) || null : null,
    organicUrl: organic ? String(organic.url || '') || null : null,
  }
}

/**
 * @param {{ total_count?: number, items?: object[] }} result
 * @param {string} apex
 */
export function parseMentions(result, apex) {
  const items = (Array.isArray(result?.items) ? result.items : []).slice(0, 20).map((item) => ({
    question: String(item?.question || ''),
    aiSearchVolume: Number(item?.ai_search_volume) || 0,
    urls: (Array.isArray(item?.sources) ? item.sources : [])
      .filter((s) => domainMatches(s?.domain || s?.url, apex))
      .map((s) => String(s.url || ''))
      .filter(Boolean)
      .slice(0, 3),
  }))
  return {
    totalCount: Number.isFinite(Number(result?.total_count)) ? Number(result.total_count) : items.length,
    items: items.filter((i) => i.question),
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length)
  let next = 0
  async function worker() {
    while (next < list.length) {
      const index = next
      next += 1
      out[index] = await fn(list[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
  return out
}

/**
 * Run SERP checks for each keyword and LLM mention checks, store rows.
 * @returns {Promise<{ ok: boolean, message: string, costUsd: number }>}
 */
export async function runAiVisibility(supabase, { companyId, domain, keywords, competitors }) {
  const apex = apexDomain(domain)
  if (!apex) return { ok: false, message: 'No domain set', costUsd: 0 }
  const list = [...new Set((keywords || []).map((k) => String(k || '').trim()).filter(Boolean))].slice(
    0,
    MAX_AI_KEYWORDS
  )
  const rivals = competitorDomains(competitors)
  const checkedAt = new Date().toISOString()
  let costUsd = 0
  let failures = 0

  const checkRows = await mapLimit(list, CONCURRENCY, async (keyword) => {
    const res = await dfsPost(
      SERP_PATH,
      {
        keyword,
        location_code: LOCATION_CODE,
        language_code: LANGUAGE_CODE,
        device: 'desktop',
        depth: 10,
        load_async_ai_overview: true,
      },
      { timeoutMs: 90000 }
    )
    if (!res.available) {
      failures += 1
      return { company_id: companyId, keyword, checked_at: checkedAt, error: res.reason }
    }
    const cost = Number(res.taskResult?.cost) || 0
    costUsd += cost
    const parsed = parseSerpForAi(res.taskResult?.result?.[0], apex, rivals)
    return {
      company_id: companyId,
      keyword,
      checked_at: checkedAt,
      has_ai_overview: parsed.hasAiOverview,
      cited: parsed.cited,
      cited_urls: parsed.citedUrls,
      cited_domains: parsed.citedDomains,
      competitors_cited: parsed.competitorsCited,
      organic_position: parsed.organicPosition,
      organic_url: parsed.organicUrl,
      cost_usd: cost,
    }
  })

  const mentionRows = await mapLimit(['chat_gpt', 'google'], 2, async (platform) => {
    const res = await dfsPost(
      MENTIONS_PATH,
      {
        target: [{ domain: apex, search_scope: ['sources'], include_subdomains: true }],
        platform,
        location_code: LOCATION_CODE,
        language_code: LANGUAGE_CODE,
        order_by: ['ai_search_volume,desc'],
        limit: 20,
      },
      { timeoutMs: 120000 }
    )
    if (!res.available) {
      // DataForSEO reports an empty result set as a task error.
      if (/no search results/i.test(String(res.reason || ''))) {
        return { company_id: companyId, checked_at: checkedAt, platform, total_count: 0, items: [] }
      }
      failures += 1
      return { company_id: companyId, checked_at: checkedAt, platform, error: res.reason }
    }
    const cost = Number(res.taskResult?.cost) || 0
    costUsd += cost
    const parsed = parseMentions(res.taskResult?.result?.[0], apex)
    return {
      company_id: companyId,
      checked_at: checkedAt,
      platform,
      total_count: parsed.totalCount,
      items: parsed.items,
      cost_usd: cost,
    }
  })

  if (checkRows.length) {
    const { error } = await supabase.from('analytics_ai_checks').insert(checkRows)
    if (error) throw error
  }
  const { error: mentionError } = await supabase.from('analytics_ai_mentions').insert(mentionRows)
  if (mentionError) throw mentionError

  const total = checkRows.length + mentionRows.length
  return {
    ok: failures < total,
    message:
      failures === 0
        ? `${list.length} keyword${list.length === 1 ? '' : 's'} + 2 mention checks`
        : `${failures} of ${total} checks failed${list.length === 0 ? ' (no core keywords set)' : ''}`,
    costUsd,
  }
}
