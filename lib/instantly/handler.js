import { Resend } from 'resend'
import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
  createServiceClient,
} from '../seo-advisor/auth.js'
import {
  addPushCounts,
  campaignSteps,
  capacityFrom,
  copyFromCampaign,
  copyMatches,
  emptyPushCounts,
  mapLead,
  normalizeAccount,
  normalizeAnalytics,
  singleStepSequences,
} from './mapping.js'

// Instantly (API v2) proxy for the Email Campaigns and Audience Build pages.
// The API key never leaves the server, and the campaign ID is ALWAYS read from
// the company record — the client only sends companyId, so a page can never
// touch another campaign. Docs: https://developer.instantly.ai
// Base https://api.instantly.ai/api/v2, Authorization: Bearer <key>.

const BASE = 'https://api.instantly.ai/api/v2'
const TIMEOUT_MS = 20000
const ADD_BATCH = 1000 // /leads/add max per request
const LIST_PAGE = 100
const DELETE_CONCURRENCY = 4
const WEBHOOK_EVENTS = ['reply_received', 'lead_unsubscribed', 'email_bounced', 'email_sent']

function apiKey() {
  return String(process.env.INSTANTLY_API_KEY || '').trim()
}

export function instantlyConfigured() {
  return Boolean(apiKey())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function httpError(message, statusCode) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function qs(query) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)))
    else p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function inFetch(path, { method = 'GET', body, query } = {}, attempt = 0) {
  const key = apiKey()
  if (!key) throw httpError('INSTANTLY_API_KEY is not set in the server environment', 400)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}${qs(query)}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    // Rate-limited per workspace; back off and retry a few times.
    if (res.status === 429 && attempt < 4) {
      clearTimeout(timer)
      await sleep(1500 * (attempt + 1))
      return inFetch(path, { method, body, query }, attempt + 1)
    }
    const text = await res.text()
    let data = text
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* keep text */
    }
    if (!res.ok) {
      let msg = (data && (data.message || data.error)) || `Instantly HTTP ${res.status}`
      if (res.status === 401) msg = `Instantly rejected the API key (${msg}). Check INSTANTLY_API_KEY and its scopes.`
      if (res.status === 402) msg = 'Instantly says the workspace has no active paid plan with API access.'
      if (res.status === 404 && /^\/campaigns\/[^/]+$/.test(path)) msg = 'Instantly campaign not found. Check the Campaign ID in Company Intelligence.'
      throw httpError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status)
    }
    return data
  } catch (err) {
    if (err?.name === 'AbortError') throw httpError('Instantly request timed out', 504)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const inGet = (path, query) => inFetch(path, { query })

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const normEmail = (e) => String(e || '').trim().toLowerCase()

function isoDate(d) {
  return d.toISOString().slice(0, 10)
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

const COMPANY_COLUMNS =
  'id, name, email_campaigns_enabled, email_campaigns_campaign_id, email_copy_subject, email_copy_body, email_copy_synced_at'

// Resolve the company's campaign from the DB. Never trust a client-sent ID.
async function loadCompanyCampaign(db, companyId) {
  const id = String(companyId || '').trim()
  if (!id) throw httpError('companyId is required', 400)
  const { data, error } = await db.from('companies').select(COMPANY_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw httpError(error.message, 500)
  if (!data) throw httpError('Company not found', 404)
  if (!data.email_campaigns_enabled) throw httpError('Email campaigns are off for this company', 400)
  const campaignId = String(data.email_campaigns_campaign_id || '').trim()
  if (!campaignId) throw httpError('No Instantly Campaign ID set in Company Intelligence', 400)
  return { company: data, campaignId, cid: encodeURIComponent(campaignId) }
}

const savedCopy = (company) =>
  company?.email_copy_subject || company?.email_copy_body
    ? { subject: company.email_copy_subject || '', body: company.email_copy_body || '' }
    : null

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

// ---------------------------------------------------------------------------
// Instantly reads shared by several resources
// ---------------------------------------------------------------------------

async function listAll(path, query = {}, max = 1000) {
  const out = []
  let after = null
  for (let guard = 0; guard < 50 && out.length < max; guard++) {
    const page = await inGet(path, { ...query, limit: LIST_PAGE, starting_after: after })
    const items = Array.isArray(page?.items) ? page.items : Array.isArray(page) ? page : []
    out.push(...items)
    after = page?.next_starting_after
    if (!after || !items.length) break
  }
  return out
}

// The sending accounts this campaign uses: listed emails plus tagged accounts.
async function campaignMailboxes(campaign) {
  const emails = new Set((campaign?.email_list || []).map(normEmail))
  const tags = campaign?.email_tag_list || []
  const all = await listAll('/accounts')
  let tagged = []
  if (tags.length) tagged = await listAll('/accounts', { tag_ids: tags.join(',') }).catch(() => [])
  const byEmail = new Map()
  for (const a of [...all.filter((a) => emails.has(normEmail(a.email))), ...tagged]) byEmail.set(normEmail(a.email), a)
  const accounts = [...byEmail.values()]

  // Sent today per account (best effort; the table still shows without it).
  const sent = new Map()
  if (accounts.length) {
    const today = isoDate(new Date())
    try {
      const rows = await inGet('/accounts/analytics/daily', {
        start_date: today,
        end_date: today,
        emails: accounts.map((a) => a.email),
      })
      for (const r of Array.isArray(rows) ? rows : []) sent.set(normEmail(r.email_account), Number(r.sent) || 0)
    } catch {
      /* ignore */
    }
  }
  return accounts.map((a) => normalizeAccount(a, sent.get(normEmail(a.email)) || 0))
}

async function ourWebhooks(campaignId) {
  const list = await listAll('/webhooks', { campaign: campaignId }, 200)
  return list.filter((w) => String(w.target_hook_url || '').includes('instantly-webhook'))
}

async function findLeadIds(campaignId, email) {
  const page = await inFetch('/leads/list', { method: 'POST', body: { campaign: campaignId, search: email, limit: 10 } })
  const items = Array.isArray(page?.items) ? page.items : []
  return items.filter((l) => normEmail(l.email) === normEmail(email)).map((l) => l.id).filter(Boolean)
}

/**
 * Everything needed to say whether the connection is ready to send:
 * campaign found, status, one step, copy synced, mailboxes, webhooks.
 * Never throws; problems come back as `checks`.
 */
export async function connectionStatus(db, companyId) {
  const checks = []
  const add = (id, ok, label, detail = null, fix = null) => checks.push({ id, ok, label, detail, fix })
  if (!instantlyConfigured()) {
    add('api_key', false, 'API key', 'INSTANTLY_API_KEY is not set in Vercel', 'vercel')
    return { ok: false, checks }
  }
  add('api_key', true, 'API key')
  let ctx
  try {
    ctx = await loadCompanyCampaign(db, companyId)
  } catch (err) {
    add('campaign', false, 'Campaign', err.message, 'company-data')
    return { ok: false, checks }
  }
  let campaign
  try {
    campaign = await inGet(`/campaigns/${ctx.cid}`)
  } catch (err) {
    add('campaign', false, 'Campaign', err.message, 'company-data')
    return { ok: false, checks }
  }
  const status = Number(campaign?.status)
  add('campaign', true, 'Campaign', campaign?.name || ctx.campaignId)

  const steps = campaignSteps(campaign).length
  add(
    'single_step',
    steps === 1,
    'Exactly one step (single touch)',
    steps === 1 ? null : steps === 0 ? 'No email yet — save the copy in Email Campaigns to create it' : `${steps} steps — saving the copy in TNV replaces them with one`,
    'copy'
  )

  const copy = savedCopy(ctx.company)
  const synced = copy && copyMatches(campaign, copy)
  add(
    'copy',
    Boolean(synced),
    'Email copy synced',
    !copy ? 'No copy saved in TNV yet' : synced ? null : 'Instantly differs from the copy saved in TNV — save it again to sync',
    'copy'
  )

  let mailboxes = []
  try {
    mailboxes = await campaignMailboxes(campaign)
  } catch (err) {
    add('mailboxes', false, 'Sending accounts', err.message, 'instantly')
  }
  const capacity = capacityFrom(mailboxes, campaign?.daily_limit)
  if (mailboxes.length || !checks.find((c) => c.id === 'mailboxes')) {
    const bad = mailboxes.filter((m) => !m.healthy)
    add(
      'mailboxes',
      mailboxes.length > 0 && bad.length === 0,
      'Sending accounts healthy',
      !mailboxes.length
        ? 'No sending accounts on this campaign — add them in Instantly'
        : bad.length
          ? `${bad.length} of ${mailboxes.length} need attention: ${bad.map((m) => `${m.email} (${m.issues.join(', ')})`).join('; ')}`
          : `${mailboxes.length} account${mailboxes.length === 1 ? '' : 's'} · ${capacity.perDay}/day`,
      'instantly'
    )
  }

  let hooks = []
  try {
    hooks = await ourWebhooks(ctx.campaignId)
  } catch (err) {
    add('webhooks', false, 'Reply, bounce and unsubscribe tracking', err.message, 'webhooks')
  }
  if (!checks.find((c) => c.id === 'webhooks')) {
    const have = new Set(hooks.map((h) => h.event_type))
    const missing = WEBHOOK_EVENTS.filter((e) => !have.has(e))
    add(
      'webhooks',
      missing.length === 0,
      'Reply, bounce and unsubscribe tracking',
      missing.length ? `Not connected: ${missing.join(', ')}` : null,
      'webhooks'
    )
  }

  add(
    'active',
    status === 1,
    'Campaign active',
    status === 1 ? null : `Status: ${({ 0: 'Draft', 2: 'Paused', 3: 'Completed', '-1': 'Accounts unhealthy', '-2': 'Bounce protect', '-99': 'Account suspended' })[status] ?? status}`,
    'activate'
  )

  // Pushing only needs the campaign, one step and synced copy; the rest warn.
  const blocking = ['api_key', 'campaign', 'single_step', 'copy']
  const canPush = checks.filter((c) => blocking.includes(c.id)).every((c) => c.ok)
  return {
    ok: checks.every((c) => c.ok),
    canPush,
    checks,
    campaign: { id: ctx.campaignId, name: campaign?.name || null, status, dailyLimit: campaign?.daily_limit ?? null },
    capacity,
  }
}

// ---------------------------------------------------------------------------
// Authenticated actions (Email Campaigns page, Company Intelligence)
// ---------------------------------------------------------------------------

export async function handleInstantly(req, res) {
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
    // Resources that don't need a saved campaign yet.
    if (resource === 'list-campaigns') {
      const items = await listAll('/campaigns', {}, 300)
      return json(res, 200, {
        ok: true,
        resource,
        data: items.map((c) => ({ id: c.id, name: c.name, status: Number(c.status) })),
      })
    }
    if (resource === 'connection') {
      return json(res, 200, { ok: true, resource, data: await connectionStatus(db, body.companyId) })
    }

    const { company, campaignId, cid } = await loadCompanyCampaign(db, body.companyId)
    let data

    switch (resource) {
      // Everything the top of the page needs, in one round trip.
      case 'overview': {
        const [campaign, analytics] = await Promise.all([
          inGet(`/campaigns/${cid}`),
          inGet('/campaigns/analytics', { id: campaignId }).catch(() => null),
        ])
        const live = copyFromCampaign(campaign)
        data = {
          campaignId,
          campaign: {
            name: campaign?.name,
            status: Number(campaign?.status),
            notSending: campaign?.not_sending_status ?? null,
            dailyLimit: campaign?.daily_limit ?? null,
            created: campaign?.timestamp_created,
            steps: campaignSteps(campaign).length,
            stopOnReply: campaign?.stop_on_reply ?? null,
          },
          analytics: normalizeAnalytics(analytics),
          copy: savedCopy(company),
          copySyncedAt: company.email_copy_synced_at,
          liveCopy: live,
          copyInSync: Boolean(savedCopy(company) && copyMatches(campaign, savedCopy(company))),
        }
        break
      }

      case 'analytics-range': {
        const days = [1, 7, 30].includes(Number(body.days)) ? Number(body.days) : 7
        const end = new Date()
        const start = new Date(end.getTime() - (days - 1) * 86400000)
        const raw = await inGet('/campaigns/analytics', {
          id: campaignId,
          start_date: isoDate(start),
          end_date: isoDate(end),
          exclude_total_leads_count: true,
        })
        data = normalizeAnalytics(raw)
        break
      }

      // One page of leads in the campaign. Cursor pagination.
      case 'leads': {
        const limit = Math.min(100, Math.max(1, Number(body.limit) || 50))
        const page = await inFetch('/leads/list', {
          method: 'POST',
          body: { campaign: campaignId, limit, ...(body.cursor ? { starting_after: String(body.cursor) } : {}) },
        })
        data = { items: Array.isArray(page?.items) ? page.items : [], next: page?.next_starting_after || null }
        break
      }

      case 'mailboxes': {
        const campaign = await inGet(`/campaigns/${cid}`)
        const mailboxes = await campaignMailboxes(campaign)
        data = { mailboxes, capacity: capacityFrom(mailboxes, campaign?.daily_limit) }
        break
      }

      // Write Instantly's real capacity into the TNV model (inboxes × per inbox).
      case 'sync-capacity': {
        const campaign = await inGet(`/campaigns/${cid}`)
        const capacity = capacityFrom(await campaignMailboxes(campaign), campaign?.daily_limit)
        if (!capacity.inboxes) throw httpError('No healthy sending accounts on this campaign', 400)
        const { error } = await db
          .from('company_profiles')
          .update({ outbound_inboxes: Math.min(20, capacity.inboxes), outbound_daily_cap: Math.min(200, capacity.perInbox) })
          .eq('company_id', company.id)
        if (error) throw httpError(error.message, 500)
        data = capacity
        break
      }

      // Activate (start/resume) or pause. Instantly has no permanent stop.
      case 'status': {
        const action = String(body.status || '').toLowerCase()
        if (!['activate', 'pause'].includes(action)) throw httpError('status must be activate or pause', 400)
        data = await inFetch(`/campaigns/${cid}/${action}`, { method: 'POST' })
        break
      }

      // Save the single email in TNV and write it to the campaign as its only step.
      case 'copy-save': {
        const subject = String(body.subject || '').trim()
        const text = String(body.body || '').replace(/\r\n?/g, '\n').trim()
        if (!subject) throw httpError('Subject is required', 400)
        if (!text) throw httpError('Body is required', 400)
        if (subject.length > 300) throw httpError('Subject is too long', 400)
        if (text.length > 20000) throw httpError('Body is too long', 400)
        const { error } = await db
          .from('companies')
          .update({ email_copy_subject: subject, email_copy_body: text })
          .eq('id', company.id)
        if (error) throw httpError(error.message, 500)
        let syncError = null
        try {
          await inFetch(`/campaigns/${cid}`, { method: 'PATCH', body: { sequences: singleStepSequences({ subject, body: text }) } })
          await db.from('companies').update({ email_copy_synced_at: new Date().toISOString() }).eq('id', company.id)
        } catch (err) {
          syncError = err.message || 'Instantly update failed'
        }
        data = { saved: true, synced: !syncError, syncError }
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

      // Replace mode: remove one page of current campaign leads. Leads that
      // replied are kept so live conversations aren't lost. The client calls
      // this repeatedly with the returned cursor until done.
      case 'clear-batch': {
        const page = await inFetch('/leads/list', {
          method: 'POST',
          body: { campaign: campaignId, limit: LIST_PAGE, ...(body.cursor ? { starting_after: String(body.cursor) } : {}) },
        })
        const rows = Array.isArray(page?.items) ? page.items : []
        const { data: replied } = await db.from('email_replies').select('lead_email').eq('company_id', company.id)
        const keep = new Set((replied || []).map((r) => normEmail(r.lead_email)))
        const toDelete = []
        let kept = 0
        for (const l of rows) {
          if (keep.has(normEmail(l.email)) || Number(l.email_reply_count) > 0) kept += 1
          else if (l.id) toDelete.push(l.id)
        }
        let removed = 0
        let failed = 0
        await mapLimit(toDelete, DELETE_CONCURRENCY, async (leadId) => {
          try {
            await inFetch(`/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' })
            removed += 1
          } catch (err) {
            console.error('instantly delete lead failed', leadId, err?.message)
            failed += 1
          }
        })
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
        // Leads are listed in id order, so the next page starts after the last
        // id on this one (deleted or not). Done when there is no next page.
        data = {
          removed,
          kept,
          failed,
          done: !page?.next_starting_after || rows.length < LIST_PAGE,
          cursor: rows.length ? rows[rows.length - 1].id : body.cursor || null,
          stuck: rows.length > 0 && removed === 0 && kept === 0,
        }
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
          ...emptyPushCounts(),
        }
        if (importId) await db.from('email_lead_imports').update({ status: 'pushing' }).eq('id', importId)
        for (const b of chunk(leads, ADD_BATCH)) {
          const resp = await addLeads(campaignId, b)
          addPushCounts(agg, resp)
          await recordLeads(db, company.id, importId || null, b, { resetClock: false })
        }

        if (importId) {
          const { data: imp } = await db
            .from('email_lead_imports')
            .select('added_count, stats')
            .eq('id', importId)
            .maybeSingle()
          const prev = imp?.stats?.push || {}
          const push = Object.fromEntries(Object.keys(agg).map((k) => [k, (Number(prev[k]) || 0) + agg[k]]))
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
            .update({ status: 'failed', error: String(body.error || '').slice(0, 1000), finished_at: new Date().toISOString() })
            .eq('id', body.importId)
        }
        data = { ok: true }
        break
      }

      // Add to DNC locally and to Instantly's workspace block list.
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
          for (const part of chunk(emails, 500)) {
            await inFetch('/block-lists-entries/bulk-create', { method: 'POST', body: { bl_values: part } })
          }
          synced = true
          await db.from('email_dnc').update({ synced_to_provider: true }).eq('company_id', company.id).in('email', emails)
        } catch (err) {
          syncError = err?.message || 'Instantly block list sync failed'
        }
        data = { added: emails.length, synced, syncError }
        break
      }

      // Test send of the rendered email to the internal notify address(es)
      // only — the recipient is never taken from the client. Sent via Resend,
      // so it checks copy/formatting, not Instantly mailbox deliverability.
      case 'send-test': {
        const key = String(process.env.RESEND_API_KEY || '').trim()
        const to = notifyRecipients()
        if (!key) throw httpError('RESEND_API_KEY is not set in Vercel', 400)
        if (!to.length) throw httpError('Set EMAIL_CAMPAIGN_NOTIFY_TO in Vercel', 400)
        const emails = (Array.isArray(body.emails) ? body.emails : []).slice(0, 5)
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

      case 'webhook-status': {
        const hooks = await ourWebhooks(campaignId)
        const have = new Set(hooks.map((h) => h.event_type))
        data = { connected: WEBHOOK_EVENTS.filter((e) => have.has(e)), missing: WEBHOOK_EVENTS.filter((e) => !have.has(e)) }
        break
      }

      // One webhook per event we track, scoped to this campaign.
      case 'webhook-register': {
        const secret = String(process.env.INSTANTLY_WEBHOOK_SECRET || '').trim()
        if (!secret) throw httpError('Set INSTANTLY_WEBHOOK_SECRET in Vercel first', 400)
        const url = `${publicBaseUrl(req)}/api/check-article-update?action=instantly-webhook&token=${encodeURIComponent(secret)}`
        const have = new Set((await ourWebhooks(campaignId)).map((h) => h.event_type))
        const created = []
        for (const event of WEBHOOK_EVENTS.filter((e) => !have.has(e))) {
          await inFetch('/webhooks', {
            method: 'POST',
            body: { campaign: campaignId, name: `TNV ${event}`, target_hook_url: url, event_type: event },
          })
          created.push(event)
        }
        data = { created }
        break
      }

      default:
        return json(res, 400, { error: `Unknown resource "${resource}"` })
    }
    return json(res, 200, { ok: true, resource, data })
  } catch (err) {
    console.error('instantly error:', err)
    return json(res, err.statusCode || 502, { ok: false, error: err.message || 'Instantly request failed' })
  }
}

async function addLeads(campaignId, leads) {
  return inFetch('/leads/add', {
    method: 'POST',
    body: {
      campaign_id: campaignId,
      leads: leads.map(mapLead),
      // TNV owns dedupe (DNC + 90-day rule); Instantly still checks its block list.
      skip_if_in_workspace: false,
      skip_if_in_campaign: false,
      skip_if_in_list: false,
    },
  })
}

// Record pushed leads so future pushes dedupe against them. resetClock: the
// 90-day re-contact rule reads created_at, so a re-push restarts it.
async function recordLeads(db, companyId, importId, leads, { resetClock }) {
  const now = new Date().toISOString()
  const rows = leads.map((l) => ({
    company_id: companyId,
    import_id: importId,
    email: l.email,
    first_name: l.first_name || null,
    last_name: l.last_name || null,
    company_name: l.company_name || null,
    job_title: l.job_title || null,
    data: l,
    ...(resetClock ? { created_at: now, sent_at: null, replied_at: null, bounced_at: null } : {}),
  }))
  const { error } = await db
    .from('email_leads')
    .upsert(rows, resetClock ? { onConflict: 'company_id,email' } : { onConflict: 'company_id,email', ignoreDuplicates: true })
  if (error) console.error('email_leads upsert failed:', error)
}

// ---------------------------------------------------------------------------
// Public webhook: Instantly → us. Authenticated by a shared secret in the URL.
// ---------------------------------------------------------------------------

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
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

async function notifyReply({ companyName, leadEmail, leadName, subject, text, uniboxUrl }) {
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
      text: [
        `${companyName} campaign got a reply.`,
        '',
        `From: ${leadName ? `${leadName} <${leadEmail}>` : leadEmail}`,
        `Subject: ${subject || '(none)'}`,
        ...(uniboxUrl ? [`Answer in Instantly: ${uniboxUrl}`] : []),
        '',
        String(text || '').slice(0, 4000),
      ].join('\n'),
    })
  } catch (err) {
    console.error('reply notification failed:', err)
  }
}

const tsOrNow = (v) => {
  const t = v ? Date.parse(v) : NaN
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString()
}

export async function handleInstantlyWebhook(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const secret = String(process.env.INSTANTLY_WEBHOOK_SECRET || '').trim()
  const token = new URL(req.url || '/', 'http://localhost').searchParams.get('token')
  if (!secret || token !== secret) return json(res, 401, { error: 'Unauthorized' })

  const p = parseBody(req) || {}
  const event = String(p.event_type || '').toLowerCase()
  const campaignId = String(p.campaign_id || p.campaign || '').trim()
  const leadEmail = normEmail(p.lead_email || p.email)
  const at = tsOrNow(p.timestamp)

  try {
    const db = createServiceClient()
    const { data: companies } = await db.from('companies').select('id, name').eq('email_campaigns_campaign_id', campaignId)
    if (!companies?.length) return json(res, 200, { ok: true, ignored: 'unknown campaign' })

    const name = [p.firstName || p.first_name, p.lastName || p.last_name].filter(Boolean).join(' ') || null
    for (const company of companies) {
      const markLead = (patch) =>
        leadEmail
          ? db.from('email_leads').update(patch).eq('company_id', company.id).eq('email', leadEmail)
          : Promise.resolve()

      if (event === 'reply_received') {
        const subject = p.reply_subject || null
        const text = p.reply_text || stripHtml(p.reply_html || '') || p.reply_text_snippet || ''
        await db.from('email_replies').insert({
          company_id: company.id,
          campaign_id: campaignId,
          lead_email: leadEmail || null,
          lead_name: name,
          subject,
          body_text: text || null,
          received_at: at,
          raw: p,
        })
        await markLead({ replied_at: at })
        await notifyReply({ companyName: company.name, leadEmail, leadName: name, subject, text, uniboxUrl: p.unibox_url })
      } else if (event === 'email_sent') {
        await markLead({ sent_at: at })
      } else if (event === 'email_bounced' && leadEmail) {
        await markLead({ bounced_at: at })
        await db.from('email_dnc').upsert(
          { company_id: company.id, email: leadEmail, source: 'bounce', synced_to_provider: true },
          { onConflict: 'company_id,email', ignoreDuplicates: true }
        )
      } else if (event === 'lead_unsubscribed' && leadEmail) {
        await markLead({ unsubscribed_at: at })
        await db.from('email_dnc').upsert(
          { company_id: company.id, email: leadEmail, source: 'unsubscribe', synced_to_provider: true },
          { onConflict: 'company_id,email', ignoreDuplicates: true }
        )
      }
    }
    return json(res, 200, { ok: true })
  } catch (err) {
    console.error('instantly webhook error:', err)
    // 200 anyway: a 5xx makes Instantly retry; the error is in the logs.
    return json(res, 200, { ok: false })
  }
}

// ---------------------------------------------------------------------------
// Server-side push (Audience Build). Same rules as the CSV import: Do Not
// Contact is never pushed; everyone pushed is recorded in email_leads.
// Difference: someone emailed more than `recontactAfterDays` ago may be pushed
// again. Instantly won't re-add a lead already in the campaign, so their old
// campaign entry is deleted first.
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

async function removeFromCampaign(campaignId, email) {
  try {
    const ids = await findLeadIds(campaignId, email)
    for (const id of ids) await inFetch(`/leads/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return ids.length > 0
  } catch (err) {
    console.error('instantly re-contact removal failed', email, err?.message)
    return false
  }
}

/**
 * @param leads cleaned-lead shape (see cleanLeads.js OUTPUT_FIELDS)
 * @returns {{ importId, sent, added, skipped_dnc, skipped_recent, recontacts, already_in_campaign, duplicates, invalid, blocked_by_provider, skipped_by_provider }}
 */
export async function pushLeadsToCampaign(db, companyId, leads, { fileName = null, recontactAfterDays = 90, stats = {} } = {}) {
  const { company, campaignId } = await loadCompanyCampaign(db, companyId)
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
  const agg = { sent: 0, skipped_dnc: 0, skipped_recent: 0, recontacts: 0, ...emptyPushCounts() }
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
    await mapLimit(recontact, DELETE_CONCURRENCY, async (l) => {
      await removeFromCampaign(campaignId, l.email)
      agg.recontacts += 1
    })
    const all = [...toPush, ...recontact]
    agg.sent = all.length
    for (const b of chunk(all, ADD_BATCH)) {
      addPushCounts(agg, await addLeads(campaignId, b))
      await recordLeads(db, company.id, imp.id, b, { resetClock: true })
    }
    await db
      .from('email_lead_imports')
      .update({
        added_count: agg.added,
        stats: { ...stats, source: 'audience-build', push: agg },
        status: 'done',
        finished_at: new Date().toISOString(),
      })
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
