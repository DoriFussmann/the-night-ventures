# Audience Build — setup (one time)

Audience Build picks the best AudienceLab intent segments for a company and
counts how many high-intent people with a validated business email they hold.
Spec: TNV Lead Sourcing Engine — AudienceLab Spec (Claude doc).

1. Supabase → SQL Editor → New query → paste the full contents of
   `supabase/migrations/068_audience_build.sql` → Run, then the same for
   `069_audience_build_settings.sql`, `070_lead_sourcing_runs.sql` and
   `071_lead_sourcing_push.sql`.
   All are safe to re-run.
2. Vercel → Project → Settings → Environment Variables → add:
   - `AUDIENCELAB_API_KEY` — AudienceLab → Account → API keys
   - (optional) `AUDIENCE_BUILD_MODEL` — Claude model for matching; default `claude-opus-5-5`
   `ANTHROPIC_API_KEY` must already be set. Then Deployments → Redeploy.
3. Admin → **AudienceLab taxonomy** → **Sync now** (about 20 s; ~45,000
   segments). Shared by all companies. A weekly Vercel cron (Mondays 11:00
   UTC, needs `CRON_SECRET`) re-checks AudienceLab and rewrites the table only
   if the list changed; "Check for updates" in Admin does the same on demand.
4. Company Intelligence → Email Campaigns: SmartLead campaign ID and
   **Sending capacity** (inboxes × emails per inbox = new leads per weekday).
   The campaign should have exactly one step (single touch).
5. Admin → Audience Build → **Target pool multiplier** (default 3×): fresh
   people needed per day = leads sent per day × this.
6. For each company: **Find audiences**, then **Who to target**.

## How matching works

1. Claude reads Company Intelligence and writes buyer-side search phrases plus
   competitor/alternative names.
2. Postgres full-text search (`search_al_segments`) over segment topic,
   taxonomy keywords, category and description returns ~80 candidates.
   Competitor names match segment topics by trigram similarity.
3. Claude ranks the candidates 0–10 and the page shows the top 10 for "researchers are buyers right now".
4. The page counts the top 5 via AudienceLab `/insights` (high intent,
   business email with a validation status; 7-day and 1-day windows) one at a
   time, best first, and stops once one segment alone covers the target pool. Each count takes 10–30 s; results are cached 12 h in
   `al_segment_counts` and shared across companies.

Do Not Call is deliberately not a filter: it governs phone outreach, and on a
test segment it removed 76% of the pool.

## Taxonomy keywords

AudienceLab's API returns segments without keywords, so keywords come from the
taxonomy sheet AudienceLab publishes, stored in
`lib/audience-build/data/al-keywords.json.gz` (`{ segment_id: keywords }`).
When AudienceLab ships a new sheet, export its first tab to CSV and run:

    node scripts/build-al-keywords.mjs path/to/taxonomy.csv

then commit the updated file and re-sync.

## Step 3: who to target (ICP filters)

After saving segments, **Who to target → Draft with Claude**:

1. The page reads the real makeup of the selected segments (one `/insights`
   call: seniority, department, titles, company size, revenue, industry, and
   what share of people have each field).
2. Claude drafts filters from Company Intelligence + that makeup, using only
   values AudienceLab accepts (`GET /audiences/attributes/*`). Unknown values
   are dropped.
3. You edit them. **Check impact** counts fresh people per day as each group
   of filters is added (one call per row, cached 12 h).
4. **Approve Filters** saves them to the config and to the company's
   `icp_*` fields.

AudienceLab semantics (verified): values in one filter are OR'd, filters are
AND'ed, several segments are a union; include filters drop people with an
unknown value, exclude filters keep them.

## Step 5: today's leads

Once filters are approved, **Today's leads → Pull today's leads**:

1. Creates an AudienceLab audience: approved segments + filters, high intent,
   `days_back = 1`, business email with a validation status. Generation took
   ~4 s in testing; the audience is deleted after its records are read.
2. Removes anyone who can't be emailed: duplicates, Do Not Contact
   (`email_dnc`), emailed for this company in the last 90 days
   (`email_leads`), and excluded domains (the company's own domain plus
   `company_profiles.outbound_exclude_domains`). People emailed 90+ days ago
   stay: they are high intent again.
3. Claude scores each eligible person's fit 0–10 in batches of 40 (max 400 a
   day). Score = 70% fit, 20% company-size fit, 10% contact quality; intent is
   equal for everyone in the run, so it isn't weighted.
4. The top inboxes × daily cap are ticked as today's list. Tick/untick to
   swap people, then **Approve List** to lock it. **Download CSV** uses
   AudienceLab column names, so it imports as-is in Email Campaigns.

A re-pull replaces the day's list unless it was already pushed. Runs are
stored in `lead_sourcing_runs`, people in `lead_sourcing_candidates`.

## Step 6: auto-pull, review, push

- **Weekday auto-pull** (opt-in per company, switch in Today's leads): a
  Vercel cron at 12:00 UTC Mon–Fri (~5 AM PT) calls
  `?action=audience-build&job=daily-pull`, which fans out one
  `job=pull-one` request per company (each gets its own function run). Each
  pull ranks the day's list and emails `EMAIL_CAMPAIGN_NOTIFY_TO` via Resend
  with a review link. Needs `CRON_SECRET`, `RESEND_API_KEY`, and optionally
  `PUBLIC_APP_URL`.
- **24-hour window.** Nothing is sent until **Approve & Push**. A list not
  pushed within 24 hours of the pull becomes `expired`; the next pull
  replaces it.
- **Push** (`pushLeadsToCampaign` in `lib/smartlead/handler.js`): same rules
  as the CSV import (Do Not Contact never pushed, everyone recorded in
  `email_leads` + an `email_lead_imports` row named "Audience Build <date>").
  Someone emailed 90+ days ago is re-contacted: their old entry is removed
  from the campaign first, because SmartLead won't re-email a lead already in
  it. `email_leads.created_at` is reset to the push time (the 90-day clock).
- The section warns when the SmartLead campaign doesn't have exactly 1 step.
