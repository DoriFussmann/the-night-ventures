-- AEO Playbook → Login & Access: free-form logins per company (title, username,
-- password, comments). Passwords are stored encrypted (AES-256-GCM) by the
-- /api/company-logins function with a key that lives only in Vercel
-- (LOGINS_ENCRYPTION_KEY); this table never holds a readable password.
-- RLS is on with no policies: only the service role (the server function) can
-- read or write it. The browser cannot query it directly.
-- Additive only. Safe to re-run.

create table if not exists public.company_logins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null default '',
  username text not null default '',
  password_enc text not null default '',
  comments text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_logins_company_idx
  on public.company_logins (company_id, sort, created_at);

comment on table public.company_logins is
  'AEO Playbook Login & Access. password_enc is AES-256-GCM ciphertext written by /api/company-logins; never plain text.';

alter table public.company_logins enable row level security;
revoke all on public.company_logins from anon, authenticated;
