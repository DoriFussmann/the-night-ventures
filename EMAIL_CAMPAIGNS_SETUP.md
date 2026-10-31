# Email Campaigns — setup (one time)

Outreach runs through **Instantly** (API v2). Single touch: one email per
person, no follow-ups. The email is written in TNV and synced to the Instantly
campaign as its only step.

1. Supabase → SQL Editor → New query → paste the full contents of
   `supabase/migrations/055_email_campaigns.sql` → Run, then the same for
   `072_instantly.sql`. Both are safe to re-run. 072 switches every company to
   Instantly and clears old SmartLead campaign IDs.
2. Instantly → Settings → Integrations → API keys → create a key with
   `all:all` scope (or campaigns, leads, accounts, webhooks, block list entries
   and analytics). API v2 needs a plan with API access.
3. Vercel → Project → Settings → Environment Variables → add:
   - `INSTANTLY_API_KEY` — the key from step 2
   - `INSTANTLY_WEBHOOK_SECRET` — any long random string
   - `EMAIL_CAMPAIGN_NOTIFY_TO` — email(s) that get reply alerts, comma-separated
   - `RESEND_API_KEY` — already set if the contact form works (alerts + tests)
   Remove `SMARTLEAD_API_KEY` and `SMARTLEAD_WEBHOOK_SECRET`. Then Deployments → Redeploy.
4. In Instantly, create a campaign: add the sending accounts and the schedule.
   No steps needed — TNV writes the email.
5. Company Intelligence → Email Campaigns: turn it on and pick the campaign.
6. Email Campaigns → **Email copy**: write the subject and body, then
   **Save & sync to Instantly**. Variables use `{{first_name}}`-style names;
   on sync the built-in ones become Instantly's (`{{firstName}}`,
   `{{lastName}}`, `{{companyName}}`) and the rest are sent with each lead as
   custom variables.
7. Email Campaigns → Replies → **Connect tracking** once. It registers
   Instantly webhooks for `reply_received`, `email_sent`, `email_bounced` and
   `lead_unsubscribed` on this campaign. Replies land in TNV and email
   `EMAIL_CAMPAIGN_NOTIFY_TO`; bounces and unsubscribes go to Do Not Contact.
8. Audience Build → **Instantly connection** shows what's left (all green =
   ready), and can copy the real sending capacity from the campaign's accounts.
   Activate the campaign there or in Instantly.

## What goes where

| TNV | Instantly API v2 |
| --- | --- |
| Campaign picker | `GET /campaigns` |
| Overview, steps, copy check | `GET /campaigns/{id}` |
| Save copy | `PATCH /campaigns/{id}` (`sequences` with one step) |
| Pause / Activate | `POST /campaigns/{id}/pause`, `/activate` |
| Performance | `GET /campaigns/analytics` |
| Mailbox health, capacity | `GET /accounts`, `GET /accounts/analytics/daily` |
| Push leads | `POST /leads/add` (≤ 1,000 per call) |
| Leads table, re-contact | `POST /leads/list`, `DELETE /leads/{id}` |
| Do Not Contact | `POST /block-lists-entries/bulk-create` |
| Tracking | `POST /webhooks` → `?action=instantly-webhook&token=…` |

Code: `lib/instantly/handler.js` (calls) and `lib/instantly/mapping.js`
(pure mapping, tests in `mapping.test.js`; run `node --test lib/instantly/*.test.js`).
