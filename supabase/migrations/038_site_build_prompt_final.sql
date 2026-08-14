-- Replace Site Build Prompt with the final Layer 1 master text
-- (git init at start, placeholder favicon, date coercion helper).

update public.general_documents
set
  title = 'Site Build Prompt',
  content = $site_build_prompt$
# LAYER 1 — MASTER SEO/GEO TEMPLATE
(Final, audit-corrected. Build in `C:\Dev\blueprint-seo-template`, currently empty.
No GitHub remote, no Vercel, no identity beyond `https://example.com` / `Site Name`.
Finish line: `npm run build` and `npm run cms` succeed locally.)

---

## ARCHITECTURE

```
flowchart LR
  subgraph publicSite [site — Astro static]
    siteTs[site.ts] --> urlTs[url.ts] --> baseLayout[BaseLayout: JSON-LD, OG]
    collections[articles/team/services] --> pages[pages + components]
    baseLayout --> pages
  end
  subgraph localCms [cms — Express, localhost:3737]
    ui[six HTML screens] --> validate[validateFrontmatter] --> write[writeArticle/writeTeamMember]
    ui --> health[connectInternalLinks / externalLinkSearch]
    health --> write
    write --> collections
    write --> llms[public/llms.txt]
  end
  zip["TNV zip or JSON"] --> ui
```

Identity lives only in `site/src/config/site.ts`. Canonical, sitemap, RSS, OG,
`robots.txt`, `llms.txt`, and `Organization` JSON-LD all import it.

---

## REFERENCE FILES — mirror these exactly, confirmed real (do not guess interfaces)

All paths relative to the TNV repo root, confirmed via direct audit:

- **DataForSEO SERP:** `lib/seo-advisor/providers/dataforseo.js` — exports
  `serpResults({keyword, depth})` and the underlying `dfsPost`. **Do not use**
  `lib/audit-snapshot/sources/dataforseo.js` — that sibling file only calls
  `keywordData`/`backlinksSummary`, never SERP.
- **PageSpeed:** `lib/audit-snapshot/pagespeed.js` (low-level `runPagespeed`) and
  `lib/audit-snapshot/sources/pagespeed.js` (`runPagespeedPanel` — runs mobile then
  desktop sequentially and merges; mirror this panel function for Health's Speed
  indicator, not just the low-level client, since it already does exactly what's
  needed).
- **Confirmation receipt:** `src/pages/tools/articleGeneration/importConfirmationReceipt.js`
  — **not** a repo-root file, correct this path if building from an earlier draft.

---

## 1. MONOREPO SCAFFOLD

Root `package.json`, workspaces `["site", "cms"]`, scripts `dev`/`build`/`cms`.
Gitignore `node_modules`, `site/dist`, `cms/.env`. Initialize a local git repo (no
remote) at the very start of the build, not partway through — every fix made during
the build should land as a real commit, not just live in a running process that
disappears on restart.

Include a placeholder `favicon` (`site/public/favicon.svg` or `.ico`) from the
start — its absence is a free, avoidable point off Lighthouse's Best Practices
score (console 404) on every single clone otherwise.

Copy `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `GOOGLE_PAGESPEED_API_KEY` from
`C:\Dev\the-night-ventures\.env.local` into gitignored `cms/.env` — all three names
confirmed to match exactly, no renaming needed. Commit an empty `cms/.env.example`
documenting the same three names.

Placeholder `site/Design Guide.md` uses TNV's real guide headings (Brand identity,
Color palette, Typography, Spacing & layout, …) plus a fenced, parseable token block
(hex colors, fonts, type scale, spacing unit, breakpoints, max container/article
widths) so Tailwind reads real theme values without inventing a client brand.

`SITE_URL = "https://example.com"`, `SITE_NAME = "Site Name"`, `SAME_AS = []`, with
the required `// TEMPLATE:` comment.

---

## 2. CONTENT SCHEMAS

`site/src/content.config.ts` — every field below from day one, no later retrofit.

**articles:** strict `author: z.string()` (not `reference('team')`). `title` 55–60
chars, `description` 140–160, `tags` 4–6, `imageAlt` min 10 chars, `image: image()`,
optional `image2`/`image3`. Defaults for `robots`, `schemaType`, `locale`,
`twitterCard`, `draft`. Optional pillar/cluster fields (`pillarKeyword`,
`supportingKeyword`, `articleType` enum, `targetKeyword`) preserved on save, never
stripped. `internalLinks`/`externalLinks`/`faqs` as previously specified.

