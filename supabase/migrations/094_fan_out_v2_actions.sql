-- 094: Fan-Out Engine v2: the five actions of step 6, set by rule.
-- Additive: one new column, and two more allowed values for fo_cards.action. No row is changed.
--
-- Rollback (only while no card uses the two new actions):
--   alter table public.fo_cards drop constraint if exists fo_cards_action_check;
--   alter table public.fo_cards add constraint fo_cards_action_check check (action in ('', 'new_article', 'fix_existing', 'off_site'));
--   alter table public.fo_query_groups drop column if exists recommendation;

-- A "who should I use" group: its searches look for providers, tools or lists of them, not for facts.
alter table public.fo_query_groups
  add column if not exists recommendation boolean not null default false;

alter table public.fo_cards drop constraint if exists fo_cards_action_check;
alter table public.fo_cards add constraint fo_cards_action_check
  check (action in ('', 'new_article', 'comparison_article', 'commercial_page', 'fix_existing', 'off_site'));
