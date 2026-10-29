-- Build Blueprint → Placeholders: the last live scan of each company's site and
-- the sign-offs a person gives for items a scan cannot judge (privacy, terms,
-- testimonials). One row per company; the browser upserts it after each scan.

create table if not exists public.site_placeholder_scans (
  company_id uuid primary key references public.companies (id) on delete cascade,
  scanned_at timestamptz,
  commit_sha text,
  branch text,
  site_root text,
  core_version text,
  manifest_source text,
  -- checkPlaceholders() report: { template, manifestVersion, results[], required, suggested, clear }
  report jsonb,
  -- { "<check id>": { "at": "<iso>", "by": "<email>" } }
  signoffs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.site_placeholder_scans is
  'Build Blueprint Placeholders stage: last scan of the site repo (seo-core placeholder manifest) and per-item sign-offs.';

alter table public.site_placeholder_scans enable row level security;

drop policy if exists "Authenticated users can manage site_placeholder_scans" on public.site_placeholder_scans;
create policy "Authenticated users can manage site_placeholder_scans"
  on public.site_placeholder_scans for all
  to authenticated
  using (true)
  with check (true);
