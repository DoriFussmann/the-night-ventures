-- Custom field definitions (global names used as keys in company_profiles.custom_fields)
create table public.company_custom_fields (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.company_custom_fields enable row level security;

create policy "Authenticated users can manage company_custom_fields"
  on public.company_custom_fields for all
  to authenticated
  using (true)
  with check (true);

-- One profile row per company
create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  domain text,
  product_name text,
  abstract text,
  short_description text,
  medium_description text,
  long_description text,
  custom_fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.company_profiles enable row level security;

create policy "Authenticated users can manage company_profiles"
  on public.company_profiles for all
  to authenticated
  using (true)
  with check (true);
