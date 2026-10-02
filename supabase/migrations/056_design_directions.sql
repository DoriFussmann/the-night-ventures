-- Design contract v3: six design directions plus two type overrides.
-- Old v2 template ids stay valid so existing rows keep loading (the Design page
-- shows them as legacy until a new direction is generated).

alter table public.company_profiles
  add column if not exists force_inter boolean not null default false,
  add column if not exists force_no_bold boolean not null default false;

alter table public.company_profiles
  drop constraint if exists company_profiles_design_template_check;

alter table public.company_profiles
  add constraint company_profiles_design_template_check
  check (
    design_template is null
    or design_template in (
      'alpine',
      'heritage',
      'pristine',
      'kinetic',
      'tactile',
      'nocturne',
      -- legacy v2 ids
      'slate',
      'midnight',
      'press',
      'daylight',
      'night',
      'field'
    )
  );

comment on column public.company_profiles.design_template is
  'Selected design direction: alpine, heritage, pristine, kinetic, tactile or nocturne. Legacy v2 ids (slate, midnight, press, daylight, night, field) may remain on old rows. Null until picked.';

comment on column public.company_profiles.force_inter is
  'Design override: replace the direction fonts with Inter.';

comment on column public.company_profiles.force_no_bold is
  'Design override: cap every font weight at 500.';

comment on column public.company_profiles.design_guide_raw is
  'Generated DESIGN_GUIDE.md (contract v3), including the tokens fence. Written by the Design page.';
