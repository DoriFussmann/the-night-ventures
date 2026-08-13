-- Inline Phase 1 audit prompt on existing run-the-audit-prompt rows.
-- New site-activation items are seeded by the app from seedData.js on next load.
-- Covers site-activation (post-032) and make-it-specific (if 032 has not run yet).

update public.setup_flow_items
set
  prompts = jsonb_build_array(
    jsonb_build_object(
      'label',
      'Phase 1 audit prompt',
      'text',
      $audit$Audit this repo for remaining template/placeholder content that hasn't been replaced with real company identity. Read-only — report only, no edits.

Check and report on:
1. HOMEPAGE: Find the homepage component/page. Quote every piece of hero/intro text, tagline, and any "what we do" copy. Flag anything that reads as generic template instruction text (e.g. "replace this with your real company description") rather than real company positioning.
2. SITE CONFIG: List every field in the site identity config (site.ts or equivalent) — not just SITE_URL/SITE_NAME, but SAME_AS, contact info, social links, taglines, meta descriptions, OG defaults — and flag any that are still empty, placeholder, or obviously templated ("example.com", "Your Company", "[insert...]", empty arrays where content is expected).
3. SERVICES COLLECTION: List every entry in the services content collection — title, summary. Flag placeholder/generic ones vs. ones that describe the company's actual offering.
4. TEAM COLLECTION: List every entry — flag any placeholder/sample team members still present (e.g. "alex-rivera" if it still exists).
5. NAVIGATION / FOOTER: Quote any nav labels, footer text, copyright line, or CTA button text that looks templated rather than company-specific.
6. 404 PAGE: Quote its content — often overlooked in template passes.
7. ANY OTHER PAGES: List every route under src/pages/ not already covered above (e.g. an About page, Contact page, legal pages) and quote their content briefly, flagging placeholder vs. real. Call out any published demo/template articles that should not ship under the real brand.
8. GREP CHECK: Search the whole repo for common template leftovers: "example.com", "Your Company", "Lorem ipsum", "[placeholder]", "TODO", "Company Name", "Site Name". Report every hit with file + line.

Output as a structured report, one section per item above.

End with a section titled exactly:

## Highest severity

List the leftover items that most urgently need a decision, one numbered item per line. Prefix each label with a kind tag:
- [content] for published/demo/template content files that need draft / delete / rewrite (e.g. "[content] Published article: some-article.md")
- [config] for site.ts fields, env vars, or other identity config that is not a content file (e.g. "[config] site.ts SITE_NAME still 'Your Company'")
- [missing] when a surface/file/page does not exist yet and should not be invented in the fill pass (e.g. "[missing] About page")

Also add the sub-tag [demo-seed] alongside the kind tag when the finding is a template-generated seed artifact from infra scaffolding (present at scaffold time, not user-authored). Tag by pattern, not by filename — filenames and topics change every scaffold run. Seed artifacts are specifically:
- the single demo article authored during infra step 6 (published sample under the real brand)
- up to two draft-only test-fixture articles
- the single seed team member created during scaffolding
- the single seed service created during scaffolding

Examples:
- "[content] [demo-seed] Published demo article: <filename>"
- "[content] [demo-seed] Draft-only test fixture: <filename>"
- "[content] [demo-seed] Seed team member: <slug>"
- "[content] [demo-seed] Seed service: <slug>"

Do not put [demo-seed] on user-authored content, real company pages, or ordinary config/missing findings. Use short labels that identify the file, field, or content piece. Do not fix anything.$audit$
    )
  ),
  updated_at = now()
where item_key = 'run-the-audit-prompt'
  and stage_key in ('site-activation', 'make-it-specific');
