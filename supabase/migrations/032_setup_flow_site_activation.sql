-- Merge make-it-specific + site-content + seed-content into site-activation.
-- Item status and notes are preserved by moving rows. Combined stage status is
-- conservative: done only if all three old stages were done, or all migrated
-- items are done; otherwise wip if any of those had progress; else open.
-- Naive max(status) is not used — one done stage among two open ones would
-- incorrectly mark the combined stage done.

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
    'setup',
    'infra-qa',
    'design',
    'deployment',
    'make-it-specific',
    'site-content',
    'seed-content',
    'site-activation',
    'connection-layer',
    'links-wiring',
    'seed-qa'
  ));

-- Disambiguate the two commit-and-push items before they share a stage_key.
update public.setup_flow_items
set item_key = 'commit-and-push-seed', updated_at = now()
where stage_key = 'seed-content'
  and item_key = 'commit-and-push';

delete from public.setup_flow_items
where stage_key = 'seed-content'
  and item_key = 'wire-internal-and-external-links';

insert into public.setup_flow_stages (company_id, stage_key, order_index, status)
select distinct company_id, 'site-activation', 4, 'open'
from public.setup_flow_stages
on conflict (company_id, stage_key) do update
  set order_index = excluded.order_index;

update public.setup_flow_items
set
  sort_order = case stage_key
    when 'make-it-specific' then sort_order
    when 'site-content' then sort_order + 5
    when 'seed-content' then
      case item_key
        when 'add-pillar-keywords' then 11
        when 'determine-supporting-keywords' then 12
        when 'pull-keyword-data-via-keyword-slip' then 13
        when 'plan-both-clusters' then 14
        when 'save-and-download-both-clusters' then 15
        when 'plan-and-save-both-pillar-articles' then 16
        when 'generate-all-articles' then 17
        when 'generate-hero-images' then 18
        when 'add-real-team-member-in-cms' then 19
        when 'publish-all-articles-through-cms' then 20
        when 'commit-and-push-seed' then 21
        else 11 + sort_order
      end
    else sort_order
  end,
  stage_key = 'site-activation',
  updated_at = now()
where stage_key in ('make-it-specific', 'site-content', 'seed-content');

with old_stages as (
  select
    company_id,
    count(*) as n,
    bool_and(status = 'done') as all_done,
    bool_or(status in ('wip', 'done')) as any_progress
  from public.setup_flow_stages
  where stage_key in ('make-it-specific', 'site-content', 'seed-content')
  group by company_id
),
new_items as (
  select
    company_id,
    count(*) as n,
    bool_and(status = 'done') as all_done,
    bool_or(status in ('wip', 'done')) as any_progress
  from public.setup_flow_items
  where stage_key = 'site-activation'
  group by company_id
),
mapped as (
  select
    s.company_id,
    case
      when coalesce(os.all_done, false) and coalesce(os.n, 0) = 3 then 'done'
      when coalesce(ni.all_done, false) and coalesce(ni.n, 0) > 0 then 'done'
      when coalesce(os.any_progress, false) or coalesce(ni.any_progress, false) then 'wip'
      else 'open'
    end as next_status
  from public.setup_flow_stages s
  left join old_stages os on os.company_id = s.company_id
  left join new_items ni on ni.company_id = s.company_id
  where s.stage_key = 'site-activation'
)
update public.setup_flow_stages s
set status = mapped.next_status, updated_at = now()
from mapped
where s.company_id = mapped.company_id
  and s.stage_key = 'site-activation';

delete from public.setup_flow_stages
where stage_key in ('make-it-specific', 'site-content', 'seed-content');

update public.setup_flow_items
set sort_order = 2, updated_at = now()
where stage_key = 'connection-layer'
  and item_key = 'verify-bing-webmaster-tools';

update public.setup_flow_items
set sort_order = 3, updated_at = now()
where stage_key = 'connection-layer'
  and item_key = 'submit-sitemap-bing-webmaster-tools';

update public.setup_flow_stages set order_index = 5 where stage_key = 'connection-layer';
update public.setup_flow_stages set order_index = 6 where stage_key = 'links-wiring';
update public.setup_flow_stages set order_index = 7 where stage_key = 'seed-qa';

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
    'links-wiring',
    'seed-qa'
  ));
