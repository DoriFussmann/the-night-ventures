# The Night Ventures — Content Pipeline System Reference

Living reference for the SEO content pipeline in this app (TNV), and how it handoffs to the separate Rupert CMS and Astro site.

---

## 1. Overview

This system is an SEO content pipeline for company sites (notably Rupert / expert-managed investor outreach): keyword architecture is stored per company, supporting-keyword clusters and pillar hub articles are planned with AI (optionally grounded on pasted Semrush keyword data), full draft articles are generated sequentially into CMS-ready markdown, drafts are saved to an in-app Articles library and/or downloaded as `.md` files, and publishing (images, author, links, go-live) is completed manually outside this app. Coverage status (`planned` → `drafted` → `published`) is tracked in TNV so the team can see what exists vs. what still needs writing or shipping.

---

## 2. Architecture Map

### Topic Generator

In-app SEO coverage dashboard and cluster planner. Lives at `src/pages/tools/ArticleTopicSuggestion.jsx` (route `/company/:companyId/article-topic-suggestion`), with planning API `api/plan-cluster.js`. Owns: syncing pillar/supporting keywords from Company Data into the coverage tree, Plan Cluster / Plan Pillar Article proposals (Anthropic + web search), review/steer/confirm, cluster markdown download/upload, and article status cycling (`planned` → `drafted` → `published`, with optional published URL).

### Article Generator

In-app draft writer. Lives at `src/pages/tools/ArticleGeneration.jsx` (route `/company/:companyId/article-generation`) plus helpers under `src/pages/tools/articleGeneration/`, with generation API `api/generate-article.js`. Owns: intake of Topic Generator cluster/pillar `.md` exports, article selection, sequential generation (comprehensive first), content-contract validation, per-article / zip `.md` download, save into the Articles library, and marking matching coverage rows as `drafted` with frontmatter.

### Articles library

In-app library of saved full drafts. Lives at `src/pages/tools/Articles.jsx` (route `/company/:companyId/articles`), backed by `generated_articles`. Owns: browse/filter/search saved drafts, read frontmatter + body, download `.md`, delete. Does not perform CMS publish. Schema allows `status` `drafted` | `published`, but nothing currently advances library status when an article is published via the separate CMS (no callback into TNV). Open decision: leave the library as a permanent drafts record, or add a manual “mark published” action mirroring Topic Generator’s coverage view (see Section 7).

### Coverage store

Supabase table `content_coverage` (migration `supabase/migrations/010_content_coverage.sql`). Owns the per-company JSON tree: pillars → supporting keywords → `plannedArticles` (plus optional `pillarArticle`, cluster rationale, published URL/timestamps). Mirrored from Company Data keyword architecture; filled/updated by Topic Generator confirm and Article Generator drafted updates.

### Company Data (keyword architecture + positioning)

Not a separate pipeline product surface name in the nav sense of “generator,” but required upstream. Lives at `src/pages/tools/CompanyData.jsx` (route `/company/:companyId/company-data`), table `company_profiles`. Owns: domain/product/descriptions, `core_keywords` (pillar + supporting keyword lists; UI defaults toward 5×5 slots, Rupert’s locked architecture is 7 pillars × 5 supporting), and `competitors` used by Plan Cluster / article generation.

### Separate CMS (Rupert CMS)

Lives in a separate Express app under `cms/` in the Rupert site repo (not this repo). Server `cms/server.ts` (port 3737), UI `cms/public/index.html` + `app.js`, write logic `cms/lib/writeArticle.ts`, validation `cms/lib/validateFrontmatter.ts` (hand-rolled mirror of the Astro Zod schema, not Zod itself).

Flow: drop `.md` → `POST /parse` (gray-matter parse + field-by-field validation checklist shown in UI) → drop hero image(s) separately (`#image-drop`, up to 3, fills `image` / `image2` / `image3` slots) → `POST /api/upload-image` (max 10MB, MIME-filtered, no dimension/format checks) → fill remaining manual fields (author, internalLinks, externalLinks) → **Generate** (disabled until validation passes and a session-staged hero image exists) → `POST /api/articles` → `writeArticle()`.

Critically: the CMS **never trusts a path already in the uploaded `.md`'s `image:` field** — it requires a real image uploaded in that session, copies it to `site/src/assets/articles/{slug}/hero{ext}`, and rewrites the frontmatter path itself. One article at a time; no bulk/folder import.

