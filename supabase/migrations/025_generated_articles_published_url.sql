-- Live URL copied from Topic Generator coverage when an article is marked published.

alter table public.generated_articles
  add column if not exists published_url text;

comment on column public.generated_articles.published_url is
  'Live article URL from Topic Generator mark-published; null while status is drafted.';
