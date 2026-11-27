# DECISIONS

Append-only log. Newest at the bottom. Format: date · decision · why · alternatives rejected. Declined ideas are logged here too so they aren't re-pitched.

## 2026-11-27 · Adopted the CEO ↔ Claude (CTO/PM) operating framework
- **Why:** run work through Claude as tech lead with sub-agents; CEO sets goals, Claude owns execution and quality.
- **Key terms (CEO decisions):** Claude merges to main on green checks; silence on a plan = go; additive DB migrations may be applied straight to production (no paid Supabase branches); model choice per agent is Claude's call.
- **Rejected:** Claude Code as the working environment (CEO preference: Claude app chat).

## 2026-11-27 · Fan-Out v2: what gets pushed (CEO)
- **Decision:** every Opportunity is shown as a card. Only **new article** goes to AEO Generation, and only when the user clicks Write this. Anything on a fundamental page (home, pricing, how it works) is a manual to-do in Fan-Out and never goes to AEO Generation.
- **Why:** AEO Generation writes articles only; fundamental pages are too sensitive to automate.
- **Rejected:** the earlier rule that blocked comparison articles on "who should I use" topics unless the user opted in. If a comparison article is what wins, the card says so.

## 2026-11-27 · Fan-Out v2: build decisions (Claude)
- **Existing data is kept.** Situations saved before v2 stay as version 1, with their runs and topics. They can be given fields from their free text; the original text is kept in `details.original_description`.
- **Prompts with runs are archived, not deleted.** Raw runs are always kept (spec section 8).
- **One brand system.** Fan-Out builds on the Prompt Tests brand list, name matching, capture code and spending cap.
- **Runs stay browser-driven for now** (spec open question 4). Captured runs survive a closed tab.
- **One migration per part**, not one up front: each part's schema is designed with its code.
- **Monthly cap left as is** (Rupert $25). CEO is fine with raising it when needed.
- **Verification run on Rupert**, the only company with Fan-Out data. CEO: every new Scenario needs a Baseline anyway.

## 2026-11-27 · Ideas declined (CEO)
- Make "Moved" require a change larger than the noise margin.
- Run captures in the background on the server.
- (The working `test` script and the typecheck baseline were done as part of the build.)

## 2026-11-27 · Fan-Out v2: decisions made while building parts 2 to 6 (Claude)
- **The score is never stored.** It is recalculated from the stored answers and today's tracked list each time, so old Runs stay comparable when brands or thresholds change. Rejected: storing scores per Run (they would go stale).
- **A label counts only with a quote that is in the answer and about that brand.** Otherwise the mention is Listed. Rejected: trusting the AI's label alone.
- **The margin uses two pseudo-runs each way** (Agresti–Coull), so 0 of 63 is not shown as certain. It gives about ±12 at 63 runs, as the spec states.
- **Query Groups hold normalized searches**, and every count per group is recalculated per Run. A new Baseline archives the old groups and regroups.
- **Cards snapshot the app's numbers at the time they were written**; that snapshot is the "before" for Moved / Not moved.
- **Acted on is read from the article itself** (`generated_articles.status`, `published_at`, `published_url`), not from the brief's status, which AEO Generation only refreshes when its page is opened.
- **Write this only for new articles with no live page**; a push that stops half-way resumes instead of making a second topic; new topics are inserted, never upserted.
- **Existing topics (fo_topics) are left as they are.** None had been pushed.
- **Admin settings are writable by any signed-in user**, like the other admin tools: the app has no admin role.
- **Parts 3 to 6 shipped as one PR (#97) with part 2**, because the old topics and push steps could not survive the new Run model as intermediate states.
