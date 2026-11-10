-- ICP & Persona Builder push: a home for the full documents, and two functions
-- the builder calls. Additive only; existing columns, personas and prompts are untouched.

alter table public.aeo_playbook
  add column if not exists icp_strategic_md text,
  add column if not exists icp_operational_md text,
  add column if not exists icp_pushed_at timestamptz,
  add column if not exists personas_md text,
  add column if not exists personas_pushed_at timestamptz;

comment on column public.aeo_playbook.icp_strategic_md is 'ICP Builder: full Strategic ICP (markdown), written by tnv_push_icp.';
comment on column public.aeo_playbook.icp_operational_md is 'ICP Builder: full Operational ICP (markdown); null when it was not generated.';
comment on column public.aeo_playbook.icp_pushed_at is 'ICP Builder: when the ICP was last pushed.';
comment on column public.aeo_playbook.personas_md is 'Persona Builder: full persona portfolio (markdown), written by tnv_push_personas.';
comment on column public.aeo_playbook.personas_pushed_at is 'Persona Builder: when the personas were last pushed.';

-- Overwrites the short ICP paragraph and shared traits (when supplied) and stores the full documents.
create or replace function public.tnv_push_icp(p_company uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_icp text := nullif(btrim(coalesce(p->>'icp', '')), '');
  v_traits jsonb := case when jsonb_typeof(p->'shared_traits') = 'array' and jsonb_array_length(p->'shared_traits') > 0 then p->'shared_traits' end;
  v_strategic text := nullif(btrim(coalesce(p->>'strategic_md', '')), '');
  v_operational text := nullif(btrim(coalesce(p->>'operational_md', '')), '');
begin
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company % not found', p_company;
  end if;
  if v_strategic is null then
    raise exception 'strategic_md is required';
  end if;

  insert into public.aeo_playbook (company_id, icp, shared_traits, icp_strategic_md, icp_operational_md, icp_pushed_at, updated_at)
  values (p_company, coalesce(v_icp, ''), coalesce(v_traits, '[]'::jsonb), v_strategic, v_operational, now(), now())
  on conflict (company_id) do update set
    icp = coalesce(v_icp, public.aeo_playbook.icp),
    shared_traits = coalesce(v_traits, public.aeo_playbook.shared_traits),
    icp_strategic_md = v_strategic,
    icp_operational_md = v_operational,
    icp_pushed_at = now(),
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'icp_updated', v_icp is not null,
    'traits', coalesce(jsonb_array_length(v_traits), 0),
    'operational', v_operational is not null
  );
end;
$$;

-- Adds the builder's personas next to the existing ones, under codes B1, B2, ...
-- A repeat push updates the B personas in place. Personas with other codes are never changed.
create or replace function public.tnv_push_personas(p_company uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base integer;
  v_count integer := 0;
  v_removed integer := 0;
  v_kept integer := 0;
  v_existing integer := 0;
  v_codes text[] := '{}';
  v_code text;
  r record;
begin
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company % not found', p_company;
  end if;
  if jsonb_typeof(p->'personas') is distinct from 'array' or jsonb_array_length(p->'personas') = 0 then
    raise exception 'personas must be a non-empty array';
  end if;

  select coalesce(max(sort), -1) into v_base
  from public.aeo_personas where company_id = p_company and code !~ '^B[0-9]+$';

  for r in select value as v, ordinality as n from jsonb_array_elements(p->'personas') with ordinality loop
    v_code := 'B' || r.n;
    v_codes := v_codes || v_code;
    insert into public.aeo_personas
      (company_id, code, name, summary, stage, "trigger", need, pains, decision_criteria, alternatives, their_words, where_they_listen, main_tiers, sort, updated_at)
    values
      (p_company, v_code,
       coalesce(r.v->>'name', ''), coalesce(r.v->>'summary', ''), coalesce(r.v->>'stage', ''), coalesce(r.v->>'trigger', ''),
       coalesce(r.v->>'need', ''), coalesce(r.v->>'pains', ''), coalesce(r.v->>'decision_criteria', ''), coalesce(r.v->>'alternatives', ''),
       coalesce(r.v->>'their_words', ''), coalesce(r.v->>'where_they_listen', ''), coalesce(r.v->>'main_tiers', ''),
       v_base + r.n::integer, now())
    on conflict (company_id, code) do update set
      name = excluded.name, summary = excluded.summary, stage = excluded.stage, "trigger" = excluded."trigger",
      need = excluded.need, pains = excluded.pains, decision_criteria = excluded.decision_criteria, alternatives = excluded.alternatives,
      their_words = excluded.their_words, where_they_listen = excluded.where_they_listen, main_tiers = excluded.main_tiers,
      sort = excluded.sort, updated_at = now();
    v_count := v_count + 1;
  end loop;

  -- Builder personas left over from an earlier, longer push: remove them unless prompts use them.
  delete from public.aeo_personas a
  where a.company_id = p_company and a.code ~ '^B[0-9]+$' and a.code <> all (v_codes)
    and not exists (select 1 from public.aeo_prompts q where q.persona_id = a.id);
  get diagnostics v_removed = row_count;

  select count(*) into v_kept from public.aeo_personas
  where company_id = p_company and code ~ '^B[0-9]+$' and code <> all (v_codes);
  select count(*) into v_existing from public.aeo_personas
  where company_id = p_company and code !~ '^B[0-9]+$';

  insert into public.aeo_playbook (company_id, personas_md, personas_pushed_at, updated_at)
  values (p_company, nullif(p->>'personas_md', ''), now(), now())
  on conflict (company_id) do update set
    personas_md = excluded.personas_md, personas_pushed_at = now(), updated_at = now();

  return jsonb_build_object('ok', true, 'personas', v_count, 'removed', v_removed, 'kept_in_use', v_kept, 'existing_untouched', v_existing);
end;
$$;

revoke execute on function public.tnv_push_icp(uuid, jsonb) from public, anon;
revoke execute on function public.tnv_push_personas(uuid, jsonb) from public, anon;
grant execute on function public.tnv_push_icp(uuid, jsonb) to authenticated, service_role;
grant execute on function public.tnv_push_personas(uuid, jsonb) to authenticated, service_role;
