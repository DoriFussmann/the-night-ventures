-- Persist the last Articles Update Refresh payload next to last-checked.

alter table public.companies
  add column if not exists articles_update_snapshot jsonb;

comment on column public.companies.articles_update_snapshot is
  'Last Articles Update Refresh result (articles, buckets, counts) for this company.';
