-- Persisted brand tokens for the fixed Design Guide template.
-- Nullable so Design Builder can suggest values when Company Data is empty.

alter table public.company_profiles
  add column if not exists brand_feel text,
  add column if not exists brand_accent text,
  add column if not exists brand_band text,
  add column if not exists brand_positive text,
  add column if not exists wordmark_primary text,
  add column if not exists wordmark_accent text,
  add column if not exists brand_voice text;

comment on column public.company_profiles.brand_feel is
  'One-sentence brand feel used as the FEEL token in Design Guide.md.';

comment on column public.company_profiles.brand_accent is
  'Accent hex (#RRGGBB) for links, focus, and nav underline.';

comment on column public.company_profiles.brand_band is
  'Deep hex (#RRGGBB) for hero and closing CTA bands.';

comment on column public.company_profiles.brand_positive is
  'Muted green hex (#RRGGBB) for gain / included marks.';

comment on column public.company_profiles.wordmark_primary is
  'Ink (first) part of the two-part wordmark.';

comment on column public.company_profiles.wordmark_accent is
  'Accent (second) part of the two-part wordmark. Empty when the name does not split.';

comment on column public.company_profiles.brand_voice is
  'Short voice do/don''t block appended to Design Guide section 9.';
