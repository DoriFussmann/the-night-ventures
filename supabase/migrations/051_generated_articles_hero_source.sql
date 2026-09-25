-- Remember where a hero image came from so attribution can be shown later.

alter table public.generated_articles
  add column if not exists hero_source jsonb;

comment on column public.generated_articles.hero_source is
  'Stock or generated hero provenance: { source, sourceId, attribution }. Null when unknown.';
