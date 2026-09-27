-- Design picker. Nullable template id plus the generated guide.
-- Deprecated design-token columns stay in place so existing rows are not dropped.
-- brand_feel and brand_voice are deprecated as design tokens only; Company
-- Intelligence still stores Brand Personality and Voice & Tone in those columns.

alter table public.company_profiles
  add column if not exists design_template text;

alter table public.company_profiles
  drop constraint if exists company_profiles_design_template_check;

alter table public.company_profiles
  add constraint company_profiles_design_template_check
  check (
    design_template is null
    or design_template in (
      'slate',
      'midnight',
      'press',
      'daylight',
      'night',
      'field'
    )
  );

comment on column public.company_profiles.design_template is
  'Selected design preset: slate, midnight, press, daylight, night, or field. Null until the company picks one.';

comment on column public.company_profiles.brand_accent is
  'Optional accent hex override (#RRGGBB). Null uses the selected template accent.';

comment on column public.company_profiles.design_guide_raw is
  'Generated Design Guide.md, including the tokens fence. Written by the Design page.';

comment on column public.company_profiles.design_guide_abstract is
  'Deprecated. No longer read or written. Imagery context comes from design_guide_raw.';

comment on column public.company_profiles.brand_band is
  'Deprecated design token. No longer read or written.';

comment on column public.company_profiles.brand_positive is
  'Deprecated design token. No longer read or written.';

comment on column public.company_profiles.brand_feel is
  'Deprecated as a design token. Still the Company Intelligence Brand Personality field.';

comment on column public.company_profiles.brand_voice is
  'Deprecated as a design token. Still the Company Intelligence Voice & Tone field.';
