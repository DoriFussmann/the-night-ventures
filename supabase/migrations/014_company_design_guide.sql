-- Design Guidelines on company profiles: full pasted Design Guide.md (raw) plus
-- AI-distilled abstract used as brand context by other tools.

alter table public.company_profiles
  add column design_guide_raw text,
  add column design_guide_abstract text;

comment on column public.company_profiles.design_guide_raw is
  'Full pasted Design Guide.md markdown, kept for reference and re-abstraction.';

comment on column public.company_profiles.design_guide_abstract is
  'AI-distilled Design Guide summary used as brand-context input by other tools.';
