-- SEO AI Advisor v2: supporting keywords on the company profile, per-topic
-- shortlist on chat sessions. Additive only. No drops.

alter table public.company_profiles
  add column if not exists supporting_keywords jsonb not null default '[]'::jsonb;

comment on column public.company_profiles.supporting_keywords is
  'Supporting/cluster SEO keywords with metadata, pushed from the SEO Advisor shortlist. '
  'Array of { keyword, search_volume, difficulty, intent, source, added_at }.';

alter table public.chat_sessions
  add column if not exists shortlist jsonb not null default '[]'::jsonb;

comment on column public.chat_sessions.shortlist is
  'Staged keywords for this topic: array of { keyword, search_volume, difficulty, intent, source, score }.';
