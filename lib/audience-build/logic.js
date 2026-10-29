// Pure logic for Audience Build segment matching. No I/O — unit-tested in
// logic.test.js. The handler wires these to Supabase, Claude and AudienceLab.

// Company Intelligence fields that describe the buyer and the offer, in the
// order Claude should read them. [column, label]
export const PROFILE_FIELDS = [
  ['short_description', 'What we do'],
  ['target_audience', 'Ideal customer'],
  ['customer_problem', 'Customer problem'],
  ['trigger_moment', 'Trigger moment (why they start looking)'],
  ['buying_criteria', 'Buying criteria'],
  ['how_it_works', 'How it works'],
  ['customer_outcome', 'Customer outcome'],
  ['core_value_proposition', 'Core value proposition'],
  ['differentiation', 'Differentiation'],
  ['market_category', 'Market & category'],
  ['competitive_position', 'Competitive position'],
  ['business_model', 'Business model'],
  ['commercial_model', 'Commercial model'],
  ['scope_boundaries', 'What we are / are not'],
  ['location_markets', 'Location / markets'],
  ['company_stage', 'Company stage'],
  ['long_description', 'Story & mission'],
]

const ICP_FIELDS = [
  ['icp_buyer_titles', 'Buyer titles'],
  ['icp_seniority', 'Buyer seniority'],
  ['icp_departments', 'Buyer departments'],
  ['icp_employee_bands', 'Buyer company size'],
  ['icp_industries', 'Buyer industries'],
]

const MAX_FIELD_CHARS = 1200

