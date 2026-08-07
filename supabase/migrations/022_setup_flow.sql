-- Replace Site Build Flow placeholder tables with Setup Flow schema.
-- The Route was client-only (localStorage); it had no Supabase tables to drop.

drop table if exists public.site_build_checklist_items;
drop table if exists public.site_build_stages;

create table public.setup_flow_stages (
  company_id uuid not null references public.companies (id) on delete cascade,
  stage_key text not null
    check (stage_key in (
      'setup',
      'infra-qa',
      'design',
      'deployment',
      'make-it-specific',
      'seed-content',
      'connection-layer',
      'seed-qa'
    )),
  order_index int not null,
  status text not null default 'open'
    check (status in ('open', 'wip', 'done')),
  updated_at timestamptz not null default now(),
  primary key (company_id, stage_key)
);

comment on table public.setup_flow_stages is
  'Per-company status for Site Build Flow stages. Status is set manually (not derived from item completion).';

create index setup_flow_stages_company_id_idx
  on public.setup_flow_stages (company_id);

alter table public.setup_flow_stages enable row level security;

create policy "Authenticated users can manage setup_flow_stages"
  on public.setup_flow_stages for all
  to authenticated
  using (true)
  with check (true);

create table public.setup_flow_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  stage_key text not null
    check (stage_key in (
      'setup',
      'infra-qa',
      'design',
      'deployment',
      'make-it-specific',
      'seed-content',
      'connection-layer',
      'seed-qa'
    )),
  item_key text not null,
  title text not null,
  description text not null default '',
  prompts jsonb not null default '[]'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'wip', 'done')),
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, stage_key, item_key)
);

comment on table public.setup_flow_items is
  'Per-company Site Build Flow checklist items. Predefined items are seeded on first open.';

comment on column public.setup_flow_items.prompts is
  'JSON array of { label, text } copy-paste prompts for the item.';

create index setup_flow_items_company_stage_idx
  on public.setup_flow_items (company_id, stage_key);

alter table public.setup_flow_items enable row level security;

create policy "Authenticated users can manage setup_flow_items"
  on public.setup_flow_items for all
  to authenticated
  using (true)
  with check (true);
