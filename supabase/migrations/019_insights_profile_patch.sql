-- Optional structured profile update suggestion for insights "Update Profile" action.
alter table public.insights
  add column if not exists profile_patch jsonb;

comment on column public.insights.profile_patch is
  'Optional { field, value } for applying a company_profiles update when the user confirms.';
