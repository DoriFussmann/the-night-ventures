// Run: node --test lib/instantly/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addPushCounts,
  capacityFrom,
  copyFromCampaign,
  copyMatches,
  emptyPushCounts,
  fromInstantlyLead,
  fromInstantlyVars,
  htmlToText,
  mapLead,
  normalizeAccount,
  normalizeAnalytics,
  singleStepSequences,
  textToHtml,
  toInstantlyVars,
} from './mapping.js'

const LEAD = {
  email: 'jane@acme.com',
  first_name: 'Jane',
  last_name: 'Doe',
  job_title: 'Head of Ops',
  headline: '',
  company_name: 'Acme',
  company_domain: 'acme.com',
  company_industry: 'Software',
  company_employee_count: '51-200',
  company_revenue: '',
  company_state: 'CA',
  linkedin_url: 'linkedin.com/in/jane',
}

test('mapLead: core fields top-level, the rest as non-empty custom variables', () => {
  const m = mapLead(LEAD)
  assert.equal(m.email, 'jane@acme.com')
  assert.equal(m.first_name, 'Jane')
  assert.equal(m.website, 'acme.com')
  assert.equal(m.job_title, 'Head of Ops')
  assert.deepEqual(m.custom_variables, {
    industry: 'Software',
    company_size: '51-200',
    linkedin_profile: 'linkedin.com/in/jane',
    location: 'CA',
    company_url: 'acme.com',
  })
  // Instantly rejects unknown top-level lead keys (additionalProperties: false).
  const allowed = new Set(['email', 'first_name', 'last_name', 'company_name', 'website', 'job_title', 'custom_variables'])
  for (const k of Object.keys(m)) assert.ok(allowed.has(k), k)
  // Instantly rejects a lead that sets a built-in field both ways.
  for (const k of Object.keys(m.custom_variables)) assert.ok(!(k in m), `${k} is top-level and custom`)
})

test('mapLead round-trips through fromInstantlyLead', () => {
  const m = mapLead(LEAD)
  const back = fromInstantlyLead({ ...m, payload: m.custom_variables })
  assert.equal(back.first_name, 'Jane')
  assert.equal(back.company_domain, 'acme.com')
  assert.equal(back.company_industry, 'Software')
  assert.equal(back.linkedin_url, 'linkedin.com/in/jane')
})

test('variables: snake_case core → camelCase and back; custom unchanged', () => {
  const t = 'Hi {{first_name}}, {{job_title}} at {{ company_name }} — {{industry}}'
  const i = toInstantlyVars(t)
  assert.equal(i, 'Hi {{firstName}}, {{jobTitle}} at {{companyName}} — {{industry}}')
  assert.equal(fromInstantlyVars(i), 'Hi {{first_name}}, {{job_title}} at {{company_name}} — {{industry}}')
})

test('text ↔ html keeps paragraphs and escapes', () => {
  const text = 'Hi Jane,\n\nA < B & C.\nThanks'
  const html = textToHtml(text)
  assert.equal(html, '<div>Hi Jane,</div><div><br></div><div>A &lt; B &amp; C.</div><div>Thanks</div>')
  assert.equal(htmlToText(html), text)
})

test('singleStepSequences builds one email step', () => {
  const seq = singleStepSequences({ subject: 'Hi {{first_name}}', body: 'Hello {{first_name}}' })
  assert.equal(seq.length, 1)
  assert.equal(seq[0].steps.length, 1)
  assert.equal(seq[0].steps[0].type, 'email')
  assert.equal(seq[0].steps[0].variants[0].subject, 'Hi {{firstName}}')
  assert.equal(seq[0].steps[0].variants[0].body, '<div>Hello {{firstName}}</div>')
})

test('copyMatches compares the synced campaign with TNV copy', () => {
  const copy = { subject: 'Hi {{first_name}}', body: 'Hello {{first_name}},\n\nShort note.' }
  const campaign = { sequences: singleStepSequences(copy) }
  assert.deepEqual(copyFromCampaign(campaign), copy)
  assert.equal(copyMatches(campaign, copy), true)
  assert.equal(copyMatches(campaign, { ...copy, subject: 'Other' }), false)
  assert.equal(copyMatches({ sequences: [] }, copy), false)
})

test('copyMatches: a campaign synced with an old variable name is out of sync', () => {
  const copy = { subject: 'Hi', body: 'As {{job_title}}, you…' }
  const old = { sequences: [{ steps: [{ type: 'email', variants: [{ subject: 'Hi', body: '<div>As {{job_title}}, you…</div>' }] }] }] }
  assert.equal(copyMatches(old, copy), false)
  assert.equal(copyMatches({ sequences: singleStepSequences(copy) }, copy), true)
})

test('normalizeAccount flags unhealthy mailboxes', () => {
  const ok = normalizeAccount({ email: 'a@x.com', status: 1, warmup_status: 1, daily_limit: 30, stat_warmup_score: 98 }, 12)
  assert.equal(ok.healthy, true)
  assert.equal(ok.sentToday, 12)
  const bad = normalizeAccount({ email: 'b@x.com', status: -1, warmup_status: 0, daily_limit: 30, stat_warmup_score: 70 })
  assert.equal(bad.healthy, false)
  assert.deepEqual(bad.issues, ['Connection error', 'warmup paused', 'warmup score 70'])
})

test('capacityFrom: healthy accounts only, capped by campaign limit', () => {
  const boxes = [
    { healthy: true, limit: 30 },
    { healthy: true, limit: 30 },
    { healthy: false, limit: 30 },
  ]
  assert.deepEqual(capacityFrom(boxes, null), {
    inboxes: 2,
    totalInboxes: 3,
    accountTotal: 60,
    campaignCap: null,
    perDay: 60,
    perInbox: 30,
  })
  assert.equal(capacityFrom(boxes, 50).perDay, 50)
  assert.equal(capacityFrom(boxes, 50).perInbox, 25)
  assert.equal(capacityFrom([], 50).perInbox, 0)
})

test('normalizeAnalytics reads Instantly fields', () => {
  const a = normalizeAnalytics([
    { leads_count: 100, emails_sent_count: 80, open_count_unique: 40, reply_count_unique: 4, bounced_count: 2, unsubscribed_count: 1, link_click_count_unique: 3 },
  ])
  assert.deepEqual(
    { sent: a.sent, opened: a.opened, replied: a.replied, bounced: a.bounced, unsubscribed: a.unsubscribed, clicked: a.clicked, leads: a.leads },
    { sent: 80, opened: 40, replied: 4, bounced: 2, unsubscribed: 1, clicked: 3, leads: 100 }
  )
  assert.equal(normalizeAnalytics(null).sent, 0)
})

test('addPushCounts sums /leads/add responses', () => {
  const agg = emptyPushCounts()
  addPushCounts(agg, { leads_uploaded: 5, duplicated_leads: 1, in_blocklist: 2, invalid_email_count: 1, skipped_count: 0, duplicate_email_count: 1 })
  addPushCounts(agg, { leads_uploaded: 3 })
  assert.deepEqual(agg, { added: 8, already_in_campaign: 1, duplicates: 1, invalid: 1, blocked_by_provider: 2, skipped_by_provider: 0 })
})