### Astro site

Astro 5, static output (`output: "static"`), `trailingSlash: "always"`, hosted separately from this repo, domain `https://www.heyrupert.com`. Content Layer API (`site/src/content.config.ts`, not the legacy `src/content/config.ts` path) defines three collections: `articles` (the schema this whole pipeline targets), `team` (author bylines, referenced by `author` id — build throws if missing), `services`. Markdown only — no MDX installed.

URL for an article is `/articles/{slug}/`, driven by the frontmatter `slug` field, not the filename (though CMS convention keeps them matching). `@astrojs/sitemap` is installed with a custom `serialize` wiring `lastmod` to `updatedDate`. RSS (`rss.xml.ts`) uses `date` for `pubDate`, not `updatedDate`. `robots.txt` is dynamic. `llms.txt` is regenerated by a standalone script (`scripts/generate-llms.mjs`) wired into `prebuild`, since Astro's own build doesn't know about CMS writes.

Article schema enforces strict lengths (`title` 55–60 chars, `description` 140–160, `tags` 4–6, `imageAlt` ≥10) — this is the exact contract `api/generate-article.js` targets.

### Related API (legacy / unwired)

`api/topic-generator.js` implements a DataForSEO + Anthropic “find topics” pipeline. **No current UI route in `src/` calls it.** Treat as present-but-unwired unless/until reconnected. Do not confuse with the live Topic Generator UI, which uses `api/plan-cluster.js`.

---

## 3. Data Model

Source of truth: `supabase/migrations/`. Below are the tables central to the content pipeline (plus `companies` as the parent key). Other app tables (`profiles`, `inquiries`, social/trackers, design guides, general documents, etc.) exist but are outside this pipeline.

### Plain language

- **`companies`** — Workspace company records (`id`, `name`). All pipeline rows key off `company_id`.
- **`company_profiles`** — One profile per company: positioning copy (`domain`, `product_name`, abstract/short/medium/long descriptions, `custom_fields`), SEO architecture in `core_keywords` (JSON array of `{ keyword, supporting: string[] }`; UI defaults toward 5 pillars × 5 supporting; Rupert locked at 7×5), and `competitors` (JSON array of `{ name, url }` for Plan Cluster).
- **`content_coverage`** — One row per company. `pillars` JSON: `{ slug, keyword, pillarArticle?, supporting: [{ slug, keyword, plannedArticles, clusterRationale? }] }`. Planned articles carry type, target keyword, status, titles, key messages, frontmatter-after-draft, publish metadata, etc. (shape enforced in UI code, not SQL columns).
- **`generated_articles`** — Full saved drafts from Article Generator: plan fields (`pillar_keyword`, `supporting_keyword`, `type`, `target_keyword`, `status`), frontmatter fields, markdown `body`, and `where_things_stand_sources` (JSON `{ url, note }[]` for manual external-link fill — not written into `.md` frontmatter). Unique on `(company_id, slug)`. Default `draft = true`, default library `status = 'drafted'`.

### Compact table

| Table | Key columns | Notes |
| --- | --- | --- |
| `companies` | `id`, `name`, `created_at` | Parent entity |
| `company_profiles` | `company_id` (unique), `domain`, `product_name`, descriptions, `custom_fields`, `core_keywords`, `competitors`, `updated_at` | Keyword architecture + positioning |
| `content_coverage` | `company_id` (unique), `pillars` (jsonb), `updated_at` | Planning / coverage tree |
| `generated_articles` | `company_id`, `slug` (unique together), plan + frontmatter fields, `body`, `where_things_stand_sources`, `draft`, `status`, timestamps | Articles library |

**`generated_articles.type`:** `comprehensive` \| `howto` \| `comparison` \| `faq` \| `flex`  
**`generated_articles.status`:** `drafted` \| `published`  
**Coverage article status (in JSON, not a SQL enum):** `planned` \| `drafted` \| `published`

---

## 4. User Flow

Legend:

- **[TNV-AUTO]** — Built and automated (or fully operable) in this app
- **[MANUAL-EXTERNAL]** — Done by the user outside this app
- **[DESIGNED-NOT-BUILT]** — Planned but not implemented here

