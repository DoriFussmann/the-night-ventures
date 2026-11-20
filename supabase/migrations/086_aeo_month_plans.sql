-- AEO monthly plan: one plan per company per month. The plan picks one prompt
-- group per working day (one brief per group, as aeo_briefs already enforces),
-- holds the user's view per theme (pillar), and links the briefs it creates.
-- The stage (key points, drafts, review, scheduled) is read from those briefs,
-- so it is not stored here.
-- Additive only: nothing existing is changed or removed.

create table if not exists public.aeo_month_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  month date not null check (extract(day from month) = 1),     -- first day of the month planned
  working_days integer not null default 0,
  status text not null default 'planning'
    check (status in ('planning', 'approved', 'done', 'cancelled')),
  plan jsonb not null default '[]'::jsonb,                       -- [{group_id, pillar_id, score, value, day}]
  theme_views jsonb not null default '{}'::jsonb,                -- {pillar_id: "the user's view this month"}
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, month)
);

alter table public.aeo_briefs
  add column if not exists month_plan_id uuid references public.aeo_month_plans(id) on delete set null;

create index if not exists aeo_briefs_month_plan on public.aeo_briefs (month_plan_id) where month_plan_id is not null;

-- Company-level voice for key points ("write as …"), set once.
alter table public.aeo_playbook
  add column if not exists key_points_voice text not null default '';

alter table public.aeo_month_plans enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'aeo_month_plans') then
    create policy "Authenticated users can manage aeo_month_plans" on public.aeo_month_plans
      for all to authenticated using (true) with check (true);
  end if;
end $$;
