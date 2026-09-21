-- Replace Setup and Initial Infrastructure Build QA with a single Code Setup stage.
-- Checklist items are seeded by the app from seedData.js on the next Build Blueprint load.

delete from public.setup_flow_items
where stage_key in ('setup', 'infra-qa');

delete from public.setup_flow_stages
where stage_key in ('setup', 'infra-qa');

update public.setup_flow_stages set order_index = 1 where stage_key = 'deployment';
update public.setup_flow_stages set order_index = 2 where stage_key = 'site-activation';
update public.setup_flow_stages set order_index = 3 where stage_key = 'connection-layer';
update public.setup_flow_stages set order_index = 4 where stage_key = 'links-wiring';
update public.setup_flow_stages set order_index = 5 where stage_key = 'seed-qa';

alter table public.setup_flow_stages
  drop constraint if exists setup_flow_stages_stage_key_check;

alter table public.setup_flow_stages
  add constraint setup_flow_stages_stage_key_check
  check (stage_key in (
    'code-setup',
    'design',
    'deployment',
    'site-activation',
    'connection-layer',
    'links-wiring',
    'seed-qa'
  ));

alter table public.setup_flow_items
  drop constraint if exists setup_flow_items_stage_key_check;

alter table public.setup_flow_items
  add constraint setup_flow_items_stage_key_check
  check (stage_key in (
    'code-setup',
    'design',
    'deployment',
    'site-activation',
    'connection-layer',
    'links-wiring',
    'seed-qa'
  ));
