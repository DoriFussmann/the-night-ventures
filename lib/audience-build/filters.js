// Pure logic for Audience Build step 3: ICP filters. No I/O; tested in
// filters.test.js. Shared by the server and the page.
//
// AudienceLab semantics (verified live): values inside one filter are OR'd,
// different filters are AND'ed, several segments are a union. Include filters
// drop people with no value for that field; exclude filters keep them.

export const EMPLOYEE_BANDS = [
  '1 to 10',
  '11 to 25',
  '26 to 50',
  '51 to 100',
  '101 to 250',
  '251 to 500',
  '501 to 1000',
  '1001 to 5000',
  '5001 to 10000',
  '10000+',
]

export const REVENUE_BANDS = [
  'Under 1 Million',
  '1 Million to 5 Million',
  '5 Million to 10 Million',
  '10 Million to 25 Million',
  '25 Million to 50 Million',
  '50 Million to 100 Million',
  '100 Million to 250 Million',
  '250 Million to 500 Million',
  '500 Million to 1 Billion',
  '1 Billion and Over',
]

export const TITLE_MATCH_MODES = ['semantic', 'contains', 'exact']

// Our filter shape (also stored on the company and in the config):
export const EMPTY_FILTERS = {
  seniority: [],
  departments: [],
  titles: [],
  title_match: 'semantic',
  exclude_titles: [],
  employee_bands: [],
  revenue_bands: [],
  industries: [],
  exclude_industries: [],
}

const LIST_FIELDS = [
  'seniority',
  'departments',
  'titles',
  'exclude_titles',
  'employee_bands',
  'revenue_bands',
  'industries',
  'exclude_industries',
]

function asArray(v) {
  return Array.isArray(v) ? v : []
}

/** Keep only allowed values (case-insensitive), in the allowed list's spelling and order. */
function pick(values, allowed) {
  const want = new Set(asArray(values).map((v) => String(v).trim().toLowerCase()))
  return allowed.filter((a) => want.has(String(a).toLowerCase()))
}

/** Free-text terms (titles): trimmed, deduped, 2-60 chars, max 25. */
function terms(values) {
  const seen = new Set()
  const out = []
  for (const raw of asArray(values)) {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim()
    const key = s.toLowerCase()
    if (s.length < 2 || s.length > 60 || seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= 25) break
  }
  return out
}

/**
 * Validate a filter object against the values AudienceLab accepts.
 * allowed: { seniority: [], departments: [], industries: [] } from
 * GET /audiences/attributes/*. Unknown values are dropped, never guessed.
 */
export function normalizeFilters(raw = {}, allowed = {}) {
  const f = raw || {}
  const industries = asArray(allowed.industries)
  const mode = String(f.title_match || '').toLowerCase()
  return {
    seniority: pick(f.seniority, asArray(allowed.seniority)),
    departments: pick(f.departments, asArray(allowed.departments)),
    titles: terms(f.titles),
    title_match: TITLE_MATCH_MODES.includes(mode) ? mode : 'semantic',
    exclude_titles: terms(f.exclude_titles),
    employee_bands: pick(f.employee_bands, EMPLOYEE_BANDS),
    revenue_bands: pick(f.revenue_bands, REVENUE_BANDS),
    industries: pick(f.industries, industries),
    exclude_industries: pick(f.exclude_industries, industries),
  }
}

export function hasAnyFilter(f) {
  return LIST_FIELDS.some((k) => asArray(f?.[k]).length > 0)
}

/** Our shape → AudienceLab `filters` (without the hard floors). */
export function toAudienceLabFilters(f = {}) {
  const bp = {}
  if (asArray(f.seniority).length) bp.seniority = f.seniority
  if (asArray(f.departments).length) bp.department = f.departments
  if (asArray(f.titles).length) {
    bp.jobTitle = f.titles
    bp.jobTitleMatchMode = f.title_match || 'semantic'
  }
  if (asArray(f.exclude_titles).length) {
    bp.excludeJobTitle = f.exclude_titles
    bp.jobTitleMatchMode = f.title_match || 'semantic'
  }
  if (asArray(f.employee_bands).length) bp.employeeCount = f.employee_bands
  if (asArray(f.revenue_bands).length) bp.companyRevenue = f.revenue_bands
  if (asArray(f.industries).length) bp.industry = f.industries
  if (asArray(f.exclude_industries).length) bp.excludeIndustry = f.exclude_industries
  return Object.keys(bp).length ? { businessProfile: bp } : {}
}

