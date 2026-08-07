/** Fixed Tab 1 audit prompt — run in the target site's repo before building pages. */
export const SITE_CONTENT_AUDIT_PROMPT = `Audit this site's current page structure. Read-only — report only, no edits.

1. HOMEPAGE: List every section currently on the homepage, in order, with a one-line description of each (e.g. 'Hero: headline + subhead, no image', 'How It Works: 3-step list'). Note whether it has a hero image, any CTA buttons, and their destinations.
2. OTHER PAGES: List every route under src/pages/ (About, Services, Contact, FAQ, Testimonials, Legal, or others) that currently exists, with a one-line summary of what's on each.
3. NAV: List current header and footer navigation links.
4. COMPONENTS: List any reusable layout components already built (e.g. an alternating text/image section component, a card/grid component, an accordion component) that could be reused for new sections, so new pages match the existing visual system rather than introducing a different pattern.
5. DESIGN SYSTEM: Confirm Design Guide.md and the established Tailwind theme tokens are present and in use.

Output as a structured report, one section per item above.`;
