-- Last time Articles Update Refresh read this company's live destination repo.
-- Also ensure last_synced_at exists (027 may not have been applied).

alter table public.companies
  add column if not exists articles_update_checked_at timestamptz;

alter table public.generated_articles
  add column if not exists last_synced_at timestamptz;

comment on column public.companies.articles_update_checked_at is
  'When Articles Update last audited live destination-repo articles for staleness.';

comment on column public.generated_articles.last_synced_at is
  'When a Where Things Stand update was committed to the destination repo for this article.';
