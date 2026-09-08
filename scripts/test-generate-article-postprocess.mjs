import assert from "node:assert/strict";
import {
  buildKeywords,
  mergeOrphanBlocks,
  mergeWtsBlocks,
  processArticleBody,
  isOrphanBlock,
  isHorizontalRuleBlock,
  isStructuralBlock,
  countKeyTakeawayBullets,
} from "../api/generate-article.js";
import { stripNoVolumeTag } from "../lib/stripNoVolumeTag.js";

// --- keywords always overwrite ---
assert.deepEqual(
  buildKeywords({
    targetKeyword: "how to find investors",
    supportingKeyword: "",
    pillarKeyword: "how to find investors",
  }),
  ["how to find investors"]
);

assert.deepEqual(
  buildKeywords({
    targetKeyword: "angel investors",
    supportingKeyword: "raising capital",
    pillarKeyword: "how to find investors",
  }),
  ["angel investors", "raising capital", "how to find investors"]
);

assert.equal(stripNoVolumeTag("best crm for startups (no volume data)"), "best crm for startups");
assert.equal(stripNoVolumeTag("best crm for startups"), "best crm for startups");
assert.equal(stripNoVolumeTag("  foo   (NO VOLUME DATA)  "), "foo");
assert.equal(stripNoVolumeTag(""), "");

assert.deepEqual(
  buildKeywords({
    targetKeyword: "long-tail query (no volume data)",
    supportingKeyword: "raising capital",
    pillarKeyword: "how to find investors",
  }),
  ["long-tail query", "raising capital", "how to find investors"]
);

// --- orphan / structural detection ---
assert.equal(isOrphanBlock("Recent data shows a 12% drop."), true);
assert.equal(
  isOrphanBlock(
    "First sentence here. Second sentence continues with more detail."
  ),
  false
);
assert.equal(isOrphanBlock("## Where Things Stand"), false);
assert.equal(isOrphanBlock("- list item only"), false);
assert.equal(isOrphanBlock("---"), false);
assert.equal(isOrphanBlock("***"), false);
assert.equal(isOrphanBlock("___"), false);
assert.equal(isOrphanBlock("> quoted line"), false);
assert.equal(isHorizontalRuleBlock("---"), true);
assert.equal(isHorizontalRuleBlock("***"), true);
assert.equal(isHorizontalRuleBlock("___"), true);
assert.equal(isStructuralBlock("## Heading"), true);
assert.equal(isStructuralBlock("> quote"), true);
assert.equal(isStructuralBlock("Normal prose."), false);

// --- HR must stay untouched with blank lines ---
const withHr = mergeOrphanBlocks(
  [
    "Founders often waste months chasing the wrong rooms and cold lists.",
    "---",
    "Deal activity cooled in early 2026.",
    "Operators who keep a living target list still clear the bar because they compound relationships instead of spraying cold emails.",
  ].join("\n\n")
);
assert.ok(
  withHr.includes(
    "Founders often waste months chasing the wrong rooms and cold lists.\n\n---\n\n"
  ),
  `HR must remain its own block with blank lines, got:\n${withHr}`
);
assert.ok(
  !withHr.includes("lists. ---"),
  `HR must not concatenate onto preceding paragraph, got:\n${withHr}`
);
assert.ok(
  withHr.includes(
    "Deal activity cooled in early 2026. Operators who keep"
  ),
  `orphan after HR should merge forward into following prose, got:\n${withHr}`
);

// --- headings / blockquotes never become merge targets ---
const withQuote = mergeOrphanBlocks(
  [
    "> A sharp founder quote about targeting.",
    "Orphan fact sits alone.",
    "A longer follow-on paragraph explains how to tighten targeting and sequence outreach so the next conversation is with a real fit.",
  ].join("\n\n")
);
assert.ok(
  withQuote.startsWith("> A sharp founder quote about targeting.\n\n"),
  `blockquote must stay untouched, got:\n${withQuote}`
);
assert.ok(
  !withQuote.includes("targeting. Orphan"),
  `orphan must not merge into blockquote, got:\n${withQuote}`
);

