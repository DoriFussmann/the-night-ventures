-- AEO Playbook, Company tab: remove the retired Company Intelligence fields.
-- Nothing reads these 43 columns; their content lives in Brand Facts and the ICP.
-- A full snapshot of every company_profiles row is kept first in
-- archive.company_profiles_20261111 (not exposed through the API). Drop that
-- table when it is no longer wanted. Safe to re-run.

create schema if not exists archive;

create table if not exists archive.company_profiles_20261111 as
  select p.company_id, c.name as company_name, to_jsonb(p) as row_data, now() as archived_at
  from public.company_profiles p
  left join public.companies c on c.id = p.company_id;

alter table public.company_profiles
  drop column if exists abstract,
  drop column if exists short_description,
  drop column if exists long_description,
  drop column if exists medium_description,
  drop column if exists business_model,
  drop column if exists core_value_proposition,
  drop column if exists differentiation,
  drop column if exists market_category,
  drop column if exists how_it_works,
  drop column if exists brand_voice,
  drop column if exists brand_feel,
  drop column if exists target_audience,
  drop column if exists seo_primary_offer,
  drop column if exists seo_buyer_problems,
  drop column if exists seo_content_edge,
  drop column if exists seo_conversion_action,
  drop column if exists seo_commercial_url,
  drop column if exists seo_search_competitors,
  drop column if exists scope_boundaries,
  drop column if exists location_markets,
  drop column if exists contact_email,
  drop column if exists founded_date,
  drop column if exists legal_name,
  drop column if exists company_stage,
  drop column if exists customer_problem,
  drop column if exists buying_criteria,
  drop column if exists customer_outcome,
  drop column if exists commercial_model,
  drop column if exists messaging_hierarchy,
  drop column if exists competitive_position,
  drop column if exists market_dynamics,
  drop column if exists brand_references,
  drop column if exists brand_boundaries,
  drop column if exists reasons_to_believe,
  drop column if exists results_proof,
  drop column if exists trust_signals,
  drop column if exists marketing_objectives,
  drop column if exists growth_priorities,
  drop column if exists customer_acquisition,
  drop column if exists competitors,
  drop column if exists services,
  drop column if exists team_members,
  drop column if exists social_links;
