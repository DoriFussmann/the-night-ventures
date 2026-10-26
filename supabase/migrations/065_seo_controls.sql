-- SEO Controls: the step-1 inputs the SEO Advisor needs before it suggests
-- Core keywords. Adds columns only; nothing is dropped or renamed.
-- Reused columns: target_audience (shown as "Target searcher") and
-- scope_boundaries (shown as "Out-of-scope topics").
-- Safe to run more than once.

begin;

alter table public.company_profiles
  add column if not exists seo_primary_offer text,
  add column if not exists seo_conversion_action text,
  add column if not exists seo_commercial_url text,
  add column if not exists seo_buyer_problems text,
  add column if not exists seo_content_edge text,
  add column if not exists seo_market text,
  add column if not exists seo_language text,
  add column if not exists seo_search_competitors text,
  add column if not exists seo_publishing_pace text,
  add column if not exists seo_authority jsonb;

comment on column public.company_profiles.seo_primary_offer is
  'SEO Controls: the one offer the content exists to sell.';
comment on column public.company_profiles.seo_conversion_action is
  'SEO Controls: what a reader should do next (book a call, buy, sign up).';
comment on column public.company_profiles.seo_commercial_url is
  'SEO Controls: the page every article links to once.';
comment on column public.company_profiles.seo_buyer_problems is
  'SEO Controls: 4-7 problems the buyer has before buying, one per line.';
comment on column public.company_profiles.seo_content_edge is
  'SEO Controls: first-hand knowledge or data competitors cannot copy.';
comment on column public.company_profiles.seo_market is
  'SEO Controls: country or region the content targets.';
comment on column public.company_profiles.seo_language is
  'SEO Controls: language the content is written in.';
comment on column public.company_profiles.seo_search_competitors is
  'SEO Controls: domains that rank for our topics, one per line.';
comment on column public.company_profiles.seo_publishing_pace is
  'SEO Controls: realistic number of articles per month.';
comment on column public.company_profiles.seo_authority is
  'SEO Controls: domain strength captured automatically by the SEO Advisor.';

-- Pre-fill "Problems before buying" from the three customer fields that the
-- new form no longer shows. Only where it is still empty.
update public.company_profiles
set seo_buyer_problems = nullif(
  concat_ws(
    E'\n',
    nullif(btrim(customer_problem), ''),
    nullif(btrim(trigger_moment), ''),
    nullif(btrim(buying_criteria), '')
  ),
  ''
)
where (seo_buyer_problems is null or btrim(seo_buyer_problems) = '')
  and (
    coalesce(btrim(customer_problem), '') <> ''
    or coalesce(btrim(trigger_moment), '') <> ''
    or coalesce(btrim(buying_criteria), '') <> ''
  );

commit;
