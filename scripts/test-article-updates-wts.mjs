import assert from "node:assert/strict";
import {
  bumpUpdatedDate,
  replaceWtsSection,
  WTS_END,
  WTS_START,
} from "../lib/article-updates/wts.js";
import {
  STALE_CHECK_BUCKETS,
  bucketNeedsUpdateCheck,
  daysSinceUpdate,
  stalenessBucket,
  summarizeBuckets,
} from "../lib/article-updates/staleness.js";

const now = new Date(2026, 7, 28); // 28 Aug 2026 local

assert.equal(daysSinceUpdate("2026-08-28", now), 0);
assert.equal(daysSinceUpdate("2026-08-14", now), 14);
assert.equal(daysSinceUpdate("2026-08-13", now), 15);
assert.equal(daysSinceUpdate("2026-07-29", now), 30);
assert.equal(daysSinceUpdate("2026-07-28", now), 31);
assert.equal(daysSinceUpdate("2026-06-29", now), 60);
assert.equal(daysSinceUpdate("2026-06-28", now), 61);
assert.equal(daysSinceUpdate("2026-05-30", now), 90);
assert.equal(daysSinceUpdate("2026-05-29", now), 91);
assert.equal(daysSinceUpdate("", now), null);

assert.equal(stalenessBucket(0), "0-14");
assert.equal(stalenessBucket(14), "0-14");
assert.equal(stalenessBucket(15), "15-30");
assert.equal(stalenessBucket(30), "15-30");
assert.equal(stalenessBucket(31), "30-60");
assert.equal(stalenessBucket(60), "30-60");
assert.equal(stalenessBucket(61), "60-90");
assert.equal(stalenessBucket(90), "60-90");
assert.equal(stalenessBucket(91), "90+");
assert.equal(stalenessBucket(null), "unknown");

assert.deepEqual(STALE_CHECK_BUCKETS, ["30-60", "60-90", "90+"]);
assert.equal(bucketNeedsUpdateCheck("15-30"), false);
assert.equal(bucketNeedsUpdateCheck("30-60"), true);
assert.equal(bucketNeedsUpdateCheck("90+"), true);
assert.equal(bucketNeedsUpdateCheck("0-14", 15), false);
assert.equal(bucketNeedsUpdateCheck("15-30", 15), true);
assert.equal(bucketNeedsUpdateCheck("30-60", 15), true);
assert.equal(bucketNeedsUpdateCheck("15-30", 30), false);
assert.equal(bucketNeedsUpdateCheck("30-60", 30), true);
assert.equal(bucketNeedsUpdateCheck("60-90", 60), true);
assert.equal(bucketNeedsUpdateCheck("30-60", 60), false);

assert.deepEqual(
  summarizeBuckets([
    { bucket: "0-14" },
    { bucket: "0-14" },
    { bucket: "30-60" },
    { bucket: "90+" },
  ]),
  {
    "0-14": 2,
    "15-30": 0,
    "30-60": 1,
    "60-90": 0,
    "90+": 1,
    unknown: 0,
  }
);

const preserved = [
  "---",
  "title: Live article",
  "slug: live-article",
  "date: 2026-01-01",
  "updatedDate: 2026-01-15",
  "draft: false",
  "---",
  "",
  "Intro paragraph stays exactly.",
  "",
  "## Where Things Stand",
  WTS_START,
  "Old paragraph about last quarter.",
  WTS_END,
  "",
  "Closing note stays exactly.",
  "",
].join("\n");

const replaced = replaceWtsSection(
  preserved,
  "New paragraph about a genuine development in the last 45 days."
);
assert.equal(replaced.ok, true);
assert.equal(
  replaced.content.includes("Intro paragraph stays exactly."),
  true
);
assert.equal(
  replaced.content.includes("Closing note stays exactly."),
  true
);
assert.equal(replaced.content.includes("Old paragraph about last quarter."), false);
assert.equal(
  replaced.content.includes(
    `${WTS_START}\nNew paragraph about a genuine development in the last 45 days.\n${WTS_END}`
  ),
  true
);

const missing = replaceWtsSection("no markers here", "New paragraph.");
assert.equal(missing.ok, false);

const bumped = bumpUpdatedDate(replaced.content, "2026-08-28");
assert.match(bumped, /^updatedDate: 2026-08-28$/m);
assert.equal(bumped.includes("date: 2026-01-01"), true);
assert.equal(bumped.includes("Intro paragraph stays exactly."), true);

const inserted = bumpUpdatedDate(
  ["---", "title: x", "date: 2026-01-01", "---", "body"].join("\n"),
  "2026-08-28"
);
assert.equal(
  inserted,
  ["---", "title: x", "date: 2026-01-01", "updatedDate: 2026-08-28", "---", "body"].join(
    "\n"
  )
);

console.log("article-updates WTS/staleness tests passed");
