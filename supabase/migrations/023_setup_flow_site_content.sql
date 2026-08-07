-- Add Site Content stage to Site Build Flow (between make-it-specific and seed-content).
-- Item rows are seeded by the app from seedData.js on next Site Build Flow load.

alter table public.setup_flow_stages
  drop constraint if exists setup_flow_stages_stage_key_check;

alter table public.setup_flow_stages
  add constraint setup_flow_stages_stage_key_check
  check (stage_key in (
    'setup',
    'infra-qa',
    'design',
    'deployment',
    'make-it-specific',
    'site-content',
    'seed-content',
    'connection-layer',
    'seed-qa'
  ));

alter table public.setup_flow_items
  drop constraint if exists setup_flow_items_stage_key_check;

alter table public.setup_flow_items
  add constraint setup_flow_items_stage_key_check
  check (stage_key in (
    'setup',
    'infra-qa',
    'design',
    'deployment',
    'make-it-specific',
    'site-content',
    'seed-content',
    'connection-layer',
    'seed-qa'
  ));

-- Re-order existing stages and backfill Site Content stage for companies that already have a flow.
update public.setup_flow_stages set order_index = 6 where stage_key = 'seed-content';
update public.setup_flow_stages set order_index = 7 where stage_key = 'connection-layer';
update public.setup_flow_stages set order_index = 8 where stage_key = 'seed-qa';

insert into public.setup_flow_stages (company_id, stage_key, order_index, status)
select distinct company_id, 'site-content', 5, 'open'
from public.setup_flow_stages
on conflict (company_id, stage_key) do update
  set order_index = excluded.order_index;