1. **Create / select company** — [TNV-AUTO]  
   Companies picker and company-scoped routes.

2. **Enter company positioning** — [TNV-AUTO]  
   Company Data: abstract, short description, competitors, etc., used by Plan Cluster and Article Generator prompts.

3. **Pillar + supporting keyword architecture** — [TNV-AUTO] (storage/UI) + [MANUAL-EXTERNAL] (how keywords are chosen)  
   Stored in `company_profiles.core_keywords` via Company Data.  
   Keyword selection was done via Claude chat (this project’s conversation), using the user’s Semrush account connected as a Claude.ai MCP connector (not this repo’s tooling). Process: seed candidate pillar keywords by search volume across three intent zones (problem-aware/high-intent, process-education, comparison/alternatives) relevant to Rupert’s positioning (expert-managed investor outreach for founders raising capital); pull `domain_overview` / `phrase_related` / `phrase_these` / `phrase_questions` Semrush reports; filter out wrong-buyer-intent keywords (e.g. investor-side “how to invest in startups” queries, real estate, loans/grants — explicitly excluded per company positioning); check CPC as a buyer-value signal; check for cross-pillar keyword-territory collisions before finalizing. Final architecture: **7 pillars × 5 supporting keywords** each, locked after iterative review (initial 6-pillar list expanded to 7 after the user flagged “pitch deck” as an underexplored high-volume territory, which a full sweep confirmed was a genuine gap alongside “venture capital” and “cap table” as other candidates — venture capital was added, cap table was cut, and “angel investors for startups” was cut in favor of “investor crm” specifically because a brand-new domain (heyrupert.com, founded 2026, zero backlink history) cannot compete at KD 50–70 in year one; the CRM cluster’s ~KD 17 average was chosen deliberately as an early-authority on-ramp).

4. **Coverage tree sync** — [TNV-AUTO]  
   Topic Generator loads Company Data keywords and upserts/merges into `content_coverage.pillars`.

5. **Keyword data grounding (Semrush paste)** — [MANUAL-EXTERNAL] (research/format) + [TNV-AUTO] (paste field into Plan Cluster / Plan Pillar)  
   UI placeholder: “Paste Semrush keyword data…”. Not an automated Semrush or DataForSEO pull from the Topic Generator screen.  
   Also done via Claude chat + Semrush MCP connector, plus a standalone React artifact (“Keyword Slip,” built during this project) that automates the same pull-and-format step: user enters a supporting or pillar keyword (plus optional seed queries and an audience filter), the artifact calls the Anthropic API directly with the Semrush MCP server attached, runs `phrase_related` + `phrase_questions` reports, filters out wrong-intent/junk rows, and outputs a clean `Keyword;Volume;KD` block with a copy button — this is what gets pasted into Topic Generator’s “Keyword data (optional)” field. Semrush data grounds `targetKeyword` selection in Plan Cluster / Plan Pillar so the model doesn’t invent unsearched phrasings.

6. **Plan Cluster (supporting keyword)** — [TNV-AUTO]  
   `POST /api/plan-cluster` (`mode` cluster): Anthropic `claude-sonnet-4-6` + `web_search` tool; returns rationale + 3–6 article specs.

7. **Plan Pillar Article** — [TNV-AUTO]  
   Same API (`mode` pillar): single comprehensive hub article proposal.

8. **Review, steer, regenerate, confirm** — [TNV-AUTO]  
   Topic Generator UI: edit proposal list, steering notes / regenerate, confirm into `plannedArticles` / `pillarArticle`.

9. **Download cluster / pillar plan as `.md`** — [TNV-AUTO]  
   Markdown export consumed by Article Generator intake (also supports upload-back of cluster markdown in Topic Generator).

10. **Article generation (batch)** — [TNV-AUTO]  
    Drop plan `.md` → select articles → generate one-at-a-time via `POST /api/generate-article` (comprehensive first). Failures skip; retries supported. Successful runs update coverage to `drafted` when a matching planned row is found.

11. **Save to Articles library and/or download `.md` / zip** — [TNV-AUTO]  
    Upsert `generated_articles`; serialize CMS-ready markdown (`draft: true`, empty author/links/images).

