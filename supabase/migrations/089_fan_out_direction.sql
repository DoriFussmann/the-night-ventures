-- 089: Fan-Out Engine: a direction per situation, who is named per topic, and the comparison-article action.
-- Additive: two columns on fo_topics, one on fo_situations, and one more allowed value for fo_topics.action.

-- What the prompts ask for: names of providers ("recommend"), a next step ("advise"), or an explanation ("explain").
alter table public.fo_situations
  add column if not exists direction text not null default 'recommend'
    check (direction in ('recommend', 'advise', 'explain'));

alter table public.fo_topics
  add column if not exists recommendation boolean not null default false,   -- true: a "who or what should I use" topic
  add column if not exists named jsonb not null default '[]'::jsonb;        -- [{ name, runs, tracked, own }]: who the answers name

-- A recommendation topic can be pushed as a comparison article, when the user chooses to.
alter table public.fo_topics drop constraint if exists fo_topics_action_check;
alter table public.fo_topics add constraint fo_topics_action_check
  check (action in ('won', 'page_fix', 'improve_page', 'commercial_page', 'existing_group', 'new_article', 'comparison_article', 'skip'));
