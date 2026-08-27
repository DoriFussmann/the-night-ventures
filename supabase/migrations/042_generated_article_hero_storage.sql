-- Persist generated hero images so clusters can be published/re-published
-- from saved library rows without regenerating. Path is keyed by company + slug.

alter table public.generated_articles
  add column if not exists hero_storage_path text;

comment on column public.generated_articles.hero_storage_path is
  'Object path in the article-heroes bucket, typically {company_id}/{slug}.png.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'article-heroes',
  'article-heroes',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "Authenticated users can read article heroes" on storage.objects;
drop policy if exists "Authenticated users can upload article heroes" on storage.objects;
drop policy if exists "Authenticated users can update article heroes" on storage.objects;
drop policy if exists "Authenticated users can delete article heroes" on storage.objects;

create policy "Authenticated users can read article heroes"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'article-heroes');

create policy "Authenticated users can upload article heroes"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'article-heroes');

create policy "Authenticated users can update article heroes"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'article-heroes')
  with check (bucket_id = 'article-heroes');

create policy "Authenticated users can delete article heroes"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'article-heroes');
