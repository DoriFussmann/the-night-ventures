-- Add Seed Articles Content between Code Setup and Deployment.
-- Checklist items are seeded by the app from seedData.js on the next Build Blueprint load.

update public.setup_flow_stages set order_index = 6 where stage_key = 'seed-qa';
update public.setup_flow_stages set order_index = 5 where stage_key = 'links-wiring';
update public.setup_flow_stages set order_index = 4 where stage_key = 'connection-layer';
update public.setup_flow_stages set order_index = 3 where stage_key = 'site-activation';
update public.setup_flow_stages set order_index = 2 where stage_key = 'deployment';

alter table public.setup_flow_stages
  drop constraint if exists setup_flow_stages_stage_key_check;

alter table public.setup_flow_stages
  add constraint setup_flow_stages_stage_key_check
  check (stage_key in (
    'code-setup',
    'seed-articles-content',
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
    'seed-articles-content',
    'design',
    'deployment',
    'site-activation',
    'connection-layer',
    'links-wiring',
    'seed-qa'
  ));

insert into public.setup_flow_stages (company_id, stage_key, order_index, status)
select distinct company_id, 'seed-articles-content', 1, 'open'
from public.setup_flow_stages
on conflict (company_id, stage_key) do update
  set order_index = excluded.order_index;
