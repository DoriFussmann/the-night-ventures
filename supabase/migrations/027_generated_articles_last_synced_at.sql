-- Timestamp of the last CMS confirmation-receipt import for this article.

alter table public.generated_articles
  add column if not exists last_synced_at timestamptz;

comment on column public.generated_articles.last_synced_at is
  'When a CMS confirmation receipt was imported for this article (Articles Update sync).';
