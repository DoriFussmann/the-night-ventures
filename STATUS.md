# STATUS — The Night Ventures (TNV)

Maintained by Claude at the end of every working session. Framework: "Operating Framework" doc in the Night Ventures Claude project.
Last updated: 2026-11-27 (Fan-Out v2 build in progress).

## What this is
TNV is the CMS and control plane for all destination sites (hey-rupert and others). Each company lives at `/company/:companyId/...`. Feature areas:
- **AEO playbook, generation and fan-out:** strategy, briefs, month plans, hot takes.
- **Articles:** generate (`api/generate-article.js`), publish (`api/publish-to-site.js`), sync from live (`api/sync-from-live.js`).
- **Audit and external audit snapshot:** SEO audits, with a daily snapshot cron.
- **Analytics:** GSC, GA4, Bing.
- **Image generator:** `api/generate-image.js`.
- **Site build flow, core version, integrations.**
- Global admin at `/admin`, including the GitHub access card.

## Stack
- Vite, React 18 in **JS/JSX (not TS)**, Tailwind, Radix, react-router v6, react-query. Routes are in `src/App.jsx`, tool pages in `src/pages/tools/`, browser Supabase client in `src/lib/supabase.js`.
- `api/*.js` holds 21 Vercel serverless handlers, which are thin and delegate to `lib/<feature>/`. Locally, `vite.config.js` serves `api/` under `vite dev`.
- `tools/builder/` is a separate Python and HTML builder for a published Claude artifact, not imported by the app. When it changes, also commit `tools/builder/built/builder.html`.

## How to build / check
| Command | Notes |
|---|---|
| `npm run build` | vite build |
| `npm run lint` | `eslint . --quiet` |
| `npm run typecheck` | `tsc -p jsconfig.json` |
| `npm test` | `node --test tests/*.mjs`: 3 node:test files (fanOut, hotTakes, monthPlan). `node --test tests/` fails on Node 22. |
Typecheck baseline: **805 errors on main** (2026-11-27), almost all TS2322 from untyped UI components (`Button`, `Textarea`, …). Every new use of those components adds one. The gate is "no new kinds of error", not the count.

There is no CI and no `.github/` folder.

## Deploy
- Merging to `main` deploys to production on Vercel (assumed to be Git integration, not yet verified).
- `vercel.json` routes `/api/check-article-update?action=X` to `/api/X` for 10 actions, and sends everything else to the SPA's `index.html`. Keep using this pattern for new actions; it is likely there because of a Vercel function limit, though that isn't confirmed. `check-article-update.js` is itself a real handler (WTS check, `maxDuration` 300).
- Crons: `/api/audit-snapshot` at 09:00 UTC and `/api/publish-schedule` at 16:00 UTC (scheduled article publishing).

## Publishing to destination sites
- `lib/publish-to-site/handler.js` uses Octokit with a single `GITHUB_TOKEN` (falling back to legacy `GITHUB_TOKEN_<KEY>`). The destination is configured per company (migration 041, `lib/publish-destination/`).
- It writes to `site/src/content/articles/` and `site/src/assets/articles/` on a `publish/YYYY-MM-DD-HHMM…` branch.
- With `MERGE_VIA_API = true`, **new articles merge straight to the live branch**. Edits and removals open a PR instead.