// --- merge into preceding ---
const mergedBack = mergeOrphanBlocks(
  [
    "Founders often waste months chasing the wrong rooms.",
    "Recent data shows a 12% drop.",
    "A longer follow-on paragraph explains how to tighten targeting and sequence outreach so the next conversation is with a real fit.",
  ].join("\n\n")
);
assert.ok(
  mergedBack.includes(
    "Founders often waste months chasing the wrong rooms. Recent data shows a 12% drop."
  ),
  `expected backward merge, got:\n${mergedBack}`
);

// --- first after heading merges forward ---
const mergedForward = mergeOrphanBlocks(
  [
    "## Market reality",
    "Deal activity cooled in early 2026.",
    "Operators who keep a living target list and warm intros still clear the bar because they compound relationships instead of spraying cold emails into a quieter market.",
  ].join("\n\n")
);
assert.ok(
  mergedForward.startsWith("## Market reality\n\nDeal activity cooled"),
  `expected forward merge after heading, got:\n${mergedForward}`
);
assert.ok(
  mergedForward.includes(
    "Deal activity cooled in early 2026. Operators who keep"
  ),
  `expected orphan joined into following prose, got:\n${mergedForward}`
);

// --- WTS force-merge + max 2 blocks ---
const wtsStacked = mergeWtsBlocks(
  [
    "Q2 data cooled.",
    "Megafunds took most of the capital.",
    "Founders still raising are leaning harder on warm intros and tighter thesis fit rather than spray-and-pray lists across a quieter market.",
    "Personalisation now beats volume in most early-stage outreaches according to recent operator writeups.",
  ].join("\n\n")
);
const wtsBlocks = wtsStacked.split(/\n[ \t]*\n+/).filter(Boolean);
assert.ok(
  wtsBlocks.length <= 2,
  `WTS must be <= 2 blocks, got ${wtsBlocks.length}:\n${wtsStacked}`
);
assert.equal(
  wtsBlocks.filter((b) => isOrphanBlock(b)).length,
  0,
  `WTS should not leave short single-sentence orphans:\n${wtsStacked}`
);

// --- WTS processed separately in full body ---
const withWts = processArticleBody(
  [
    "Intro paragraph with enough length to stay put on its own.",
    "Orphan fact sits alone.",
    "---",
    "## Where Things Stand",
    "<!-- WHERE-THINGS-STAND:START -->",
    "Q2 data cooled.",
    "Megafunds took most of the capital pool.",
    "Founders still raising are leaning harder on warm intros and tighter thesis fit rather than spray-and-pray lists.",
    "<!-- WHERE-THINGS-STAND:END -->",
  ].join("\n\n")
);

assert.ok(
  withWts.includes(
    "Intro paragraph with enough length to stay put on its own. Orphan fact sits alone.\n\n---\n\n## Where Things Stand"
  ),
  `body orphans merge and HR stays before WTS heading:\n${withWts}`
);

const wtsMatch = withWts.match(
  /<!-- WHERE-THINGS-STAND:START -->\n([\s\S]*?)\n<!-- WHERE-THINGS-STAND:END -->/
);
assert.ok(wtsMatch, "WTS markers preserved");
const innerBlocks = wtsMatch[1].split(/\n[ \t]*\n+/).filter(Boolean);
assert.ok(
  innerBlocks.length <= 2,
  `WTS inner <= 2 blocks, got ${innerBlocks.length}:\n${wtsMatch[1]}`
);

assert.equal(countKeyTakeawayBullets(""), 0);
assert.equal(
  countKeyTakeawayBullets("## Key Takeaways\n- One\n- Two\n- Three\n"),
  3
);
assert.equal(
  countKeyTakeawayBullets(
    "## Where Things Stand\n<!-- WHERE-THINGS-STAND:START -->\nx\n<!-- WHERE-THINGS-STAND:END -->\n\n## Key Takeaways\n- A\n- B\n- C\n- D\n\n<!-- CMS-INTERNAL:START -->\n"
  ),
  4
);

console.log("All post-process checks passed.");
