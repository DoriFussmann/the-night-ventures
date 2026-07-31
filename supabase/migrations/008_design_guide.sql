-- One design guide per company
create table public.design_guides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.design_guides enable row level security;

create policy "Authenticated users can manage design_guides"
  on public.design_guides for all
  to authenticated
  using (true)
  with check (true);

-- Reusable design guide themes (global, not company-specific)
create table public.design_guide_themes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.design_guide_themes enable row level security;

create policy "Authenticated users can manage design_guide_themes"
  on public.design_guide_themes for all
  to authenticated
  using (true)
  with check (true);