## Data
- Migrations are in `supabase/migrations/`, numbered 001–094. **002 is missing and 074 is duplicated** (`074_audit_ai_prompts.sql`, `074_cron_runs.sql`). The next migration is **095**. There is no `supabase/config.toml`.
- **Env var names** (values only in Vercel):
  - Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
  - Supabase and AI: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.
  - Images: `UNSPLASH_ACCESS_KEY`, `SHUTTERSTOCK_API_TOKEN`, `SHUTTERSTOCK_SUBSCRIPTION_ID`, `IMAGE_STOCK_ORDER`, `IMAGE_STOCK_MIN_SCORE`.
  - Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `INQUIRY_TO_EMAIL`.
  - SEO and analytics: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `SEMRUSH_API_KEY`, `MOZ_API_TOKEN`, `GOOGLE_PAGESPEED_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `BING_WEBMASTER_API_KEY`.
  - Other: `CRON_SECRET`, `GITHUB_TOKEN`.

## Sensitive areas (need CEO yes per framework)
- The publishing pipeline (it writes to every company's live repo), auth pages and `AuthContext`, the shared `GITHUB_TOKEN`, and the cron handlers.

## Known quirks
- The rewrite indirection in `vercel.json` is confusing. Read it before adding API routes.
- Cron auth was not verified in `audit-snapshot.js` or `publish-schedule.js`. Check this before touching them.
- Long handlers use `maxDuration` 300, which depends on the Vercel plan.

## Fan-Out Engine (v2)
- Spec: `claude/fan-out-engine-spec.md` in the Night Ventures Claude project. Built 2026-11-27 (PRs #96, #97, #98). **The project copy of the spec is the only current one**: read it with the Projects tool before working on the engine, not an attached or pasted copy.
- **Flow:** Situation → Persona → Prompts (frozen) → Run → Summary (score, Query Groups, cards, comparison) → Push ("Write this").
- **Code:** `lib/fan-out/` holds the logic; all of it except `handler.js` and `pages.js`'s fetch is pure and covered by `tests/fanOut*.test.mjs`.
  - `core.js`: Situation, persona, prompts, settings defaults (`DEFAULT_SETTINGS`, including every AI prompt template).
  - `score.js`: Mentioned / First named / Recommended, margins, mention labels.
  - `groups.js`: Query Groups, Opportunity / Win / Skip, cards, takeaway, brief fields.
  - `compare.js`: Baseline vs a later Run, Moved / Not moved, the re-run reminder.
  - `pages.js`: reads pages ChatGPT cited. The addresses are untrusted: redirects and DNS are checked, 300 KB cap, linear-time HTML stripping.
  - `handler.js`: actions behind `/api/fan-out` (`structure, check, persona, prompts, start_run, run, finish_run, label, score, groups, card, takeaway, sync`).
  - Page: `src/pages/tools/FanOut.jsx` with `src/pages/tools/fanOut/{api.js, Score.jsx, Groups.jsx, Compare.jsx}`. Admin: `src/pages/admin/FanOutSettingsCard.jsx`.
- **Tables:** `fo_situations` (the Scenario; `version` 1 = free text from before v2), `fo_prompts` (`archived_at` instead of delete once a prompt has runs), `fo_scenario_runs` (a Run; `legacy` = captures from before Runs existed), `fo_runs` (one capture), `fo_query_groups`, `fo_cards`, `fo_insights`, `fo_settings` (one global row of overrides). `fo_topics` is from the engine before v2: kept, no longer written.
- **Measurement is recalculated on read** from the stored answers and today's brand list (`score` action). Nothing measured is stored except mention labels (AI, set once) and the snapshot on each card.
- It reuses Prompt Tests for the brand list and aliases (`pt_brands`), name matching and the ChatGPT capture (`lib/prompt-tests/derive.js`), and the monthly spending cap (`pt_settings.monthly_cap`, shared; Rupert $25, others $10).
- ChatGPT's brand tag carries the brand name in `markdown` and a description in `title`. Captures stored before 2026-11-27 only kept the description; the name is read from `raw`.
- A Run is driven from the browser, four captures at a time; the tab must stay open. A closed tab loses nothing: the Run stays open and continues.
- One request never relies on more than 1,000 rows (Supabase's cap): captures are read per Run.
- Preview deploys use the production database (there is no staging), so a migration has to be applied before its preview can be checked. The branch address `the-night-ventures-git-<branch>-team-rupert.vercel.app` is stable per branch; each address needs its own sign-in.
- **Measured (Rupert, F001 Baseline, 2026-11-27):** 63 captures, $0.252, 20 minutes, none failed. Step 5: grouping, 3 cards and the takeaway used 23,207 input and 1,457 output tokens (about $0.09 on Sonnet); labeling was not metered on that Run and is from now on (`fo_scenario_runs.summary_usage`).

## Current state
- Build, lint and tests (71) pass. Fan-Out v2 is live.
- Not yet exercised on live data: an Opportunity card, the five rule-based actions, "Write this", and sorting a second Run's searches into the frozen Query Groups (spec 13.2). Rupert is named in half or more of the runs for every search in its three Scenarios, so they have Wins only. Both paths are covered by tests.

## Open work
- Fan-Out: a second Run of F001 (Rupert), to test Query Group freezing and the Baseline comparison on live data.
- Fan-Out: Query Groups made before PR #98 (F001, F002, F003) have no "who should I use" flag, so their Opportunities would default to New article. New groupings carry it.
- Fan-Out: `fo_cards.comparison` is unused since PR #98.
- Fan-Out: run a Scenario where the brand is weak, to see Opportunity cards and "Write this" on live data.
- Fan-Out: remove the dead code of the old topics step (`topics` action in `handler.js`; `buildTopicsPrompt`, `parseTopics`, `topicStats`, `decideAction`, `briefFromTopic` and friends in `core.js`, with their tests).
- Fan-Out: two tabs grouping the same Run at once can put one search in two groups. No lock yet.
- Fan-Out: the page reader checks what a name resolves to before fetching, but does not pin the connection to that address.
- Fan-Out: the spec's "Real move" rule (change larger than the margin) reports a move about 1 time in 6 when nothing changed. The margin of a difference is about 1.4 times wider. CEO was told; left as the spec says.
