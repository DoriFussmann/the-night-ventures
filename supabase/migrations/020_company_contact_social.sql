-- Contact email and social links on company profiles.
-- Used by Company Data UI and Specific Prompt (Personalize) config auto-fill.

alter table public.company_profiles
  add column if not exists contact_email text;

alter table public.company_profiles
  add column if not exists social_links jsonb not null default '[]'::jsonb;

comment on column public.company_profiles.contact_email is
  'Primary public contact email for site identity config (CONTACT_EMAIL).';

comment on column public.company_profiles.social_links is
  'Array of { label, url } social profiles for SAME_AS / social links config.';
