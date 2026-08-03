-- Saved full article drafts from Article Generator (library view).
-- Independent of content_coverage (planning/status) and of .md download workflow.

create table public.generated_articles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,

  -- Plan / tracking
  pillar_keyword text not null default '',
  supporting_keyword text,
  type text not null default 'flex'
    check (type in ('comprehensive', 'howto', 'comparison', 'faq', 'flex')),
  target_keyword text not null default '',
  status text not null default 'drafted'
    check (status in ('drafted', 'published')),

  -- Frontmatter
  title text not null default '',
  description text not null default '',
  slug text not null,
  date text,
  updated_date text,
  author text,
  category text,
  tags jsonb not null default '[]'::jsonb,
  image_alt text,
  keywords jsonb not null default '[]'::jsonb,
  draft boolean not null default true,
  internal_links jsonb not null default '[]'::jsonb,
  external_links jsonb not null default '[]'::jsonb,
  faqs jsonb not null default '[]'::jsonb,

  -- Body (markdown)
  body text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (company_id, slug)
);

comment on table public.generated_articles is
  'Full saved article drafts (frontmatter + body) from Article Generator, keyed by company + slug.';

create index generated_articles_company_id_idx
  on public.generated_articles (company_id);

create index generated_articles_pillar_keyword_idx
  on public.generated_articles (pillar_keyword);

create index generated_articles_type_idx
  on public.generated_articles (type);

create index generated_articles_title_idx
  on public.generated_articles (title);

alter table public.generated_articles enable row level security;

create policy "Authenticated users can manage generated_articles"
  on public.generated_articles for all
  to authenticated
  using (true)
  with check (true);
