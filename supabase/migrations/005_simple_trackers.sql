-- Business Development Initiatives Tracker
create table public.business_dev_initiatives (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item text not null,
  comments text,
  owner text,
  status text,
  created_at timestamptz not null default now()
);

alter table public.business_dev_initiatives enable row level security;

create policy "Authenticated users can manage business_dev_initiatives"
  on public.business_dev_initiatives for all
  to authenticated
  using (true)
  with check (true);

-- Website Build Tasks Tracker
create table public.website_build_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  item text not null,
  comments text,
  owner text,
  status text,
  created_at timestamptz not null default now()
);

alter table public.website_build_tasks enable row level security;

create policy "Authenticated users can manage website_build_tasks"
  on public.website_build_tasks for all
  to authenticated
  using (true)
  with check (true);
