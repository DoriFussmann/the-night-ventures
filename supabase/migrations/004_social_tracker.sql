-- Social media / shop accounts tracked per company
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  type text not null default 'Other' check (type in ('Social Media', 'Digital Store', 'Other')),
  url text,
  username text,
  access_details text,
  status text,
  comments text,
  created_at timestamptz not null default now()
);

alter table public.social_accounts enable row level security;

create policy "Authenticated users can manage social_accounts"
  on public.social_accounts for all
  to authenticated
  using (true)
  with check (true);

-- Freeform notes for the social tracker (per company)
create table public.social_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.social_notes enable row level security;

create policy "Authenticated users can manage social_notes"
  on public.social_notes for all
  to authenticated
  using (true)
  with check (true);
