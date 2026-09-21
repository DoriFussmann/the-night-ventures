-- Workspace Admin future projects: named notes, not tied to a company.

create table if not exists public.workspace_future_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists workspace_future_projects_created_at_idx
  on public.workspace_future_projects (created_at desc);

alter table public.workspace_future_projects enable row level security;

drop policy if exists "Authenticated users can manage workspace_future_projects"
  on public.workspace_future_projects;

create policy "Authenticated users can manage workspace_future_projects"
  on public.workspace_future_projects for all
  to authenticated
  using (true)
  with check (true);
