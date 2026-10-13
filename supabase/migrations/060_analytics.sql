-- Analytics: stored daily pulls from Google Search Console, GA4, Bing Webmaster,
-- DataForSEO AI visibility checks, and AI-crawler hits reported by the
-- destination sites. The Analytics page reads only from these tables.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Per-company settings + sync state
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  gsc_property_override text,
  ga4_property_override text,
  bing_site_override text,
  gsc_property text,
  ga4_property text,
  bing_site text,
  status jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  sync_started_at timestamptz,
  ai_checked_at timestamptz,
  bot_token text not null unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  bot_last_hit_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.analytics_settings is
  'Analytics: property overrides, resolved properties, per-source sync status, and the AI-crawler ingest token.';
comment on column public.analytics_settings.status is
  '{ gsc|ga4|bing|ai: { ok: boolean, message: string, at: iso } } from the last sync.';
comment on column public.analytics_settings.bot_token is
  'Secret the destination site middleware sends with each AI-crawler hit.';

-- ---------------------------------------------------------------------------
-- Search data (GSC + Bing)
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_daily (
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('gsc', 'bing')),
  date date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  position numeric,
  primary key (company_id, source, date)
);

create table if not exists public.analytics_pages (
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('gsc', 'bing')),
  date date not null,
  page text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  position numeric,
  primary key (company_id, source, date, page)
);

create table if not exists public.analytics_queries (
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('gsc', 'bing')),
  date date not null,
  query text not null,
  page text not null default '',
  clicks integer not null default 0,
  impressions integer not null default 0,
  position numeric,
  primary key (company_id, source, date, query, page)
);

comment on table public.analytics_pages is
  'Per-day (GSC) or per-week bucket (Bing) page stats. Pruned after ~200 days.';
comment on table public.analytics_queries is
  'Per-day query stats (GSC: with page; Bing: page is empty). Pruned after ~200 days.';

-- ---------------------------------------------------------------------------
-- GA4 traffic
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_traffic (
  company_id uuid not null references public.companies (id) on delete cascade,
  date date not null,
  source text not null,
  channel text not null,
  ai_assistant text,
  sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  primary key (company_id, date, source, channel)
);

create table if not exists public.analytics_ai_landing (
  company_id uuid not null references public.companies (id) on delete cascade,
  date date not null,
  ai_assistant text not null,
  landing_page text not null,
  sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  primary key (company_id, date, ai_assistant, landing_page)
);

comment on column public.analytics_traffic.ai_assistant is
  'Set when sessionSource is a known AI assistant (lib/analytics/aiSources.js).';

-- ---------------------------------------------------------------------------
-- AI visibility (DataForSEO)
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_ai_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  keyword text not null,
  checked_at timestamptz not null default now(),
  has_ai_overview boolean,
  cited boolean,
  cited_urls jsonb not null default '[]'::jsonb,
  cited_domains jsonb not null default '[]'::jsonb,
  competitors_cited jsonb not null default '[]'::jsonb,
  organic_position integer,
  organic_url text,
  error text,
  cost_usd numeric(10, 4) not null default 0
);

create index if not exists analytics_ai_checks_company_idx
  on public.analytics_ai_checks (company_id, checked_at desc);

create table if not exists public.analytics_ai_mentions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  checked_at timestamptz not null default now(),
  platform text not null check (platform in ('chat_gpt', 'google')),
  total_count integer,
  items jsonb not null default '[]'::jsonb,
  error text,
  cost_usd numeric(10, 4) not null default 0
);