/**
 * Cumulative layers for the impact check: each adds one group of filters to
 * the previous. Groups with nothing set are skipped.
 */
export function impactLayers(f = {}) {
  const groups = [
    ['Who: seniority, department, titles', ['seniority', 'departments', 'titles', 'exclude_titles', 'title_match']],
    ['Company size and revenue', ['employee_bands', 'revenue_bands']],
    ['Industry', ['industries', 'exclude_industries']],
  ]
  const layers = [{ key: 'base', label: 'Selected segments only', filters: { ...EMPTY_FILTERS } }]
  let acc = { ...EMPTY_FILTERS }
  for (const [label, keys] of groups) {
    const set = keys.filter((k) => k !== 'title_match' && asArray(f[k]).length)
    if (!set.length) continue
    acc = { ...acc }
    for (const k of keys) acc[k] = f[k] ?? EMPTY_FILTERS[k]
    layers.push({ key: keys[0], label, filters: acc })
  }
  return layers
}

/** Filters → company_profiles icp_* columns. */
export function filtersToProfileColumns(f = {}) {
  return {
    icp_seniority: asArray(f.seniority),
    icp_departments: asArray(f.departments),
    icp_buyer_titles: asArray(f.titles),
    icp_exclude_titles: asArray(f.exclude_titles),
    icp_employee_bands: asArray(f.employee_bands),
    icp_revenue_bands: asArray(f.revenue_bands),
    icp_industries: asArray(f.industries),
    icp_exclude_industries: asArray(f.exclude_industries),
  }
}

/** company_profiles icp_* columns → filters (for pre-filling). */
export function profileColumnsToFilters(p = {}) {
  return {
    ...EMPTY_FILTERS,
    seniority: asArray(p.icp_seniority),
    departments: asArray(p.icp_departments),
    titles: asArray(p.icp_buyer_titles),
    exclude_titles: asArray(p.icp_exclude_titles),
    employee_bands: asArray(p.icp_employee_bands),
    revenue_bands: asArray(p.icp_revenue_bands),
    industries: asArray(p.icp_industries),
    exclude_industries: asArray(p.icp_exclude_industries),
  }
}

