-- Workspace Admin tasks: global free-text list, not tied to a company.

create table if not exists public.workspace_tasks (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists workspace_tasks_created_at_idx
  on public.workspace_tasks (created_at desc);

alter table public.workspace_tasks enable row level security;

drop policy if exists "Authenticated users can manage workspace_tasks"
  on public.workspace_tasks;

create policy "Authenticated users can manage workspace_tasks"
  on public.workspace_tasks for all
  to authenticated
  using (true)
  with check (true);