**team / services:** as previously specified; `photo: image()`.

**CMS intake** (`cms/lib/schema.ts`) mirrors the same fields but **accepts
`author: null` and reports it as a missing required field** — this is the normal
case for every TNV-generated article, never a parse crash. An article with a null
author is never written to `site/src/content/articles/`; the strict Astro schema
above never actually receives a null in practice, and must not be loosened to
accommodate the intake case.

**Date coercion, build this in from the start (known real bug, already hit once):**
the YAML parser used for frontmatter intake (`gray-matter` or equivalent) will
auto-coerce an unquoted `date: 2026-08-14` into a JS `Date` object before any
validation runs. Naively stringifying that with `String(date)` produces a locale
string (`Fri Aug 14 2026 ...`), which then fails a `YYYY-MM-DD` format check even
though the source data was correct. `date`/`updatedDate` intake must go through a
coercion helper that handles all three cases: an already-correct `YYYY-MM-DD`
string, a JS `Date` object (format via `.toISOString().slice(0, 10)`), and anything
else parseable by `Date.parse` as a fallback. Do not assume frontmatter dates arrive
as plain strings.

`site/src/lib/url.ts` joins `SITE_URL` + path, trailing slash always except
`robots.txt` / `rss.xml` / `sitemap-index.xml`.

---

## 3. SITE LAYOUTS, SEO, PAGES

Astro 5, `output: 'static'`, `trailingSlash: 'always'`, `@astrojs/sitemap` with
`filter` excluding `/404`, `serialize` giving `lastmod` from `updatedDate || date`.
Sitemap output is `sitemap-index.xml` only — never reference `sitemap.xml`.

**HTML comments (build-breaking if missed):** custom remark plugin so
`<!-- WHERE-THINGS-STAND:START -->` / `<!-- WHERE-THINGS-STAND:END -->` survive
verbatim to the built `dist` HTML — Astro's default markdown pipeline may strip
raw HTML comments otherwise. After the first article build, grep the built HTML for
both markers; if either is missing, fix the remark config before continuing. This is
a hard gate, not a nice-to-have: TNV's Articles Update tool scans the **live
published HTML** for these exact markers, not this repo's source files.

`site/src/layouts/BaseLayout.astro` owns all meta/OG/JSON-LD. Required
`title`/`description` props, throw if missing. Fallback fields use plain
`override || base`, no truncation. `og:description` byte-identical to meta
description when no override is set. `ogImage` uses the same resolved
`astro:assets` URL that `<Image />` renders — never a raw dev-server path.

Article page: `getEntry('team', author)`, build-time throw if missing.
`getStaticPaths` skips `draft: true` entirely — no route, not just unlinked.
Visible "Updated on" text only when `updatedDate` is a genuinely later calendar day
than `date`; the underlying `dateModified` JSON-LD value still always uses
`updatedDate` regardless of what's shown.

Listing filters (title search AND `pillarKeyword` dropdown, both as URL query
params, independent clear, pagination), TOC smooth-scroll, and Back to Top: plain
vanilla `<script>`, not `client:*` islands — a static host can't server-filter, and
this keeps the zero-hydration rule intact everywhere it doesn't strictly need
breaking. FAQ accordion uses `<details>`/`<summary>`, no JS needed at all.
`client:*` only if a mobile nav toggle genuinely needs it; prefer vanilla even there
if it works.

Hero images: CSS `16:9` + `object-fit: cover`; never strip `<Image />`
`width`/`height` to achieve this.

---

## 4. CMS (port 3737)

Express + `tsx`, `multer` 10MB limit shown in the UI. Every endpoint returns JSON on
failure, never an unhandled error page. Left-nav shell from the start: Articles, Add
Article, Articles Health, Articles Update, Team, Dashboard. Dense admin type scale,
distinct from the public site's tokens.

**Shared write path** (used by single-file, batch, Health, and Update — not
duplicated): `validateFrontmatter.ts` → `writeArticle.ts` → optional
`generateLlmsTxt.ts`. Hero image is valid only if a file was staged this session, or
zip-paired via `{slug}.png` — a pre-existing path string (especially containing
`REPLACE`/`TODO`/`placeholder`) never counts. Slug drives filename; a mismatch is
rejected outright, not silently corrected. `MAX_EXTERNAL_LINKS = 5` (trim oldest
first) is one shared constant used by both Health's Add and Update's Confirm.

