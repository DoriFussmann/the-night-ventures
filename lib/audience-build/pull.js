// Pure logic for Audience Build step 5: daily pull → clean → rank.
// No I/O; tested in pull.test.js.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

export const RECONTACT_DAYS = 90
export const FIT_BATCH = 40
export const MAX_RANKED = 400

function firstEmail(...values) {
  for (const v of values) {
    const m = String(v || '').match(EMAIL_RE)
    if (m) return m[0].toLowerCase()
  }
  return ''
}

export function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

export function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@')
  return at > 0 ? normalizeDomain(email.slice(at + 1)) : ''
}

const clip = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** AudienceLab record → candidate. Business email only (verified first). */
export function toCandidate(row) {
  const g = (k) => String(row?.[k] ?? '').trim()
  return {
    al_uuid: g('UUID') || null,
    email: firstEmail(g('BUSINESS_VERIFIED_EMAILS'), g('BUSINESS_EMAIL')),
    email_verified: Boolean(firstEmail(g('BUSINESS_VERIFIED_EMAILS'))),
    first_name: g('FIRST_NAME'),
    last_name: g('LAST_NAME'),
    job_title: g('JOB_TITLE'),
    headline: clip(g('HEADLINE'), 200),
    seniority: g('SENIORITY_LEVEL').toLowerCase(),
    department: g('DEPARTMENT').toLowerCase(),
    company_name: g('COMPANY_NAME'),
    company_domain: normalizeDomain(g('COMPANY_DOMAIN')),
    employee_count: g('COMPANY_EMPLOYEE_COUNT'),
    revenue: g('COMPANY_REVENUE'),
    industry: g('COMPANY_INDUSTRY'),
    linkedin_url: g('LINKEDIN_URL'),
    company_description: clip(g('COMPANY_DESCRIPTION'), 400),
  }
}

/**
 * Mark who can't be emailed today. Mutates nothing; returns new objects.
 * ctx: { dnc: Set<email>, recent: Set<email> (emailed < 90 days ago),
 *        excludedDomains: Set<domain> }
 */
export function classify(candidates, ctx) {
  const seen = new Set()
  const counts = { pulled: candidates.length, no_business_email: 0, duplicates: 0, dnc: 0, emailed_recently: 0, excluded_domain: 0, eligible: 0 }
  const out = []
  for (const c of candidates) {
    if (!c.email) {
      counts.no_business_email += 1
      continue
    }
    let reason = null
    const domains = [emailDomain(c.email), c.company_domain].filter(Boolean)
    if (seen.has(c.email)) reason = 'duplicate'
    else if (ctx.dnc?.has(c.email)) reason = 'dnc'
    else if (ctx.recent?.has(c.email)) reason = 'emailed_recently'
    else if (domains.some((d) => ctx.excludedDomains?.has(d))) reason = 'excluded_domain'
    seen.add(c.email)
    if (reason === 'duplicate') counts.duplicates += 1
    else if (reason) counts[reason] += 1
    else counts.eligible += 1
    out.push({ ...c, removed_reason: reason })
  }
  return { candidates: out, counts }
}

/** Domains never emailed: the company's own + its configured exclusions. */
export function excludedDomainSet(profile = {}) {
  const set = new Set()
  const own = normalizeDomain(profile.domain)
  if (own) set.add(own)
  for (const d of Array.isArray(profile.outbound_exclude_domains) ? profile.outbound_exclude_domains : []) {
    const n = normalizeDomain(d)
    if (n) set.add(n)
  }
  return set
}

/**
 * Final score, 0-1. Everyone in a run is high intent from the last day, so
 * intent doesn't separate them and isn't weighted here.
 *   70% Claude fit (0-10) · 20% company size fit · 10% contact quality
 */
export function scoreCandidate(c, filters = {}) {
  const fit = Math.max(0, Math.min(10, Number(c.fit_score) || 0)) / 10
  const bands = Array.isArray(filters.employee_bands) ? filters.employee_bands : []
  let size = 0.6
  if (!bands.length) size = 1
  else if (c.employee_count && bands.some((b) => b.toLowerCase() === c.employee_count.toLowerCase())) size = 1
  else if (!c.employee_count) size = 0.5
  const contact = (c.email_verified ? 0.7 : 0.4) + (c.linkedin_url ? 0.3 : 0)
  return Math.round((0.7 * fit + 0.2 * size + 0.1 * contact) * 1000) / 1000
}

