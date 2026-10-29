# Audience Build — setup (one time)

Audience Build picks the best AudienceLab intent segments for a company and
counts how many high-intent people with a validated business email they hold.
Spec: TNV Lead Sourcing Engine — AudienceLab Spec (Claude doc).

1. Supabase → SQL Editor → New query → paste the full contents of
   `supabase/migrations/068_audience_build.sql` → Run, then the same for
   `069_audience_build_settings.sql`. Both are safe to re-run.
2. Vercel → Project → Settings → Environment Variables → add:
   - `AUDIENCELAB_API_KEY` — AudienceLab → Account → API keys
   - (optional) `AUDIENCE_BUILD_MODEL` — Claude model for matching; default `claude-opus-5-5`
   `ANTHROPIC_API_KEY` must already be set. Then Deployments → Redeploy.
3. Admin → **AudienceLab taxonomy** → **Sync now** (about 20 s; ~45,000
   segments). Shared by all companies. A weekly Vercel cron (Mondays 11:00
   UTC, needs `CRON_SECRET`) re-checks AudienceLab and rewrites the table only
   if the list changed; "Check for updates" in Admin does the same on demand.
4. Admin → Audience Build → **Target pool multiplier** (default 3×): fresh
   people needed per day = leads sent per day × this.
5. For each company: set Sending capacity, then **Find audiences**.

## How matching works

1. Claude reads Company Intelligence and writes buyer-side search phrases plus
   competitor/alternative names.
2. Postgres full-text search (`search_al_segments`) over segment topic,
   taxonomy keywords, category and description returns ~80 candidates.
   Competitor names match segment topics by trigram similarity.
3. Claude ranks the candidates 0–10 and the page shows the top 10 for "researchers are buyers right now".
4. The page counts the top 5 via AudienceLab `/insights` (high intent,
   business email with a validation status; 7-day and 1-day windows) one at a
   time, best first, and stops once one segment alone covers the target pool. Each count takes 10–30 s; results are cached 12 h in
   `al_segment_counts` and shared across companies.

Do Not Call is deliberately not a filter: it governs phone outreach, and on a
test segment it removed 76% of the pool.

## Taxonomy keywords

AudienceLab's API returns segments without keywords, so keywords come from the
taxonomy sheet AudienceLab publishes, stored in
`lib/audience-build/data/al-keywords.json.gz` (`{ segment_id: keywords }`).
When AudienceLab ships a new sheet, export its first tab to CSV and run:

    node scripts/build-al-keywords.mjs path/to/taxonomy.csv

then commit the updated file and re-sync.

## Step 3: who to target (ICP filters)

After saving segments, **Who to target → Draft with Claude**:

1. The page reads the real makeup of the selected segments (one `/insights`
   call: seniority, department, titles, company size, revenue, industry, and
   what share of people have each field).
2. Claude drafts filters from Company Intelligence + that makeup, using only
   values AudienceLab accepts (`GET /audiences/attributes/*`). Unknown values
   are dropped.
3. You edit them. **Check impact** counts fresh people per day as each group
   of filters is added (one call per row, cached 12 h).
4. **Approve Filters** saves them to the config and to the company's
   `icp_*` fields.

AudienceLab semantics (verified): values in one filter are OR'd, filters are
AND'ed, several segments are a union; include filters drop people with an
unknown value, exclude filters keep them.
