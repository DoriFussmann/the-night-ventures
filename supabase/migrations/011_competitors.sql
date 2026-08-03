-- Competitors for company profiles: known competitor set used by Plan Cluster.

alter table public.company_profiles
  add column competitors jsonb not null default '[]'::jsonb;

comment on column public.company_profiles.competitors is
  'Array of { name: string, url: string } known competitors. Plan Cluster uses this list exclusively as the competitor set.';
