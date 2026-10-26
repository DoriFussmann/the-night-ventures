// Unit tests for generate-article modes.
// Run: node scripts/test-generate-article-modes.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countMainBodyWords,
  modifyMainBodyBounds,
} from "../lib/generate-article/mainBodyWords.js";
import {
  buildModifyPrompt,
  buildUserPrompt,
  mergeAllowedBrands,
} from "../lib/generate-article/prompt.js";
import { validateGeneratedArticle } from "../api/generate-article.js";

const here = dirname(fileURLToPath(import.meta.url));
// Frozen output of buildUserPrompt(base). Regenerated in Sprint 2 when the
// writer gained the angle / secondary keywords / FACTS AND SOURCES rules.
// Not generated at test time.
const defaultPromptSnapshot = readFileSync(
  join(here, "fixtures/default-prompt.snapshot.txt"),
  "utf8"
);

const article = {
  title: "How to Find Investors",
  targetKeyword: "how to find investors",
  type: "comprehensive",
  searchIntent: "Founders want a practical playbook.",
  wordCount: 1800,
  ctaAngle: "Use expert-managed outreach when volume becomes the bottleneck.",
  keyMessages: ["Target before you pitch.", "Keep a living list."],
  expertInput: "Warm intros beat cold email.",
};

const base = {
  abstract: "Rupert helps startup founders raise capital.",
  shortDescription: "Expert-managed investor outreach.",
  audience: "Startup founders raising a seed round",
  article,
  pillarKeyword: "how to find investors",
  supportingKeyword: "angel investors",
  batchContext: [
    {
      title: "Seed Round Checklist",
      slug: "seed-round-checklist",
      type: "howto",
      targetKeyword: "seed round checklist",
      oneLinerSummary: "A short checklist.",
    },
  ],
  competitors: [{ name: "AngelList", url: "https://www.angellist.com" }],
};

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log("✓", name);
};

check("SEO Controls and spec fields reach the writer when given", () => {
  const prompt = buildUserPrompt({
    ...base,
    article: { ...article, angle: "Warm intros first", secondaryKeywords: ["angel investor list"] },
    seoControls: {
      targetSearcher: "Seed founders",
      contentEdge: "Ran 40 raises",
      outOfScope: "Crypto",
      conversionAction: "Book a call",
      commercialUrl: "https://www.heyrupert.com/book-call/",
    },
  });
  assert.ok(prompt.includes("SEO CONTROLS"));
  assert.ok(prompt.includes("CONTENT EDGE"));
  assert.ok(prompt.includes("OUT-OF-SCOPE TOPICS (never write about these):\nCrypto"));
  assert.ok(prompt.includes('"angle": "Warm intros first"'));
  assert.ok(prompt.includes('"angel investor list"'));
  assert.ok(prompt.includes("FACTS AND SOURCES"));
});

check("default mode prompt matches the snapshot", () => {
  assert.equal(buildUserPrompt(base), defaultPromptSnapshot);
});

check("modify prompt wraps the source article in source markers", () => {
  const source = "# Old title\n\nThe original argument stays.\n";
  const prompt = buildModifyPrompt({
    ...base,
    sourceArticle: source,
    expand: false,
  });
  const start = prompt.indexOf("<<<SOURCE>>>");
  const end = prompt.indexOf("<<<END SOURCE>>>");
  assert.ok(start !== -1, "missing <<<SOURCE>>>");
  assert.ok(end > start, "missing <<<END SOURCE>>>");
  assert.equal(prompt.slice(start + "<<<SOURCE>>>".length, end), `\n${source}\n`);
  const kept = modifyMainBodyBounds({
    sourceArticle: source,
    expand: false,
    wordCount: article.wordCount,
  });
  assert.match(prompt, /MAIN BODY ONLY/);
  assert.match(prompt, /do not count toward the length/);
  assert.match(
    prompt,
    new RegExp(
      `within \\+/-15% of the source word count \\(${kept.sourceWordCount} words\\): between ${kept.min} and ${kept.max} words`
    )
  );
  assert.match(prompt, /CONTENT CONTRACT CONSTRAINTS/);
  assert.match(prompt, /OUTPUT FORMAT/);
  assert.match(prompt, /WHERE THINGS STAND SECTION/);
  assert.match(prompt, /KEY TAKEAWAYS SECTION/);
  assert.equal(prompt.includes("BODY REQUIREMENTS:"), false);

  const expanded = buildModifyPrompt({
    ...base,
    sourceArticle: source,
    expand: true,
  });
  const expandedBounds = modifyMainBodyBounds({
    sourceArticle: source,
    expand: true,
    wordCount: article.wordCount,
  });
  assert.equal(expandedBounds.min, 1620);
  assert.equal(expandedBounds.max, 1980);
  assert.match(
    expanded,
    /within \+\/-10% of 1800 words: between 1620 and 1980 words/
  );
  assert.match(expanded, /deepening existing points, not by adding new theses/);
});