**Add Article:** single `.md`, or batch multi-`.md` / single `.zip` containing
`{slug}.md` + optional sibling `{slug}.png` (auto-paired by filename). Shared
Missing Fields / field checklist, collapsed by default, count badges. Author
dropdown sourced from Team, promoted to always-visible top-of-form placement
alongside hero image. "Generate All" runs sequentially with live per-row status;
`generateLlmsTxt.ts` fires once after the whole batch, not per file.

**Articles Health** — five symbols on collapsed rows, gray = unscanned. Links is the
only fully actionable indicator; Meta/Schema/Sitemap/Speed are diagnostic only this
build.

- **Internal Connect** (`cms/lib/connectInternalLinks.ts`): pillar
  (`articleType: comprehensive`, no `supportingKeyword`) links to each cluster's
  comprehensive article sharing the same `pillarKeyword`; supporting articles link
  to the pillar (mandatory) plus same-`supportingKeyword` siblings. Published/
  non-draft only, ever. Writes `internalLinks`, inserts a signpost line before
  `## Related` (or at the end of the body if no such heading exists), bumps
  `updatedDate`. Per-row and global controls, both sequential, never parallel.

- **External propose** (`cms/lib/externalLinkSearch.ts`): priority order —
  pre-seeded sources → body links → `cms/data/sources.json` → **DataForSEO**
  `POST /v3/serp/google/organic/live/regular` via `serpResults({keyword, depth})`
  from the mirrored `dataforseo.js`. Auth: HTTP Basic, base64(`login:password`),
  read from `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`. Query pattern:
  `"{targetKeyword} {pillarKeyword} guide OR resource OR statistics"`. Consume the
  **normalized** return shape (`{available, items[]}`), not the raw DataForSEO
  envelope — either copy `dfsPost` + its mapper together, or reimplement the same
  mapping, but don't guess at raw fields like `rank_absolute` at the call site.
  30-second timeout, no retries — this matches the existing pattern, don't add
  retry logic. On `available: false`, skip that candidate source and surface the
  `reason` string in the UI rather than treating it as a hard failure. Hardcoded
  `location_code: 2840` (US) / `language_code: 'en'` — keep these constants unless
  there's an explicit reason to vary by market. Mandatory topic-relevance filter
  before any candidate surfaces. Review-gated always: "Propose All" writes nothing
  until "Add Selected" is clicked.

