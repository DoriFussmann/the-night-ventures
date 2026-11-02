-- One row per scheduled (cron) run, so the app can show "last ran …" and
-- warn when a daily job stops running. Idempotent. Safe to re-run.

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  ran_at timestamptz not null default now(),
  ok boolean not null default true,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists cron_runs_job_ran_at on public.cron_runs (job, ran_at desc);

comment on table public.cron_runs is
  'Heartbeat of scheduled jobs (publish-schedule, …). Written by the server with the service role.';

alter table public.cron_runs enable row level security;

drop policy if exists "Authenticated users can read cron_runs" on public.cron_runs;
create policy "Authenticated users can read cron_runs"
  on public.cron_runs for select
  to authenticated
  using (true);