/** Keep the parts of an InsightsResponse the drafting prompt and the editor use. */
export function audienceMakeup(resp, topN = 15) {
  const d = resp?.distributions || {}
  const list = (dist) => {
    if (Array.isArray(dist)) return dist.slice(0, topN).map(([k, v]) => ({ value: String(k), count: Number(v) || 0 }))
    if (dist && typeof dist === 'object') {
      return Object.entries(dist)
        .map(([k, v]) => ({ value: k, count: Number(v) || 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN)
    }
    return []
  }
  const cov = resp?.coverage || {}
  const total = Number(cov.total || resp?.reach) || 0
  const share = (k) => (total ? Math.round(((Number(cov[k]) || 0) / total) * 100) : null)
  return {
    reach: Number(resp?.reach) || 0,
    seniority: list(d.seniority_level),
    department: list(d.department),
    employee_count: list(d.company_employee_count),
    revenue: list(d.company_revenue),
    industry: list(d.company_industry),
    job_title: list(d.job_title, 25),
    // % of people that have each field; an include filter drops the rest.
    known: {
      seniority: share('has_seniority_level'),
      department: share('has_department'),
      job_title: share('has_job_title'),
      employee_count: share('has_company_employee_count'),
      revenue: share('has_company_revenue'),
      industry: share('has_company_industry'),
    },
  }
}

// ---------------------------------------------------------------------------
// Drafting prompt
// ---------------------------------------------------------------------------

export const FILTERS_SYSTEM = `You set AudienceLab filters for a single-touch B2B cold-email program. The people come from intent segments already chosen for this company: everyone in the pool researched a relevant topic this week. Your job is to keep only people who are actual BUYERS for this company: the role that feels the problem and can say yes, at a company that fits.

How the filters combine: values inside one filter are OR'd; different filters are AND'ed. Every include filter also DROPS people whose value is unknown (the "known" % says how many have it). Exclude filters keep unknowns.

Rules:
- Backbone = seniority + departments describing who buys. Prefer them over titles.
- titles: only when the buyer is a specific role better named by title (e.g. "controller", "head of people"). Titles are AND'ed with seniority and departments, so when you use titles leave departments empty unless both are clearly right.
- exclude_titles: roles that research the topic but never buy (e.g. student, intern, teacher, professor, recruiter, consultant at a vendor). Short terms; matching is by words.
- employee_bands / revenue_bands: from the company's ideal customer. Leave empty if the profile gives no size signal. Use revenue only if the profile talks about revenue.
- industries: only if the company sells to specific industries. exclude_industries: industries that are clearly not buyers (e.g. the company's own industry when buyers would be competitors, education, government) when they show up in the audience.
- Use the audience makeup: do not filter on a value that barely exists in the pool, and say when a filter removes most of it.
- Use ONLY values from the allowed lists for seniority, departments, industries, employee_bands and revenue_bands. Spell them exactly.
- When unsure, filter less: later steps rank people by fit, so a slightly broad pool is fine; a pool filtered to near zero is not.

Return ONLY a JSON object:
{
  "filters": {
    "seniority": [], "departments": [], "titles": [], "title_match": "semantic",
    "exclude_titles": [], "employee_bands": [], "revenue_bands": [],
    "industries": [], "exclude_industries": []
  },
  "reasons": { "<field>": "max 20 words: why, citing the profile or the makeup" },
  "summary": "one sentence: who these filters keep"
}`

export function filtersUserMessage({ profileText, segments, makeup, allowed, current, need, target }) {
  const fmtList = (l) => (l || []).map((x) => `${x.value} ${x.count}`).join(', ') || '(none)'
  const known = makeup?.known || {}
  return [
    `COMPANY PROFILE\n\n${profileText}`,
    `\nSELECTED SEGMENTS\n${(segments || []).map((s) => `- ${s.topic} (${s.segment_id})`).join('\n')}`,
    `\nAUDIENCE MAKEUP (high intent, last 7 days, validated business email; ${makeup?.reach ?? '?'} people)`,
    `- seniority (known ${known.seniority ?? '?'}%): ${fmtList(makeup?.seniority)}`,
    `- department (known ${known.department ?? '?'}%): ${fmtList(makeup?.department)}`,
    `- job titles (known ${known.job_title ?? '?'}%): ${fmtList(makeup?.job_title)}`,
    `- company employees (known ${known.employee_count ?? '?'}%): ${fmtList(makeup?.employee_count)}`,
    `- company revenue (known ${known.revenue ?? '?'}%): ${fmtList(makeup?.revenue)}`,
    `- company industry (known ${known.industry ?? '?'}%): ${fmtList(makeup?.industry)}`,
    `\nVOLUME: the company sends to ${need} new people per weekday and wants about ${target} fresh people per day before ranking. The makeup above covers 7 days.`,
    current ? `\nCURRENT FILTERS (the user's last approved set; improve, don't discard without reason)\n${JSON.stringify(current)}` : '',
    `\nALLOWED VALUES\n- seniority: ${(allowed.seniority || []).join(', ')}\n- departments: ${(allowed.departments || []).join(', ')}\n- employee_bands: ${EMPLOYEE_BANDS.join(', ')}\n- revenue_bands: ${REVENUE_BANDS.join(', ')}\n- industries: ${(allowed.industries || []).join(', ')}`,
  ].join('\n')
}

export function normalizeReasons(obj) {
  const out = {}
  const r = obj && typeof obj === 'object' ? obj : {}
  for (const k of [...LIST_FIELDS]) {
    const s = String(r[k] ?? '').trim()
    if (s) out[k] = s.length > 240 ? `${s.slice(0, 240)}…` : s
  }
  return out
}
