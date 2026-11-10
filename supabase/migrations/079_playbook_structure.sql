-- AEO Playbook structure: one home per fact.
--   * Proof moves from Brand Facts to the Company tab (Customer evidence & proof,
--     company_profiles.gtm_customer_evidence).
--   * Image style moves from Brand Facts to the Company tab (company_profiles.image_style).
--   * The unused fit_* keys are dropped from Brand Facts (never filled).
-- Existing values are copied before the old keys are removed. Safe to re-run.

alter table public.company_profiles
  add column if not exists image_style text;

update public.company_profiles p
set
  gtm_customer_evidence = coalesce(nullif(p.gtm_customer_evidence, ''), nullif(pb.brand_facts->>'proof', '')),
  image_style = coalesce(nullif(p.image_style, ''), nullif(pb.brand_facts->>'image_style', ''))
from public.aeo_playbook pb
where pb.company_id = p.company_id
  and (pb.brand_facts ? 'proof' or pb.brand_facts ? 'image_style');

update public.aeo_playbook pb
set brand_facts = pb.brand_facts
  - 'proof' - 'image_style'
  - 'fit_size_band' - 'fit_ability_to_pay' - 'fit_floor_ceiling'
  - 'fit_problem_cost' - 'fit_buying_window' - 'fit_signals' - 'fit_environment'
where exists (select 1 from public.company_profiles p where p.company_id = pb.company_id);
