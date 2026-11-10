-- AEO Playbook, Company tab: commercial and sales fields (how the company sells
-- and what limits it). Internal context for the ICP and Persona work; articles
-- do not read them. Additive and nullable. Safe to re-run.

alter table public.company_profiles
  add column if not exists gtm_deal_size text,
  add column if not exists gtm_sales_motion text,
  add column if not exists gtm_customer_evidence text,
  add column if not exists gtm_where_to_find text,
  add column if not exists gtm_constraints text;
