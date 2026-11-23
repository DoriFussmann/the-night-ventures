-- AEO hot takes bank: the expert's own positions, one take per row, per company.
-- A brief's "Your hot takes" field (aeo_briefs.key_points) is filled from this
-- bank: takes that already speak to the article's topic are suggested, and a
-- new take can be drafted from the existing ones, so articles stay consistent.
-- Additive only: nothing existing is changed or removed.

create table if not exists public.aeo_hot_takes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,                                   -- R001, N014 …; stable, unique per company
  topic text not null default '',                       -- e.g. "Fees and incentives"
  kind text not null default 'Opinion',                 -- Opinion, Method, Framework, Term, Experience, About the company
  take text not null,                                   -- the take as used in articles
  original text not null default '',                    -- the expert's own wording it came from
  source text not null default '',                      -- where the original was written
  note text not null default '',                        -- e.g. "say 'many times', not a measured statistic"
  status text not null default 'active'
    check (status in ('active', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists aeo_hot_takes_company_idx on public.aeo_hot_takes (company_id, status);

alter table public.aeo_hot_takes enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'aeo_hot_takes') then
    create policy "Authenticated users can manage aeo_hot_takes" on public.aeo_hot_takes
      for all to authenticated using (true) with check (true);
  end if;
end $$;
