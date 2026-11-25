-- Analytics: keep every crawler hit, not only the daily count.
-- analytics_bot_hits holds one row per (company, day, bot, path) with a count
-- and the time of the last hit. That cannot answer "did an AI assistant fetch
-- the site just before this booking?" when the same page is fetched many times
-- a day. This adds one row per hit, written by the same ingest function.
-- Additive only: the daily counter and everything that reads it are unchanged.

create table if not exists public.analytics_bot_hit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  hit_at timestamptz not null default now(),
  bot text not null,
  kind text not null,
  path text not null
);

create index if not exists analytics_bot_hit_log_company_time_idx
  on public.analytics_bot_hit_log (company_id, hit_at desc);

alter table public.analytics_bot_hit_log enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'analytics_bot_hit_log'
  ) then
    create policy "Authenticated users can manage analytics_bot_hit_log"
      on public.analytics_bot_hit_log
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Same function as in 060, plus the insert into the log.
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

  insert into public.analytics_bot_hit_log (company_id, bot, kind, path)
  values (v_company, p_bot, p_kind, p_path);

  update public.analytics_settings
  set bot_last_hit_at = now()
  where company_id = v_company
    and (bot_last_hit_at is null or bot_last_hit_at < now() - interval '1 minute');

  return true;
end;
$$;

revoke all on function public.analytics_record_bot_hit(text, text, text, text) from public, anon, authenticated;
grant execute on function public.analytics_record_bot_hit(text, text, text, text) to service_role;

-- Fetches made by AI assistants on a user's behalf (ChatGPT-User and the like)
-- in the minutes before a moment, newest first. For matching a booking to the
-- assistant session that likely led to it.
create or replace function public.analytics_ai_fetches_before(
  p_company_id uuid, p_at timestamptz, p_minutes integer default 180
)
returns table (hit_at timestamptz, minutes_before numeric, bot text, path text)
language sql stable security invoker
as $$
  select l.hit_at,
    round((extract(epoch from (p_at - l.hit_at)) / 60)::numeric, 1),
    l.bot,
    l.path
  from public.analytics_bot_hit_log l
  where l.company_id = p_company_id
    and l.kind = 'ai_user'
    and l.hit_at <= p_at
    and l.hit_at > p_at - make_interval(mins => greatest(1, least(p_minutes, 10080)))
  order by l.hit_at desc
$$;
