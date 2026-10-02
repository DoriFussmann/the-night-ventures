/** Static Cursor prompt. Company data and page recipes stay in ChatGPT's response. */

export const CURSOR_IMPLEMENT_PROMPT = `IMPLEMENT SITE CONTENT. The document at the end of this message comes from ChatGPT and is the final content for this site. Implement it exactly. You do not write, edit, shorten, reorder or improve any copy.

READ FIRST
- site/src/content.config.ts (pages collection schema)
- site/src/components/sections/
- site/src/config/site.ts
- the services collection and serviceSchema from seo-core
- the design guide: DESIGN_GUIDE.md at the repository root if it exists, otherwise site/Design Guide.md (read only — never change it)

STEPS
1. Pages: for every "=== PAGE: <id> ===" block, write the YAML verbatim to site/src/content/pages/<id>.yaml, replacing the placeholder file. Fix YAML syntax only (quoting, indentation) — never wording.
2. Services: delete placeholder files in site/src/content/services/ that are not in the document. For every "=== SERVICE: <slug> ===" block, write site/src/content/services/<slug>.md verbatim. If icon is not valid for serviceSchema, replace only the icon with the closest valid value. If the schema has draft, set draft: false.
3. Navigation: NAV in site/src/config/site.ts stays About, Services, Articles, Contact, in that order. Articles must remain. FAQ, Testimonials and Team are reached from the footer and in-page links — do not add them to NAV. Set SITE_NAME, SITE_TAGLINE and SITE_URL only if they are still template placeholders and the right values are unambiguous; otherwise leave them and flag.
4. Links: every href in the YAML must resolve to an existing route. If one does not, report it — do not create pages.
5. Do not touch: DESIGN_GUIDE.md, site/Design Guide.md, design-tokens.mjs, tailwind config, global.css, section components, BaseLayout, Header, Footer, schemas, articles, team entries, or any SEO / JSON-LD / sitemap / RSS / robots / llms.txt code. No new components, no inline styles, no color or type utility classes. If any content cannot be rendered by the existing section library, stop and report it — do not build around it.
6. Build: npm run build (contrast check, astro build, audit). Fix only schema or YAML errors in content files. Re-run until clean.
7. Report:
   - pages written, with word counts from the QA section
   - services written
   - every YAML fix (file, line, what)
   - broken links
   - the full [GAP] / [PLACEHOLDER] / image-brief checklist, copied from the QA section

THE CONTENT DOCUMENT (ChatGPT's full response):`;
