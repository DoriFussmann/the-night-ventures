import { Resend } from 'resend'
import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
  createServiceClient,
} from '../seo-advisor/auth.js'

// SmartLead proxy for the Email Campaigns page. The API key never leaves the
// server, and the campaign ID is ALWAYS read from the company record — the
// client only sends companyId, so a page can never touch another campaign.
// Docs: https://api.smartlead.ai  (base https://server.smartlead.ai/api/v1)

const BASE = 'https://server.smartlead.ai/api/v1'
const TIMEOUT_MS = 20000
const IMPORT_BATCH = 400
const CLEAR_PAGE = 100
const DELETE_CONCURRENCY = 4

function apiKey() {
  return String(process.env.SMARTLEAD_API_KEY || '').trim()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function httpError(message, statusCode) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

async function slFetch(path, { method = 'GET', body } = {}, attempt = 0) {
  const key = apiKey()
  if (!key) throw httpError('SMARTLEAD_API_KEY is not set in the server environment', 400)
  const sep = path.includes('?') ? '&' : '?'
  const url = `${BASE}${path}${sep}api_key=${encodeURIComponent(key)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    // SmartLead rate-limits per key; back off and retry a few times.
    if (res.status === 429 && attempt < 4) {
      clearTimeout(timer)
      await sleep(1500 * (attempt + 1))
      return slFetch(path, { method, body }, attempt + 1)
    }
    const text = await res.text()
    let data = text
    try {
      data = JSON.parse(text)
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `SmartLead HTTP ${res.status}`
      throw httpError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status)
    }
    return data
  } catch (err) {
    if (err?.name === 'AbortError') throw httpError('SmartLead request timed out', 504)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const slGet = (path) => slFetch(path)

// Map a cleaned lead (compact shape from the CSV cleaner) to SmartLead's item.
// Keep in sync with VARIABLE_MAP in src/pages/tools/emailCampaigns/validateCopy.js.
function mapLead(c) {
  return {
    email: c.email,
    first_name: c.first_name,
    last_name: c.last_name,
    company_name: c.company_name,
    company_url: c.company_domain,
    website: c.company_domain,
    linkedin_profile: c.linkedin_url,
    location: c.company_state,
    custom_fields: {
      job_title: c.job_title,
      headline: c.headline,
      industry: c.company_industry,
      company_size: c.company_employee_count,
      company_revenue: c.company_revenue,
    },
  }
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const normEmail = (e) => String(e || '').trim().toLowerCase()

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

// Resolve the company's campaign from the DB. Never trust a client-sent ID.
async function loadCompanyCampaign(db, companyId) {
  const id = String(companyId || '').trim()
  if (!id) throw httpError('companyId is required', 400)
  const { data, error } = await db
    .from('companies')
    .select('id, name, email_campaigns_enabled, email_campaigns_provider, email_campaigns_campaign_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw httpError(error.message, 500)
  if (!data) throw httpError('Company not found', 404)
  if (!data.email_campaigns_enabled) throw httpError('Email campaigns are off for this company', 400)
  if (data.email_campaigns_provider !== 'smartlead') {
    throw httpError('Only SmartLead is supported right now', 400)
  }
  const campaignId = String(data.email_campaigns_campaign_id || '').trim()
  if (!campaignId) throw httpError('No Campaign ID set in Company Intelligence', 400)
  return { company: data, campaignId, cid: encodeURIComponent(campaignId) }
}

// Emails in this company's DNC list or already pushed before.
async function blockedEmails(db, companyId, emails) {
  const dnc = new Set()
  const existing = new Set()
  for (const part of chunk(emails, 500)) {
    const [d, e] = await Promise.all([
      db.from('email_dnc').select('email').eq('company_id', companyId).in('email', part),
      db.from('email_leads').select('email').eq('company_id', companyId).in('email', part),
    ])
    if (d.error) throw httpError(d.error.message, 500)
    if (e.error) throw httpError(e.error.message, 500)
    for (const r of d.data || []) dnc.add(normEmail(r.email))
    for (const r of e.data || []) existing.add(normEmail(r.email))
  }
  return { dnc, existing }
}

async function mapLimit(items, limit, fn) {
  const results = []
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

function publicBaseUrl(req) {
  const explicit = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '')
  if (explicit) return explicit
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || 'https'
  return `${proto}://${host}`
}

// ---------------------------------------------------------------------------
// Authenticated actions (called from the Email Campaigns page)
// ---------------------------------------------------------------------------

export async function handleSmartlead(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const body = parseBody(req) || {}
  const resource = String(body.resource || '').trim()
  const db = auth.supabase

  try {
    const { company, campaignId, cid } = await loadCompanyCampaign(db, body.companyId)
    let data

    switch (resource) {
      // Everything the top of the page needs, in one round trip.
      case 'overview': {
        const [campaign, sequences, analytics, leadsPage] = await Promise.all([
          slGet(`/campaigns/${cid}`),
          slGet(`/campaigns/${cid}/sequences`),
          slGet(`/campaigns/${cid}/analytics`).catch(() => null),
          slGet(`/campaigns/${cid}/leads?offset=0&limit=1`).catch(() => null),
        ])
        data = {
          campaignId,
          provider: company.email_campaigns_provider,
          campaign,
          sequences,
          analytics,
          leadCount: Number(leadsPage?.total_leads ?? 0) || 0,
        }
        break
      }

      case 'analytics-range': {
        const days = [1, 7, 30].includes(Number(body.days)) ? Number(body.days) : 7
        const end = new Date()
        const start = new Date(end.getTime() - (days - 1) * 86400000)
        data = await slGet(
          `/campaigns/${cid}/analytics-by-date?start_date=${isoDate(start)}&end_date=${isoDate(end)}`
        )
        break
      }

      case 'leads': {
        const offset = Math.max(0, Number(body.offset) || 0)
        const limit = Math.min(100, Math.max(1, Number(body.limit) || 50))
        data = await slGet(`/campaigns/${cid}/leads?offset=${offset}&limit=${limit}`)
        break
      }

      case 'mailboxes':
        data = await slGet(`/campaigns/${cid}/email-accounts`)
        break

      // Pause / resume / stop. STOPPED is permanent in SmartLead.
      case 'status': {
        const status = String(body.status || '').toUpperCase()
        if (!['PAUSED', 'START', 'STOPPED'].includes(status)) {
          throw httpError('status must be PAUSED, START or STOPPED', 400)
        }
        data = await slFetch(`/campaigns/${cid}/status`, { method: 'POST', body: { status } })
        break
      }

      // Which of these emails are DNC or already pushed before.
      case 'precheck': {
        const emails = [...new Set((body.emails || []).map(normEmail).filter(Boolean))]
        const { dnc, existing } = await blockedEmails(db, company.id, emails)
        data = { dnc: [...dnc], existing: [...existing] }
        break
      }

      case 'import-start': {
        const mode = body.mode === 'append' ? 'append' : 'replace'
        const { data: row, error } = await db
          .from('email_lead_imports')
          .insert({
            company_id: company.id,
            campaign_id: campaignId,
            file_name: String(body.fileName || '').slice(0, 300) || null,
            mode,
            status: mode === 'replace' ? 'clearing' : 'pushing',
            input_count: Number(body.inputCount) || 0,
            kept_count: Number(body.keptCount) || 0,
            stats: body.stats || {},
            created_by: auth.user.id,
          })
          .select('id')
          .single()
        if (error) throw httpError(error.message, 500)
        data = { importId: row.id }
        break
      }

      // LIFO via replace: remove one page of existing campaign leads. Leads that
      // replied are kept so live conversations aren't lost. The client calls
      // this repeatedly (offset = kept so far) until remaining hits 0.
      case 'clear-batch': {
        const offset = Math.max(0, Number(body.offset) || 0)
        const page = await slGet(`/campaigns/${cid}/leads?offset=${offset}&limit=${CLEAR_PAGE}`)
        const rows = Array.isArray(page?.data) ? page.data : []
        const { data: replied } = await db
          .from('email_replies')
          .select('lead_email')
          .eq('company_id', company.id)
        const keep = new Set((replied || []).map((r) => normEmail(r.lead_email)))
        const toDelete = []
        let kept = 0
        for (const r of rows) {
          const lead = r.lead || r
          if (keep.has(normEmail(lead.email))) kept += 1
          else if (lead.id != null) toDelete.push(lead.id)
        }
        let removed = 0
        let failed = 0
        await mapLimit(toDelete, DELETE_CONCURRENCY, async (leadId) => {
          try {
            await slFetch(`/campaigns/${cid}/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' })
            removed += 1
          } catch (err) {
            console.error('smartlead delete lead failed', leadId, err?.message)
            failed += 1
          }
        })
        const total = Number(page?.total_leads ?? 0) || 0
        const remaining = Math.max(0, total - offset - removed - kept)
        if (body.importId && removed) {
          const { data: imp } = await db
            .from('email_lead_imports')
            .select('removed_from_campaign')
            .eq('id', body.importId)
            .maybeSingle()
          await db
            .from('email_lead_imports')
            .update({ removed_from_campaign: (imp?.removed_from_campaign || 0) + removed })
            .eq('id', body.importId)
        }
        // If nothing could be deleted on a full page, stop the client looping.
        data = { removed, kept, failed, remaining, stuck: rows.length > 0 && removed === 0 && kept === 0 }
        break
      }

      // Push a chunk of cleaned leads. The server re-applies DNC + dedupe so the
      // rules hold even if the client is stale. `final` marks the import done.
      case 'leads-import': {
        const importId = body.importId
        const incoming = (Array.isArray(body.leads) ? body.leads : [])
          .map((l) => ({ ...l, email: normEmail(l.email) }))
          .filter((l) => l.email)
        const { dnc, existing } = await blockedEmails(db, company.id, incoming.map((l) => l.email))
        const leads = incoming.filter((l) => !dnc.has(l.email) && !existing.has(l.email))

        const agg = {
          sent: leads.length,
          skipped_dnc: incoming.filter((l) => dnc.has(l.email)).length,
          skipped_existing: incoming.filter((l) => existing.has(l.email)).length,
          added: 0,
          already_in_campaign: 0,
          duplicates: 0,
          invalid: 0,
          blocked_by_provider: 0,
        }
        if (importId) {
          await db.from('email_lead_imports').update({ status: 'pushing' }).eq('id', importId)
        }
        for (const b of chunk(leads, IMPORT_BATCH)) {
          const resp = await slFetch(`/campaigns/${cid}/leads`, {
            method: 'POST',
            body: {
              lead_list: b.map(mapLead),
              settings: {
                ignore_global_block_list: false,
                ignore_unsubscribe_list: false,
                ignore_duplicate_leads_in_other_campaign: false,
              },
            },
          })
          agg.added += Number(resp?.added_count ?? resp?.upload_count ?? 0) || 0
          agg.already_in_campaign += Number(resp?.already_added_to_campaign ?? 0) || 0
          agg.duplicates += Number(resp?.duplicate_count ?? 0) || 0
          agg.invalid += Number(resp?.invalid_email_count ?? 0) || 0
          agg.blocked_by_provider += Number(resp?.block_count ?? resp?.unsubscribed_leads?.length ?? 0) || 0

          // Record locally so future uploads dedupe against them.
          const rows = b.map((l) => ({
            company_id: company.id,
            import_id: importId || null,
            email: l.email,
            first_name: l.first_name || null,
            last_name: l.last_name || null,
            company_name: l.company_name || null,
            job_title: l.job_title || null,
            data: l,
          }))
          const { error } = await db
            .from('email_leads')
            .upsert(rows, { onConflict: 'company_id,email', ignoreDuplicates: true })
          if (error) console.error('email_leads upsert failed:', error)
        }

        if (importId) {
          const { data: imp } = await db
            .from('email_lead_imports')
            .select('added_count, stats')
            .eq('id', importId)
            .maybeSingle()
          const prev = imp?.stats?.push || {}
          const push = Object.fromEntries(
            Object.keys(agg).map((k) => [k, (Number(prev[k]) || 0) + agg[k]])
          )
          await db
            .from('email_lead_imports')
            .update({
              added_count: (imp?.added_count || 0) + agg.added,
              stats: { ...(imp?.stats || {}), push },
              ...(body.final ? { status: 'done', finished_at: new Date().toISOString() } : {}),
            })
            .eq('id', importId)
        }
        data = agg
        break
      }

      case 'import-fail': {
        if (body.importId) {
          await db
            .from('email_lead_imports')
            .update({
              status: 'failed',
              error: String(body.error || '').slice(0, 1000),
              finished_at: new Date().toISOString(),
            })
            .eq('id', body.importId)
        }
        data = { ok: true }
        break
      }

      // Add to DNC locally and to SmartLead's global block list.
      case 'dnc-add': {
        const emails = [...new Set((body.emails || []).map(normEmail).filter((e) => e.includes('@')))]
        if (!emails.length) throw httpError('No valid emails', 400)
        const note = String(body.note || '').slice(0, 500) || null
        const { error } = await db.from('email_dnc').upsert(
          emails.map((email) => ({ company_id: company.id, email, source: 'manual', note })),
          { onConflict: 'company_id,email', ignoreDuplicates: true }
        )
        if (error) throw httpError(error.message, 500)
        let synced = false
        let syncError = null
        try {
          await slFetch('/leads/add-domain-block-list', {
            method: 'POST',
            body: { domain_block_list: emails },
          })
          synced = true
          await db
            .from('email_dnc')
            .update({ synced_to_provider: true })
            .eq('company_id', company.id)
            .in('email', emails)
        } catch (err) {
          syncError = err?.message || 'SmartLead block list sync failed'
        }
        data = { added: emails.length, synced, syncError }
        break
      }

      // Test send of the rendered sequence to the internal notify address(es)
      // only — the recipient is never taken from the client. Sent via Resend,
      // so it checks copy/formatting, not SmartLead mailbox deliverability.
      case 'send-test': {
        const key = String(process.env.RESEND_API_KEY || '').trim()
        const to = notifyRecipients()
        if (!key) throw httpError('RESEND_API_KEY is not set in Vercel', 400)
        if (!to.length) throw httpError('Set EMAIL_CAMPAIGN_NOTIFY_TO in Vercel', 400)
        const emails = (Array.isArray(body.emails) ? body.emails : []).slice(0, 20)
        if (!emails.length) throw httpError('Nothing to send', 400)
        const resend = new Resend(key)
        let sent = 0
        for (const e of emails) {
          const { error } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'The Night Ventures <onboarding@resend.dev>',
            to,
            subject: `[TEST] ${String(e.subject || '(no subject)').slice(0, 250)}`,
            html: String(e.html || '').slice(0, 200000),
          })
          if (error) throw httpError(`Resend: ${error.message || 'send failed'}`, 502)
          sent += 1
          await sleep(600) // Resend default limit is 2 req/s
        }
        data = { sent, to }
        break
      }

      case 'webhook-status':
        data = await slGet(`/campaigns/${cid}/webhooks`)
        break

      // Register reply + unsubscribe webhooks for this campaign.
      case 'webhook-register': {
        const secret = String(process.env.SMARTLEAD_WEBHOOK_SECRET || '').trim()
        if (!secret) throw httpError('Set SMARTLEAD_WEBHOOK_SECRET in Vercel first', 400)
        const url = `${publicBaseUrl(req)}/api/check-article-update?action=smartlead-webhook&token=${encodeURIComponent(secret)}`
        data = await slFetch(`/campaigns/${cid}/webhooks`, {
          method: 'POST',
          body: {
            id: null,
            name: 'TNV replies + unsubscribes',
            webhook_url: url,
            event_types: ['EMAIL_REPLY', 'LEAD_UNSUBSCRIBED'],
            categories: [],
          },
        })
        break
      }

      default:
        return json(res, 400, { error: `Unknown resource "${resource}"` })
    }
    return json(res, 200, { ok: true, resource, data })
  } catch (err) {
    console.error('smartlead error:', err)
    return json(res, err.statusCode || 502, { ok: false, error: err.message || 'SmartLead request failed' })
  }
}

// ---------------------------------------------------------------------------
// Public webhook: SmartLead → us. Authenticated by a shared secret in the URL.
// ---------------------------------------------------------------------------

function pick(obj, ...paths) {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
}

function notifyRecipients() {
  const raw = String(process.env.EMAIL_CAMPAIGN_NOTIFY_TO || process.env.INQUIRY_TO_EMAIL || '').trim()
  return raw.split(',').map((x) => x.trim()).filter(Boolean)
}

async function notifyReply({ companyName, leadEmail, leadName, subject, text }) {
  const key = String(process.env.RESEND_API_KEY || '').trim()
  const to = notifyRecipients()
  if (!key || !to.length) return
  try {
    const resend = new Resend(key)
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'The Night Ventures <onboarding@resend.dev>',
      to,
      replyTo: leadEmail || undefined,
      subject: `Reply — ${companyName}: ${leadName || leadEmail || 'lead'}`,
      text: `${companyName} campaign got a reply.\n\nFrom: ${leadName ? `${leadName} <${leadEmail}>` : leadEmail}\nSubject: ${subject || '(none)'}\n\n${String(text || '').slice(0, 4000)}`,
    })
  } catch (err) {
    console.error('reply notification failed:', err)
  }
}

export async function handleSmartleadWebhook(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const secret = String(process.env.SMARTLEAD_WEBHOOK_SECRET || '').trim()
  const token = new URL(req.url || '/', 'http://localhost').searchParams.get('token')
  if (!secret || token !== secret) return json(res, 401, { error: 'Unauthorized' })

  const p = parseBody(req) || {}
  const event = String(p.event_type || p.eventType || '').toUpperCase()
  const campaignId = String(pick(p, 'campaign_id', 'campaignId') ?? '').trim()

  try {
    const db = createServiceClient()
    const { data: companies } = await db
      .from('companies')
      .select('id, name')
      .eq('email_campaigns_campaign_id', campaignId)
    if (!companies?.length) return json(res, 200, { ok: true, ignored: 'unknown campaign' })

    const leadEmail = normEmail(
      pick(p, 'sl_lead_email', 'lead_email', 'leadCorrespondence.targetLeadEmail', 'lead.email', 'to_email')
    )
    const leadName = pick(p, 'to_name', 'lead_name', 'lead.first_name') || null

    for (const company of companies) {
      if (event === 'EMAIL_REPLY') {
        const subject = pick(p, 'subject', 'reply_message.subject') || null
        const text =
          pick(p, 'reply_message.text', 'reply_body') ||
          stripHtml(pick(p, 'reply_message.html', 'reply_message_html') || '')
        const received = pick(p, 'reply_message.time', 'event_timestamp', 'time_replied')
        await db.from('email_replies').insert({
          company_id: company.id,
          campaign_id: campaignId,
          lead_email: leadEmail || null,
          lead_name: leadName,
          subject,
          body_text: text || null,
          received_at: received ? new Date(received).toISOString() : new Date().toISOString(),
          raw: p,
        })
        await notifyReply({ companyName: company.name, leadEmail, leadName, subject, text })
      } else if (event === 'LEAD_UNSUBSCRIBED' && leadEmail) {
        await db.from('email_dnc').upsert(
          { company_id: company.id, email: leadEmail, source: 'unsubscribe', synced_to_provider: true },
          { onConflict: 'company_id,email', ignoreDuplicates: true }
        )
      }
    }
    return json(res, 200, { ok: true })
  } catch (err) {
    console.error('smartlead webhook error:', err)
    // 200 anyway: a 5xx makes SmartLead retry-storm; the error is in logs.
    return json(res, 200, { ok: false })
  }
}

// ---------------------------------------------------------------------------
// Server-side push (Audience Build step 6). Same rules as the CSV import:
// Do Not Contact is never pushed; everyone pushed is recorded in email_leads.
// Difference: someone emailed more than `recontactAfterDays` ago may be pushed
// again. SmartLead won't email a lead already in the campaign, so their old
// campaign entry is removed first.
// ---------------------------------------------------------------------------

async function existingWithDates(db, companyId, emails) {
  const out = new Map()
  for (const part of chunk(emails, 500)) {
    const { data, error } = await db
      .from('email_leads')
      .select('email, created_at')
      .eq('company_id', companyId)
      .in('email', part)
    if (error) throw httpError(error.message, 500)
    for (const r of data || []) out.set(normEmail(r.email), r.created_at)
  }
  return out
}

async function removeFromCampaign(cid, email) {
  try {
    const found = await slGet(`/leads/?email=${encodeURIComponent(email)}`)
    const lead = Array.isArray(found) ? found[0] : found
    const leadId = lead?.id ?? lead?.lead_id
    if (leadId == null) return false
    await slFetch(`/campaigns/${cid}/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' })
    return true
  } catch (err) {
    console.error('smartlead re-contact removal failed', email, err?.message)
    return false
  }
}

/**
 * @param leads cleaned-lead shape (see cleanLeads.js OUTPUT_FIELDS)
 * @returns {{ importId, sent, added, skipped_dnc, skipped_recent, recontacts, already_in_campaign, duplicates, invalid, blocked_by_provider }}
 */
export async function pushLeadsToCampaign(db, companyId, leads, { fileName = null, recontactAfterDays = 90, stats = {} } = {}) {
  const { company, campaignId, cid } = await loadCompanyCampaign(db, companyId)
  const incoming = []
  const seen = new Set()
  for (const l of Array.isArray(leads) ? leads : []) {
    const email = normEmail(l?.email)
    if (!email || seen.has(email)) continue
    seen.add(email)
    incoming.push({ ...l, email })
  }
  const emails = incoming.map((l) => l.email)
  const [{ dnc }, existing] = await Promise.all([blockedEmails(db, company.id, emails), existingWithDates(db, company.id, emails)])
  const cutoff = Date.now() - recontactAfterDays * 86400000
  const agg = {
    sent: 0,
    added: 0,
    skipped_dnc: 0,
    skipped_recent: 0,
    recontacts: 0,
    already_in_campaign: 0,
    duplicates: 0,
    invalid: 0,
    blocked_by_provider: 0,
  }
  const toPush = []
  const recontact = []
  for (const l of incoming) {
    if (dnc.has(l.email)) agg.skipped_dnc += 1
    else if (existing.has(l.email)) {
      if (Date.parse(existing.get(l.email)) < cutoff) recontact.push(l)
      else agg.skipped_recent += 1
    } else toPush.push(l)
  }

  const { data: imp, error: impErr } = await db
    .from('email_lead_imports')
    .insert({
      company_id: company.id,
      campaign_id: campaignId,
      file_name: fileName,
      mode: 'append',
      status: 'pushing',
      input_count: incoming.length,
      kept_count: toPush.length + recontact.length,
      stats: { ...stats, source: 'audience-build' },
    })
    .select('id')
    .single()
  if (impErr) throw httpError(impErr.message, 500)

  try {
    for (const l of recontact) {
      await removeFromCampaign(cid, l.email)
      agg.recontacts += 1
    }
    const all = [...toPush, ...recontact]
    agg.sent = all.length
    const now = new Date().toISOString()
    for (const b of chunk(all, IMPORT_BATCH)) {
      const resp = await slFetch(`/campaigns/${cid}/leads`, {
        method: 'POST',
        body: {
          lead_list: b.map(mapLead),
          settings: {
            ignore_global_block_list: false,
            ignore_unsubscribe_list: false,
            ignore_duplicate_leads_in_other_campaign: false,
          },
        },
      })
      agg.added += Number(resp?.added_count ?? resp?.upload_count ?? 0) || 0
      agg.already_in_campaign += Number(resp?.already_added_to_campaign ?? 0) || 0
      agg.duplicates += Number(resp?.duplicate_count ?? 0) || 0
      agg.invalid += Number(resp?.invalid_email_count ?? 0) || 0
      agg.blocked_by_provider += Number(resp?.block_count ?? resp?.unsubscribed_leads?.length ?? 0) || 0

      // created_at = last pushed; the 90-day rule reads it.
      const rows = b.map((l) => ({
        company_id: company.id,
        import_id: imp.id,
        email: l.email,
        first_name: l.first_name || null,
        last_name: l.last_name || null,
        company_name: l.company_name || null,
        job_title: l.job_title || null,
        data: l,
        created_at: now,
      }))
      const { error } = await db.from('email_leads').upsert(rows, { onConflict: 'company_id,email' })
      if (error) console.error('email_leads upsert failed:', error)
    }
    await db
      .from('email_lead_imports')
      .update({ added_count: agg.added, stats: { ...stats, source: 'audience-build', push: agg }, status: 'done', finished_at: new Date().toISOString() })
      .eq('id', imp.id)
    return { importId: imp.id, ...agg }
  } catch (err) {
    await db
      .from('email_lead_imports')
      .update({ status: 'failed', error: String(err?.message || err).slice(0, 1000), finished_at: new Date().toISOString() })
      .eq('id', imp.id)
    throw err
  }
}

/** Number of steps in the company's SmartLead campaign sequence. */
export async function campaignStepCount(db, companyId) {
  const { cid } = await loadCompanyCampaign(db, companyId)
  const seq = await slGet(`/campaigns/${cid}/sequences`)
  return Array.isArray(seq) ? seq.length : Array.isArray(seq?.data) ? seq.data.length : 0
}

/** Plain-text ops email to EMAIL_CAMPAIGN_NOTIFY_TO (fallback INQUIRY_TO_EMAIL). */
export async function sendOpsEmail({ subject, text }) {
  const key = String(process.env.RESEND_API_KEY || '').trim()
  const to = notifyRecipients()
  if (!key || !to.length) return { sent: false, reason: 'RESEND_API_KEY or EMAIL_CAMPAIGN_NOTIFY_TO not set' }
  try {
    const resend = new Resend(key)
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'The Night Ventures <onboarding@resend.dev>',
      to,
      subject,
      text,
    })
    if (error) return { sent: false, reason: error.message || 'send failed' }
    return { sent: true }
  } catch (err) {
    return { sent: false, reason: err?.message || 'send failed' }
  }
}
