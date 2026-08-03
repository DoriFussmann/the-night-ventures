-- Content coverage tree per company for Topic Generation.
-- Mirrors Company Data pillar/supporting keywords; plannedArticles filled by cluster plans / manual entry.

create table public.content_coverage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  pillars jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.content_coverage is
  'SEO content-coverage dashboard: pillars → supporting keywords → planned articles, keyed by company.';

comment on column public.content_coverage.pillars is
  'Array of { slug, keyword, pillarArticle, supporting: [{ slug, keyword, plannedArticles }] }.';

alter table public.content_coverage enable row level security;

create policy "Authenticated users can manage content_coverage"
  on public.content_coverage for all
  to authenticated
  using (true)
  with check (true);
