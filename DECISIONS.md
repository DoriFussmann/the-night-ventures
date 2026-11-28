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

## 2026-11-27 · Fan-Out v2: built from the wrong copy of the spec, then corrected (Claude)
- **What happened:** the build started from a copy of the spec attached to the chat. The project copy (`claude/fan-out-engine-spec.md`) was newer and said to ignore attached copies. It was only read at the end.
- **Differences found and fixed (PR #98):** the "who should I use" flag on Query Groups; the action set by rule by the app (five actions, including Commercial page or FAQ) instead of chosen by the AI; a comparison article only when the user chooses it.
- **Difference not undone:** the project copy says existing situations are left as they are and Scenarios start fresh. F001 (Rupert) was given fields, a new persona and 9 prompts during verification, and its two old prompts were removed (it had no runs; its original text is kept). The page also offers "Fill the fields from this text" on older situations. F002 and F003 were not changed, apart from the summary cards written for their earlier runs.
- **Rule from now on:** read the project docs with the Projects tool before planning. An attachment is not the source of truth.

## 2026-11-27 · Fan-Out: the ICP's selling points kept out of the persona and the prompts (Claude, CEO asked for the fix)
- **What happened:** the persona was built from the ICP, which describes the customer partly by what they like about the company ("approve every message, keep every investor relationship"). That came back as the person's "What matters" and then as demands in the prompts (8 of 9 on Rupert F002). The Run measured a buyer who already wanted the company's model: Mentioned 94%, no Opportunities.
- **Persona:** the request no longer includes the ICP's summary line or "Problem & Reasons to Buy". The Situation comes first; the ICP is marked as background for vocabulary and knowledge level; "What matters" comes from the Situation.
- **Prompts:** the request no longer includes the ICP (the spec's draft starts with `PERSON: {icp}`). It may not add a requirement or an exclusion the Situation does not state. `{icp}` still works in an admin-edited prompt.
- **Checked on a real generation:** the same Situation, rebuilt as Rupert F002, gave a neutral persona and nine prompts open to all four kinds of help.
- **Not changed:** F001's persona and prompts were written before this and carry the same tilt. They are frozen with its Baseline.

## 2026-11-27 · Fan-Out: an Opportunity is what ChatGPT searched where the company was not named (CEO decision)
- **Why:** all searches were grouped together and each group judged by how often the company was named in its runs. With broad groups every group repeated the overall score. Rupert F002 (named in 41 of 63 runs, in 2 of 21 Short runs) reported no Opportunity.
- **Rule now:** the runs are split into named and not named. A Query Group is an Opportunity when ChatGPT searched it in at least 5 runs where the company was not named (`cutoffs.min_missed`, in the admin). This replaces "named in fewer than 50% of the runs that searched it" in the spec. The 50% cut-off is still what Moved means on a re-run.
- **An Opportunity is described by the missed runs only:** the searches, the brands named instead, the pages cited, the prompts.
- **Score:** the share of the missed runs the group is part of, times how often the company is missing when it is searched.
- **Tried and dropped:** calling a theme background when it is as common in the named runs. Named runs carry about twice as many searches each (3.6 against 1.7 on F002), so every theme looked like background.
- **Grouping:** the first grouping starts from the searches of the missed runs, then sorts the rest into those groups. The request asks for narrow groups.
- **Own page:** counts as covering a search only when cited in at least 2 and a quarter of those runs.
- **Later, agreed:** the same analysis for runs where the company is named but not recommended.
- **Known:** the second pass still merges too much into the first groups (one group of 81 searches on F002, and no Win group); two of F002's four Opportunities overlap on the SEC rules.
