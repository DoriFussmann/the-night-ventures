/**
 * Live comparison run against the same pillar topic used in prior sessions:
 * "How to Find Investors: The Complete Founder's Guide"
 */
const payload = {
  abstract:
    "Rupert helps startup founders raise capital through expert-managed investor outreach.",
  shortDescription:
    "Expert-managed investor outreach for founders who want a qualified target list and personalised follow-up.",
  competitors: [],
  pillarKeyword: "how to find investors",
  supportingKeyword: "",
  batchContext: [],
  article: {
    title: "How to Find Investors: The Complete Founder's Guide",
    targetKeyword: "how to find investors",
    type: "comprehensive",
    searchIntent:
      "Founders want a practical end-to-end playbook for identifying, researching, and reaching the right investors.",
    wordCount: 2000,
    ctaAngle:
      "When outreach volume and personalisation become the bottleneck, expert-managed investor outreach can keep the pipeline warm without burning founder time.",
    keyMessages: [
      "Finding investors is a targeting problem before it is a pitching problem.",
      "Build a living list from thesis fit, stage fit, and check-size reality — not from brand-name logos.",
      "Warm intros and personalised first touches outperform spray-and-pray cold email.",
      "Track replies and follow-ups like a sales pipeline so momentum does not die between conversations.",
      "Raise readiness (narrative, metrics, materials) should run in parallel with list-building.",
    ],
  },
};

const started = Date.now();
console.log("POST /api/generate-article …");

const res = await fetch("http://localhost:5173/api/generate-article", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const data = await res.json().catch(() => ({}));
const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

console.log(`status=${res.status} elapsed=${elapsedSec}s`);

if (!res.ok) {
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const fm = data.frontmatter || {};
const keywords = Array.isArray(fm.keywords) ? fm.keywords : [];
const sources = Array.isArray(data.whereThingsStandSources)
  ? data.whereThingsStandSources
  : [];
const body = String(data.body || "");

const blocks = body
  .replace(/\r\n/g, "\n")
  .split(/\n[ \t]*\n+/)
  .map((b) => b.trim())
  .filter(Boolean);

const isStructural = (block) =>
  /^\s*#+\s/.test(block) ||
  /^\s*(?:[-*+]|\d+\.)\s/.test(block) ||
  /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(block) ||
  /^\s*>/.test(block);

const orphanish = blocks.filter((block) => {
  if (isStructural(block)) return false;
  if (block.length >= 200) return false;
  const core = block.replace(/[.!?]+["')\]]*$/, "");
  const mid = core.match(/[.!?]["')\]]*\s+/g);
  return !(mid && mid.length > 0);
});

const hrGlued = /(?:\S ---|--- \S|\S \*\*\*|\*\*\* \S|\S ___|\___ \S)/.test(
  body
);
const hrIntact =
  !body.includes("---") ||
  (/\n\n---\n\n/.test(body) && !/\S\n---\n\S/.test(body) && !/\.\s*---/.test(body));

const wtsMatch = body.match(
  /<!-- WHERE-THINGS-STAND:START -->\n([\s\S]*?)\n<!-- WHERE-THINGS-STAND:END -->/
);
const wtsInnerBlocks = wtsMatch
  ? wtsMatch[1]
      .split(/\n[ \t]*\n+/)
      .map((b) => b.trim())
      .filter(Boolean)
  : [];

console.log(
  JSON.stringify(
    {
      title: fm.title,
      titleLen: String(fm.title || "").length,
      descriptionLen: String(fm.description || "").length,
      keywords,
      whereThingsStandSources: sources,
      lengthAdjusted: Boolean(data.lengthAdjusted),
      bodyChars: body.length,
      blockCount: blocks.length,
      shortSingleSentenceBlocksRemaining: orphanish.length,
      shortSingleSentenceSamples: orphanish.slice(0, 8),
      hasWtsMarkers: Boolean(wtsMatch),
      wtsBlockCount: wtsInnerBlocks.length,
      hrGluedToProse: hrGlued,
      hrIntactWhenPresent: body.includes("---") ? hrIntact : null,
    },
    null,
    2
  )
);

// Soft assertions for the two regressions
if (
  keywords.length !== 1 ||
  keywords[0]?.toLowerCase() !== "how to find investors"
) {
  console.error("FAIL: keywords not server-constructed as expected", keywords);
  process.exit(2);
}

console.log("Keywords OK (server-side overwrite).");
console.log(
  `Orphan-ish short single-sentence blocks remaining: ${orphanish.length}`
);

if (hrGlued) {
  console.error("FAIL: horizontal rule appears glued into prose");
  process.exit(3);
}
if (wtsInnerBlocks.length > 2) {
  console.error(
    `FAIL: WTS has ${wtsInnerBlocks.length} blocks (max 2)`,
    wtsInnerBlocks
  );
  process.exit(4);
}
console.log(`WTS block count OK (${wtsInnerBlocks.length} <= 2).`);
if (body.includes("---")) {
  console.log(hrIntact ? "HR dividers intact." : "WARN: HR spacing looks off");
}
