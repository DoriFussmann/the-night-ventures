-- Audience Build step 6: weekday auto-pull, 24-hour review window, push.
--   * lead_sourcing_configs.daily_pull_enabled: opt-in per company.
--   * lead_sourcing_runs: expires_at (pull + 24 h), notified_at, pushed_at,
--     push_result, and the new status 'expired' (not confirmed in time; the
--     next pull replaces it, nothing is sent).
-- Idempotent. Safe to re-run.

alter table public.lead_sourcing_configs
  add column if not exists daily_pull_enabled boolean not null default false;

comment on column public.lead_sourcing_configs.daily_pull_enabled is
  'Audience Build: pull + rank automatically every weekday morning and email a review link.';

alter table public.lead_sourcing_runs
  add column if not exists expires_at timestamptz,
  add column if not exists notified_at timestamptz,
  add column if not exists pushed_at timestamptz,
  add column if not exists push_result jsonb,
  add column if not exists trigger text not null default 'manual';

alter table public.lead_sourcing_runs drop constraint if exists lead_sourcing_runs_status_check;
alter table public.lead_sourcing_runs
  add constraint lead_sourcing_runs_status_check
  check (status in ('running', 'ready', 'failed', 'approved', 'pushed', 'expired'));

comment on column public.lead_sourcing_runs.expires_at is
  'Audience Build: the list must be approved and pushed before this time (pull + 24 h).';
comment on column public.lead_sourcing_runs.trigger is
  'Audience Build: manual (Pull button) or cron (weekday auto-pull).';
