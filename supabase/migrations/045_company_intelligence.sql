-- Company Intelligence: add brief fields, map existing copy, keep every
-- populated column and specialized SEO / publishing / operational value.
-- Safe to run on production. No drops.

-- ---------------------------------------------------------------------------
-- 1) New brief columns (all nullable text; empty is allowed)
-- ---------------------------------------------------------------------------
alter table public.company_profiles
  add column if not exists legal_name text,
  add column if not exists founded_date text,
  add column if not exists location_markets text,
  add column if not exists company_stage text,
  add column if not exists customer_problem text,
  add column if not exists trigger_moment text,
  add column if not exists buying_criteria text,
  add column if not exists how_it_works text,
  add column if not exists customer_outcome text,
  add column if not exists commercial_model text,
  add column if not exists differentiation text,
  add column if not exists messaging_hierarchy text,
  add column if not exists market_category text,
  add column if not exists competitive_position text,
  add column if not exists market_dynamics text,
  add column if not exists brand_references text,
  add column if not exists brand_boundaries text,
  add column if not exists reasons_to_believe text,
  add column if not exists results_proof text,
  add column if not exists trust_signals text,
  add column if not exists marketing_objectives text,
  add column if not exists growth_priorities text,
  add column if not exists customer_acquisition text,
  add column if not exists learnings_constraints text;

comment on column public.company_profiles.legal_name is
  'Legal / registered company name for Company Intelligence.';
comment on column public.company_profiles.founded_date is
  'Founded or incorporation date (free text: year or full date).';
comment on column public.company_profiles.location_markets is
  'HQ, regions, or markets served.';
comment on column public.company_profiles.company_stage is
  'Stage, maturity, size, launch status, or other current-context notes.';
comment on column public.company_profiles.customer_problem is
  'Problems, frustrations, or unmet needs the ideal customer is trying to solve.';
comment on column public.company_profiles.trigger_moment is
  'What typically causes the customer to start looking.';
comment on column public.company_profiles.buying_criteria is
  'What matters most when choosing a solution, including objections.';
comment on column public.company_profiles.how_it_works is
  'How the offering works from the customer''s perspective.';
comment on column public.company_profiles.customer_outcome is
  'Outcomes and benefits the customer actually receives.';
comment on column public.company_profiles.commercial_model is
  'Pricing, packaging, contracting, onboarding, or commitment.';
comment on column public.company_profiles.differentiation is
  'What makes the company meaningfully different from alternatives.';
comment on column public.company_profiles.messaging_hierarchy is
  'The three most important things someone should remember.';
comment on column public.company_profiles.market_category is
  'Narrative market / category context for the brief.';
comment on column public.company_profiles.competitive_position is
  'Why the right customer would choose this company, including limitations.';
comment on column public.company_profiles.market_dynamics is
  'Relevant trends, behaviors, technology, or regulatory forces.';
comment on column public.company_profiles.brand_references is
  'Reference brands/publications and what to borrow from each.';
comment on column public.company_profiles.brand_boundaries is
  'What the brand should avoid.';
comment on column public.company_profiles.reasons_to_believe is
  'Why a prospective customer should believe the claims.';
comment on column public.company_profiles.results_proof is
  'Results, testimonials, case studies, or demonstrated outcomes.';
comment on column public.company_profiles.trust_signals is
  'Customers, partners, certifications, press, awards, investors, affiliations.';
comment on column public.company_profiles.marketing_objectives is
  'Commercial objectives and marketing''s role.';
comment on column public.company_profiles.growth_priorities is
  'Products, segments, markets, or geographies that should get attention.';
comment on column public.company_profiles.customer_acquisition is
  'How customers discover, evaluate, and buy today.';
comment on column public.company_profiles.learnings_constraints is
  'What has worked or not, plus meaningful constraints.';

-- ---------------------------------------------------------------------------
-- 2) Map existing fields into the new structure WITHOUT overwriting
--    populated destinations and WITHOUT deleting source columns.
--
-- Reused in place (no copy):
--   short_description          → What We Do
--   long_description           → Story & Mission
--   business_model             → Business Model
--   target_audience            → Ideal Customer
--   services                   → Products & Services
--   core_value_proposition     → Core Value Proposition
--   scope_boundaries           → What We Are / Are Not
--   competitors                → Competitors & Alternatives (structured)
--   brand_feel                 → Brand Personality
--   brand_voice                → Voice & Tone
--   team_members               → Team & Founder Credibility
--   domain, contact_email, social_links, companies.name
--
-- Left in place as specialized / leftover (not dropped):
--   product_name, abstract, medium_description, core_keywords,
--   design_guide_*, brand color/wordmark tokens, custom_fields,
--   company_industries, github_* on companies
-- ---------------------------------------------------------------------------

