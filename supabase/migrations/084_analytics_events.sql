-- Analytics → Events: a per-company event log, the annotations Analyze writes
-- for flagged moves on a weekly chart, and the links between the two.
-- Analysis is stored, so a week is only analysed once.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Event log. Auto events carry a ref (one row per company + ref); manual
-- events have ref null.
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  date date not null,
  type text not null default 'other'
    check (type in ('publish', 'deploy', 'email', 'tracking', 'social', 'pr', 'algorithm', 'site', 'other')),
  title text not null,
  detail text not null default '',
  source text not null default 'manual' check (source in ('auto', 'manual')),
  ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ref)
);

create index if not exists analytics_events_company_date_idx
  on public.analytics_events (company_id, date desc);

comment on table public.analytics_events is
  'Analytics Events: things that happened (publishes, deploys, sends, posts). Auto rows are collected from other tables and GitHub; manual rows are typed in.';

-- ---------------------------------------------------------------------------
-- Annotations: one per flagged move on one metric.
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_annotations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  metric text not null,
  week_start date not null,
  through_week date not null,
  direction text not null check (direction in ('up', 'down')),
  value numeric not null,
  baseline numeric not null,
  verdict text not null check (verdict in ('explained', 'partly', 'unexplained')),
  summary text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  window_from date not null,
  window_to date not null,
  stale boolean not null default false,
  model text,
  analyzed_at timestamptz not null default now(),
  edited_at timestamptz,
  edited_by uuid,
  unique (company_id, metric, week_start)
);

comment on table public.analytics_annotations is
  'Analytics Events: a flagged move on a weekly metric with its verdict. week_start/through_week are the Mondays of the first and last flagged week. edited_at set = a person changed it, so re-analysis leaves it alone.';
comment on column public.analytics_annotations.stale is
  'True when an event dated inside window_from..window_to was logged after the analysis.';
comment on column public.analytics_annotations.evidence is
  '{ contributors: [{ key, current, baseline, delta, share }], weeks: n }';

create table if not exists public.analytics_annotation_events (
  annotation_id uuid not null references public.analytics_annotations (id) on delete cascade,
  event_id uuid not null references public.analytics_events (id) on delete cascade,
  strength text not null default 'possible' check (strength in ('strong', 'possible')),
  primary key (annotation_id, event_id)
);

comment on table public.analytics_annotation_events is
  'Analytics Events: which events an annotation cites as a cause, and how strongly.';

alter table public.analytics_settings
  add column if not exists events_analyzed jsonb not null default '{}'::jsonb,
  add column if not exists events_collected_at timestamptz;

comment on column public.analytics_settings.events_analyzed is
  '{ <metric>: "YYYY-MM-DD" } Monday of the last week Analyze has covered, per metric.';

-- RLS: same model as the rest of the app (any signed-in user).
do $$
declare
  t text;
begin
  foreach t in array array['analytics_events', 'analytics_annotations', 'analytics_annotation_events']
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
-- Weekly series for one metric. Weeks start on Monday. Weeks with no rows are
-- not returned (the caller fills them).
-- ---------------------------------------------------------------------------
create or replace function public.analytics_events_weekly(
  p_company_id uuid, p_metric text, p_from date, p_to date
)
returns table (week date, value numeric)
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_metric = 'search_top10' then
    return query
      select date_trunc('week', q.date)::date, sum(q.impressions)::numeric
      from analytics_queries q
      where q.company_id = p_company_id and q.source = 'gsc'
        and q.date between p_from and p_to and q.position <= 10
      group by 1 order by 1;
  elsif p_metric in ('search_impressions', 'search_clicks') then
    return query
      select date_trunc('week', d.date)::date,
        sum(case when p_metric = 'search_clicks' then d.clicks else d.impressions end)::numeric
      from analytics_daily d
      where d.company_id = p_company_id and d.source = 'gsc' and d.date between p_from and p_to
      group by 1 order by 1;
  elsif p_metric = 'ai_sessions' then
    return query
      select date_trunc('week', t.date)::date, sum(t.sessions)::numeric
      from analytics_traffic t
      where t.company_id = p_company_id and t.date between p_from and p_to
        and t.ai_assistant is not null
      group by 1 order by 1;
  elsif p_metric = 'ai_mention_rate' then
    return query
      select date_trunc('week', r.ran_at at time zone 'utc')::date,
        round(100.0 * count(*) filter (
          where coalesce((r.brands -> b.id::text ->> 'named')::boolean, false)
             or coalesce((r.brands -> b.id::text ->> 'cited')::boolean, false)
        ) / count(*), 1)
      from pt_runs r
      join pt_brands b on b.company_id = r.company_id and b.is_own
      where r.company_id = p_company_id and r.status = 'ok'
        and (r.ran_at at time zone 'utc')::date between p_from and p_to
      group by 1 order by 1;
  elsif p_metric = 'ai_crawler_hits' then
    return query
      select date_trunc('week', h.date)::date, sum(h.hits)::numeric
      from analytics_bot_hits h
      where h.company_id = p_company_id and h.date between p_from and p_to and h.kind <> 'search'
      group by 1 order by 1;
  elsif p_metric in ('traffic_engaged', 'traffic_engaged_ex_direct', 'traffic_sessions') then
    return query
      select date_trunc('week', t.date)::date,
        sum(case when p_metric = 'traffic_sessions' then t.sessions else t.engaged_sessions end)::numeric
      from analytics_traffic t
      where t.company_id = p_company_id and t.date between p_from and p_to
        and (p_metric <> 'traffic_engaged_ex_direct' or t.channel <> 'Direct')
      group by 1 order by 1;
  else
    raise exception 'Unknown metric %', p_metric;
  end if;
