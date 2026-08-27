-- Destination GitHub repo per company for Publish to Site.
-- Nullable so existing companies stay valid until mapped in Company Data.

alter table public.companies
  add column if not exists github_owner text,
  add column if not exists github_repo text,
  add column if not exists github_token_key text;

comment on column public.companies.github_owner is
  'GitHub org or user that owns the destination site repo.';

comment on column public.companies.github_repo is
  'Destination repository name (not owner/repo).';

comment on column public.companies.github_token_key is
  'Suffix for server env var GITHUB_TOKEN_<key>, e.g. HEYRUPERT.';
