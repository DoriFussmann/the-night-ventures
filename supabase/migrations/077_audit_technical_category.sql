-- Audit: allow the Technical & Infrastructure runner (category 'technical').
-- Widens the category check only; existing rows are unaffected. Safe to re-run.

alter table public.audit_runs drop constraint if exists audit_runs_category_check;

alter table public.audit_runs
  add constraint audit_runs_category_check
  check (category in (
    'crawl', 'schema', 'clusters', 'aeo_readiness', 'ai_visibility',
    'speed', 'authority', 'aeo_content', 'technical'
  ));
