-- 091: Fan-Out Engine v2, step 4: a Run is a record of its own, so a Scenario can be run again and compared.
-- Additive: one new table, new columns, and the unique key of fo_runs widened from (prompt_id, run_no) to
-- (scenario_run_id, prompt_id, run_no). Existing captures are kept: each situation's captures are grouped into one
-- Run marked `legacy` (made by the engine before v2; never a Baseline), and their new columns are filled in.
--
-- Rollback (run in one transaction; step 3 fails once any prompt has captures in two Runs, and then nothing should be rolled back):
--   alter table public.fo_situations drop column if exists baseline_run_id;
--   alter table public.fo_runs drop constraint if exists fo_runs_scenario_run_prompt_run_key;
--   -- (prompt_id, run_no) can be unique again only while no prompt has captures in two Runs:
--   alter table public.fo_runs add constraint fo_runs_prompt_id_run_no_key unique (prompt_id, run_no);
--   alter table public.fo_runs drop column if exists scenario_run_id, drop column if exists prompt_text, drop column if exists prompt_form, drop column if exists mention_labels;
--   drop table if exists public.fo_scenario_runs;

create table if not exists public.fo_scenario_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  situation_id uuid not null references public.fo_situations(id) on delete cascade,
  seq integer not null,                                 -- 1, 2, 3 … within the Scenario
  status text not null default 'running' check (status in ('running', 'done', 'stopped')),
  legacy boolean not null default false,                -- captures made before Runs existed; never a Baseline
  runs_per_prompt integer not null default 7 check (runs_per_prompt between 1 and 10),
  prompt_ids jsonb not null default '[]'::jsonb,        -- the frozen prompts this Run asks
  est_cost numeric not null default 0,                  -- shown before the Run starts
  cost numeric not null default 0,                      -- actual, set when the Run ends
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (situation_id, seq)
);
create index if not exists fo_scenario_runs_situation_idx on public.fo_scenario_runs (situation_id, seq);
alter table public.fo_scenario_runs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fo_scenario_runs') then
    create policy "Authenticated users can manage fo_scenario_runs" on public.fo_scenario_runs for all to authenticated using (true) with check (true);
  end if;
end $$;

alter table public.fo_runs
  add column if not exists scenario_run_id uuid references public.fo_scenario_runs(id) on delete cascade,
  add column if not exists prompt_text text,            -- the exact prompt that was asked
  add column if not exists prompt_form text,            -- its type: short, medium, long
  add column if not exists mention_labels jsonb not null default '{}'::jsonb;  -- { brand id: { label, quote } }, set once by the AI
create index if not exists fo_runs_scenario_run_idx on public.fo_runs (scenario_run_id);

alter table public.fo_situations
  add column if not exists baseline_run_id uuid references public.fo_scenario_runs(id) on delete set null;

-- Existing captures: one legacy Run per situation.
insert into public.fo_scenario_runs (company_id, situation_id, seq, status, legacy, runs_per_prompt, cost, started_at, finished_at)
select r.company_id, r.situation_id, 1, 'done', true, least(10, greatest(1, max(r.run_no))), coalesce(sum(r.cost), 0), min(r.ran_at), max(r.ran_at)
from public.fo_runs r
where r.scenario_run_id is null
  and not exists (select 1 from public.fo_scenario_runs s where s.situation_id = r.situation_id)
group by r.company_id, r.situation_id;

update public.fo_runs r
set scenario_run_id = s.id
from public.fo_scenario_runs s
where r.scenario_run_id is null and s.situation_id = r.situation_id and s.legacy;

update public.fo_runs r
set prompt_text = p.prompt, prompt_form = p.form
from public.fo_prompts p
where p.id = r.prompt_id and r.prompt_text is null;

-- Every capture now belongs to a Run.
alter table public.fo_runs alter column scenario_run_id set not null;

alter table public.fo_runs drop constraint if exists fo_runs_prompt_id_run_no_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fo_runs_scenario_run_prompt_run_key') then
    alter table public.fo_runs add constraint fo_runs_scenario_run_prompt_run_key unique (scenario_run_id, prompt_id, run_no);
  end if;
end $$;
