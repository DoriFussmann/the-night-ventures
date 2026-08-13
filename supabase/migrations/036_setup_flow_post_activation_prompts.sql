-- Add Post Activation Prompts stage to Site Build Flow (between connection-layer and links-wiring).
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
    'site-activation',
    'connection-layer',
    'post-activation-prompts',
    'links-wiring',
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
    'site-activation',
    'connection-layer',
    'post-activation-prompts',
    'links-wiring',
    'seed-qa'
  ));

-- Re-order Links Wiring and Initial Seed Content QA, then backfill the new stage.
update public.setup_flow_stages set order_index = 7 where stage_key = 'links-wiring';
update public.setup_flow_stages set order_index = 8 where stage_key = 'seed-qa';

insert into public.setup_flow_stages (company_id, stage_key, order_index, status)
select distinct company_id, 'post-activation-prompts', 6, 'open'
from public.setup_flow_stages
on conflict (company_id, stage_key) do update
  set order_index = excluded.order_index;
