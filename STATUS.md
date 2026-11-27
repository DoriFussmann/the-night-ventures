# STATUS — The Night Ventures (TNV)

Maintained by Claude at the end of every working session. Framework: "Operating Framework" doc in the Night Ventures Claude project.
Last updated: 2026-11-27 (initial version, from a read-only scan — builds not yet run).

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
| `node --test tests/` | 3 node:test files (fanOut, hotTakes, monthPlan). There is no `test` script. |
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
- Migrations are in `supabase/migrations/`, numbered 001–089. **002 is missing and 074 is duplicated** (`074_audit_ai_prompts.sql`, `074_cron_runs.sql`). The next migration is **090**. There is no `supabase/config.toml`.
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

## Current state
- HEAD at setup: `3ab2b79` "Fan-Out Engine… (#94)".
- Builds, lint, typecheck and tests have not yet been verified by Claude. The first session should establish a known-good baseline.

## Open work
- (none recorded yet)
