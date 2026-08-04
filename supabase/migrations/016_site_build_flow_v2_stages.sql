-- Site Build Flow v2 stages: expand allowed stage_keys and insert the new
-- 7-stage set alongside any existing v1 rows (do not delete or rewrite old data).
-- Active UI stage_keys: infra-build, design-build, deployment-infra,
-- make-it-specific, seed-content, full-site-content-build, live-wiring-qa.
-- Legacy keys from 015 remain valid so historical progress is preserved.

alter table public.site_build_stages
  drop constraint if exists site_build_stages_stage_key_check;

alter table public.site_build_stages
  add constraint site_build_stages_stage_key_check
  check (stage_key in (
    'infra-scaffold',
    'environment-deploy',
    'design-system',
    'template-to-specific',
    'content-foundations',
    'content-production-live',
    'infra-build',
    'design-build',
    'deployment-infra',
    'make-it-specific',
    'seed-content',
    'full-site-content-build',
    'live-wiring-qa'
  ));

alter table public.site_build_checklist_items
  drop constraint if exists site_build_checklist_items_stage_key_check;

alter table public.site_build_checklist_items
  add constraint site_build_checklist_items_stage_key_check
  check (stage_key in (
    'infra-scaffold',
    'environment-deploy',
    'design-system',
    'template-to-specific',
    'content-foundations',
    'content-production-live',
    'infra-build',
    'design-build',
    'deployment-infra',
    'make-it-specific',
    'seed-content',
    'full-site-content-build',
    'live-wiring-qa'
  ));

comment on table public.site_build_stages is
  'Per-company status for Site Build Flow stages. Active set is the seven v2 stage_keys; v1 keys may remain for historical rows. Status is set manually (not derived from checklist completion).';

-- Seed v2 stages for companies that already opened Site Build Flow.
-- Fresh companies are still seeded client-side on first open.
insert into public.site_build_stages (company_id, stage_key, status)
select tc.company_id, ns.stage_key, 'pending'
from (
  select distinct company_id
  from public.site_build_stages
  union
  select distinct company_id
  from public.site_build_checklist_items
) as tc(company_id)
cross join (
  values
    ('infra-build'),
    ('design-build'),
    ('deployment-infra'),
    ('make-it-specific'),
    ('seed-content'),
    ('full-site-content-build'),
    ('live-wiring-qa')
) as ns(stage_key)
on conflict (company_id, stage_key) do nothing;

insert into public.site_build_checklist_items (
  company_id,
  stage_key,
  item_key,
  label,
  status,
  note,
  proof_url,
  is_custom,
  sort_order
)
select
  tc.company_id,
  si.stage_key,
  si.item_key,
  si.label,
  'pending',
  null,
  null,
  false,
  si.sort_order