- **Speed**: mirror `runPagespeedPanel` (mobile + desktop, sequential — this *is*
  the existing rate-limit strategy, don't parallelize it). Three distinct states,
  driven by the API response itself, not a URL heuristic alone:
  - **Not configured** — the exact string `'GOOGLE_PAGESPEED_API_KEY is not
    configured'` comes back. Render "not configured."
  - **Configured but scan failed** — `ok: false` **with** a `status` field present
    (typical for a dead/404/unreachable URL) or a timeout message. Render this
    distinctly from "not configured" — it means the key works but the target
    couldn't be scanned, which is the expected state for every seed article in this
    build (no `published_url` yet, since nothing deploys in Layer 1).
  - **Success** — `ok: true`, with `scores`/`coreWebVitals`/`fetchTime`/`finalUrl`.
  - Known accepted gap, matching TNV's own behavior exactly: the client doesn't
    inspect `lighthouseResult.runtimeError`, so a Google 200-with-load-failure can
    still surface as `ok: true` with null scores. Do not add a fourth state to
    handle this — mirror TNV as-is rather than over-engineering past what it does.
  - Scan button disabled with a stated reason on articles with no live
    `published_url`. Verify the integration itself (key loads, request fires,
    response parses, scores color correctly) with a one-off test against any real
    reachable URL — not the seed articles.

- **Meta/Schema/Sitemap:** diagnostics only, read from frontmatter and
  `site/dist` when present. No fix actions this build.

Persistent session banner after any Links or Update write: "N articles updated this
session — remember to commit, push, and deploy."

**Articles Update:** consumes a JSON array only (`slug`, `newParagraph`,
`newUpdatedDate`, `newSources: [{title, url}]`). Unmatched slugs flagged clearly,
never silently skipped. Side-by-side current-vs-proposed WTS paragraph. "Confirm"
swaps only the text between the markers (markers themselves stay in place), sets
`updatedDate` to `newUpdatedDate`, and maps checked sources through the same
external-link writer used by Health (`newSources[].title` → `externalLinks[].label`,
`newSources[].url` → `externalLinks[].url`; same 5-link cap, same trim rule, same
signpost pattern). "Confirm All" is sequential.

**Confirmation receipt (optional, non-blocking):** after Confirm/Confirm All, offer
a "Download confirmation receipt" `.json` export — array of
`{slug, confirmedDate, confirmedAt}`. `confirmedDate` is the field TNV's importer
actually applies and is required, format `YYYY-MM-DD`; include `confirmedAt` too
since TNV's parser accepts it even though it isn't persisted. **This is a manual
hand-off, not an API call** — TNV's `importConfirmationReceipt.js` is invoked
through a drag-drop/file-picker in TNV's own Articles Update screen
(`.json`/`application/json` only). The operator downloads this file from the
destination CMS and manually re-uploads it into TNV; there is no webhook or push
path to build here.

**Dashboard:** `GET /articles` read-only table only, as previously specified.

---

## 5. DESIGN TOKENS

Parse `site/Design Guide.md`'s fenced token block into `tailwind.config` theme
extensions (colors, fonts, spacing, type scale, screens). Google Fonts with
`font-display: swap` unless the guide names self-hosted files. Apply across every
listed component. **Do not touch:** schemas, any CMS file, `site.ts`, `url.ts`,
robots/RSS/sitemap logic, JSON-LD, heading count/hierarchy, or the
presence/order of `AuthorBio`/`Breadcrumbs`/`RelatedLinks`/`Sources`/`FaqBlock`.

WCAG AA contrast, visible focus states (never `outline: none` with no replacement),
44×44px minimum tap targets, no horizontal scroll at 200% zoom.

---

## 6. SEED — via real CMS flows, then unpublished

Generic cluster, no client identity, shaped so **both** internal-link Connect rules
actually fire — note the middle row is its own distinct `comprehensive`-typed
article, not just "2 supporting articles":

| Role | articleType | pillarKeyword | supportingKeyword |
|---|---|---|---|
| Pillar hub | comprehensive | technical seo | (omitted entirely, not `""`) |
| Cluster comprehensive | comprehensive | technical seo | core web vitals |
| Sibling | howto | technical seo | core web vitals |

Titles/descriptions hit the 55–60 / 140–160 contract. Each body includes
`## Where Things Stand` plus both HTML comment markers, exactly once.

1. Write **Dori Fussmann** as a real team entry (Founder, The Night Ventures; real
   bio/credentials; `sameAs` only if a real URL is actually known — do not invent a
   LinkedIn). Photo: a real headshot if one exists in TNV's assets, otherwise a
   non-photoreal initials avatar at `site/src/assets/team/` for Activation to
   replace. Seed via the CMS team form if built by this point, else
   `writeTeamMember.ts` directly.
2. One hand-written service, so the home page's scroll section isn't empty.
3. Build `{pillar-slug}-drafts.zip`: three `.md` files + sibling `.png` heroes. Run
   batch Generate **through the CMS** — this is the pipeline proof, not a
   hand-authored shortcut. Temporarily `draft: false`.
4. Run "Connect All Internal Links." Confirm: pillar → cluster-comprehensive link,
   and sibling ↔ sibling + sibling → pillar links, all correctly wired.
5. Run Propose / Add External Links **against live DataForSEO** — real credentials,
   real search, real candidates surfaced and added, not just the "not configured"
   fallback rendering.
6. Confirm the WTS HTML comments survive into the built HTML (grep `dist`); confirm
   `astro build` is clean; confirm drafts are excluded from routes, sitemap, and RSS.
7. Set all three seed articles back to `draft: true`, regenerate `llms.txt`. They
   stay in the repo, unpublished, until Site Activation explicitly replaces or
   deletes them.
8. One-off PageSpeed scan against any real, already-live URL (not the seeds, which
   structurally have no `published_url` yet) — confirms the integration mechanics
   independent of deployment status.

---

## OUT OF SCOPE (enforced)

No git remotes, no Vercel, no custom domain, no Supabase or any database
integration, no analytics, no auth, no "Preview JSON-LD," no fix actions for
Meta/Schema/Sitemap, no hardcoded collection content inside `.astro` files — home
hero chrome is the sole placeholder-copy exception, and even that gets replaced at
Site Activation.

$site_build_prompt$,
  updated_at = now()
where key = 'site_build_prompt';
