-- Prompt Tests: prompts pushed from the Prompt Builder, the brands to track,
-- and what each AI engine did with each prompt (searched, retrieved, cited, named).
-- Separate from aeo_prompts on purpose; nothing existing is changed.

create table if not exists public.pt_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  monthly_cap numeric not null default 10,
  runs jsonb not null default '{"chatgpt":3,"gemini":2,"claude":1,"perplexity":1}'::jsonb,
  engines jsonb not null default '["chatgpt","gemini"]'::jsonb,
  location_code integer not null default 2840,
  language_code text not null default 'en',
  updated_at timestamptz not null default now()
);

create table if not exists public.pt_brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  domains text[] not null default '{}',
  name_patterns text[] not null default '{}',
  exclude_patterns text[] not null default '{}',
  is_own boolean not null default false,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.pt_prompts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  persona text not null default '',
  situation text not null default '',
  stage text not null default '',
  type text not null default '',
  variables jsonb not null default '[]'::jsonb,
  named_brands jsonb not null default '[]'::jsonb,
  prompt text not null,
  status text not null default 'Approved',
  source_set text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.pt_cycles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  engines jsonb not null default '[]'::jsonb,
  runs jsonb not null default '{}'::jsonb,
  prompt_ids uuid[] not null default '{}',
  planned_calls integer not null default 0,
  est_cost numeric not null default 0
);

create table if not exists public.pt_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cycle_id uuid not null references public.pt_cycles(id) on delete cascade,
  prompt_id uuid not null references public.pt_prompts(id) on delete cascade,
  engine text not null,
  method text not null default 'app',
  run_no integer not null default 1,
  status text not null default 'ok',
  error text,
  model text,
  ran_at timestamptz not null default now(),
  location_code integer,
  language_code text,
  cost numeric not null default 0,
  answer text,
  fan_out jsonb not null default '[]'::jsonb,
  search_results jsonb not null default '[]'::jsonb,
  cited jsonb not null default '[]'::jsonb,
  brand_entities jsonb not null default '[]'::jsonb,
  searched boolean,
  brands jsonb not null default '{}'::jsonb,
  own_cited_urls jsonb not null default '[]'::jsonb,
  raw jsonb,
  unique (cycle_id, prompt_id, engine, run_no)
);

create index if not exists pt_runs_company_ran_at on public.pt_runs (company_id, ran_at desc);
create index if not exists pt_prompts_company on public.pt_prompts (company_id);

comment on table public.pt_prompts is 'Prompt Tests: prompts pushed from the Prompt Builder (separate from aeo_prompts).';
comment on table public.pt_runs is 'Prompt Tests: one row per engine call. Failed calls are stored and excluded from every rate.';
comment on table public.pt_brands is 'Prompt Tests: tracked brands (own brand and competitors) with domains, name patterns and exclude patterns.';

alter table public.pt_settings enable row level security;
alter table public.pt_brands enable row level security;
alter table public.pt_prompts enable row level security;
alter table public.pt_cycles enable row level security;
alter table public.pt_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pt_settings', 'pt_brands', 'pt_prompts', 'pt_cycles', 'pt_runs'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      execute format('create policy "Authenticated users can manage %1$s" on public.%1$I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- Called by the Prompt Builder's push. Replaces the tracked brands, upserts prompts by code,
-- and creates the settings row on first use. Prompts already tested keep their id and their runs,
-- unless their wording changed.
create or replace function public.tnv_push_prompts(p_company uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prompts integer := 0;
  v_brands integer := 0;
  r record;
begin
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company % not found', p_company;
  end if;
  if jsonb_typeof(p->'prompts') is distinct from 'array' or jsonb_array_length(p->'prompts') = 0 then
    raise exception 'prompts must be a non-empty array';
  end if;

  if jsonb_typeof(p->'brands') = 'array' and jsonb_array_length(p->'brands') > 0 then
    delete from public.pt_brands b
    where b.company_id = p_company
      and b.name not in (select x->>'name' from jsonb_array_elements(p->'brands') x);
    for r in select value as v, ordinality as n from jsonb_array_elements(p->'brands') with ordinality loop
      continue when coalesce(btrim(r.v->>'name'), '') = '';
      insert into public.pt_brands (company_id, name, domains, name_patterns, exclude_patterns, is_own, sort, updated_at)
      values (
        p_company, btrim(r.v->>'name'),
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r.v->'domains', '[]'::jsonb)) x), '{}'),
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r.v->'name_patterns', '[]'::jsonb)) x), '{}'),
        coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r.v->'exclude_patterns', '[]'::jsonb)) x), '{}'),
        coalesce((r.v->>'own')::boolean, false), r.n::integer, now())
      on conflict (company_id, name) do update set
        domains = excluded.domains, name_patterns = excluded.name_patterns, exclude_patterns = excluded.exclude_patterns,
        is_own = excluded.is_own, sort = excluded.sort, updated_at = now();
      v_brands := v_brands + 1;
    end loop;
  end if;

  for r in select value as v from jsonb_array_elements(p->'prompts') loop
    continue when coalesce(btrim(r.v->>'id'), '') = '' or coalesce(btrim(r.v->>'prompt'), '') = '';
    -- A prompt whose wording changed is a different question: its earlier results no longer apply.
    delete from public.pt_runs x using public.pt_prompts q
    where x.prompt_id = q.id and q.company_id = p_company and q.code = btrim(r.v->>'id') and q.prompt <> btrim(r.v->>'prompt');
    insert into public.pt_prompts (company_id, code, persona, situation, stage, type, variables, named_brands, prompt, status, source_set, updated_at)
    values (
      p_company, btrim(r.v->>'id'), coalesce(r.v->>'persona', ''), coalesce(r.v->>'situation', ''), coalesce(r.v->>'stage', ''), coalesce(r.v->>'type', ''),
      coalesce(r.v->'variables', '[]'::jsonb), coalesce(r.v->'named_brands', '[]'::jsonb), btrim(r.v->>'prompt'),
      coalesce(nullif(r.v->>'status', ''), 'Approved'), coalesce(p->>'source_set', ''), now())
    on conflict (company_id, code) do update set
      persona = excluded.persona, situation = excluded.situation, stage = excluded.stage, type = excluded.type,
      variables = excluded.variables, named_brands = excluded.named_brands, prompt = excluded.prompt,
      status = excluded.status, source_set = excluded.source_set, updated_at = now();
    v_prompts := v_prompts + 1;
  end loop;

  insert into public.pt_settings (company_id) values (p_company) on conflict (company_id) do nothing;

  return jsonb_build_object('ok', true, 'prompts', v_prompts, 'brands', v_brands,
    'total', (select count(*) from public.pt_prompts where company_id = p_company));
end;
$$;

revoke execute on function public.tnv_push_prompts(uuid, jsonb) from public, anon;
grant execute on function public.tnv_push_prompts(uuid, jsonb) to authenticated, service_role;
