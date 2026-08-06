-- External Audit Snapshot runs: PageSpeed, bot access (robots.txt), JSON-LD checks.
-- Every run is stored to support trend / history views.

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

comment on table public.audit_snapshots is
  'Point-in-time external audit snapshots (PageSpeed, robots bot access, JSON-LD) per company.';

comment on column public.audit_snapshots.pagespeed_mobile is
  'PageSpeed Insights mobile strategy payload: category scores + Core Web Vitals field data.';

comment on column public.audit_snapshots.pagespeed_desktop is
  'PageSpeed Insights desktop strategy payload: category scores + Core Web Vitals field data.';

comment on column public.audit_snapshots.bot_access is
  'Per known-bot allow/block status parsed from robots.txt.';

comment on column public.audit_snapshots.jsonld_check is
  'JSON-LD validity + expected @type presence for a sample article URL.';

comment on column public.audit_snapshots.sample_url is
  'Article URL used for the JSON-LD check (explicit or auto-selected).';

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
