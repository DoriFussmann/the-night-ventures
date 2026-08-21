-- Positioning fields on company profiles: how the business works, why it wins,
-- and what is explicitly in or out of scope.

alter table public.company_profiles
  add column if not exists business_model text,
  add column if not exists core_value_proposition text,
  add column if not exists scope_boundaries text;

comment on column public.company_profiles.business_model is
  'How the company makes money and delivers value (product, services, marketplace, membership, etc.).';

comment on column public.company_profiles.core_value_proposition is
  'Primary reason customers choose this company over alternatives.';

comment on column public.company_profiles.scope_boundaries is
  'What is in scope for the business — and what it explicitly does not do.';