check("main body word count excludes WTS, Key Takeaways, and markdown syntax", () => {
  const body = [
    "## **Intro**",
    "",
    "See the [guide](https://sec.gov/education/capital-raising) today.",
    "A <img src=\"https://example.com/hero.png\" alt=\"ignored\"> photo remains.",
    "",
    "## Where Things Stand",
    "Ignore these seven extra section words please now.",
    "",
    "## Key Takeaways",
    "- Ignore this takeaway completely",
    "- Ignore this takeaway completely",
    "- Ignore this takeaway completely",
  ].join("\n");

  // Intro + See the guide today + A photo remains = 1 + 4 + 3
  assert.equal(countMainBodyWords(body), 8);

  const takeawaysFirst = [
    "Alpha beta gamma.",
    "",
    "## Key Takeaways",
    "- These takeaway words do not count",
    "",
    "## Where Things Stand",
    "Neither do these section words.",
  ].join("\n");
  assert.equal(countMainBodyWords(takeawaysFirst), 3);

  const hundred = Array.from({ length: 100 }, () => "word").join(" ");
  const bounds = modifyMainBodyBounds({
    sourceArticle: hundred,
    expand: false,
  });
  assert.equal(bounds.sourceWordCount, 100);
  assert.equal(bounds.min, 85);
  assert.equal(bounds.max, 115);

  const withoutLength = validateGeneratedArticle({ title: "x" }, body, {});
  assert.equal(
    withoutLength.some((err) => err.startsWith("Main body is")),
    false
  );
  const withLength = validateGeneratedArticle({ title: "x" }, body, {
    length: { min: 1, max: 2 },
  });
  assert.ok(
    withLength.includes(
      "Main body is 8 words; it must be between 1 and 2. Cut/expand while preserving the author's wording."
    )
  );
});

check("allowedBrands pass competitor validation for this request only", () => {
  const title = "How Founders Find the Investors Who Fit Their Round Easily";
  const description =
    "A practical guide for startup founders who need a repeatable way to find investors that fit their stage and thesis. It works. Start now. Read this.";
  assert.equal(title.length >= 55 && title.length <= 60, true);
  assert.equal(description.length >= 140 && description.length <= 160, true);

  const frontmatter = {
    title,
    description,
    slug: "how-to-find-investors",
    imageAlt: "Founders reviewing an investor shortlist",
    tags: ["investors", "fundraising", "startups", "seed round"],
    faqs: [
      { question: "Who belongs on the list?", answer: "Investors whose thesis fits the round." },
      { question: "Should the draft name extra brands?", answer: "Only brands on the allowed list." },
    ],
  };
  const body = [
    "Founders compare options before they commit. Acme Widgets comes up often enough to name it once in the argument.",
    "",
    "## Where Things Stand",
    "<!-- WHERE-THINGS-STAND:START -->",
    "Recent reporting indicates the topic is stable. Data from this quarter shows no major shift. Operators are still using the same short list of criteria when they decide who to contact.",
    "<!-- WHERE-THINGS-STAND:END -->",
    "",
    "## Key Takeaways",
    "- Name a brand only when it is on the allowed list.",
    "- Keep the original argument intact while fixing structure.",
    "- Put links in frontmatter rather than the body.",
    "- Stay close to the source unless asked to expand.",
  ].join("\n");

  const merged = mergeAllowedBrands([], ["Acme Widgets"]);
  assert.deepEqual(merged, [{ name: "Acme Widgets", url: "" }]);

  const allowedErrors = validateGeneratedArticle(frontmatter, body, {
    competitors: merged,
    competitorsMentioned: ["Acme Widgets"],
  });
  assert.equal(
    allowedErrors.some((err) => err.includes("Unauthorized competitor")),
    false
  );
  assert.deepEqual(allowedErrors, []);

  const blockedErrors = validateGeneratedArticle(frontmatter, body, {
    competitors: [],
    competitorsMentioned: ["Acme Widgets"],
  });
  assert.equal(
    blockedErrors.some((err) => err.includes('Unauthorized competitor named: "Acme Widgets"')),
    true
  );
});

console.log(`\n${passed} passed`);
