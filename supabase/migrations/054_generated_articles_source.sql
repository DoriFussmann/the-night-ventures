-- How a generated article was created. Existing rows default to cluster,
-- then comprehensive articles with no supporting keyword are marked pillar.

alter table public.generated_articles
  add column source text not null default 'cluster'
  check (source in ('pillar', 'cluster', 'modify', 'idea'));

update public.generated_articles
  set source = 'pillar'
  where type = 'comprehensive'
    and supporting_keyword is null;