-- Lift common custom_fields into first-class brief columns when empty.
-- Keys are matched case-insensitively. Source custom_fields keys are kept.
update public.company_profiles p
set legal_name = nullif(trim(kv.value), '')
from (
  select p2.id, e.value
  from public.company_profiles p2
  cross join lateral jsonb_each_text(coalesce(p2.custom_fields, '{}'::jsonb)) e
  where lower(trim(e.key)) in ('legal name', 'legal_name')
) kv
where kv.id = p.id
  and coalesce(trim(p.legal_name), '') = ''
  and nullif(trim(kv.value), '') is not null;

update public.company_profiles p
set founded_date = nullif(trim(kv.value), '')
from (
  select p2.id, e.value
  from public.company_profiles p2
  cross join lateral jsonb_each_text(coalesce(p2.custom_fields, '{}'::jsonb)) e
  where lower(trim(e.key)) in (
    'founded year',
    'founded',
    'founded / incorporation date',
    'incorporation date'
  )
) kv
where kv.id = p.id
  and coalesce(trim(p.founded_date), '') = ''
  and nullif(trim(kv.value), '') is not null;

update public.company_profiles p
set location_markets = nullif(trim(kv.value), '')
from (
  select p2.id, e.value
  from public.company_profiles p2
  cross join lateral jsonb_each_text(coalesce(p2.custom_fields, '{}'::jsonb)) e
  where lower(trim(e.key)) in (
    'official address',
    'location',
    'location / markets served',
    'address'
  )
) kv
where kv.id = p.id
  and coalesce(trim(p.location_markets), '') = ''
  and nullif(trim(kv.value), '') is not null;

-- If business_model / CVP / scope were only in custom_fields, lift them
-- into the first-class columns when those columns are still empty.
update public.company_profiles p
set business_model = nullif(trim(coalesce(
  p.custom_fields->>'business model',
  p.custom_fields->>'Business Model'
)), '')
where coalesce(trim(p.business_model), '') = ''
  and nullif(trim(coalesce(
    p.custom_fields->>'business model',
    p.custom_fields->>'Business Model'
  )), '') is not null;

update public.company_profiles p
set core_value_proposition = nullif(trim(coalesce(
  p.custom_fields->>'core value proposition',
  p.custom_fields->>'Core Value Proposition'
)), '')
where coalesce(trim(p.core_value_proposition), '') = ''
  and nullif(trim(coalesce(
    p.custom_fields->>'core value proposition',
    p.custom_fields->>'Core Value Proposition'
  )), '') is not null;

update public.company_profiles p
set scope_boundaries = nullif(trim(coalesce(
  p.custom_fields->>'scope / boundaries',
  p.custom_fields->>'Scope / Boundaries',
  p.custom_fields->>'scope boundaries'
)), '')
where coalesce(trim(p.scope_boundaries), '') = ''
  and nullif(trim(coalesce(
    p.custom_fields->>'scope / boundaries',
    p.custom_fields->>'Scope / Boundaries',
    p.custom_fields->>'scope boundaries'
  )), '') is not null;

-- What We Do reuses short_description. If that is empty, copy abstract
-- (tagline / short positioning) so existing Rupert copy surfaces in 01.
-- Does not overwrite short_description. Does not delete abstract.
update public.company_profiles
set short_description = abstract
where coalesce(trim(short_description), '') = ''
  and coalesce(trim(abstract), '') <> '';

-- Story & Mission reuses long_description. If that is empty, copy the
-- medium description rather than inventing copy.
update public.company_profiles
set long_description = medium_description
where coalesce(trim(long_description), '') = ''
  and coalesce(trim(medium_description), '') <> '';

-- Market & Category: seed from linked industry names when the new
-- narrative field is empty. company_industries rows are left intact.
update public.company_profiles p
set market_category = src.names
from (
  select
    ci.company_id,
    string_agg(i.name, E'\n' order by i.name) as names
  from public.company_industries ci
  join public.industries i on i.id = ci.industry_id
  group by ci.company_id
) src
where src.company_id = p.company_id
  and coalesce(trim(p.market_category), '') = ''
  and coalesce(trim(src.names), '') <> '';

-- MANUAL REVIEW
-- * company_stage, customer_problem, trigger_moment,
--   buying_criteria, how_it_works, customer_outcome, commercial_model,
--   differentiation, messaging_hierarchy, competitive_position,
--   market_dynamics, brand_references, brand_boundaries,
--   reasons_to_believe, results_proof, trust_signals, and the Growth
--   fields have no reliable source column. They stay empty until a
--   human fills them. Do not generate copy here.
-- * product_name, abstract (after the short_description fallback),
--   medium_description (after the long_description fallback),
--   core_keywords, design_guide_*, brand color tokens, custom_fields,
--   and github_* are intentionally preserved and not dropped.
-- * If a company used custom_fields for something that now has a
--   first-class column, the custom_fields value is copied when the
--   column was empty, but the custom key is NOT deleted.
-- * Rupert specifically: custom_fields currently includes
--   "Legal Name", "Incorporation Date", "Official Address", and "EIN".
--   The first three map into legal_name / founded_date / location_markets.
--   EIN is operational metadata and stays only in custom_fields.
