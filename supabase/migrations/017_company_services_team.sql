-- First-class services/products and team members on company profiles.
-- Used by Company Data UI and Specific Prompt (Personalize) auto-fill.

alter table public.company_profiles
  add column if not exists services jsonb not null default '[]'::jsonb;

alter table public.company_profiles
  add column if not exists team_members jsonb not null default '[]'::jsonb;

comment on column public.company_profiles.services is
  'Array of { title, summary, detail } services/products. detail is optional.';

comment on column public.company_profiles.team_members is
  'Array of { name, role, bio, credentials, same_as: string[] }. credentials and same_as are optional.';
