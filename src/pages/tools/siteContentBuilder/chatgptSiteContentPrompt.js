/** ChatGPT prompt: produce a full site-content spec from company-data.md. */

export const CHATGPT_SITE_CONTENT_PROMPT = `You are writing the complete content specification for an SEO-optimized website. I've attached company-data.md — everything you need about the business is in it. Use only what's in that file; do not invent facts, services, team members, statistics, or claims that aren't supported by it.

The site is built on an existing SEO/GEO-optimized template, and the repo contains a Design Guide.md file that defines all visual design. So you are NOT designing visuals — you're specifying, for each page, its purpose, its sections in order, the actual finished copy, and the *spirit* of how each section should feel and lay out (e.g. "hero: single strong promise, one primary CTA, calm and confident" — not colors, fonts, or pixel specs). Cursor will handle the real design from Design Guide.md.

PAGES TO WRITE:
[List the pages you want, e.g. Home, About, Services, Contact, FAQ. If I don't specify, use: Home, About, Services, Contact, FAQ.]

FOR EACH PAGE, produce:
1. Page purpose — one line on what this page is for and who it's for.
2. SEO intent — target keyword/topic, a meta title (~55–60 chars), a meta description (~140–160 chars), and the single H1.
3. Sections in order — for every section: a short label, the spirit of its layout/feel (one line), and the FULL finished copy — real headlines, real body paragraphs, real CTA button text. Write publish-ready copy, not summaries or placeholders. Depth matters: each page should be substantive and complete, never thin or generic filler.
4. Internal CTAs — where each section should link (only to pages in the list above or routes that clearly already exist).

GUARDRAILS (follow exactly):
- Do not invent services or team members. If Company Data lists them, use them; if it doesn't, omit that section rather than fabricate.
- Testimonials/reviews: never write fabricated quotes. If a testimonials section is wanted, insert '[PLACEHOLDER: real testimonial needed]' for each quote and add a visible note that this section must be populated with real quotes or removed before launch.
- Every factual claim must trace to company-data.md.

OUTPUT FORMAT:
Return ONE complete markdown document I can paste directly into Cursor. Begin the document with this exact block, then the per-page content below it:

---
BUILD INSTRUCTIONS FOR CURSOR:
- Use Design Guide.md in the repo for ALL visual design decisions (layout, color, type, spacing).
- Do NOT modify the site's infrastructure, SEO plumbing, build config, metadata, sitemap, RSS, or structured data in any way that degrades the SEO/GEO optimization. Preserve every existing SEO optimization.
- Do NOT break existing functionality. If any change risks breaking the build, stop and flag it before proceeding.
- Verify exactly one H1 renders per page against the existing template. If the template already outputs its own H1 (especially on the homepage), do not add a second. Reconcile to one.
- Implement all page content below in full — do not shorten, summarize, or skip sections.
---`;
