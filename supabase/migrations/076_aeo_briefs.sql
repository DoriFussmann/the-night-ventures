-- AEO Playbook, phase 2a: article briefs (one per prompt group) for the
-- Generation workflow, plus the two fields generation needs on pillars and
-- groups. Additive only; safe on production.

-- The live site's topic name for this pillar: new articles' pillarKeyword must
-- match it exactly, or they drop out of the hub page.
alter table public.aeo_pillars add column if not exists topic_name text not null default '';

-- The group's primary keyword (the strongest keyword among its prompts).
alter table public.aeo_prompt_groups add column if not exists primary_keyword text not null default '';

create table if not exists public.aeo_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  group_id uuid not null references public.aeo_prompt_groups (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'generated', 'approved', 'scheduled', 'published', 'skipped')),
  title text not null default '',
  primary_keyword text not null default '',
  article_type text not null default 'flex'
    check (article_type in ('comprehensive', 'howto', 'comparison', 'faq', 'flex')),
  angle text not null default '',
  -- [{ heading, points: [] }]
  outline jsonb not null default '[]'::jsonb,
  -- Dori's key points: the expert input the writer leads with.
  key_points text not null default '',
  -- { primary: 'consultation' | 'tool' | 'newsletter', tool: '' }
  cta jsonb not null default '{}'::jsonb,
  -- [{ slug, title, kind: 'pillar' | 'sibling' }]
  link_targets jsonb not null default '[]'::jsonb,
  batch_label text not null default '',
  generated_article_id uuid references public.generated_articles (id) on delete set null,
  publish_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, group_id)
);

create index if not exists aeo_briefs_company_idx on public.aeo_briefs (company_id, status);

alter table public.aeo_briefs enable row level security;
drop policy if exists "Authenticated users can manage aeo_briefs" on public.aeo_briefs;
create policy "Authenticated users can manage aeo_briefs"
  on public.aeo_briefs for all to authenticated using (true) with check (true);