/** Rank eligible candidates by score and mark the top `need` as selected. */
export function rankAndSelect(candidates, need, filters) {
  const eligible = candidates
    .filter((c) => !c.removed_reason)
    .map((c) => ({ ...c, score: scoreCandidate(c, filters) }))
    .sort((a, b) => b.score - a.score || (Number(b.fit_score) || 0) - (Number(a.fit_score) || 0))
    .map((c, i) => ({ ...c, rank: i + 1, selected: i < need }))
  const removed = candidates.filter((c) => c.removed_reason).map((c) => ({ ...c, score: null, rank: null, selected: false }))
  return [...eligible, ...removed]
}

/** Cheap pre-sort when the pool is larger than MAX_RANKED: seniority + size fit. */
export function preRank(candidates, filters = {}) {
  const sen = new Set(filters.seniority || [])
  const bands = new Set((filters.employee_bands || []).map((b) => b.toLowerCase()))
  const s = (c) => (sen.has(c.seniority) ? 2 : 0) + (bands.has(String(c.employee_count).toLowerCase()) ? 1 : 0) + (c.email_verified ? 0.5 : 0)
  return [...candidates].sort((a, b) => s(b) - s(a))
}

// ---------------------------------------------------------------------------
// Claude fit scoring
// ---------------------------------------------------------------------------

export const FIT_SYSTEM = `You score cold-email prospects for one company. Everyone below researched a relevant topic in the last day and already passed the company's filters. Only ONE email is sent per person, so rank who is most likely to be a real buyer who would welcome a relevant email now.

Score each person 0-10 for fit:
- 9-10: clearly the buyer (role owns the problem and the budget) at a company that clearly fits the ideal customer.
- 6-8: likely buyer or strong influencer at a fitting company.
- 3-5: plausible but unclear role or company fit.
- 0-2: wrong role (student, job seeker, practitioner with no say, vendor, competitor, consultant selling the same thing) or wrong company.
Use the job title, headline, seniority, department and the company description. Do not reward missing information.

Return ONLY a JSON object: { "scores": [ { "i": 0, "fit": 8, "reason": "max 12 words" } ] } with one entry per person, using their index i.`

export function fitLines(batch) {
  return batch
    .map((c, i) =>
      [
        `i=${i}`,
        `title: ${c.job_title || '?'}`,
        c.headline ? `headline: ${c.headline}` : null,
        `seniority: ${c.seniority || '?'}`,
        `dept: ${c.department || '?'}`,
        `company: ${c.company_name || '?'} (${c.employee_count || '? employees'}${c.industry ? `, ${c.industry}` : ''})`,
        c.company_description ? `about: ${clip(c.company_description, 220)}` : null,
      ]
        .filter(Boolean)
        .join(' | ')
    )
    .join('\n')
}

export function fitUserMessage(profileText, filtersSummary, batch) {
  return `COMPANY PROFILE\n\n${profileText}\n\nTARGETING\n${filtersSummary || '(none)'}\n\nPEOPLE (${batch.length})\n${fitLines(batch)}`
}

/** Apply Claude's scores to a batch by index; unscored people get fit 0. */
export function applyFit(batch, obj) {
  const by = new Map()
  for (const s of Array.isArray(obj?.scores) ? obj.scores : []) {
    const i = Number(s?.i)
    const fit = Number(s?.fit)
    if (Number.isInteger(i) && i >= 0 && i < batch.length && Number.isFinite(fit) && !by.has(i)) {
      by.set(i, { fit: Math.max(0, Math.min(10, fit)), reason: clip(s?.reason, 120) })
    }
  }
  return batch.map((c, i) => ({
    ...c,
    fit_score: by.get(i)?.fit ?? 0,
    fit_reason: by.get(i)?.reason || (by.has(i) ? '' : 'not scored'),
  }))
}

export function filtersSummary(f = {}) {
  const part = (label, v) => (Array.isArray(v) && v.length ? `${label}: ${v.join(', ')}` : null)
  return [
    part('Seniority', f.seniority),
    part('Departments', f.departments),
    part('Titles', f.titles),
    part('Excluded titles', f.exclude_titles),
    part('Company employees', f.employee_bands),
    part('Company revenue', f.revenue_bands),
    part('Industries', f.industries),
    part('Excluded industries', f.exclude_industries),
  ]
    .filter(Boolean)
    .join('\n')
}

/** YYYY-MM-DD in America/Los_Angeles (the run's business day). */
export function runDate(now = new Date(), timeZone = 'America/Los_Angeles') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
