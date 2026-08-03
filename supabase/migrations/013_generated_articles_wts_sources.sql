-- Sources used in Where Things Stand (manual externalLinks reference).

alter table public.generated_articles
  add column where_things_stand_sources jsonb not null default '[]'::jsonb;

comment on column public.generated_articles.where_things_stand_sources is
  'Array of { url, note } from generation — not written into .md frontmatter; for manual externalLinks.';