12. **Manual CMS publish prep** — [MANUAL-EXTERNAL]  
    See CMS description in Section 2. Concretely, per article: (1) open the separate CMS app at localhost:3737 (or wherever deployed), (2) drag & drop the Article Generator’s downloaded `.md`, (3) review the field checklist the CMS shows (this is what surfaced the “wrong file” confusion during testing — the *plan* `.md` from Topic Generator has no frontmatter at all and will show everything missing; only the Article Generator’s *output* `.md` is CMS-ready), (4) drag & drop a hero image — currently one of 7 pillar-branded template images kept locally by the user, assigned by matching the article’s pillar (decided deliberately over AI-generated or per-article designed images, as the simplest option that scales to ~150 articles), (5) select the real author (`team` entry, currently one real bio with `sameAs` including LinkedIn — deliberately not a fictional/placeholder persona, since Person JSON-LD and E-E-A-T signals matter for this YMYL-adjacent financial/investment content), (6) manually add `internalLinks` (cluster siblings + pillar, using real slugs — TNV’s plan proposes *which* articles to link but not live hrefs, since those don’t exist until sibling articles are actually published) and `externalLinks` (using the `where_things_stand_sources` shown in the Articles library detail modal as the primary candidate list), (7) click Generate in the CMS, which validates and writes the file into the Astro site’s content collection with `draft` set appropriately.

13. **Mark published in Topic Generator** — [TNV-AUTO]  
    Status cycle can set `published` and store `publishedUrl` / `publishedAt` on coverage articles. This is in-app tracking, not an automated CMS webhook.

14. **Public site (Astro)** — [MANUAL-EXTERNAL]  
    Astro build (`astro build`) picks up any non-`draft: true` article in `site/src/content/articles/` and generates its static route; deploy mechanics (Vercel or similar; exact host outside this repo’s visibility) are outside this repo. No CMS→Astro webhook or auto-deploy has been discussed or built; presumed manual `git push` / deploy trigger after a CMS write, matching the “manual, one article at a time” nature of the CMS itself.

15. **Launch-order ranking** — [DESIGNED-NOT-BUILT]  
    Discussed but not built. Design intent: rank confirmed supporting-keyword clusters by a volume-to-difficulty ratio (using the Semrush data already gathered at planning time — no new data source needed) to decide which of the 35 clusters to write/publish first, prioritizing fast-rankable, low-competition territory (e.g. “investor crm,” KD ~17 average) ahead of harder clusters, rather than working pillar-by-pillar in list order.

16. **Monthly update scan** — [DESIGNED-NOT-BUILT]  
    Discussed but not built. Design intent: the scan/decision logic belongs in TNV (reuses existing Anthropic + web search infrastructure and the human-review-queue pattern from Plan Cluster), but the read/write of the actual article content must go through the live site/CMS, not TNV’s stored copy, because published articles may have manual edits (added links, author, images) since generation that would be lost if TNV overwrote from its own memory. Planned flow: TNV scans each published article’s `<!-- WHERE-THINGS-STAND:START/END -->` markers on a schedule (~monthly), web-searches for genuine developments in the last 45 days specific to that article’s topic, and if something substantive is found, drafts a replacement paragraph and queues it for human review in TNV (approve/skip) — never auto-publishes. On approval, the update is either written back via a small CMS write endpoint (not yet built) or delivered as a corrected `.md` for the same manual CMS drop workflow already in use. Deliberately **not** built as blind automated monthly rewrites with auto-bumped `updatedDate` on every article — that pattern was explicitly rejected early in planning as a likely Google spam signal (trivial content changes + manipulated lastmod), in favor of substantive-only, human-approved updates.

---

## 5. Tech Stack

### App (from `package.json`)

- **Runtime / UI:** React 18, Vite 6, React Router 6, Tailwind CSS 3, Radix UI primitives, TanStack React Query, Framer Motion, react-markdown, JSZip, Zod, date-fns / moment, Recharts, etc.
- **Backend-for-frontend:** Vercel serverless functions under `api/` (`vercel.json` rewrites).
- **Auth / DB client:** `@supabase/supabase-js`.
- **Also present (broader app, not content-pipeline-specific):** Resend (inquiries), Stripe packages, Leaflet, Three.js, Quill, etc.

### Content-pipeline API integrations

