-- Expand External Audit Snapshot storage for multi-source panel runs.
-- Ensures base table exists (021 may not have been applied yet), then adds
-- results jsonb + site_url for the progressive multi-panel payload.

create table if not exists public.audit_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  run_at timestamptz not null default now(),
  pagespeed_mobile jsonb,
  pagespeed_desktop jsonb,
  bot_access jsonb,
  jsonld_check jsonb,
  sample_url text
);

alter table public.audit_snapshots
  add column if not exists results jsonb;

alter table public.audit_snapshots
  add column if not exists site_url text;

comment on table public.audit_snapshots is
  'Point-in-time external audit snapshots per company (multi-source panel payload in results).';

comment on column public.audit_snapshots.results is
  'Full multi-source snapshot payload: { semrush, pagespeed, moz, dataforseo, technical }.';

comment on column public.audit_snapshots.site_url is
  'Canonical site URL audited for this run.';

create index if not exists audit_snapshots_company_id_idx
  on public.audit_snapshots (company_id);

create index if not exists audit_snapshots_company_run_at_idx
  on public.audit_snapshots (company_id, run_at desc);

alter table public.audit_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_snapshots'
      and policyname = 'Authenticated users can manage audit_snapshots'
  ) then
    create policy "Authenticated users can manage audit_snapshots"
      on public.audit_snapshots for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;
