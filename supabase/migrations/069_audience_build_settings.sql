-- Audience Build workspace settings (one row), edited in Admin.
--   pool_multiplier: target fresh pool per day = leads needed per day x this.
--   Headroom for leads removed (already emailed, Do Not Contact, excluded
--   domains, ICP filters) and for ranking to choose the best. Default 3.
-- Idempotent. Safe to re-run.

create table if not exists public.audience_build_settings (
  id boolean primary key default true check (id),
  pool_multiplier numeric(4, 1) not null default 3
    check (pool_multiplier >= 1 and pool_multiplier <= 10),
  updated_at timestamptz not null default now()
);

insert into public.audience_build_settings (id) values (true) on conflict (id) do nothing;

comment on table public.audience_build_settings is
  'Audience Build: workspace-wide settings (one row). Edited in Admin.';

alter table public.audience_build_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audience_build_settings'
      and policyname = 'Authenticated users can manage audience_build_settings'
  ) then
    create policy "Authenticated users can manage audience_build_settings"
      on public.audience_build_settings for all to authenticated using (true) with check (true);
  end if;
end $$;
