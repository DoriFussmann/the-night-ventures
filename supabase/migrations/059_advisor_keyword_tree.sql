-- SEO Advisor v3: content_coverage is the single source of truth for Core and
-- Supporting keywords. company_profiles.core_keywords becomes a mirror that the
-- app rewrites on every keyword change.
--
-- 1. Per-chat research market + language for the Advisor.
-- 2. One-off, additive backfill: merge any keywords that exist only in
--    company_profiles.core_keywords into content_coverage.pillars. Nothing is
--    removed or renamed. Safe to re-run.

alter table public.chat_sessions
  add column if not exists market text,
  add column if not exists language text;

comment on column public.chat_sessions.market is
  'Advisor research market code (lib/seo-advisor/markets.js), e.g. us, uk, il.';
comment on column public.chat_sessions.language is
  'Advisor research language code, e.g. en, he.';

comment on column public.company_profiles.core_keywords is
  'Mirror of content_coverage.pillars as [{ keyword, supporting: [string] }]. '
  'Written by the app on every keyword change; edit keywords via content_coverage.';

-- Matches slugifyKeyword() in lib/seo-advisor/pillars.js.
create or replace function pg_temp.kw_slug(value text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(
        regexp_replace(lower(trim(coalesce(value, ''))), '[^a-z0-9_\s-]', '', 'g'),
        '[\s_-]+', '-', 'g'
      )),
      ''
    ),
    'untitled'
  )
$$;

create or replace function pg_temp.kw_label(item jsonb)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    case jsonb_typeof(item)
      when 'string' then item #>> '{}'
      when 'object' then coalesce(item ->> 'keyword', item ->> 'term', item ->> 'name', '')
      else ''
    end,
    '\s+', ' ', 'g'
  ))
$$;

do $$
declare
  prof record;
  tree jsonb;
  has_row boolean;
  item jsonb;
  sup jsonb;
  core_label text;
  core_slug text;
  sup_label text;
  sup_slug text;
  idx int;
  used text[];
  changed boolean;
  now_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  for prof in
    select company_id, core_keywords
    from public.company_profiles
    where jsonb_typeof(core_keywords) = 'array'
      and jsonb_array_length(core_keywords) > 0
  loop
    select c.pillars into tree
    from public.content_coverage c
    where c.company_id = prof.company_id;
    has_row := found;
    if tree is null or jsonb_typeof(tree) <> 'array' then
      tree := '[]'::jsonb;
    end if;
    changed := false;

    -- Every slug already in the tree (core or supporting).
    select coalesce(array_agg(s), '{}') into used from (
      select pg_temp.kw_slug(coalesce(p ->> 'slug', p ->> 'keyword')) as s
      from jsonb_array_elements(tree) p
      where jsonb_typeof(p) = 'object'
      union all
      select pg_temp.kw_slug(coalesce(x ->> 'slug', x ->> 'keyword'))
      from jsonb_array_elements(tree) p,
           jsonb_array_elements(
             case when jsonb_typeof(p -> 'supporting') = 'array' then p -> 'supporting' else '[]'::jsonb end
           ) x
      where jsonb_typeof(p) = 'object' and jsonb_typeof(x) = 'object'
    ) t;

    for item in select value from jsonb_array_elements(prof.core_keywords)
    loop
      core_label := pg_temp.kw_label(item);
      continue when core_label = '';
      core_slug := pg_temp.kw_slug(core_label);

      -- Find the matching pillar (0-based index), if any.
      select (ord - 1)::int into idx
      from jsonb_array_elements(tree) with ordinality as e(p, ord)
      where jsonb_typeof(p) = 'object'
        and pg_temp.kw_slug(coalesce(p ->> 'slug', p ->> 'keyword')) = core_slug
      limit 1;

      if idx is null then
        -- Skip if this keyword already lives in the tree as a supporting keyword.
        continue when core_slug = any(used);
        tree := tree || jsonb_build_array(jsonb_build_object(
          'slug', core_slug,
          'keyword', core_label,
          'supporting', '[]'::jsonb,
          'source', 'company_data',
          'addedAt', now_iso
        ));
        idx := jsonb_array_length(tree) - 1;
        used := used || core_slug;
        changed := true;
      end if;

      if jsonb_typeof(tree -> idx -> 'supporting') is distinct from 'array' then
        tree := jsonb_set(tree, array[idx::text, 'supporting'], '[]'::jsonb);
      end if;

      if jsonb_typeof(item) = 'object' and jsonb_typeof(item -> 'supporting') = 'array' then
        for sup in select value from jsonb_array_elements(item -> 'supporting')
        loop
          sup_label := pg_temp.kw_label(sup);
          continue when sup_label = '';
          sup_slug := pg_temp.kw_slug(sup_label);
          continue when sup_slug = any(used);
          tree := jsonb_set(
            tree,
            array[idx::text, 'supporting'],
            (tree -> idx -> 'supporting') || jsonb_build_array(jsonb_build_object(
              'slug', sup_slug,
              'keyword', sup_label,
              'plannedArticles', '[]'::jsonb,
              'source', 'company_data',
              'addedAt', now_iso
            ))
          );
          used := used || sup_slug;
          changed := true;
        end loop;
      end if;

      idx := null;
    end loop;

    if changed then
      if has_row then
        update public.content_coverage
        set pillars = tree, updated_at = now()
        where company_id = prof.company_id;
      else
        insert into public.content_coverage (company_id, pillars, updated_at)
        values (prof.company_id, tree, now());
      end if;
    end if;
  end loop;
end
$$;
