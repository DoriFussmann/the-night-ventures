-- Email Campaigns move from SmartLead to Instantly (API v2).
--   * companies.email_copy_*: the single outbound email is written in TNV and
--     synced to the Instantly campaign as its only step.
--   * email_leads.sent_at / replied_at / bounced_at / unsubscribed_at: filled
--     by the Instantly webhook; Audience Build "Results" reads them.
--   * email_dnc.source gains 'bounce' (hard bounces are never emailed again).
--   * Provider is Instantly for every company. SmartLead campaign IDs don't
--     exist in Instantly, so they are cleared; set the Instantly ID in
--     Company Intelligence → Email Campaigns.
-- Idempotent. Safe to re-run.

alter table public.companies
  add column if not exists email_copy_subject text,
  add column if not exists email_copy_body text,
  add column if not exists email_copy_synced_at timestamptz;

comment on column public.companies.email_copy_body is
  'Email Campaigns: the single-touch email body (plain text, {{snake_case}} variables). Synced to Instantly as step 1.';

update public.companies
set email_campaigns_campaign_id = null
where email_campaigns_provider = 'smartlead';

update public.companies
set email_campaigns_provider = 'instantly'
where email_campaigns_provider is distinct from 'instantly';

alter table public.email_leads
  add column if not exists sent_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists unsubscribed_at timestamptz;

create index if not exists email_leads_import_idx on public.email_leads (import_id);

alter table public.email_dnc drop constraint if exists email_dnc_source_check;
alter table public.email_dnc
  add constraint email_dnc_source_check
  check (source in ('manual', 'unsubscribe', 'reply', 'bounce'));
