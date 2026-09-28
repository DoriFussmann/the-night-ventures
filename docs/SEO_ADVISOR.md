# SEO AI Advisor

A regular chat. What makes it useful: whenever a real number would make an answer stronger, the Advisor hands a data question to a **data agent**, which picks the right API endpoints, calls them, and hands back compact results. Three guided stages sit on top of the chat and write approved keywords to Company Intelligence.

## Flow

```
Page load ─► health intro: Anthropic, Semrush, DataForSEO, Moz slide in, go green/red
             (account/usage endpoints only, no data credits burned)

User ─► Advisor (Sonnet)
          │  "would a number change this answer?" ── no ──► answers directly
          │  yes
          ▼
        request_data({ question, keywords, domains })
          │
          ▼
        Data agent (Haiku, lib/seo-advisor/router.js)
          reads the endpoint catalog generated from registry.js (+ live health)
          picks cheapest endpoints that fully answer, batches keywords,
          runs independent calls in parallel, falls back to another provider on failure
          │
          ▼
        Semrush / DataForSEO / Moz ──► full results → Research Data panel (UI)
                                    └► compact results → Advisor
                                    └► keyword metrics → session metrics index
```

## Stages

| Stage | Goal | Output |
|---|---|---|
| 1. Idea check | "Is there something here?" Answers five questions: demand, trend, competition, clear path, verdict. "Pass" is a valid answer. | Verdict card, saved as an insight (`idea_verdict`). |
| 2. Core keywords | 5–7 pillar keywords, proposed **one at a time**. | Approve → `content_coverage.pillars` + `company_profiles.core_keywords`. |
| 3. Clusters | Up to 5 cluster keywords per core, one at a time. Switch cores freely. | Approve → `content_coverage.pillars[].supporting`. |

Approve or Skip automatically asks for the next proposal. Auto-continue stops at 7 cores and at 5 clusters per core.

**Numbers on proposal cards are verified server-side.** A keyword can't be proposed until its volume/KD has been fetched in this session; the card shows the fetched values and which endpoints they came from, never numbers the model typed.

## The endpoint registry is the documentation

`lib/seo-advisor/registry.js` is the single place that declares every endpoint: what it answers, inputs, cost tier, vendor docs link, how to compact its result, how to extract keyword metrics, and a contract probe. The data agent's catalog and tool schemas, the health intro's endpoint list, and the contract check are all **generated from it**. There is no second document to drift.

That removes one kind of staleness by construction: the agent can't be told about an endpoint that isn't wired, and nothing wired is hidden from it. The other kind of staleness is the vendor changing their API. That's covered by three layers:

1. **Live, every page load.** Account/usage probes (Semrush unit balance, DataForSEO balance, Moz usage). A provider that's down is marked DEGRADED in the catalog, and the agent routes around it.
2. **Contracts, weekly.** `npm run check:seo-contracts` makes one tiny real call per endpoint and checks the response still has the fields the registry reads. It runs Mondays in `.github/workflows/seo-advisor-contracts.yml`, and on any PR touching the registry or providers. It costs a few cents per run.
3. **Human review, every 90 days.** Each provider has `docsVerifiedAt`. Past 90 days the health bar shows "Endpoint map review due" and the contract check fails. Review = skim the vendor changelog, adjust entries, bump the date.

There's no reliable way to read vendor docs "live" at request time. Semrush and Moz don't publish machine-readable specs. Scraping HTML docs per request would be slow and fragile, and it would still not prove the endpoint behaves as documented. A real call with a shape check proves exactly that.

### Adding an endpoint

1. Add the call to `lib/seo-advisor/providers/<provider>.js`, returning `{ available, provider, ... }` and never throwing.
2. Add one entry to `ENDPOINTS` in `registry.js`, including `answers`, `description` (written for the agent), `compact`, `metrics`, and `probe`.
3. Run `npm run check:seo-contracts <provider>`.
4. (Optional) Add a title in `src/pages/tools/seoAdvisor/dataCards.js`.

## On "you are an SEO master"

Persona lines barely move a capable model. What changes output is the job, the decision criteria, the process, and the constraints, and that's where the prompt spends its words (`lib/seo-advisor/context.js`). There's no persona line.

## Config

- `SEO_ROUTER_MODEL`: data agent model (default `claude-haiku-4-5-20251001`). Routing is classification; it doesn't need Sonnet.
- The health route is `GET /api/seo-advisor-sessions?health=1[&force=1]`. It's folded into an existing function because the project sits at 11 of the Vercel Hobby limit of 12.
