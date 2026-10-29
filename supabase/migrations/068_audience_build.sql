-- Audience Build (AudienceLab lead sourcing), step 1 of the build:
--   * al_segments: AudienceLab's pre-made intent segments (taxonomy), synced
--     from GET /audiences/attributes/segments + keywords from the taxonomy
--     sheet, searchable with Postgres full-text search.
--   * search_al_segments(): keyword retrieval used by the segment matcher.
--   * al_segment_counts: cached AudienceLab counts per segment/window/filters.
--   * lead_sourcing_configs: one row per company — chosen segments, the last
--     match run, and (later steps) filters, sizing ladder, audience ids.
--   * Structured ICP columns on company_profiles (used by later steps for
--     AudienceLab filters; Claude drafts them from Company Intelligence).
-- Idempotent. Safe to re-run.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1) Taxonomy
-- ---------------------------------------------------------------------------
create table if not exists public.al_segments (
  segment_id text primary key,                  -- b2b_1003 / b2c_1253
  taxonomy_type text not null,                  -- b2b | b2c
  topic text not null,
  category text,
  subcategory text,
  description text,
  keywords text,
  available_scores text[] not null default '{}',
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(topic, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(keywords, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '') || ' ' || coalesce(subcategory, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'D')
  ) stored,
  synced_at timestamptz not null default now()
);

create index if not exists al_segments_search_idx on public.al_segments using gin (search);
create index if not exists al_segments_topic_trgm_idx on public.al_segments using gin (lower(topic) gin_trgm_ops);
create index if not exists al_segments_type_idx on public.al_segments (taxonomy_type);

comment on table public.al_segments is
  'AudienceLab pre-made intent segments. Synced by Audience Build (action audience-build, resource sync-segments).';
comment on column public.al_segments.available_scores is
  'Intent tiers AudienceLab offers for this segment (low/medium/high). The matcher only uses segments with high.';

alter table public.al_segments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'al_segments'
      and policyname = 'Authenticated users can manage al_segments'
  ) then
    create policy "Authenticated users can manage al_segments"
      on public.al_segments for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Retrieval: phrases (full-text) + names (trigram, for competitor/vendor
--    segments). Returns candidates ranked by how many phrases hit, then score.
-- ---------------------------------------------------------------------------
create or replace function public.search_al_segments(
  phrases text[],
  names text[] default '{}',
  segment_type text default 'b2b',
  max_results integer default 80
)
returns table (
  segment_id text,
  topic text,
  category text,
  subcategory text,
  description text,
  keywords text,
  available_scores text[],
  hits integer,
  score real,
  name_match boolean
)
language sql
stable
as $$
  with phrase_hits as (
    select s.segment_id,
           count(*)::int as hits,
           sum(ts_rank_cd(s.search, q.tsq))::real as score
    from unnest(coalesce(phrases, '{}')) as p(phrase)
    cross join lateral (select plainto_tsquery('english', p.phrase) as tsq) q
    join public.al_segments s on s.search @@ q.tsq
    where s.taxonomy_type = segment_type
      and 'high' = any (s.available_scores)
      and numnode(q.tsq) > 0
    group by s.segment_id
  ),
  name_hits as (
    select distinct s.segment_id
    from unnest(coalesce(names, '{}')) as n(name)
    join public.al_segments s
      on length(trim(n.name)) > 1
     and lower(s.topic) % lower(trim(n.name))
     and similarity(lower(s.topic), lower(trim(n.name))) >= 0.6
    where s.taxonomy_type = segment_type
      and 'high' = any (s.available_scores)
  ),
  merged as (
    select coalesce(p.segment_id, n.segment_id) as segment_id,
           coalesce(p.hits, 0) as hits,
           coalesce(p.score, 0) as score,
           (n.segment_id is not null) as name_match
    from phrase_hits p
    full outer join name_hits n on n.segment_id = p.segment_id
  )
  select s.segment_id, s.topic, s.category, s.subcategory, s.description, s.keywords,
         s.available_scores, m.hits, m.score, m.name_match
  from merged m
  join public.al_segments s on s.segment_id = m.segment_id
  -- A competitor-name match counts as two phrase hits, so it ranks high
  -- without crowding out strong topical matches.
  order by (m.hits + case when m.name_match then 2 else 0 end) desc, m.score desc
  limit greatest(1, least(max_results, 200));
