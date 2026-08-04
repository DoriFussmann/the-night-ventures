-- Site Build Flow: one-time (or once-per-new-site) template → live tracker.
-- Stages are manually statused; checklist items are seeded per company on first open.

create table public.site_build_stages (
  company_id uuid not null references public.companies (id) on delete cascade,
  stage_key text not null
    check (stage_key in (
      'infra-scaffold',
      'environment-deploy',
      'design-system',
      'template-to-specific',
      'content-foundations',
      'content-production-live'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'in-progress', 'done')),
  updated_at timestamptz not null default now(),
  primary key (company_id, stage_key)
);

comment on table public.site_build_stages is
  'Per-company status for the six fixed Site Build Flow stages. Status is set manually (not derived from checklist completion).';

create index site_build_stages_company_id_idx
  on public.site_build_stages (company_id);

alter table public.site_build_stages enable row level security;

create policy "Authenticated users can manage site_build_stages"
  on public.site_build_stages for all
  to authenticated
  using (true)
  with check (true);

create table public.site_build_checklist_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  stage_key text not null
    check (stage_key in (
      'infra-scaffold',
      'environment-deploy',
      'design-system',
      'template-to-specific',
      'content-foundations',
      'content-production-live'
    )),
  item_key text,
  label text not null,
  status text not null default 'pending'
    check (status in ('pending', 'done')),
  note text,
  proof_url text,
  is_custom boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.site_build_checklist_items is
  'Per-company Site Build Flow checklist rows. Predefined items are seeded on first open (item_key set, is_custom false); custom items have item_key null and is_custom true.';

comment on column public.site_build_checklist_items.item_key is
  'Stable key for predefined seed items; null for user-added custom items.';

comment on column public.site_build_checklist_items.proof_url is
  'Optional URL/text proof (e.g. Lighthouse report, deploy URL). No file uploads.';

create index site_build_checklist_items_company_stage_idx
  on public.site_build_checklist_items (company_id, stage_key);

create unique index site_build_checklist_items_predefined_unique_idx
  on public.site_build_checklist_items (company_id, stage_key, item_key)
  where item_key is not null;

alter table public.site_build_checklist_items enable row level security;

create policy "Authenticated users can manage site_build_checklist_items"
  on public.site_build_checklist_items for all
  to authenticated
  using (true)
  with check (true);