| Integration | Where | Notes |
| --- | --- | --- |
| Anthropic Messages API | `api/plan-cluster.js`, `api/generate-article.js` (+ design-guide routes, unwired `api/topic-generator.js`) | Models in use: `claude-sonnet-4-6` (plan + generate), `claude-sonnet-5` (topic-generator / some design routes) |
| Anthropic web search tool | `web_search_20250305` / `web_search` | Used by plan-cluster and generate-article |
| MCP | — | **Not used** in this repo’s API code. Semrush MCP is used externally via Claude.ai / the “Keyword Slip” artifact (see stages 3 and 5) |
| DataForSEO | `api/topic-generator.js` only | Env: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`; **not called by current Topic Generator UI** |
| Semrush | External (Claude.ai MCP + Keyword Slip artifact) | No Semrush API client in this repo; paste `Keyword;Volume;KD` into Topic Generator |
| Supabase | Client + migrations | Profiles, companies, coverage, generated articles, etc. |

### External systems (not this repo)

| System | Notes |
| --- | --- |
| Rupert CMS | Express app under `cms/` in the Rupert site repo (port 3737) |
| Astro site | Astro 5 static site at `https://www.heyrupert.com` |

### Hosting / env (pipeline-relevant)

- Hosting: Vercel (see `README.md`).
- Secrets used by pipeline APIs: `ANTHROPIC_API_KEY` (required by plan/generate), Supabase URL/keys, optional DataForSEO for the unwired topic-generator route.

---

## 6. Key Design Decisions

Running log of durable product/engineering choices and why.

| ID | Decision (observable in code) | Rationale |
| --- | --- | --- |
| KD-01 | Article generation runs **sequentially** (one request after another; comprehensive first via `orderSelectedArticles`) | Sequential (never parallel) generation is required for internal-link coherence: each article after the first receives the *real* titles/slugs/summaries of already-generated siblings in its prompt context, so cluster-mate references are accurate rather than guessed. Parallel generation would make this impossible, since sibling N+1 can’t reference sibling N’s real output before it exists. Cost is added latency, accepted as the correct tradeoff for correctness over speed. |
| KD-02 | Generated / exported articles force **`draft: true`**, `author: null`, empty `internalLinks` / `externalLinks`, null images | These fields require real assets/decisions the CMS deliberately does not trust from an uploaded file (confirmed via direct CMS investigation — see Section 2): hero images must be uploaded fresh each CMS session regardless of what path is in the `.md`, and author/links are intentionally left for human judgment (real slugs for links don’t exist until sibling articles are published; author was deliberately kept as one real, credentialed person for E-E-A-T rather than automated). `draft: true` ensures nothing goes live without a human publish step. |
| KD-03 | Keyword research in Topic Generator is **paste-in Semrush data**, not live Semrush/DataForSEO from that screen | No Semrush REST API integration was built into TNV because it requires a separate paid Business-tier product; the existing Semrush *MCP* connector (already available via the user’s Claude.ai / Anthropic-connected account) was judged sufficient for the actual pull volume (35 clusters + 7 pillars), done either directly in Claude chat or via the standalone “Keyword Slip” artifact. Full API/MCP wiring directly into TNV’s backend was scoped as a future upgrade once paste-based workflow becomes a bottleneck at higher volume, not before. |
| KD-04 | Plan Cluster treats Company Data **`competitors` as the exclusive competitor set** (prompt instructs not to invent others) | Prevents the model from inventing or hallucinating competitor names/positioning during Plan Cluster’s SERP/competitive-gap reasoning; “competitor” for this tool specifically means content/SEO competitors in the fundraising-advice space (verified against real sites like Qubit Capital), not just companies offering similar services. |
| KD-05 | Coverage planning and Articles library are **separate stores** (`content_coverage` vs `generated_articles`) | `content_coverage` is the planning/status source of truth (what’s planned, what stage it’s in) and is meant to always exist from the moment keywords are chosen, even with zero articles written. `generated_articles` only exists once real content has been generated — separating them avoids conflating “this is planned” with “this has been written,” which the dashboard design explicitly needed to distinguish (coverage checklist should show gaps even before any generation happens). |
| KD-06 | “Where Things Stand” sources are stored on `generated_articles.where_things_stand_sources`, **not** in `.md` frontmatter | Deliberate: `externalLinks` in the `.md` frontmatter was kept as a manual-only field (the user chose to handle all internal/external linking by hand). Rather than lose the genuinely useful, web-search-sourced citations found while writing the “Where Things Stand” section, they’re persisted separately as candidate sources for the user to manually promote into `externalLinks` later — without automating a decision (which links go live) the user wanted to keep manual. |
| KD-07 | Keyword difficulty capping / filtering | No hard KD cap is enforced in code; it was applied as a *human judgment rule* during the manual pillar/supporting-keyword selection phase (done in Claude chat, not in this app) — roughly KD ≤35–40 for supporting keywords on this brand-new, zero-authority domain, with a small number of explicitly justified exceptions (e.g. “angel investors for startups” cluster averaging ~KD 47, accepted because no viable lower-KD alternative existed and the topic was judged too central to skip). This reasoning lives in the planning conversation, not as an enforced product rule, since different companies/domains would need different caps. (DataForSEO KD scoring exists only in unwired `api/topic-generator.js`.) |
| KD-08 | Manual publish remains outside TNV (CMS + Astro) | The Astro site’s CMS is a separate, already-existing Express app with its own validation and asset-handling logic (see Section 2); duplicating that logic inside TNV as a second, independently-written path to the same content schema was judged more likely to cause silent drift/breakage than reusing the trusted existing path. TNV’s role was scoped as “produce a correct CMS-ready `.md`,” not “become a second CMS.” |