$$;

comment on function public.search_al_segments is
  'Audience Build retrieval: full-text match on phrases + trigram match on names (competitors). B2B by default; only segments with a high intent tier.';

-- ---------------------------------------------------------------------------
-- 2b) Count cache. AudienceLab /insights takes 10-30 s per call and allows
--     30/min, so counts are cached per segment + window + filter set and
--     shared across companies. filter_key identifies the filter set (score
--     tiers + hard floors + any ICP filters), so different filters never mix.
-- ---------------------------------------------------------------------------
create table if not exists public.al_segment_counts (
  segment_id text not null,
  days_back integer not null,
  filter_key text not null,
  reach integer not null,
  summary jsonb not null default '{}'::jsonb,
  counted_at timestamptz not null default now(),
  primary key (segment_id, days_back, filter_key)
);

comment on table public.al_segment_counts is
  'Audience Build: cached AudienceLab /insights results (reach + distributions) per segment, window and filter set.';

alter table public.al_segment_counts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'al_segment_counts'
      and policyname = 'Authenticated users can manage al_segment_counts'
  ) then
    create policy "Authenticated users can manage al_segment_counts"
      on public.al_segment_counts for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Per-company lead sourcing config
-- ---------------------------------------------------------------------------
create table if not exists public.lead_sourcing_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  -- Chosen segments: [{ segment_id, topic, category, reason, relevance,
  --   reach_7d_high, reach_1d_high, role: 'primary' | 'additional' }]
  segments jsonb not null default '[]'::jsonb,
  -- Last match run: { ran_at, phrases, names, candidates: [...] }
  last_match jsonb,
  -- Later steps: approved AudienceLab filters, sizing ladder result,
  -- per-tier audience ids created by the daily job.
  filters jsonb not null default '{}'::jsonb,
  ladder jsonb,
  al_audience_ids jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'segments_selected', 'filters_approved', 'active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lead_sourcing_configs is
  'Audience Build: per-company AudienceLab segment selection, filters, sizing and audience ids.';

alter table public.lead_sourcing_configs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'lead_sourcing_configs'
      and policyname = 'Authenticated users can manage lead_sourcing_configs'
  ) then
    create policy "Authenticated users can manage lead_sourcing_configs"
      on public.lead_sourcing_configs for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Structured ICP fields (filled in step 3; added now so the schema lands once)
-- ---------------------------------------------------------------------------
alter table public.company_profiles
  add column if not exists icp_buyer_titles text[] not null default '{}',
  add column if not exists icp_exclude_titles text[] not null default '{}',
  add column if not exists icp_seniority text[] not null default '{}',
  add column if not exists icp_departments text[] not null default '{}',
  add column if not exists icp_employee_bands text[] not null default '{}',
  add column if not exists icp_revenue_bands text[] not null default '{}',
  add column if not exists icp_industries text[] not null default '{}',
  add column if not exists icp_exclude_industries text[] not null default '{}',
  add column if not exists icp_states text[] not null default '{}',
  add column if not exists icp_exclude_states text[] not null default '{}',
  add column if not exists outbound_exclude_domains text[] not null default '{}',
  add column if not exists outbound_inboxes integer not null default 1,
  add column if not exists outbound_daily_cap integer not null default 30;

comment on column public.company_profiles.icp_buyer_titles is 'Audience Build: target job titles (AudienceLab businessProfile.jobTitle).';
comment on column public.company_profiles.icp_seniority is 'Audience Build: values from GET /audiences/attributes/seniority.';
comment on column public.company_profiles.icp_departments is 'Audience Build: values from GET /audiences/attributes/departments.';
comment on column public.company_profiles.icp_employee_bands is 'Audience Build: AudienceLab employeeCount bands, e.g. "51 to 100".';
comment on column public.company_profiles.outbound_exclude_domains is 'Audience Build: customer/competitor/partner domains never emailed.';
comment on column public.company_profiles.outbound_inboxes is 'Audience Build: sending inboxes; daily lead need = inboxes x daily cap (single touch).';
