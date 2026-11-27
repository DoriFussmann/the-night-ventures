-- 092: Fan-Out Engine v2, step 5 and 6: Query Groups, Opportunity and Win cards, the Insights bank.
-- Additive: three new tables and three new columns. Nothing existing is changed. The topics of the engine
-- before v2 (fo_topics) are kept as they are; the page no longer writes them.
--
-- Rollback (in one transaction):
--   alter table public.fo_scenario_runs drop column if exists takeaway, drop column if exists summary_usage, drop column if exists summary_at;
--   drop table if exists public.fo_insights;
--   drop table if exists public.fo_cards;
--   drop table if exists public.fo_query_groups;

create table if not exists public.fo_query_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  situation_id uuid not null references public.fo_situations(id) on delete cascade,
  label text not null,                                  -- written as an article title a buyer would click; no company names
  norms jsonb not null default '[]'::jsonb,             -- the searches in the group, normalized (lower case, no years or filler words)
  baseline_run_id uuid references public.fo_scenario_runs(id) on delete set null,  -- the Baseline the groups were frozen at
  first_run_id uuid references public.fo_scenario_runs(id) on delete set null,     -- the Run that first produced this group
  is_new boolean not null default false,                -- true: appeared in a later Run, not at the Baseline
  archived_at timestamptz,                              -- set when the Scenario changed and a new Baseline regrouped the searches
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists fo_query_groups_situation_idx on public.fo_query_groups (situation_id) where archived_at is null;

create table if not exists public.fo_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  situation_id uuid not null references public.fo_situations(id) on delete cascade,
  scenario_run_id uuid not null references public.fo_scenario_runs(id) on delete cascade,
  group_id uuid not null references public.fo_query_groups(id) on delete cascade,
  kind text not null check (kind in ('opportunity', 'win')),
  -- measurement at the time the card was written (the app's numbers): standing, signal, who wins, searches
  stats jsonb not null default '{}'::jsonb,
  how text not null default 'neither' check (how in ('own_page', 'third_party', 'neither')),   -- how the winner got there (app)
  how_pages jsonb not null default '[]'::jsonb,
  your_page jsonb not null default '{}'::jsonb,         -- the closest Content Map topic or live page, or { kind: "none" } (app)
  pages jsonb not null default '[]'::jsonb,             -- the most-cited pages and whether each could be read
  reasons jsonb not null default '[]'::jsonb,           -- one or two ids from the fixed reason list (AI, an estimate)
  why text not null default '',                         -- one sentence (AI, an estimate)
  cover jsonb not null default '[]'::jsonb,             -- "What to cover": 3 to 6 lines (AI)
  action text not null default '' check (action in ('', 'new_article', 'fix_existing', 'off_site')),
  action_line text not null default '',
  repeat_this text not null default '',                 -- Win cards
  comparison boolean not null default false,
  pillar_id uuid references public.aeo_pillars(id) on delete set null,          -- the theme: suggested by the AI, confirmed by the user
  aeo_group_id uuid references public.aeo_prompt_groups(id) on delete set null, -- the Content Map topic, set at push
  brief_id uuid references public.aeo_briefs(id) on delete set null,            -- set at push ("Write this")
  merged_into uuid references public.fo_cards(id) on delete set null,           -- written together with another Opportunity, as one brief
  status text not null default 'open' check (status in ('open', 'pushed', 'done', 'acted_on', 'dismissed')),
  pushed_at timestamptz,
  acted_on_at timestamptz,                              -- the brief went live (read from AEO Generation), or the user clicked Done
  acted_url text not null default '',
  details jsonb not null default '{}'::jsonb,           -- the exact request and reply
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scenario_run_id, group_id)
);
create index if not exists fo_cards_situation_idx on public.fo_cards (situation_id, scenario_run_id);
create index if not exists fo_cards_brief_idx on public.fo_cards (brief_id) where brief_id is not null;

create table if not exists public.fo_insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  situation_id uuid not null references public.fo_situations(id) on delete cascade,
  scenario_run_id uuid not null references public.fo_scenario_runs(id) on delete cascade,
  card_id uuid not null references public.fo_cards(id) on delete cascade,
  tag text not null check (tag in ('your_win', 'competitor_win')),
  brand text not null default '',                       -- who is named
  search text not null default '',                      -- the Query Group
  reasons jsonb not null default '[]'::jsonb,
  page text not null default '',
  counts jsonb not null default '{}'::jsonb,            -- { named, of, signal_x, signal_n }
  verdict text check (verdict in ('confirmed', 'not_confirmed')),   -- set by a later Run, once what was written is live
  verdict_at timestamptz,
  created_at timestamptz not null default now(),
  unique (card_id)
);
create index if not exists fo_insights_company_idx on public.fo_insights (company_id, created_at desc);

alter table public.fo_scenario_runs
  add column if not exists takeaway text not null default '',       -- three sentences; may only point to numbers the app calculated
  add column if not exists summary_usage jsonb not null default '{}'::jsonb,   -- { input_tokens, output_tokens, pages_read }: what step 5 used
  add column if not exists summary_at timestamptz;

alter table public.fo_query_groups enable row level security;
alter table public.fo_cards enable row level security;
alter table public.fo_insights enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['fo_query_groups', 'fo_cards', 'fo_insights'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute format('create policy "Authenticated users can manage %1$s" on public.%1$I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;
