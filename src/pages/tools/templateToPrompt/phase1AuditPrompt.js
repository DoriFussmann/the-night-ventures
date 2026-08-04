/** Fixed Phase 1 audit prompt — run in the target site's repo before personalizing. */
export const PHASE_1_AUDIT_PROMPT = `Audit this repo for remaining template/placeholder content that hasn't been replaced with real company identity. Read-only — report only, no edits.

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

List the leftover items that most urgently need a content decision (draft it / delete it / rewrite it), one numbered item per line. Use short labels that identify the file or content piece (e.g. "Published article: technical-seo-eeat-content-sites.md", "Service: Technical SEO Audits"). Do not fix anything.`;
