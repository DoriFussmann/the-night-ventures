-- Decision Moments: one base persona, in one buyer situation, at the moment they are
-- ready to act. Each moment holds a seed prompt and a set of 10 recommendation prompts
-- (stored in pt_prompts, linked by moment_id) that one piece of content should answer.
-- Additive only: nothing existing is changed or removed. Baseline prompts keep moment_id empty.

create table if not exists public.pt_moments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,                                  -- DM1, DM2 …
  title text not null default '',
  moment_text text not null default '',                -- the user's own description
  persona_code text not null default '',               -- base persona, e.g. B1
  situation_id text not null default '',               -- ICP buyer situation, e.g. S3
  match_reason text not null default '',
  seed_prompt text not null default '',
  path_note text not null default '',                  -- need -> category -> why us -> competitors
  seed_versions jsonb not null default '[]'::jsonb,    -- [{prompt, path_note, feedback, at}]
  runs integer not null default 10 check (runs between 1 and 10),
  status text not null default 'draft' check (status in ('draft', 'final', 'tested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

alter table public.pt_prompts
  add column if not exists moment_id uuid references public.pt_moments(id) on delete set null;

create index if not exists pt_prompts_moment on public.pt_prompts (moment_id) where moment_id is not null;

alter table public.pt_moments enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pt_moments') then
    create policy "Authenticated users can manage pt_moments" on public.pt_moments
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Push one moment and its prompts from the builder page.
-- Payload: {moment: {code, title, moment_text, persona_code, situation_id, match_reason,
--                    seed_prompt, path_note, seed_versions, runs, status},
--           prompts: [{id: "DM1-01", prompt, angle, named_brands, status}]}
-- Rules: prompt codes must start with the moment code; a prompt that names the company's
-- own brand is refused; pt_brands is never touched; a prompt whose wording changed loses
-- its earlier runs (same rule as tnv_push_prompts).
create or replace function public.tnv_push_moment(p_company uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  m jsonb := p->'moment';
  v_code text := btrim(coalesce(p->'moment'->>'code', ''));
  v_moment uuid;
  v_prompts integer := 0;
  v_own text[];
  r record;
begin
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company % not found', p_company;
  end if;
  if v_code !~ '^DM[0-9]+$' then
    raise exception 'moment.code must look like DM1, got "%"', v_code;
  end if;
  if jsonb_typeof(p->'prompts') is distinct from 'array' then
    raise exception 'prompts must be an array';
  end if;

  insert into public.pt_moments (company_id, code, title, moment_text, persona_code, situation_id, match_reason,
                                 seed_prompt, path_note, seed_versions, runs, status, updated_at)
  values (p_company, v_code, coalesce(m->>'title', ''), coalesce(m->>'moment_text', ''), coalesce(m->>'persona_code', ''),
          coalesce(m->>'situation_id', ''), coalesce(m->>'match_reason', ''), coalesce(m->>'seed_prompt', ''),
          coalesce(m->>'path_note', ''), coalesce(m->'seed_versions', '[]'::jsonb),
          coalesce((m->>'runs')::integer, 10), coalesce(nullif(m->>'status', ''), 'final'), now())
  on conflict (company_id, code) do update set
    title = excluded.title, moment_text = excluded.moment_text, persona_code = excluded.persona_code,
    situation_id = excluded.situation_id, match_reason = excluded.match_reason, seed_prompt = excluded.seed_prompt,
    path_note = excluded.path_note, seed_versions = excluded.seed_versions, runs = excluded.runs,
    status = excluded.status, updated_at = now()
  returning id into v_moment;

  -- Own brand names and patterns, for the "never name ourselves" guard.
  select coalesce(array_agg(lower(x)), '{}') into v_own
  from (select b.name as x from public.pt_brands b where b.company_id = p_company and b.is_own
        union select unnest(b.name_patterns) from public.pt_brands b where b.company_id = p_company and b.is_own) s
  where coalesce(btrim(x), '') <> '';

  for r in select value as v from jsonb_array_elements(p->'prompts') loop
    continue when coalesce(btrim(r.v->>'id'), '') = '' or coalesce(btrim(r.v->>'prompt'), '') = '';
    if btrim(r.v->>'id') not like v_code || '-%' then
      raise exception 'Prompt code % does not belong to moment %', r.v->>'id', v_code;
    end if;
    if exists (select 1 from unnest(v_own) o where position(o in lower(r.v->>'prompt')) > 0) then
      raise exception 'Prompt % names the company''s own brand', r.v->>'id';
    end if;

    delete from public.pt_runs x using public.pt_prompts q
    where x.prompt_id = q.id and q.company_id = p_company and q.code = btrim(r.v->>'id') and q.prompt <> btrim(r.v->>'prompt');

    insert into public.pt_prompts (company_id, code, persona, situation, stage, type, variables, named_brands,
                                   prompt, status, source_set, moment_id, updated_at)
    values (p_company, btrim(r.v->>'id'), coalesce(m->>'persona_code', ''), coalesce(m->>'situation_id', ''), 'Buy',
            'Recommendation', jsonb_build_array(jsonb_build_object('k', 'Angle', 'v', coalesce(r.v->>'angle', ''))),
            coalesce(r.v->'named_brands', '[]'::jsonb), btrim(r.v->>'prompt'),
            coalesce(nullif(r.v->>'status', ''), 'Approved'), 'moment:' || v_code, v_moment, now())
    on conflict (company_id, code) do update set
      persona = excluded.persona, situation = excluded.situation, stage = excluded.stage, type = excluded.type,
      variables = excluded.variables, named_brands = excluded.named_brands, prompt = excluded.prompt,
      status = excluded.status, source_set = excluded.source_set, moment_id = excluded.moment_id, updated_at = now();
    v_prompts := v_prompts + 1;
  end loop;

  insert into public.pt_settings (company_id) values (p_company) on conflict (company_id) do nothing;

  return jsonb_build_object('ok', true, 'moment_id', v_moment, 'code', v_code, 'prompts', v_prompts,
    'moment_prompts', (select count(*) from public.pt_prompts where moment_id = v_moment));
end;
$$;

revoke execute on function public.tnv_push_moment(uuid, jsonb) from public, anon;
grant execute on function public.tnv_push_moment(uuid, jsonb) to authenticated, service_role;
