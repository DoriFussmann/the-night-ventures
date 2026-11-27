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
- Migrations are in `supabase/migrations/`, numbered 001–090. **002 is missing and 074 is duplicated** (`074_audit_ai_prompts.sql`, `074_cron_runs.sql`). The next migration is **091**. There is no `supabase/config.toml`.
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

## Fan-Out Engine
- Spec: `claude/fan-out-engine-spec.md` in the Night Ventures Claude project (v2, 2026-11-27). Code: `lib/fan-out/` (core.js has no server in it and is what the tests cover), `api/fan-out.js`, `src/pages/tools/FanOut.jsx`, `src/pages/tools/fanOut/api.js`.
- It reuses Prompt Tests for the brand list and aliases (`pt_brands`), name matching and the ChatGPT capture (`lib/prompt-tests/derive.js`), and the monthly spending cap (`pt_settings.monthly_cap`, shared by both tools; Rupert $25, others $10).
- `fo_situations.version`: 1 = saved as free text before v2, 2 = structured fields. Version 1 rows are kept and still open, run and push.
- A prompt that has runs is never deleted (its runs would cascade): it gets `archived_at`. Everything reads prompts with `archived_at is null`.
- The AI prompts are templates in `DEFAULT_SETTINGS` (core.js), overridable from the single row in `fo_settings`.
- Preview deploys use the production database (there is no staging), so a migration has to be applied before its preview can be checked. Each preview URL needs its own sign-in.

## Current state
- Build, lint and tests pass on main (`9b15a8b`, 2026-11-27).
- Fan-Out v2 is being built in six parts. Part 1 (steps 1–3, migration 090) is PR #96.

## Open work
- Fan-Out v2, remaining parts: (2) Run entity, 7 runs per prompt, the score with margins and competitors; (3) Query Groups, Opportunity / Skip, cards, page reading, Insights bank; (4) Baseline vs re-run, the Acted-on loop, monthly reminder; (5) Push rules and the to-do list; (6) admin settings screen.
- One real Baseline Run on Rupert (about $1–2) to verify the score and cards, and to replace the step 5 cost estimate in the spec.
