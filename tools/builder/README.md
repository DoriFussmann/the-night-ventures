# ICP, Persona and Prompt Builder: source

The source of the builder page that feeds this app: ICP Builder, Persona Builder and Prompt Builder in one published Claude artifact. The app does not import anything from this folder and the app's build does not touch it. It is kept here because the page pushes into this app's database and reads this app's export format, so a change on either side should be visible next to the other.

- Published page: https://claude.ai/artifact/2mefk9XaCJfayJKbWTGVUM (artifact slug `0e551409-6db3-45b4-b912-8848cef27bba`)

## What is here

| Path | What it is |
|---|---|
| `src/icp-builder.html` | ICP Builder, and the page's shared head, styles and layout |
| `src/persona-builder.src.html` | Persona Builder (its element ids get the prefix `p-` at build time) |
| `src/prompts.frag.html`, `src/prompts.js` | Prompt Builder markup and script (element ids prefixed `q-`) |
| `src/moments.frag.html`, `src/moments.js` | Decision Moments markup and script (element ids written with the prefix `d-`). Reads the ICP and personas through `window.PromptParse` from `prompts.js`; pushes with `tnv_push_moment` (migration 083) |
| `src/tnv_rows.js` | Reader for the Supabase connector's replies |
| `src/company.js` | The company bar at the top of the page: one company for all four tools and every push |
| `src/company_link.js` | Makes the bar the only control: hides "Use This ICP", "Use These Personas" and the Saved ICPs list, and picks for each tool the company's newest saved ICP (by `companyId`, else by name) and the newest persona set built from it. Never replaces same-company work; asks before replacing another company's prompts |
| `src/tnv_export.js` | Loads a company's Company and Brand Facts from The Night Ventures. `build.py` fills it with the app's own export code |
| `build.py` | Assembles the page from `src/`, including the shared stores and the push to The Night Ventures |
| `built/builder.html` | The page as published. Commit it with every change so the repo shows what is live |
| `tests/unit.test.mjs` | Node tests of import, parsing, brand merge, persona mix, trim and style examples |
| `tests/export.test.mjs` | The page's Company and Brand Facts must match the app's Export button exactly |
| `tests/browser_test.py` | Browser test of the built page with stand-in Claude and Supabase replies |
| `tests/moments_test.py` | Browser test of the Decision Moments tool (reuses the stand-ins of `browser_test.py`). `PAGE_URI` points it at another copy of the page |
| `tests/fixtures/` | Made-up sample files in the shape of the real exports and ICP |

## Build and test

Run from this folder.

```
python3 build.py                      # writes built/builder.html and .check/j*.js
for f in .check/j*.js; do node --check "$f"; done
node --test tests/unit.test.mjs tests/export.test.mjs
pip install playwright && playwright install chromium
python3 tests/browser_test.py
python3 tests/moments_test.py
```

The tests never call Claude or Supabase. The browser test uses fixed stand-in replies, so it shows the page's wiring works. It does not show how well Claude writes prompts, judges ambiguity or follows the style reference; check those in the published page.

## Publish

Publishing is done from a Claude session with the artifact tools:

1. Build and run both test suites.
2. Read the artifact's current version, then publish `built/builder.html` as `index.html` to the slug above, as a new version of the same artifact. The link and everything saved in the page stay.
3. Check that the artifact still declares these capabilities afterwards. Without them the page silently loses Claude calls, saving or pushing:

| Capability | Used for |
|---|---|
| `sample` | Every Claude call from the page |
| `downloads` | Download .md, CSV, JSON |
| `db` and `user` | Saved ICPs, personas and prompt sets |
| `mcp`: server `Supabase`, tool `execute_sql` | Company list, reading tracked brands, the three pushes |

## What it depends on in this app

- **Database functions** `tnv_push_icp`, `tnv_push_personas`, `tnv_push_prompts` (migrations 080 and 081) and the tables `aeo_playbook`, `aeo_personas`, `pt_brands`, `pt_prompts`, `pt_runs`.
- **Export format** of the AEO Playbook's Company and Brand Facts tabs (`src/pages/tools/aeoPlaybook/sectionMarkdown.js`, with the declarations it uses from `api.js`). `build.py` copies that code into the page, so "Load from The Night Ventures" writes the same two documents as the Export button. **After any change to the export, rebuild and republish the page**; `tests/export.test.mjs` fails until you do. The ICP Builder's import then maps the headings and labels to its fields: if one changes, change the aliases in `src/icp-builder.html` (`SECTIONS`) and the test fixtures.
- **Tracked brands are maintained in the app.** `tnv_push_prompts` deletes brands that are not in the list it is sent, so the page reads the company's brands first and sends them back unchanged (`mergeBrands` in `src/prompts.js`). Do not go back to sending only the builder's list.

## Things that break easily

1. The three tools parse each other's output. The Prompt Builder reads the Strategic ICP's Buyer Situations, Alternatives and Question Variables tables by their headings and columns; the Persona Builder reads the Buyer Situations. Change an output format and its parser together.
2. Buyer situation IDs (S1, S2 …) are the join key across all three tools.
3. Element ids must keep their prefixes (`p-`, `q-`). `build.py` reports duplicate ids; the line must read `dup ids set()`.
4. A section title used inside a request to Claude (for example "WRITE EXACTLY THESE") must not be repeated inside another block of the same request.

The full description of how each tool works is in the project document `claude/builder-technical-reference.md`.

## Live page differs from `built/builder.html` (2026-11-13)

The live page was published at 2026-11-12 22:25 PST (version `1794551129-a56f`) from source that is not in this repo (it adds, among other things, a `.fbrow` feedback list). To keep that work, the Decision Moments tool was not published from `built/builder.html`: it is served as extra files, `moments.js` (the frag and script bundled) and `company-link.js` (`src/company_link.js`), and `index.html` got eight small edits (tool tab, empty `#tool-moments`, `TNV.pushMoment`, `showTool`, `window.PromptParse`, `companyId` on a saved ICP, the two script tags). `built/builder.html` here holds the same tool inline. Until the 22:25 source is recovered and committed, **do not publish `built/builder.html` over the live page**: it would remove that work.
