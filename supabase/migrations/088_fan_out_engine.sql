-- 088: Fan-Out Engine (per company).
-- A situation in one person's life -> a persona -> the prompts that person would type ->
-- runs on real ChatGPT -> the search queries grouped into topics -> briefs in AEO Generation.
-- Additive only: four new tables. Nothing existing is changed.

create table if not exists public.fo_situations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,                                   -- F001, F002 …; stable, unique per company
  title text not null default '',
  description text not null,                            -- the situation, in the user's own words
  -- { who, where_they_stand, inside, location, summary }: the persona built from the description
  persona jsonb not null default '{}'::jsonb,
  situation_id text not null default '',                -- closest ICP buyer situation (S1 …); may be empty
  fit_note text not null default '',                    -- why that situation, or "outside the ICP: …"
  runs integer not null default 5 check (runs between 1 and 10),
  step text not null default 'describe'
    check (step in ('describe', 'persona', 'prompts', 'run', 'topics', 'push')),
  stale_from text not null default '',                  -- first step that is out of date after an edit; '' = none
  -- per step: the exact request sent and the exact reply ("Show details")
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.fo_prompts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  situation_id uuid not null references public.fo_situations(id) on delete cascade,
  form text not null check (form in ('medium', 'short', 'long')),
  prompt text not null check (char_length(prompt) between 1 and 2000),   -- the real-ChatGPT engine takes 2,000 characters at most
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (situation_id, form)
);

create table if not exists public.fo_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  situation_id uuid not null references public.fo_situations(id) on delete cascade,
  prompt_id uuid not null references public.fo_prompts(id) on delete cascade,
  run_no integer not null default 1 check (run_no between 1 and 10),
  status text not null default 'ok' check (status in ('ok', 'failed')),
  error text,
  attempts integer not null default 1,                  -- a timed-out call is retried; failed calls are not charged
  model text,
  ran_at timestamptz not null default now(),
  seconds numeric,
  cost numeric not null default 0,
  answer text,
  fan_out jsonb not null default '[]'::jsonb,           -- the search queries ChatGPT ran
  search_results jsonb not null default '[]'::jsonb,    -- pages found
  cited jsonb not null default '[]'::jsonb,             -- pages cited
  brand_entities jsonb not null default '[]'::jsonb,
  searched boolean,
  brands jsonb not null default '{}'::jsonb,            -- per tracked brand: retrieved, cited, named
  own_cited_urls jsonb not null default '[]'::jsonb,
  raw jsonb,
  unique (prompt_id, run_no)
);

create table if not exists public.fo_topics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  situation_id uuid not null references public.fo_situations(id) on delete cascade,
  title text not null default '',
  queries jsonb not null default '[]'::jsonb,           -- [{ q, runs, forms: [] }], strongest first
  runs_seen integer not null default 0,                 -- in how many runs the topic appeared
  forms_seen integer not null default 0,                -- from how many prompt forms
  local boolean not null default false,                 -- true: the queries are about a place the prompt never named
  winners jsonb not null default '[]'::jsonb,           -- [{ domain, url, cited, type }]: who is cited today
  owner_note text not null default '',                  -- who owns this ground today, and whether there is an opening
  standing text not null default 'Absent'
    check (standing in ('Named', 'Cited, not named', 'Retrieved, not cited', 'Absent', 'No search')),
  answer_points jsonb not null default '[]'::jsonb,     -- what an article must answer: sub-questions and the facts ChatGPT looked up
  action text not null default 'new_article'
    check (action in ('won', 'page_fix', 'improve_page', 'commercial_page', 'existing_group', 'new_article', 'skip')),
  action_reason text not null default '',               -- the rule that produced the action
  pillar_id uuid references public.aeo_pillars(id) on delete set null,
  group_id uuid references public.aeo_prompt_groups(id) on delete set null,   -- the existing group it matches, or the one created at push
  brief_id uuid references public.aeo_briefs(id) on delete set null,          -- set at push
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'removed', 'pushed')),
  pushed_at timestamptz,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fo_situations_company_idx on public.fo_situations (company_id, created_at desc);
create index if not exists fo_prompts_situation_idx on public.fo_prompts (situation_id);
create index if not exists fo_runs_situation_idx on public.fo_runs (situation_id);
create index if not exists fo_runs_company_ran_idx on public.fo_runs (company_id, ran_at);
create index if not exists fo_topics_situation_idx on public.fo_topics (situation_id, sort);

alter table public.fo_situations enable row level security;
alter table public.fo_prompts enable row level security;
alter table public.fo_runs enable row level security;
alter table public.fo_topics enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['fo_situations', 'fo_prompts', 'fo_runs', 'fo_topics'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute format('create policy "Authenticated users can manage %1$s" on public.%1$I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;
