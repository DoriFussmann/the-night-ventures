-- Global reference documents (not company-specific)
create table public.general_documents (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  content text,
  updated_at timestamptz not null default now()
);

alter table public.general_documents enable row level security;

create policy "Authenticated users can manage general_documents"
  on public.general_documents for all
  to authenticated
  using (true)
  with check (true);

insert into public.general_documents (key, title, content) values
  ('site_build_prompt', 'Build Prompt', ''),
  ('site_build_checklist', 'QA Checklist', '');
