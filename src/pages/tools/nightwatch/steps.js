import {
  daysSinceUpdate,
  stalenessBucket,
  STALENESS_BUCKETS,
} from "../articleGeneration/daysSinceUpdate";

export const AUTO_ADVANCE_SECONDS = 10;

// ROUGH ESTIMATE ONLY — tune freely
export const EST = {
  usdPerRefresh: 0.02, // per article audited for freshness (LLM)
  usdPerPolish: 0.02, // per section proposed (LLM)
  usdPerSerpCall: 0.003, // per DataForSEO call (scan rank + links)
  usdPerCleanup: 0.0, // mostly deterministic
};

export const STEPS = [
  { id: "scan", label: "Scan" },
  { id: "refresh", label: "Refresh" },
  { id: "links", label: "Links Audit" },
  { id: "cleanup", label: "Cleanup" },
  { id: "polish", label: "Polish" },
  { id: "summary", label: "Summary" },
];

export const SUMMARY_INDEX = STEPS.findIndex((s) => s.id === "summary");

export const REVIEW_NOTE =
  "Review in Summary — nothing has been applied to the live site yet.";

export function emptyStepMaps() {
  const status = {};
  const data = {};
  const error = {};
  for (const step of STEPS) {
    status[step.id] = "idle";
    data[step.id] = null;
    error[step.id] = null;
  }
  return { status, data, error };
}

export function issueKey(slug, url) {
  return `${slug}::${url}`;
}

function startOfDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Next 1st or 15th on or after today, skipping a due date already covered by lastRunAt. */
export function nextDueDate(now = new Date(), lastRunAt = null) {
  const today = startOfDay(now);
  if (!today) return null;
  const last = lastRunAt ? startOfDay(lastRunAt) : null;
  const candidates = [];
  for (let i = 0; i < 3; i++) {
    const monthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
    candidates.push(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
    candidates.push(
      new Date(monthDate.getFullYear(), monthDate.getMonth(), 15)
    );
  }
  return (
    candidates.find((d) => {
      const day = startOfDay(d);
      if (!day || day < today) return false;
      if (last && last.getTime() >= day.getTime()) return false;
      return true;
    }) || null
  );
}

export function formatDueDate(date) {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatLastRun(dateValue) {
  if (!dateValue) return "Never";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "Never";
  const days = daysSinceUpdate(d.toISOString().slice(0, 10));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function refreshArticles(data) {
  return Array.isArray(data?.articles) ? data.articles : [];
}

export function refreshWarranted(article) {
  if (!article) return false;
  if (article.updateWarranted === true) return true;
  if (article.updateWarranted === false) return false;
  return Boolean(article.needsUpdateCheck);
}

export function refreshParagraph(article) {
  return String(
    article?.proposedParagraph || article?.newParagraph || ""
  ).trim();
}

/** Mirror ArticlesUpdate: pre-check only when an update is warranted and a paragraph exists. */
export function defaultRefreshSelected(data) {
  const next = new Set();
  for (const article of refreshArticles(data)) {
    if (article.updateWarranted && refreshParagraph(article)) {
      next.add(article.slug);
    }
  }
  return next;
}

export function linksIssues(audit) {
  return Array.isArray(audit?.issues) ? audit.issues : [];
}

export function linksProposalRows(proposals) {
  return Array.isArray(proposals?.rows) ? proposals.rows : [];
}

/** Mirror CheckLinksPanel's merge of audit issues + external proposals. */
export function buildLinkReviewRows(audit, proposals) {
  const issues = linksIssues(audit);
  const proposalRows = linksProposalRows(proposals);
  const proposalBySlug = new Map(proposalRows.map((row) => [row.slug, row]));
  const issueBySlug = new Map(issues.map((item) => [item.slug, item]));
  const slugs = [
    ...new Set([
      ...issues.map((item) => item.slug),
      ...proposalRows.map((row) => row.slug),
    ]),
  ];
  return slugs.map((slug) => {
    const issue = issueBySlug.get(slug);
    const proposal = proposalBySlug.get(slug);
    const failed = Boolean(proposal?.error) || proposal?.available === false;
    return {
      slug,
      title: issue?.title || proposal?.title || slug,
      error: failed,
      reason: proposal?.reason,
      internal: issue?.internal || { kept: [], added: [] },
      candidates: failed ? [] : proposal?.candidates || [],
      externalShort: Boolean(issue?.external?.short),
      currentCount:
        proposal?.currentCount ?? issue?.external?.currentCount ?? 0,
      needed: proposal?.needed ?? issue?.external?.needed ?? 3,
    };
  });
}

export function defaultLinksSelected(proposals) {
  const next = new Set();
  for (const row of linksProposalRows(proposals)) {
    if (row?.error || row?.available === false) continue;
    for (const link of row.candidates || []) {
      if (link?.url) next.add(issueKey(row.slug, link.url));
    }
  }
  return next;
}

export function cleanupPreviews(data) {
  return Array.isArray(data?.previews) ? data.previews : [];
}

/** Mirror CleanupPanel: default-select changed items that are not ranking well. */
export function defaultCleanupSelected(data) {
  const next = new Set();
  for (const preview of cleanupPreviews(data)) {
    if (!preview.rankSkip) next.add(preview.slug);
  }
  return next;
}

export function rewriteItems(audit) {
  return Array.isArray(audit?.items) ? audit.items : [];
}

/** Mirror RewritePanel after audit: recommended option per slug, skips excluded. */
export function rewriteProposeItems(audit) {
  return rewriteItems(audit)
    .map((item) => ({
      slug: item.slug,
      heading: item.heading,
      option: item.recommended,
    }))
    .filter((item) => item.option && item.option !== "skip");
}

export function rewriteProposals(data) {
  return Array.isArray(data?.proposals) ? data.proposals : [];
}

/** Mirror RewritePanel: approve every proposed item. */
export function defaultPolishSelected(proposals) {
  return new Set(rewriteProposals(proposals).map((p) => p.slug));
}

function scanBucketBreakdown(data) {
  if (data?.buckets && typeof data.buckets === "object") {
    return STALENESS_BUCKETS.map((id) => ({
      id,
      count: Number(data.buckets[id] || 0),
    }));
  }
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  if (!articles.length) return [];
  const counts = Object.fromEntries(STALENESS_BUCKETS.map((id) => [id, 0]));
  let unknown = 0;
  for (const article of articles) {
    const days =
      article.daysSince != null
        ? article.daysSince
        : daysSinceUpdate(
            article.lastDate || article.updatedDate || article.date
          );
    const bucket = article.bucket || stalenessBucket(days);
    if (counts[bucket] != null) counts[bucket] += 1;
    else unknown += 1;
  }
  const rows = STALENESS_BUCKETS.map((id) => ({ id, count: counts[id] }));
  if (unknown) rows.push({ id: "unknown", count: unknown });
  return rows;
}

function countInternalAdds(audit) {
  let n = 0;
  for (const article of linksIssues(audit)) {
    n += (article.internal?.added || article.internal?.missing || []).length;
  }
  return n;
}

function countExternalCandidates(proposals) {
  let n = 0;
  for (const row of linksProposalRows(proposals)) {
    if (row?.error || row?.available === false) continue;
    n += (row.candidates || []).length;
  }
  return n;
}

export function stepSummary(stepId, data) {
  if (!data) {
    return { lines: ["No results for this step."] };
  }
  if (stepId === "scan") {
    const count =
      Number(data.articleCount) ||
      (Array.isArray(data.articles) ? data.articles.length : 0);
    const buckets = scanBucketBreakdown(data);
    const lines = [
      `${count} live article${count === 1 ? "" : "s"} found.`,
    ];
    if (buckets.some((b) => b.count > 0)) {
      lines.push(buckets.map((b) => `${b.id}: ${b.count}`).join(" · "));
    }
    return { lines };
  }
  if (stepId === "refresh") {
    const articles = refreshArticles(data);
    const warranted = articles.filter(refreshWarranted);
    const proposals = articles.filter(
      (article) => refreshWarranted(article) && refreshParagraph(article)
    );
    const noChange = articles.length - warranted.length;
    return {
      lines: [
        `${warranted.length} article${warranted.length === 1 ? "" : "s"} with a warranted update.`,
        `${noChange} with no change needed.`,
        proposals.length
          ? `${proposals.length} include a proposed Where Things Stand paragraph.`
          : "No proposed paragraphs in this audit — Refresh will have nothing to commit unless proposals are present.",
      ],
    };
  }
  if (stepId === "links") {
    const internal = countInternalAdds(data.audit);
    const external = countExternalCandidates(data.proposals);
    const issues = linksIssues(data.audit).length;
    return {
      lines: [
        `${issues} article${issues === 1 ? "" : "s"} need link work.`,
        `${internal} internal link${internal === 1 ? "" : "s"} to be added.`,
        `${external} external source candidate${external === 1 ? "" : "s"} found.`,
      ],
    };
  }
  if (stepId === "cleanup") {
    const previews = cleanupPreviews(data);
    const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
    return {
      lines: [
        `${previews.length} article${previews.length === 1 ? "" : "s"} have cleanup diffs.`,
        data.scanned != null ? `Scanned ${data.scanned}.` : null,
        skipped ? `${skipped} skipped as already clean.` : null,
      ].filter(Boolean),
    };
  }
  if (stepId === "polish") {
    const proposals = rewriteProposals(data.proposals);
    const dropped = Array.isArray(data.proposals?.dropped)
      ? data.proposals.dropped.length
      : 0;
    return {
      lines: [
        `${proposals.length} section proposal${proposals.length === 1 ? "" : "s"} produced.`,
        dropped ? `${dropped} dropped by guardrails.` : null,
      ].filter(Boolean),
    };
  }
  return { lines: [] };
}

function readUsageUsd(node) {
  if (!node || typeof node !== "object") return null;
  const usage = node.usage;
  const direct = usage?.usd ?? usage?.cost ?? node.costUsd;
  if (direct != null && Number.isFinite(Number(direct))) return Number(direct);
  const input = Number(usage?.input_tokens ?? usage?.inputTokens);
  const output = Number(usage?.output_tokens ?? usage?.outputTokens);
  if (Number.isFinite(input) || Number.isFinite(output)) {
    const inUsd = (Number.isFinite(input) ? input : 0) / 1_000_000 * 3;
    const outUsd = (Number.isFinite(output) ? output : 0) / 1_000_000 * 15;
    return inUsd + outUsd;
  }
  return null;
}

function collectUsageUsd(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  let total = 0;
  const own = readUsageUsd(value);
  if (own != null) total += own;
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") total += collectUsageUsd(child, seen);
  }
  return total;
}

export function estimateCost(dataByStep) {
  const usageUsd = collectUsageUsd(dataByStep);
  const freshnessCount = refreshArticles(dataByStep.refresh).filter(
    refreshWarranted
  ).length;
  const polishCount = rewriteProposals(dataByStep.polish?.proposals).length;
  const cleanupCount = cleanupPreviews(dataByStep.cleanup).length;
  const linkRows = linksProposalRows(dataByStep.links?.proposals).length;
  const rankLookups =
    cleanupPreviews(dataByStep.cleanup).length +
    rewriteItems(dataByStep.polish?.audit).length +
    linkRows;

  const breakdown = [
    {
      label: "Refresh (freshness LLM)",
      count: freshnessCount,
      usd: freshnessCount * EST.usdPerRefresh,
    },
    {
      label: "Polish (section LLM)",
      count: polishCount,
      usd: polishCount * EST.usdPerPolish,
    },
    {
      label: "SERP / DataForSEO",
      count: rankLookups,
      usd: rankLookups * EST.usdPerSerpCall,
    },
    {
      label: "Cleanup",
      count: cleanupCount,
      usd: cleanupCount * EST.usdPerCleanup,
    },
  ];
  const ballpark = breakdown.reduce((sum, row) => sum + row.usd, 0);
  return {
    fromUsage: usageUsd > 0,
    usd: usageUsd > 0 ? usageUsd : ballpark,
    breakdown,
  };
}

export function commitCount(result) {
  if (!result) return 0;
  if (Array.isArray(result.committed)) return result.committed.length;
  if (Number.isFinite(Number(result.committedCount))) {
    return Number(result.committedCount);
  }
  return 0;
}

export function formatUsd(value) {
  const n = Number(value) || 0;
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
