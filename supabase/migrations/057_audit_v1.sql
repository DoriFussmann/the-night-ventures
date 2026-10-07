-- Audit tool V1: one row per category run, normalized issues (comparable across
-- runs by fingerprint), per-company accepted issues, and the AI training-bot policy.
-- The legacy audit_snapshots table is left untouched.

create table if not exists public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid,
  category text not null
    check (category in (
      'crawl', 'schema', 'clusters', 'aeo_readiness', 'ai_visibility',
      'speed', 'authority', 'aeo_content'
    )),
  status text not null default 'running'
    check (status in ('running', 'done', 'error', 'skipped', 'cancelled')),
  site_url text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer check (score between 0 and 100),
  cost_usd numeric(10, 4) not null default 0,
  external_task_id text,
  progress jsonb not null default '{}'::jsonb,
  workspace jsonb not null default '{}'::jsonb,
  metrics jsonb,
  error text,
  created_by uuid references auth.users (id) on delete set null
);

comment on table public.audit_runs is
  'Audit tool: one run of one category for a company. batch_id groups a Run all.';
comment on column public.audit_runs.cost_usd is
  'Recorded third-party spend (DataForSEO cost fields) for this run.';
comment on column public.audit_runs.external_task_id is
  'DataForSEO On-Page task id for crawl runs (lets any client resume polling).';
comment on column public.audit_runs.progress is
  '{ step, phase, done, total, message } — step is the optimistic-lock counter.';
comment on column public.audit_runs.workspace is
  'Intermediate state while running; cleared when the run ends.';

create index if not exists audit_runs_company_category_idx
  on public.audit_runs (company_id, category, started_at desc);
create index if not exists audit_runs_batch_idx
  on public.audit_runs (batch_id) where batch_id is not null;

create table if not exists public.audit_issues (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.audit_runs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  category text not null,
  check_id text not null,
  fingerprint text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  scope text not null default 'page' check (scope in ('page', 'site')),
  title text not null,
  detail text,
  url text,
  evidence jsonb not null default '{}'::jsonb,
  fix_hint text,
  created_at timestamptz not null default now(),
  unique (run_id, fingerprint)
);

comment on column public.audit_issues.fingerprint is
  'Stable hash of category + check + target; equal across runs for the same finding.';

create index if not exists audit_issues_company_fingerprint_idx
  on public.audit_issues (company_id, fingerprint);

create table if not exists public.audit_issue_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  fingerprint text not null,
  check_id text,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, fingerprint)
);

comment on table public.audit_issue_overrides is
  'Issues marked "accepted / won''t fix": excluded from scores and diffs.';

alter table public.company_profiles
  add column if not exists ai_training_bot_policy text not null default 'allow';

alter table public.company_profiles
  drop constraint if exists company_profiles_ai_training_bot_policy_check;

alter table public.company_profiles
  add constraint company_profiles_ai_training_bot_policy_check
  check (ai_training_bot_policy in ('allow', 'block', 'any'));

comment on column public.company_profiles.ai_training_bot_policy is
  'Audit: intended stance on AI training crawlers (GPTBot, ClaudeBot, Google-Extended…). any = not scored.';

-- RLS: same convention as the rest of the app (authenticated = full access).
do $$
declare t text;
begin
  foreach t in array array['audit_runs','audit_issues','audit_issue_overrides']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Authenticated users can manage %1$s" on public.%1$I', t);
    execute format(
      'create policy "Authenticated users can manage %1$s" on public.%1$I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;