create index if not exists analytics_ai_mentions_company_idx
  on public.analytics_ai_mentions (company_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- AI crawler hits (reported by destination site middleware)
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_bot_hits (
  company_id uuid not null references public.companies (id) on delete cascade,
  date date not null,
  bot text not null,
  kind text not null,
  path text not null,
  hits integer not null default 0,
  last_hit_at timestamptz not null default now(),
  primary key (company_id, date, bot, path)
);

-- ---------------------------------------------------------------------------
-- RLS: same model as the rest of the app (any signed-in user).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'analytics_settings', 'analytics_daily', 'analytics_pages', 'analytics_queries',
    'analytics_traffic', 'analytics_ai_landing', 'analytics_ai_checks',
    'analytics_ai_mentions', 'analytics_bot_hits'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = 'Authenticated users can manage ' || t
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        'Authenticated users can manage ' || t, t
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Read-side aggregates (security invoker: RLS applies to the caller).
-- position is impression-weighted.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_page_stats(
  p_company_id uuid, p_source text, p_from date, p_to date
)
returns table (page text, clicks bigint, impressions bigint, "position" numeric)
language sql stable security invoker
as $$
  select
    p.page,
    sum(p.clicks)::bigint,
    sum(p.impressions)::bigint,
    case when sum(p.impressions) > 0
      then sum(coalesce(p.position, 0) * p.impressions) / sum(p.impressions)
    end
  from public.analytics_pages p
  where p.company_id = p_company_id and p.source = p_source
    and p.date between p_from and p_to
  group by p.page
  order by sum(p.clicks) desc, sum(p.impressions) desc, p.page
$$;

create or replace function public.analytics_query_stats(
  p_company_id uuid, p_source text, p_from date, p_to date, p_limit integer default 3000
)
returns table (query text, page text, clicks bigint, impressions bigint, "position" numeric)
language sql stable security invoker
as $$
  select
    q.query,
    q.page,
    sum(q.clicks)::bigint,
    sum(q.impressions)::bigint,
    case when sum(q.impressions) > 0
      then sum(coalesce(q.position, 0) * q.impressions) / sum(q.impressions)
    end
  from public.analytics_queries q
  where q.company_id = p_company_id and q.source = p_source
    and q.date between p_from and p_to
  group by q.query, q.page
  order by sum(q.impressions) desc, q.query, q.page
  limit greatest(1, least(p_limit, 10000))
$$;

create or replace function public.analytics_traffic_stats(
  p_company_id uuid, p_from date, p_to date
)
returns table (source text, channel text, ai_assistant text, sessions bigint, engaged_sessions bigint)
language sql stable security invoker
as $$
  select t.source, t.channel, t.ai_assistant,
    sum(t.sessions)::bigint, sum(t.engaged_sessions)::bigint
  from public.analytics_traffic t
  where t.company_id = p_company_id and t.date between p_from and p_to
  group by t.source, t.channel, t.ai_assistant
  order by sum(t.sessions) desc, t.source, t.channel
$$;

create or replace function public.analytics_traffic_daily(
  p_company_id uuid, p_from date, p_to date
)
returns table (date date, sessions bigint, ai_sessions bigint)
language sql stable security invoker
as $$
  select t.date,
    sum(t.sessions)::bigint,
    coalesce(sum(t.sessions) filter (where t.ai_assistant is not null), 0)::bigint
  from public.analytics_traffic t
  where t.company_id = p_company_id and t.date between p_from and p_to
  group by t.date
  order by t.date
$$;

create or replace function public.analytics_ai_landing_stats(
  p_company_id uuid, p_from date, p_to date
)
returns table (landing_page text, ai_assistant text, sessions bigint, engaged_sessions bigint)
language sql stable security invoker
as $$
  select l.landing_page, l.ai_assistant,
    sum(l.sessions)::bigint, sum(l.engaged_sessions)::bigint
  from public.analytics_ai_landing l
  where l.company_id = p_company_id and l.date between p_from and p_to
  group by l.landing_page, l.ai_assistant
  order by sum(l.sessions) desc, l.landing_page, l.ai_assistant
$$;

create or replace function public.analytics_bot_stats(
  p_company_id uuid, p_from date, p_to date
)
returns table (bot text, kind text, hits bigint, pages bigint, last_hit_at timestamptz)
language sql stable security invoker
as $$
  select b.bot, b.kind, sum(b.hits)::bigint, count(distinct b.path)::bigint, max(b.last_hit_at)
  from public.analytics_bot_hits b
  where b.company_id = p_company_id and b.date between p_from and p_to
  group by b.bot, b.kind
  order by sum(b.hits) desc, b.bot
$$;

create or replace function public.analytics_bot_paths(
  p_company_id uuid, p_from date, p_to date, p_limit integer default 20
)
returns table (path text, hits bigint, ai_hits bigint, bots text[])
language sql stable security invoker
as $$
  select b.path,
    sum(b.hits)::bigint,
    coalesce(sum(b.hits) filter (where b.kind <> 'search'), 0)::bigint,
    array_agg(distinct b.bot order by b.bot)
  from public.analytics_bot_hits b
  where b.company_id = p_company_id and b.date between p_from and p_to
  group by b.path
  order by coalesce(sum(b.hits) filter (where b.kind <> 'search'), 0) desc, sum(b.hits) desc
  limit greatest(1, least(p_limit, 200))
$$;

create or replace function public.analytics_bot_daily(
  p_company_id uuid, p_from date, p_to date
)
returns table (date date, ai_hits bigint, search_hits bigint)
language sql stable security invoker
as $$
  select b.date,
    coalesce(sum(b.hits) filter (where b.kind <> 'search'), 0)::bigint,
    coalesce(sum(b.hits) filter (where b.kind = 'search'), 0)::bigint
  from public.analytics_bot_hits b
  where b.company_id = p_company_id and b.date between p_from and p_to
  group by b.date
  order by b.date
$$;

-- ---------------------------------------------------------------------------
-- Write path for the public ingest endpoint (service role only).
-- Validates the token, then increments the (company, day, bot, path) counter.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_record_bot_hit(
  p_token text, p_bot text, p_kind text, p_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select company_id into v_company
  from public.analytics_settings
  where bot_token = p_token;

  if v_company is null then
    return false;
  end if;

  insert into public.analytics_bot_hits (company_id, date, bot, kind, path, hits, last_hit_at)
  values (v_company, (now() at time zone 'utc')::date, p_bot, p_kind, p_path, 1, now())
  on conflict (company_id, date, bot, path)
  do update set hits = public.analytics_bot_hits.hits + 1, last_hit_at = now();

  update public.analytics_settings
  set bot_last_hit_at = now()
  where company_id = v_company
    and (bot_last_hit_at is null or bot_last_hit_at < now() - interval '1 minute');

  return true;
end;
$$;

revoke all on function public.analytics_record_bot_hit(text, text, text, text) from public, anon, authenticated;
grant execute on function public.analytics_record_bot_hit(text, text, text, text) to service_role;
