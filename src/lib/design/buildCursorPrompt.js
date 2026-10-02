import { CONTRACT_VERSION, GUIDE_FILENAME } from "./contract.js";

function uniquePackages(tokens) {
  const list = [tokens?.type?.display?.package, tokens?.type?.body?.package].filter(Boolean);
  return [...new Set(list)];
}

function uniqueImports(tokens) {
  const list = [...(tokens?.type?.display?.imports || []), ...(tokens?.type?.body?.imports || [])];
  return [...new Set(list)];
}

/**
 * Deterministic Cursor prompt that applies DESIGN_GUIDE.md to a site built from
 * the SEO Blueprint template. Same tokens in → same prompt out.
 */
export function buildCursorPrompt(tokens) {
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens are required");
  }
  const packages = uniquePackages(tokens);
  const imports = uniqueImports(tokens);
  const overrides = tokens.overrides || {};
  const overrideNote = [
    overrides.forceInter ? "Force Inter is ON — Inter is the only typeface." : null,
    overrides.forceNoBold ? "Force no bold is ON — nothing renders above weight 500." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return `APPLY THE SITE DESIGN. ${GUIDE_FILENAME} is at the repository root. It defines the complete visual design for this site: Direction "${tokens.templateName}" (${tokens.mode}), design contract v${CONTRACT_VERSION}.${overrideNote ? ` ${overrideNote}` : ""} Apply it to the whole site. You change how the site looks — never what it says.

READ FIRST
- ${GUIDE_FILENAME} — all of it. The \`tokens\` block at the end is the source of truth for every value; the sections above it explain behavior.
- site/design-tokens.mjs, site/tailwind.config.mjs, site/package.json
- site/src/styles/global.css
- site/src/layouts/BaseLayout.astro
- site/src/components/ (Header, Footer, Wordmark, MediaFrame, sections/*)
- site/scripts/check-contrast.mjs, site/scripts/theme-test.mjs

STEPS
1. Token source. Rewrite site/design-tokens.mjs so it reads ${GUIDE_FILENAME} from the repository root (one level above site/; fall back to process.cwd()/.. and process.cwd()), parses the single \`tokens\` fence and validates it against "Token contract (v${CONTRACT_VERSION})" in the guide: every key, every enum, hex/px/rem/em formats, version === ${CONTRACT_VERSION}. Any problem throws a clear error naming the key. Keep exporting \`tokens\`, \`typeScale\` and \`themeCss()\`.
2. Remove the old design source: delete site/Design Guide.md and site/design-presets/. Delete site/scripts/theme-test.mjs and the "theme:test" script in site/package.json (it only swaps v2 presets).
3. CSS variables. themeCss() emits:
   - every color as --c-<key> (all 20 keys, including accentInk and onImage)
   - --font-display and --font-body: "<family>", <fallback>
   - --weight-heading, --weight-ui, --weight-strong, --weight-body
   - --heading-tracking, --heading-leading, --heading-transform (none | uppercase), --eyebrow-tracking (from type.eyebrowTracking when eyebrow is uppercase, else 0)
   - every variable it emits today (sizes, radius, container, measure, density, motion, imagery) unchanged in meaning
   Remove --font-sans; replace every use with --font-body.
4. html attributes. In BaseLayout.astro keep the existing data-* attributes and add: data-direction={tokens.template}, data-hero-overlay, data-hover, data-portrait, data-eyebrow-mark (from tokens.variants). data-motion now also takes "blur" and "spring".
5. Fonts. Run in site/: npm install ${packages.join(" ")}. Import exactly these in BaseLayout.astro frontmatter: ${imports.map((i) => `"${i}"`).join(", ")}. Remove any other font import${packages.includes("@fontsource-variable/inter") ? "" : " (including the template's @fontsource-variable/inter in global.css and BaseLayout)"} and uninstall font packages that are no longer imported. Update or remove the font preload so it points at a file that exists.
6. Type roles. Headings (.h1/.h2/.h3, prose h2/h3), .wordmark, .stat-value, .card-title and blockquotes use var(--font-display), var(--weight-heading), var(--heading-tracking), var(--heading-leading), text-transform: var(--heading-transform). Everything else inherits var(--font-body) at var(--weight-body). Set html { font-synthesis-weight: none; }. Update tailwind.config.mjs fontFamily to display/body from the same variables.
7. Weights. Replace every hard-coded font-weight in site/src (global.css has several "font-weight: 600"; check components for font-bold / font-semibold / font-medium classes) with var(--weight-ui) for UI text (eyebrows, buttons, nav, labels, placeholder labels, FAQ summaries, card CTAs) or var(--weight-heading) for heading-like text. Add: strong, b, th, dt { font-weight: var(--weight-strong); }. After this step no literal font-weight number may remain in site/src.
8. Accent as text. Every place --c-accent is used as a TEXT color (links, .eyebrow, .wordmark-accent, nav and footer hover, prose links, outline-button text, card titles and CTAs on hover) switches to --c-accentInk. Fills, borders, active dots and the focus ring keep their current tokens.
9. Variants. In global.css implement every value listed under "Variant reference" in the guide, using html[data-…] selectors like the existing ones. Existing values keep their current CSS unless the guide describes them differently. New work at minimum: hero "photo" (with the Hero.astro markup it needs: a class or wrapper so the carousel can sit behind the copy) and heroOverlay dark/fade/vignette, texture "scanline" (add a .texture-scanline element where texture-grid/texture-dots already exist), hover zoom/lift/jelly/glitch/brighten on .card, .article-card and .media-frame images, portrait rounded/circle/square/blob on team and author images, eyebrowMark dot/rule/slashes, motion blur/spring reveals, button outline using accentInk text.
10. Signature details. Implement every item in "Signature details" with CSS and small markup additions inside existing components (decorative elements get aria-hidden="true"). No new sections, pages or routes.
11. Reduced motion. Under prefers-reduced-motion: reduce, disable reveal transforms, hover transforms (zoom, lift, jelly, glitch), carousel autoplay and any bouncing indicator.
12. Contrast. Set the pairs in site/scripts/check-contrast.mjs to exactly the "Contrast pairs" list in the guide (4.5:1 each).
13. Do not touch: any content file (site/src/content/**), page YAML, copy, images in site/src/assets/, the seo-core package, routes, SEO / JSON-LD / sitemap / RSS / robots / llms.txt code, or ${GUIDE_FILENAME} itself. No inline style attributes for design values. No hex, font-family or font-weight literals outside design-tokens.mjs.
14. Build: run npm run build in site/ (contrast check, astro build, audit). Fix until it is clean.
15. Verify: grep site/src for "font-weight: [0-9]", "font-bold", "font-semibold", "font-family:" and "#[0-9A-Fa-f]{6}" — every hit must be a var() or be inside design-tokens.mjs; report anything left and why. Run the dev server and check the home page, one article and the team page at 390px and 1280px.
16. Report:
   - files changed and files deleted
   - packages installed and removed
   - each Signature detail and each new variant: done, or not done and why
   - build result`;
}
