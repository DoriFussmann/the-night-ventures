-- Scheduled publishing (Sprint 3): one schedule per pillar, one item per
-- supporting article. The browser writes the drafts and creates the rows; the
-- daily cron (publish-schedule action) publishes the items that are due.

create table if not exists public.publish_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  pillar_slug text not null,
  pillar_keyword text not null,
  -- writing: drafts still being written in the browser
  -- active | paused | cancelled | done
  status text not null default 'writing'
    check (status in ('writing', 'active', 'paused', 'cancelled', 'done')),
  -- { intervalDays, weekends: 'allow'|'skip', approval: 'auto'|'approve', timezone }
  settings jsonb not null default '{}'::jsonb,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open schedule per pillar.
create unique index if not exists publish_schedules_one_open_per_pillar
  on public.publish_schedules (company_id, pillar_slug)
  where status in ('writing', 'active', 'paused');

create table if not exists public.publish_schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.publish_schedules (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  position integer not null,
  keyword text not null,
  supporting_slug text,
  generated_article_id uuid references public.generated_articles (id) on delete set null,
  -- Local publish day in settings.timezone.
  publish_on date,
  status text not null default 'to_write'
    check (status in ('to_write', 'scheduled', 'publishing', 'published', 'failed', 'skipped')),
  approved_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  -- Review notes added at publish time, e.g. figure mismatches: [{ kind, message }]
  notes jsonb not null default '[]'::jsonb,
  published_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publish_schedule_items_due
  on public.publish_schedule_items (status, publish_on);
create index if not exists publish_schedule_items_schedule
  on public.publish_schedule_items (schedule_id, position);

comment on table public.publish_schedules is
  'Scheduled publishing: one schedule per pillar (Article Generation → Generate & schedule).';
comment on table public.publish_schedule_items is
  'Scheduled publishing: one row per supporting article, published by the daily cron.';

alter table public.publish_schedules enable row level security;
alter table public.publish_schedule_items enable row level security;

drop policy if exists "Authenticated users can manage publish_schedules" on public.publish_schedules;
create policy "Authenticated users can manage publish_schedules"
  on public.publish_schedules for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can manage publish_schedule_items" on public.publish_schedule_items;
create policy "Authenticated users can manage publish_schedule_items"
  on public.publish_schedule_items for all
  to authenticated
  using (true)
  with check (true);
