-- Manual "Mark Published" tracking for Articles library rows.
-- Set by the user after publishing via the separate CMS (no auto-sync).

alter table public.generated_articles
  add column if not exists published_at timestamptz;

comment on column public.generated_articles.published_at is
  'When the library row was manually marked published in TNV (after CMS publish). Null while status is drafted.';
