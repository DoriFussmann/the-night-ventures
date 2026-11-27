-- 095: Fan-Out Engine: brands ChatGPT named that the company chose not to track ("Ignore" on a discovered brand).
-- Additive: one new table. Nothing existing is changed.
--
-- Rollback:
--   drop table if exists public.fo_ignored_brands;

create table if not exists public.fo_ignored_brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists fo_ignored_brands_company_name_idx on public.fo_ignored_brands (company_id, lower(name));

alter table public.fo_ignored_brands enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fo_ignored_brands') then
    create policy "Authenticated users can manage fo_ignored_brands" on public.fo_ignored_brands for all to authenticated using (true) with check (true);
  end if;
end $$;
