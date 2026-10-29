-- Audience Build step 5: daily pull → clean → rank → review.
--   lead_sourcing_runs: one per company per day (a re-run replaces it).
--   lead_sourcing_candidates: everyone pulled that day, with why they were
--   removed (if they were), Claude's fit score, rank and whether they are in
--   the day's send list.
-- Idempotent. Safe to re-run.

create table if not exists public.lead_sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  run_date date not null,
  -- running | ready | failed | approved | pushed
  status text not null default 'running'
    check (status in ('running', 'ready', 'failed', 'approved', 'pushed')),
  al_audience_id text,
  segment_ids text[] not null default '{}',
  -- Snapshot of the approved filters used for this run.
  filters jsonb not null default '{}'::jsonb,
  need integer not null default 0,
  -- { pulled, no_business_email, duplicates, dnc, emailed_recently,
  --   excluded_domain, eligible, ranked, selected }
  counts jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, run_date)
);

create index if not exists lead_sourcing_runs_company_idx
  on public.lead_sourcing_runs (company_id, run_date desc);

create table if not exists public.lead_sourcing_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.lead_sourcing_runs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  al_uuid text,
  email text not null,
  first_name text,
  last_name text,
  job_title text,
  headline text,
  seniority text,
  department text,
  company_name text,
  company_domain text,
  employee_count text,
  revenue text,
  industry text,
  linkedin_url text,
  company_description text,
  -- Why this person can't be emailed today (null = eligible).
  -- dnc | emailed_recently | excluded_domain | duplicate
  removed_reason text,
  fit_score numeric(4, 1),
  fit_reason text,
  score numeric(5, 3),
  rank integer,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists lead_sourcing_candidates_run_idx
  on public.lead_sourcing_candidates (run_id, rank);

comment on table public.lead_sourcing_runs is
  'Audience Build: one daily pull per company (AudienceLab audience → clean → rank).';
comment on table public.lead_sourcing_candidates is
  'Audience Build: people pulled in a run, with removal reason, Claude fit score, rank and selection.';

alter table public.lead_sourcing_runs enable row level security;
alter table public.lead_sourcing_candidates enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lead_sourcing_runs', 'lead_sourcing_candidates']
  loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = 'Authenticated users can manage ' || t
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        'Authenticated users can manage ' || t, t
      );
    end if;
  end loop;
end $$;
