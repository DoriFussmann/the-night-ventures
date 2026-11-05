-- AEO Playbook: the new, separate section of Company Intelligence.
-- Brand Facts, ICP + personas, the prompt universe, and the content map
-- (pillars -> prompt groups). Kept apart from the existing company_profiles
-- fields on purpose, so old fields can be compared and retired one by one.
-- Additive only; safe on production.

-- One row per company: Brand Facts (structured JSON) and the ICP.
create table if not exists public.aeo_playbook (
  company_id uuid primary key references public.companies (id) on delete cascade,
  brand_facts jsonb not null default '{}'::jsonb,
  icp text not null default '',
  shared_traits jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.aeo_playbook is
  'AEO Playbook: Brand Facts (single source of truth) and ICP, one row per company.';

create table if not exists public.aeo_personas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null default '',
  summary text not null default '',
  stage text not null default '',
  trigger text not null default '',
  need text not null default '',
  pains text not null default '',
  decision_criteria text not null default '',
  alternatives text not null default '',
  their_words text not null default '',
  where_they_listen text not null default '',
  main_tiers text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.aeo_pillars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null default '',
  hub_path text not null default '',
  pillar_article_slug text not null default '',
  is_new boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.aeo_prompt_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  pillar_id uuid references public.aeo_pillars (id) on delete set null,
  code text not null,
  name text not null default '',
  page_type text not null default 'supporting'
    check (page_type in ('pillar', 'supporting', 'money')),
  live_slug text not null default '',
  status text not null default 'new'
    check (status in ('live', 'new', 'money', 'planned', 'drafted', 'scheduled', 'published')),
  notes text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table if not exists public.aeo_prompts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  persona_id uuid references public.aeo_personas (id) on delete set null,
  group_id uuid references public.aeo_prompt_groups (id) on delete set null,
  intent_tier text not null default 'Problem'
    check (intent_tier in ('Buy', 'Problem', 'Learn')),
  prompt text not null,
  keyword text not null default '',
  search_volume integer,
  keyword_difficulty integer,
  gsc_impressions integer,
  gsc_best_position numeric,
  bing_impressions integer,
  cited_today text not null default '',
  business_value integer check (business_value between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists aeo_prompts_company_idx on public.aeo_prompts (company_id);
create index if not exists aeo_prompts_group_idx on public.aeo_prompts (group_id);
create index if not exists aeo_prompt_groups_company_idx on public.aeo_prompt_groups (company_id, sort);
create index if not exists aeo_pillars_company_idx on public.aeo_pillars (company_id, sort);
create index if not exists aeo_personas_company_idx on public.aeo_personas (company_id, sort);

alter table public.aeo_playbook enable row level security;
alter table public.aeo_personas enable row level security;
alter table public.aeo_pillars enable row level security;
alter table public.aeo_prompt_groups enable row level security;
alter table public.aeo_prompts enable row level security;

drop policy if exists "Authenticated users can manage aeo_playbook" on public.aeo_playbook;
create policy "Authenticated users can manage aeo_playbook"
  on public.aeo_playbook for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users can manage aeo_personas" on public.aeo_personas;
create policy "Authenticated users can manage aeo_personas"
  on public.aeo_personas for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users can manage aeo_pillars" on public.aeo_pillars;
create policy "Authenticated users can manage aeo_pillars"
  on public.aeo_pillars for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users can manage aeo_prompt_groups" on public.aeo_prompt_groups;
create policy "Authenticated users can manage aeo_prompt_groups"
  on public.aeo_prompt_groups for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated users can manage aeo_prompts" on public.aeo_prompts;
create policy "Authenticated users can manage aeo_prompts"
  on public.aeo_prompts for all to authenticated using (true) with check (true);