end;
$$;

-- Latest date with data for a metric's source (so only complete weeks are analysed).
create or replace function public.analytics_events_last_date(p_company_id uuid, p_metric text)
returns date
language sql stable security invoker
set search_path = public
as $$
  select case
    when p_metric like 'search_%' then
      (select max(date) from analytics_daily where company_id = p_company_id and source = 'gsc')
    when p_metric = 'ai_mention_rate' then
      (select max((ran_at at time zone 'utc')::date) from pt_runs where company_id = p_company_id and status = 'ok')
    when p_metric = 'ai_crawler_hits' then
      (select max(date) from analytics_bot_hits where company_id = p_company_id)
    else
      (select max(date) from analytics_traffic where company_id = p_company_id)
  end
$$;

-- What a metric is made of over a date range: pages for search, sources for
-- traffic, landing pages for AI visits, bots for crawler hits.
create or replace function public.analytics_events_breakdown(
  p_company_id uuid, p_metric text, p_from date, p_to date
)
returns table (key text, value numeric)
language plpgsql stable security invoker
set search_path = public
as $$
begin
  if p_metric = 'search_top10' then
    return query
      select q.page, sum(q.impressions)::numeric
      from analytics_queries q
      where q.company_id = p_company_id and q.source = 'gsc'
        and q.date between p_from and p_to and q.position <= 10
      group by 1 order by 2 desc limit 500;
  elsif p_metric in ('search_impressions', 'search_clicks') then
    return query
      select p.page,
        sum(case when p_metric = 'search_clicks' then p.clicks else p.impressions end)::numeric
      from analytics_pages p
      where p.company_id = p_company_id and p.source = 'gsc' and p.date between p_from and p_to
      group by 1 order by 2 desc limit 500;
  elsif p_metric = 'ai_sessions' then
    return query
      select l.ai_assistant || ' → ' || l.landing_page, sum(l.sessions)::numeric
      from analytics_ai_landing l
      where l.company_id = p_company_id and l.date between p_from and p_to
      group by 1 order by 2 desc limit 500;
  elsif p_metric = 'ai_crawler_hits' then
    return query
      select h.bot, sum(h.hits)::numeric
      from analytics_bot_hits h
      where h.company_id = p_company_id and h.date between p_from and p_to and h.kind <> 'search'
      group by 1 order by 2 desc limit 500;
  elsif p_metric in ('traffic_engaged', 'traffic_engaged_ex_direct', 'traffic_sessions') then
    return query
      select t.source || ' / ' || t.channel,
        sum(case when p_metric = 'traffic_sessions' then t.sessions else t.engaged_sessions end)::numeric
      from analytics_traffic t
      where t.company_id = p_company_id and t.date between p_from and p_to
        and (p_metric <> 'traffic_engaged_ex_direct' or t.channel <> 'Direct')
      group by 1 order by 2 desc limit 500;
  end if;
  return;
end;
$$;

-- Events that can be read off other tables, one row per company + day + kind.
create or replace function public.analytics_events_auto(p_company_id uuid, p_from date)
returns table (date date, type text, ref text, title text, detail text)
language sql stable security invoker
set search_path = public
as $$
  select d, 'publish', 'publish:' || d,
    n || case when n = 1 then ' article published' else ' articles published' end,
    array_to_string(titles[1:10], ' · ') || case when n > 10 then ' · and ' || (n - 10) || ' more' else '' end
  from (
    select (g.published_at at time zone 'utc')::date as d, count(*) as n,
      array_agg(coalesce(nullif(g.title, ''), g.slug) order by g.title) as titles
    from generated_articles g
    where g.company_id = p_company_id and g.published_at is not null
      and (g.published_at at time zone 'utc')::date >= p_from
    group by 1
  ) a
  union all
  select d, 'email', 'email:' || d,
    n || case when n = 1 then ' outreach email sent' else ' outreach emails sent' end, ''
  from (
    select (e.sent_at at time zone 'utc')::date as d, count(*) as n
    from email_leads e
    where e.company_id = p_company_id and e.sent_at is not null
      and (e.sent_at at time zone 'utc')::date >= p_from
    group by 1
  ) s
  union all
  select d, 'tracking', 'tracking:bots', 'AI crawler tracking started',
    'Crawler hits are only counted from this date.'
  from (select min(h.date) as d from analytics_bot_hits h where h.company_id = p_company_id) b
  where d is not null and d >= p_from
  union all
  select d, 'tracking', 'tracking:ga4', 'GA4 data starts',
    'Visits are only counted from this date.'
  from (select min(t.date) as d from analytics_traffic t where t.company_id = p_company_id) t
  where d is not null and d >= p_from
$$;
