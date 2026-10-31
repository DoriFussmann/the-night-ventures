// Pure Instantly (API v2) mapping helpers. No I/O, so they are unit-testable
// (lib/instantly/mapping.test.js). The handler in ./handler.js does the calls.

// TNV copy uses snake_case variables ({{first_name}}). Instantly's built-in
// lead fields use camelCase in templates; everything else is a custom
// variable with the same snake_case key, sent in custom_variables.
// Keep in sync with VARIABLE_MAP in src/pages/tools/emailCampaigns/validateCopy.js.
export const CORE_VARS = {
  first_name: 'firstName',
  last_name: 'lastName',
  company_name: 'companyName',
  email: 'email',
  website: 'website',
}
const CORE_BACK = Object.fromEntries(Object.entries(CORE_VARS).map(([k, v]) => [v.toLowerCase(), k]))

// Custom variable key → field on a cleaned lead.
export const CUSTOM_VARS = {
  job_title: 'job_title',
  headline: 'headline',
  industry: 'company_industry',
  company_size: 'company_employee_count',
  company_revenue: 'company_revenue',
  linkedin_profile: 'linkedin_url',
  location: 'company_state',
  company_url: 'company_domain',
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

const clean = (v) => {
  const s = String(v ?? '').trim()
  return s || null
}

/** Cleaned lead (see cleanLeads.js OUTPUT_FIELDS) → Instantly /leads/add item. */
export function mapLead(c) {
  const custom = {}
  for (const [key, field] of Object.entries(CUSTOM_VARS)) {
    const v = clean(c?.[field])
    if (v) custom[key] = v
  }
  const out = {
    email: c.email,
    first_name: clean(c.first_name),
    last_name: clean(c.last_name),
    company_name: clean(c.company_name),
    website: clean(c.company_domain),
    job_title: clean(c.job_title),
  }
  if (Object.keys(custom).length) out.custom_variables = custom
  return out
}

/** Instantly lead (from /leads/list) → the cleaned-lead shape used for previews. */
export function fromInstantlyLead(l) {
  const p = l?.payload || {}
  const pick = (k) => String(p[k] ?? '').trim()
  return {
    first_name: l?.first_name || '',
    last_name: l?.last_name || '',
    email: l?.email || '',
    company_name: l?.company_name || '',
    company_domain: l?.website || l?.company_domain || pick('company_url'),
    job_title: l?.job_title || pick('job_title'),
    headline: pick('headline'),
    company_industry: pick('industry'),
    company_employee_count: pick('company_size'),
    company_revenue: pick('company_revenue'),
    company_state: pick('location'),
    linkedin_url: pick('linkedin_profile'),
  }
}

/** {{first_name}} → {{firstName}}; custom variables unchanged. */
export function toInstantlyVars(text) {
  return String(text || '').replace(VAR_RE, (m, name) => {
    const core = CORE_VARS[name.toLowerCase()]
    return core ? `{{${core}}}` : `{{${name}}}`
  })
}

/** {{firstName}} → {{first_name}}; custom variables unchanged. */
export function fromInstantlyVars(text) {
  return String(text || '').replace(VAR_RE, (m, name) => {
    const back = CORE_BACK[name.toLowerCase()]
    return back ? `{{${back}}}` : `{{${name}}}`
  })
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain-text body (blank line = new paragraph) → the HTML Instantly stores. */
export function textToHtml(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  return lines.map((l) => (l.trim() ? `<div>${escapeHtml(l)}</div>` : '<div><br></div>')).join('')
}

/** Instantly HTML body → plain text for the TNV editor. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>\s*<\/div>/gi, '</div>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The single-touch sequence Instantly expects in PATCH /campaigns/{id}. */
export function singleStepSequences({ subject, body }) {
  return [
    {
      steps: [
        {
          type: 'email',
          delay: 0,
          delay_unit: 'days',
          variants: [{ subject: toInstantlyVars(subject), body: textToHtml(toInstantlyVars(body)) }],
        },
      ],
    },
  ]
}

/** Steps in the campaign's (only) sequence. */
export function campaignSteps(campaign) {
  const seq = Array.isArray(campaign?.sequences) ? campaign.sequences[0] : null
  return Array.isArray(seq?.steps) ? seq.steps : []
}

/** First enabled variant of step 1, in TNV form ({ subject, body } plain text). */
export function copyFromCampaign(campaign) {
  const step = campaignSteps(campaign)[0]
  const variants = Array.isArray(step?.variants) ? step.variants : []
  const v = variants.find((x) => !x?.v_disabled) || variants[0]
  if (!v) return null
  return { subject: fromInstantlyVars(v.subject || ''), body: fromInstantlyVars(htmlToText(v.body || '')) }
}

/** Does the campaign's step 1 match this copy (after Instantly's translation)? */
export function copyMatches(campaign, copy) {
  const live = copyFromCampaign(campaign)
  if (!live || !copy) return false
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  return norm(live.subject) === norm(copy.subject) && norm(live.body) === norm(copy.body)
}

export const CAMPAIGN_STATUS = {
  0: 'Draft',
  1: 'Active',
  2: 'Paused',
  3: 'Completed',
  4: 'Running subsequences',
  [-99]: 'Account suspended',
  [-1]: 'Accounts unhealthy',
  [-2]: 'Bounce protect',
}

export const NOT_SENDING = {
  1: 'Outside the sending schedule',
  2: 'Waiting for a lead to process',
  3: 'Campaign daily limit reached',
  4: 'All sending accounts at their daily limit',
  99: 'Error — contact Instantly support',
}

const ACCOUNT_STATUS = {
  1: 'Active',
  2: 'Paused',
  3: 'Maintenance',
  [-1]: 'Connection error',
  [-2]: 'Soft bounce error',
  [-3]: 'Sending error',
}
const WARMUP_STATUS = {
  0: 'Paused',
  1: 'Active',
  [-1]: 'Banned',
  [-2]: 'Spam folder unknown',
  [-3]: 'Suspended',
}

const n = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Instantly account → mailbox row for the health table. */
export function normalizeAccount(a, sentToday = 0) {
  const status = Number(a?.status)
  const warm = Number(a?.warmup_status)
  const score = a?.stat_warmup_score == null ? null : n(a.stat_warmup_score)
  const issues = []
  if (status !== 1) issues.push(ACCOUNT_STATUS[status] || `status ${a?.status}`)
  if (a?.setup_pending) issues.push('setup pending')
  if (warm !== 1) issues.push(`warmup ${String(WARMUP_STATUS[warm] || a?.warmup_status).toLowerCase()}`)
  if (score != null && score < 90) issues.push(`warmup score ${score}`)
  return {
    email: a?.email || '',
    limit: n(a?.daily_limit),
    sentToday: n(sentToday),
    warmup: WARMUP_STATUS[warm] || '—',
    score,
    healthy: issues.length === 0,
    issues,
  }
}

/**
 * Real sending capacity for single touch: the healthy accounts' daily limits,
 * capped by the campaign's daily limit (null = no campaign cap).
 */
export function capacityFrom(mailboxes, campaignDailyLimit) {
  const healthy = (mailboxes || []).filter((m) => m.healthy)
  const accountTotal = healthy.reduce((s, m) => s + m.limit, 0)
  const cap = campaignDailyLimit == null || campaignDailyLimit === '' ? null : n(campaignDailyLimit)
  const perDay = cap != null && cap > 0 ? Math.min(accountTotal, cap) : accountTotal
  const inboxes = healthy.length
  return {
    inboxes,
    totalInboxes: (mailboxes || []).length,
    accountTotal,
    campaignCap: cap,
    perDay,
    // The TNV model is inboxes × per-inbox cap; round so the product ≈ perDay.
    perInbox: inboxes ? Math.max(1, Math.round(perDay / inboxes)) : 0,
  }
}

/** /campaigns/analytics item → the numbers the page shows. */
export function normalizeAnalytics(raw) {
  const a = Array.isArray(raw) ? raw[0] || {} : raw || {}
  return {
    leads: n(a.leads_count),
    contacted: n(a.contacted_count),
    sent: n(a.emails_sent_count),
    opened: n(a.open_count_unique),
    clicked: n(a.link_click_count_unique),
    replied: n(a.reply_count_unique),
    bounced: n(a.bounced_count),
    unsubscribed: n(a.unsubscribed_count),
    completed: n(a.completed_count),
  }
}

/** Sum /leads/add responses into the counters TNV records. */
export function addPushCounts(agg, resp) {
  agg.added += n(resp?.leads_uploaded)
  agg.already_in_campaign += n(resp?.duplicated_leads)
  agg.duplicates += n(resp?.duplicate_email_count)
  agg.invalid += n(resp?.invalid_email_count)
  agg.blocked_by_provider += n(resp?.in_blocklist)
  agg.skipped_by_provider += n(resp?.skipped_count)
  return agg
}

export function emptyPushCounts() {
  return {
    added: 0,
    already_in_campaign: 0,
    duplicates: 0,
    invalid: 0,
    blocked_by_provider: 0,
    skipped_by_provider: 0,
  }
}