Add new rows here whenever a durable product/engineering choice is made.

---

## 7. Status

Checklist from what exists in this repository today (routes, tables, APIs). “Tested” means automated tests present in-repo, not informal manual QA.

### Built

- [x] Company Data: profiles, `core_keywords`, `competitors` UI + Supabase tables
- [x] Topic Generator UI + `content_coverage` sync/upsert
- [x] `POST /api/plan-cluster` (cluster + pillar modes, web search)
- [x] Cluster/pillar markdown download + upload-to-coverage
- [x] Coverage article status cycling incl. publish URL dialog
- [x] Article Generator UI: parse plan `.md`, select, sequential generate, retry, zip/individual download
- [x] `POST /api/generate-article` (web search, WTS section, validation/post-process)
- [x] Save to `generated_articles` + Articles library UI (list/filter/read/download/delete)
- [x] Coverage update to `drafted` after successful generation
- [x] Migrations through `013_generated_articles_wts_sources.sql`
- [x] Helper unit-style scripts under `scripts/test-generate-*.mjs` (local postprocess / sample checks)

### Present but unwired / partial

- [ ] `api/topic-generator.js` (DataForSEO find_topics) — **no `src/` caller**
- [ ] Articles library `status = published` sync — **genuinely unresolved**: no mechanism updates `generated_articles.status` when an article is published via the CMS (separate app, no callback into TNV). Decision still open: leave the library as a permanent “drafts” record independent of live status (simplest), or eventually add a lightweight “mark published” action in the Articles library UI mirroring the one already built in Topic Generator’s coverage view
- [x] `ANTHROPIC_API_KEY` documented in `.env.example` (added; was a real gap in the scaffold)

### Designed / pending (not built here)

- [ ] Automated Semrush (or DataForSEO) pull from Topic Generator UI — scoped as future upgrade if paste workflow becomes a bottleneck (see KD-03)
- [ ] Launch-order ranking — volume/difficulty ranking of the 35 clusters to decide write/publish order (see stage 15)
- [ ] Monthly update scan — TNV review queue for substantive WTS updates only; write-back via CMS or manual `.md` drop; auto lastmod bumps explicitly rejected (see stage 16)
- [ ] CMS write endpoint for approved monthly updates — not built
- [ ] CMS / Astro automation or sync from TNV — deliberately out of scope (see KD-08); presumed manual deploy after CMS write
- [ ] Specific Prompt tool — UI stub (“Coming soon”)

### Doc freshness check

- npm script: `npm run check:system-doc` (warning only)
- Optional git hook: `.githooks/pre-push` (enable with `git config core.hooksPath .githooks`)

---

## 8. Last Updated

**2026-08-03** — Scaffold filled with CMS/Astro architecture, keyword-selection history, Semrush paste workflow, publish handoff, future stages (launch-order ranking, monthly update scan), and design-decision rationales from project conversation.

Update this file whenever a stage in section 4 changes, or when a new design decision is made.