function clip(text, max = MAX_FIELD_CHARS) {
  const s = String(text ?? '').replace(/\s+\n/g, '\n').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function asArray(v) {
  return Array.isArray(v) ? v : []
}

export function competitorNames(profile) {
  const seen = new Set()
  const out = []
  for (const c of asArray(profile?.competitors)) {
    const name = String((c && typeof c === 'object' ? c.name : c) || '').trim()
    const key = name.toLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out
}

/** Markdown brief of the company for the prompts. Skips empty fields. */
export function buildProfileText(companyName, profile = {}) {
  const lines = [`# ${String(companyName || 'Company').trim()}`]
  if (profile.domain) lines.push(`Website: ${profile.domain}`)
  for (const [col, label] of PROFILE_FIELDS) {
    const v = clip(profile[col])
    if (v) lines.push(`\n## ${label}\n${v}`)
  }
  const services = asArray(profile.services)
    .map((s) => [s?.title, s?.summary].filter(Boolean).join(': '))
    .filter(Boolean)
  if (services.length) lines.push(`\n## Products & services\n${services.map((s) => `- ${clip(s, 300)}`).join('\n')}`)
  const comps = competitorNames(profile)
  if (comps.length) lines.push(`\n## Competitors\n${comps.join(', ')}`)
  const icp = ICP_FIELDS.map(([col, label]) => {
    const vals = asArray(profile[col]).filter(Boolean)
    return vals.length ? `- ${label}: ${vals.join(', ')}` : null
  }).filter(Boolean)
  if (icp.length) lines.push(`\n## Structured ICP\n${icp.join('\n')}`)
  return lines.join('\n')
}

/** Fields that matter most for matching; used to warn when the profile is thin. */
export function missingKeyFields(profile = {}) {
  const key = [
    ['short_description', 'What we do'],
    ['target_audience', 'Ideal customer'],
    ['customer_problem', 'Customer problem'],
  ]
  const missing = key.filter(([col]) => !String(profile[col] || '').trim()).map(([, l]) => l)
  if (!competitorNames(profile).length) missing.push('Competitors')
  return missing
}

export const DEFAULT_POOL_MULTIPLIER = 3

/** Clamp the Admin setting to 1-10 (one decimal); falls back to 3. */
export function poolMultiplier(value) {
  const m = Number(value)
  if (!Number.isFinite(m) || m <= 0) return DEFAULT_POOL_MULTIPLIER
  return Math.round(Math.min(10, Math.max(1, m)) * 10) / 10
}

/** Single-touch volume: every send is a new lead. Target pool = need x multiplier. */
export function dailyNeed(profile = {}, multiplier = DEFAULT_POOL_MULTIPLIER) {
  const inboxes = Math.max(0, Math.round(Number(profile.outbound_inboxes ?? 1)) || 0)
  const cap = Math.max(0, Math.round(Number(profile.outbound_daily_cap ?? 30)) || 0)
  const need = inboxes * cap
  const m = poolMultiplier(multiplier)
  return { inboxes, cap, need, multiplier: m, targetPool: Math.round(need * m) }
}

/** First top-level JSON object in a model reply (tolerates fences/prose). */
export function parseJsonObject(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('No JSON object in model reply')
  return JSON.parse(s.slice(start, end + 1))
}

function cleanList(list, { max, minLen = 2, maxLen = 80 }) {
  const seen = new Set()
  const out = []
  for (const raw of asArray(list)) {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim()
    const key = s.toLowerCase()
    if (s.length < minLen || s.length > maxLen || seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** Validate Claude's search plan; always includes the stored competitors. */
export function normalizePlan(obj, competitors = []) {
  const phrases = cleanList(obj?.phrases, { max: 30 })
  const names = cleanList([...competitors, ...asArray(obj?.names)], { max: 25, maxLen: 60 })
  if (!phrases.length && !names.length) throw new Error('Search plan was empty')
  return {
    buyer_summary: clip(obj?.buyer_summary, 400),
    phrases,
    names,
  }
}

/** One line per candidate for the rerank prompt. */
export function compactCandidates(rows) {
  return asArray(rows)
    .map((r) => {
      const where = [r.category, r.subcategory].filter(Boolean).join(' > ')
      const kw = clip(r.keywords, 160).replace(/\n/g, ' ')
      return `${r.segment_id} | ${r.topic} | ${where}${kw ? ` | ${kw}` : ''}`
    })
    .join('\n')
}

/** Validate Claude's ranking against the candidates actually offered. */
export function normalizeRerank(obj, candidateIds, max = 10) {
  const allowed = new Set(candidateIds)
  const seen = new Set()
  const out = []
  for (const r of asArray(obj?.ranked)) {
    const id = String(r?.segment_id || '').trim()
    if (!allowed.has(id) || seen.has(id)) continue
    seen.add(id)
    const rel = Number(r?.relevance)
    out.push({
      segment_id: id,
      relevance: Number.isFinite(rel) ? Math.max(0, Math.min(10, Math.round(rel * 10) / 10)) : 0,
      reason: clip(r?.reason, 240),
    })
  }
  out.sort((a, b) => b.relevance - a.relevance)
  return out.slice(0, max)
}

/**
 * Hard floors that never relax: a business email with a validation status.
 * Deliberately NOT nullOnly: ['DNC'] — Do Not Call governs phone outreach,
 * not email, and on a test segment it removed 76% of the pool (471 → 111).
 */
export const HARD_FLOOR_FILTERS = {
  notNulls: ['BUSINESS_EMAIL', 'BUSINESS_EMAILS_VALIDATION_STATUS'],
}

export function insightsBody({ segmentId, segmentIds, daysBack = 7, score = ['high'], filters = {} }) {
  return {
    segment: segmentIds?.length ? [...segmentIds] : [segmentId],
    days_back: Math.max(0, Math.min(7, Math.round(Number(daysBack) || 0))),
    score,
    filters: { ...filters, ...HARD_FLOOR_FILTERS },
  }
}

function top(dist, n = 5) {
  if (Array.isArray(dist)) return dist.slice(0, n).map(([k, v]) => ({ value: String(k), count: Number(v) || 0 }))
  if (dist && typeof dist === 'object') {
    return Object.entries(dist)
      .map(([k, v]) => ({ value: k, count: Number(v) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n)
  }
  return []
}

/** Keep only what the UI and later steps need from an InsightsResponse. */
export function summarizeInsights(resp) {
  const d = resp?.distributions || {}
  return {
    reach: Number(resp?.reach) || 0,
    seniority: top(d.seniority_level),
    department: top(d.department),
    employee_count: top(d.company_employee_count, 6),
    industry: top(d.company_industry),
    job_title: top(d.job_title, 8),
  }
}

/**
 * Fresh supply per day vs the target pool (need x multiplier).
 * covers: >= target · partial: >= need · short: < need
 */
export function coverage(reachPerDay, need, multiplier = DEFAULT_POOL_MULTIPLIER) {
  const n = Number(need) || 0
  const r = Number(reachPerDay) || 0
  if (n <= 0) return { ratio: null, status: 'unknown' }
  const ratio = Math.round((r / n) * 10) / 10
  return { ratio, status: r >= n * poolMultiplier(multiplier) ? 'covers' : r >= n ? 'partial' : 'short' }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const PLAN_SYSTEM = `You plan a search over AudienceLab's B2B intent taxonomy for a cold-email program.

Each taxonomy segment is a topic that people were seen actively researching online in the last 7 days: a product, a vendor, a technology, a service category or a business problem (e.g. "QuickBooks Online", "Accounts Payable Automation", "Commercial Roofing", "SOC 2 Compliance").

Goal: find segments whose researchers are likely BUYERS of this company's offering right now. Think from the buyer's side: what does the ideal customer research in the weeks before they would buy? That includes the problem itself, the category, competitors and alternatives they compare, tools adjacent to the job, and the trigger events that start the search. Do NOT describe the company's own internal work; a segment matters only if the company's buyers research it.

Return ONLY a JSON object:
{
  "buyer_summary": "one sentence: who buys and what they research before buying",
  "phrases": ["15 to 25 short search phrases, 1 to 4 words each, in plain topic language: category names, problem terms, job-to-be-done terms, adjacent tools or services"],
  "names": ["competitor and alternative vendor or product names buyers evaluate; include the company's listed competitors; up to 15"]
}`

export const RERANK_SYSTEM = `You pick AudienceLab intent segments for a single-touch cold-email program. Each person in a segment researched that topic online in the last 7 days. Only one email is sent per person, so precision matters more than size.

Score each candidate 0-10 for: "someone researching this topic this week is a strong prospect for this company's offering and would find a relevant cold email timely."
- 9-10: researching the exact problem, category, or a direct competitor; clearly in-market.
- 6-8: strongly adjacent; many researchers are likely buyers.
- 3-5: loosely related or broad; mostly not buyers.
- 0-2: unrelated, or researchers are mostly practitioners, job seekers, students or vendors rather than buyers.
Penalise topics that are too generic to signal intent (e.g. "Marketing", "Software") and topics whose taxonomy category looks mislabelled relative to the company.

Return ONLY a JSON object with the best candidates (at most 10), best first:
{ "ranked": [ { "segment_id": "b2b_123", "relevance": 9, "reason": "max 20 words: why these researchers are buyers" } ] }
Use only segment_ids from the candidate list.`

export function planUserMessage(profileText) {
  return `COMPANY PROFILE\n\n${profileText}`
}

export function rerankUserMessage(profileText, buyerSummary, candidatesText) {
  return `COMPANY PROFILE\n\n${profileText}\n\nBUYER SUMMARY\n${buyerSummary || '(none)'}\n\nCANDIDATE SEGMENTS (segment_id | topic | category > subcategory | keywords)\n${candidatesText}`
}

// ---------------------------------------------------------------------------
// Count cache helpers
// ---------------------------------------------------------------------------

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** Identifies a filter set (score tiers + filters), independent of key order. */
export function filterKey(body) {
  const score = [...(body?.score || [])].sort()
  return stableStringify({ score, filters: body?.filters || {} })
}

export const COUNT_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const COUNT_WINDOWS = [7, 1]

/**
 * Merge cached count rows into candidates.
 * rows: [{ segment_id, days_back, reach, summary, counted_at }] for ONE filter key.
 */
export function attachCounts(candidates, rows, need, multiplier = DEFAULT_POOL_MULTIPLIER) {
  const by = new Map()
  for (const r of asArray(rows)) by.set(`${r.segment_id}|${r.days_back}`, r)
  return asArray(candidates).map((c) => {
    const week = by.get(`${c.segment_id}|7`)
    const day = by.get(`${c.segment_id}|1`)
    const counted = Boolean(week && day)
    return {
      ...c,
      counted,
      reach_7d_high: week ? Number(week.reach) || 0 : null,
      reach_1d_high: day ? Number(day.reach) || 0 : null,
      makeup: week ? week.summary || null : null,
      coverage: counted ? coverage(day.reach, need, multiplier) : null,
      counted_at: counted ? week.counted_at : null,
    }
  })
}

export function isFresh(countedAt, now = Date.now()) {
  const t = Date.parse(countedAt || '')
  return Number.isFinite(t) && now - t < COUNT_MAX_AGE_MS
}
