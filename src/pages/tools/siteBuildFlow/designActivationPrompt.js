/** Cursor prompt: apply site/Design Guide.md to a Layer 1 clone. Restyle only. */
export const DESIGN_ACTIVATION_PROMPT = `DESIGN ACTIVATION. Apply site/Design Guide.md to this Layer 1 site. Restyle only; do not rewrite copy, identity, or seed content.

READ FIRST
- site/Design Guide.md — the whole file, including the \`\`\`tokens fence.
- design-tokens.mjs, tailwind.config.*, src/styles/global.css, BaseLayout, Header, Footer.

HARD BOUNDARIES (Layer 1 §6) — do not change
Schemas, CMS (localhost:3737 and its files), site.ts, url.ts, endpoints, JSON-LD, heading hierarchy, the order of article blocks, machine routes (robots, rss, llms.txt, sitemap, per-article .md). Keep WCAG AA, visible focus, 44×44 tap targets, no horizontal scroll at 200% zoom. No React islands, no hydration.

1. TOKENS
- Re-parse the \`\`\`tokens fence through design-tokens.mjs into Tailwind. If the fence has keys the parser does not know, extend the parser; if the parser expects keys the fence lacks, map: highlight → Positive, serif → the sans stack, focus → Accent, surface → Paper.
- Delete every hardcoded color in global.css :root and regenerate them from the tokens so there is one source of truth.
- Remove the Inter and Source Serif 4 imports. Font stack is ui-sans-serif, system-ui, sans-serif. Weight 400 only. Nothing on the site may be font-medium/semibold/bold except nowhere; strip every such class.
- Base font-size 13px on html/body. Container max-width 1280px, px-6 md:px-8. Update .container-page accordingly.

2. GLOBALS
- Remove every box-shadow, gradient, rounded-full pill, and uppercase/tracking-wide utility.
- Headings: leading-tight tracking-tight, Ink, weight 400. H1 text-4xl, H2 text-3xl, H3 text-2xl. Eyebrows and labels 13px Muted, sentence case.
- Body text Muted 13px leading-relaxed. Measure max-w-xl / max-w-2xl; never full-bleed grey paragraphs.
- Links: Accent, no underline, hover darkens. Focus ring: 1px Accent border, no glow.
- Sections py-20 on inner pages, py-24 on the homepage. Alternate white → Wash (#fafafa, border-y Border) → white.

3. PRIMITIVES (one definition each, reused everywhere)
- Button: ghost only. rounded-lg border Border px-3 py-2 text-[13px] Muted, hover bg Wash text Ink, transition-colors duration-200. Delete any filled/primary variant. On Band surfaces use border-white/30 text-white/70.
- Card: rounded-xl border Border bg-white p-6 h-full, hover bg Wash transition-colors duration-300. Only article cards get hover:-translate-y-1 transition-all duration-300.
- Input / select (article search + pillar filter): same geometry as Button, placeholder Faint, focus border Accent, no ring.
- Hairline: 1px Border. Use it instead of any heavier rule.

4. MOTION (CSS + one IntersectionObserver, no library)
- Add a \`.reveal\` class: opacity 0, translateY(24px), transition opacity/transform 0.6s cubic-bezier(0.16,1,0.3,1). \`.reveal.is-in\` → opacity 1, translateY(0).
- One script in BaseLayout: IntersectionObserver with rootMargin "0px 0px -80px 0px", adds is-in once, then unobserves. Read \`data-delay\` (ms) and set transition-delay.
- Grids: each card gets data-delay = index * 80.
- Homepage hero: not observed; mount with translateY(20px) 0.7s on load via a class added after DOMContentLoaded.
- Hover transitions as in primitives. Nothing else moves. No bounce, spring, scale, slide-from-side, parallax, counters.
- @media (prefers-reduced-motion: reduce): all transitions and transforms off, .reveal visible.

5. LAYOUT WALK — apply the above to each; note what you changed
- Header: sticky h-16 bg-white/80 backdrop-blur-xl border-b Border. Wordmark 15px tracking-tight, two-part: wordmark_primary in Ink, wordmark_accent in Accent (from the guide's token block). Nav links 13px Muted → Ink; active = Ink + 1px Accent underline growing from the left (w-0 → w-full, duration-300). Hamburger unchanged in behaviour, restyled.
- Footer: border-t Border, py-12, wordmark + one Muted sentence max-w-xs, links Muted, legal row Faint 13px under a hairline.
- Breadcrumbs, Back to Top: 13px Muted, Accent on hover, ghost geometry.
- Homepage hero: Band background, white text, relative overflow-hidden, the 48px grid backdrop at opacity 0.07 plus the two radial gradients from the guide. Eyebrow 13px white/50, H1 text-4xl md:text-5xl white max-w-3xl, tagline 15px white/70 max-w-xl. This is the only Band surface and the only place the grid texture appears. Keep existing copy.
- Homepage article / service / team sections: Card primitive, md:grid-cols-3, gap-4, reveal with stagger. Team teaser photos: square, rounded-lg, warm matte look via a CSS filter (saturate(.85) contrast(.95) sepia(.08)), no circles.
- Homepage FAQ and article FAQ (<details>): hairline-separated rows, summary 15px Ink, body 13px Muted, chevron is a 16px Lucide-style inline SVG stroke 1.5, no background.
- Article listing: Card primitive; title 15px Ink, excerpt 13px Muted, meta 13px Faint. Filters use Input primitive. Pagination: ghost buttons, active = Ink text + Accent underline.
- Article page (keep block order): 16:9 hero rounded-xl border Border with matte filter; title text-4xl; byline 13px Faint; TOC as 13px Muted list with Accent active item and a hairline left rule; related links and sources as Card primitive lists; author bio as a single wide Card.
- .prose-article EXCEPTION: body 15px leading-relaxed Charcoal (#2d2d2d) max-w-2xl; H2 text-2xl, H3 15px Ink; links Accent; lists with 4px Faint dots mt-[7px]; blockquote = hairline left rule in Accent, no background. Captions 13px Muted. Code 13px mono Wash background, border Border.
- Team listing / detail: Card primitive; credentials and sameAs as 13px Muted lines with Positive "+" prefix, not checkmarks. Articles-by-author = article card grid.
- Service detail: eyebrow 13 Muted → H1 text-4xl → lede 15 Muted max-w-xl, all in one reveal; body in .prose-article; closing ghost button back to home.
- 404: single reveal, H1 text-4xl, one Muted sentence, one ghost button.

6. FORBIDDEN — grep and remove
font-medium font-semibold font-bold shadow- bg-gradient rounded-full uppercase tracking-wide tracking-wider ring- Inter "Source Serif"

7. VERIFY
- Build passes, no console errors.
- grep for every token in section 6 returns nothing under src/ (excluding CMS).
- Lighthouse a11y ≥ 95 on /, /articles/, one article, /team/.
- Reduced-motion: page renders fully with animations disabled.
- Band surface appears exactly once (homepage hero).
- No color hex exists in src/ outside design-tokens output and global.css.
List every file changed, grouped by the section above that caused the change.`;
