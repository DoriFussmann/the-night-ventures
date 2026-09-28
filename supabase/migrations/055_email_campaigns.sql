-- Email Campaigns: company settings columns (idempotent — may already exist
-- if added by hand), plus local records of imported leads, import batches,
-- the Do Not Contact list, and replies captured from the SmartLead webhook.

alter table public.companies
  add column if not exists email_campaigns_enabled boolean not null default false,
  add column if not exists email_campaigns_provider text,
  add column if not exists email_campaigns_campaign_id text;

-- One row per CSV pushed to the provider.
create table if not exists public.email_lead_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  campaign_id text not null,
  file_name text,
  mode text not null default 'replace' check (mode in ('replace', 'append')),
  status text not null default 'pending'
    check (status in ('pending', 'clearing', 'pushing', 'done', 'failed')),
  input_count integer not null default 0,
  kept_count integer not null default 0,
  removed_from_campaign integer not null default 0,
  added_count integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists email_lead_imports_company_idx
  on public.email_lead_imports (company_id, created_at desc);

-- Every lead we've ever pushed for a company. Unique per company+email so a
-- person is never pushed twice (cross-upload dedupe).
create table if not exists public.email_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  import_id uuid references public.email_lead_imports (id) on delete set null,
  email text not null,
  first_name text,
  last_name text,
  company_name text,
  job_title text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create index if not exists email_leads_company_idx
  on public.email_leads (company_id, created_at desc);

-- Do Not Contact. Checked before every push; mirrored to SmartLead's
-- global block list.
create table if not exists public.email_dnc (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  source text not null default 'manual'
    check (source in ('manual', 'unsubscribe', 'reply')),
  note text,
  synced_to_provider boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, email)
);

create index if not exists email_dnc_company_idx
  on public.email_dnc (company_id, created_at desc);

-- Replies captured by the SmartLead webhook. read_at drives the unread badge.
create table if not exists public.email_replies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  campaign_id text,
  lead_email text,
  lead_name text,
  subject text,
  body_text text,
  received_at timestamptz not null default now(),
  read_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_replies_company_idx
  on public.email_replies (company_id, received_at desc);
create index if not exists email_replies_unread_idx
  on public.email_replies (company_id) where read_at is null;

-- RLS: same convention as the rest of the app (authenticated = full access).
do $$
declare t text;
begin
  foreach t in array array['email_lead_imports','email_leads','email_dnc','email_replies']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Authenticated users can manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "Authenticated users can manage %1$s" on public.%1$I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;