from (
  select distinct company_id
  from public.site_build_stages
  union
  select distinct company_id
  from public.site_build_checklist_items
) as tc(company_id)
cross join (
  values
    ('infra-build', 'init-cursor-git', $l$Open a new Cursor project / repo and initialize git$l$, 0),
    ('infra-build', 'run-infra-scaffold-prompt', $l$Paste the Infra Scaffold Prompt into Cursor and run it$l$, 1),
    ('infra-build', 'build-zero-errors', $l$npm run build completes with zero errors$l$, 2),
    ('infra-build', 'dev-pages-render', $l$npm run dev renders home, article, and team pages correctly$l$, 3),
    ('infra-build', 'view-source-meta', $l$View-source spot check: title, meta description, canonical, OG tags present$l$, 4),
    ('infra-build', 'json-ld-present', $l$JSON-LD present: Organization, BlogPosting, Person, BreadcrumbList$l$, 5),
    ('infra-build', 'discovery-files-present', $l$llms.txt, sitemap-index.xml, robots.txt, rss.xml all present and populated$l$, 6),
    ('infra-build', 'drafts-no-live-route', $l$Draft articles produce zero live route$l$, 7),
    ('infra-build', 'cms-e2e-tested', $l$CMS tested end-to-end: fake image path rejected, short alt text rejected, Generate blocked with visible reason when required fields missing, oversized file rejected clearly, editing an existing article doesn't duplicate it, invalid internal/external links flagged, Dashboard counts verified by hand$l$, 8),
    ('infra-build', 'placeholder-grep-clean', $l$Repo-wide grep for placeholder text returns nothing outside the identity config file$l$, 9),
    ('design-build', 'design-guide-complete', $l$Design Guide.md placed in project root and complete, not placeholder$l$, 0),
    ('design-build', 'run-design-system-prompt', $l$Paste the Design System Prompt into Cursor and run it (only after Infra Build stage fully passes)$l$, 1),
    ('design-build', 'build-still-zero-errors', $l$npm run build still completes with zero errors$l$, 2),
    ('design-build', 'hard-boundaries-untouched', $l$Hard boundaries confirmed untouched: JSON-LD, meta tags, heading structure identical to pre-design$l$, 3),
    ('design-build', 'visual-pass-guide', $l$Visual pass completed against Design Guide's component direction$l$, 4),
    ('design-build', 'hero-copy-updated', $l$Hero copy updated from Design Guide, if provided$l$, 5),
    ('design-build', 'lighthouse-90-plus', $l$Lighthouse: Performance, Accessibility, Best Practices, SEO all score 90+$l$, 6),
    ('design-build', 'a11y-baseline', $l$Accessibility baseline confirmed: contrast ratios, visible focus states, 44x44 tap targets, readable at 200% zoom$l$, 7),
    ('deployment-infra', 'vercel-site-linked', $l$Vercel project created and linked to the site repo$l$, 0),
    ('deployment-infra', 'cms-hosting-set', $l$CMS hosting set up, or confirmed local-only by design$l$, 1),
    ('deployment-infra', 'vercel-env-vars', $l$Environment variables set in Vercel: ANTHROPIC_API_KEY, Supabase URL/keys, any others required$l$, 2),
    ('deployment-infra', 'supabase-project-created', $l$Supabase project created$l$, 3),
    ('deployment-infra', 'migrations-run', $l$SQL Editor: all migrations run in order with no errors$l$, 4),
    ('deployment-infra', 'rls-verified', $l$RLS policies verified on all pipeline tables$l$, 5),
    ('deployment-infra', 'production-deploy-ok', $l$Production build deploys successfully and the live URL loads$l$, 6),
    ('deployment-infra', 'custom-domain-ssl', $l$Custom domain connected and SSL active$l$, 7),
    ('make-it-specific', 'company-data-populated', $l$Company Data populated in TNV: positioning, keyword architecture, competitors, Design Guidelines abstract$l$, 0),
    ('make-it-specific', 'specific-prompt-audit', $l$Specific Prompt audit (Tab 1) run in Cursor against the live repo$l$, 1),
    ('make-it-specific', 'personalize-prompt-generated', $l$Audit report pasted into Specific Prompt Tab 2, Personalize Prompt generated$l$, 2),
    ('make-it-specific', 'zero-needs-input', $l$Zero [NEEDS INPUT] markers remain in the generated prompt$l$, 3),
    ('make-it-specific', 'fill-prompt-run', $l$Fill prompt run in Cursor$l$, 4),
    ('make-it-specific', 'severity-items-resolved', $l$Every highest-severity audit item resolved with an explicit decision$l$, 5),
    ('make-it-specific', 'template-grep-clean', $l$Repo-wide grep for template leftovers returns zero hits outside legitimate editorial content$l$, 6),
    ('make-it-specific', 'homepage-services-reviewed', $l$Homepage and services reviewed live: real positioning, no template instruction text$l$, 7),
    ('seed-content', 'two-pillars-generated', $l$At least 2 pillar articles planned and generated$l$, 0),
    ('seed-content', 'cluster-per-pillar', $l$At least 1 supporting cluster generated under each seeded pillar$l$, 1),
    ('seed-content', 'hero-images-generated', $l$Cluster/pillar hero images generated$l$, 2),
    ('seed-content', 'cms-publish-each-article', $l$Each article published through the CMS: author, image, links set$l$, 3),
    ('seed-content', 'deployed', $l$Deployed$l$, 4),
    ('seed-content', 'marked-published-with-url', $l$Each article marked Published in Topic Generator with its live URL$l$, 5),
    ('full-site-content-build', 'tnv-full-site-tool-built', $l$TNV tool built: collects Company Data + seeded content and generates a Cursor prompt for remaining site pages/sections$l$, 0),
    ('full-site-content-build', 'full-site-prompt-run', $l$Generated prompt run in Cursor$l$, 1),
    ('full-site-content-build', 'build-clean-pages-render', $l$Build completes clean, all pages render$l$, 2),
    ('full-site-content-build', 'deployed-full-content', $l$Deployed — site live with full real content end-to-end$l$, 3),
    ('live-wiring-qa', 'gsc-verified', $l$Google Search Console verified (Domain property)$l$, 0),
    ('live-wiring-qa', 'bing-verified', $l$Bing Webmaster Tools verified$l$, 1),
    ('live-wiring-qa', 'analytics-receiving', $l$Analytics installed and confirmed receiving data$l$, 2),
    ('live-wiring-qa', 'sitemap-submitted', $l$Sitemap submitted in GSC and Bing$l$, 3),
    ('live-wiring-qa', 'speed-scores-recorded', $l$PageSpeed Insights / GTmetrix / Lighthouse run on live URLs, scores recorded$l$, 4),
    ('live-wiring-qa', 'trimmed-seo-baseline', $l$Trimmed SEO baseline check run (Semrush snapshot, robots/canonical/schema spot-check)$l$, 5),
    ('live-wiring-qa', 'gsc-security-clean', $l$GSC Security Issues and Manual Actions confirmed clean$l$, 6),
    ('live-wiring-qa', 'rank-tracking-set', $l$Rank tracking set up$l$, 7)
) as si(stage_key, item_key, label, sort_order)
where not exists (
  select 1
  from public.site_build_checklist_items existing
  where existing.company_id = tc.company_id
    and existing.stage_key = si.stage_key
);
