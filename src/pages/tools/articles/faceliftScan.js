import { MIN_EXTERNAL_LINKS } from "../../../../lib/wire-internal-links/plan.js";
import {
  auditLiveLinks,
  commitLinkFixes,
  proposeExternalFixes,
} from "./checkLinksApi";
import {
  auditLiveArticleUpdates,
  cleanupAudit,
  cleanupCommit,
  commitArticleUpdates,
  rewriteAudit,
  rewriteCommit,
  rewritePropose,
} from "./articleUpdatesApi";
import { checkArticleUpdate } from "./checkArticleUpdateApi";

export { MIN_EXTERNAL_LINKS };

export const CLEANUP_BATCH_CAP = 25;
export const REWRITE_AUDIT_CAP = 25;
export const REWRITE_COMMIT_CAP = 10;
export const EXTERNAL_PROPOSE_BATCH = 1;

const STALE_EXCLUDE_BUCKETS = ["0-14", "15-30"];

export const OP_KEYS = ["links", "cleanup", "wts", "rewrite"];

export const OP_LABELS = {
  links: "Links Fix",
  cleanup: "Cleanup",
  wts: "WTS Update",
  rewrite: "Section Optimization",
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function keywordRole(article) {
  const target = String(article?.targetKeyword || "").trim().toLowerCase();
  const pillar = String(article?.pillarKeyword || "").trim().toLowerCase();
  if (!target && !pillar) return "";
  if (target && pillar && target === pillar) return "pillar";
  if (pillar) return "supporting";
  return "";
}

function proposedOp(extra = {}) {
  return {
    state: "proposed",
    disabled: false,
    checkedDefault: true,
    reason: "",
    ...extra,
  };
}

function gatedOp(reason, extra = {}) {
  return {
    state: extra.state || "skipped",
    disabled: true,
    checkedDefault: false,
    reason,
    ...extra,
  };
}

function indexBySlug(items, key = "slug") {
  const map = new Map();
  for (const item of asArray(items)) {
    const slug = String(item?.[key] || "").trim();
    if (slug) map.set(slug, item);
  }
  return map;
}

function committedSlugs(result) {
  return new Set(
    asArray(result?.committed)
      .map((item) => String(item?.slug || "").trim())
      .filter(Boolean)
  );
}

function skippedBySlug(result) {
  const map = new Map();
  for (const item of asArray(result?.skipped)) {
    const slug = String(item?.slug || "").trim();
    if (slug) map.set(slug, item);
  }
  return map;
}

function errorsBySlug(result) {
  const map = new Map();
  for (const item of asArray(result?.errors)) {
    const slug = String(item?.slug || "").trim();
    if (slug) map.set(slug, item);
  }
  return map;
}

export function buildLinkHealth(audit) {
  const health = {};
  for (const row of asArray(audit?.healthy)) {
    const slug = String(row?.slug || "").trim();
    if (!slug) continue;
    health[slug] = {
      audited: true,
      internalOk: true,
      internalMissing: 0,
      externalOk: true,
      externalCurrent: null,
      externalNeeded: MIN_EXTERNAL_LINKS,
    };
  }
  for (const row of asArray(audit?.issues)) {
    const slug = String(row?.slug || "").trim();
    if (!slug) continue;
    const missing = asArray(row.internal?.added || row.internal?.missing);
    const current = Number(row.external?.currentCount);
    const needed = Number(row.external?.needed) || MIN_EXTERNAL_LINKS;
    health[slug] = {
      audited: true,
      internalOk: missing.length === 0,
      internalMissing: missing.length,
      internalCurrent: Number(row.internal?.currentCount),
      externalOk: !row.external?.short && current >= needed,
      externalCurrent: Number.isFinite(current) ? current : null,
      externalNeeded: needed,
    };
  }
  return health;
}

function buildLinkRows(audit, proposals) {
  const issues = asArray(audit?.issues);
  const proposalRows = asArray(proposals?.rows);
  const proposalBySlug = indexBySlug(proposalRows);
  const issueBySlug = indexBySlug(issues);
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
    const added = asArray(issue?.internal?.added || issue?.internal?.missing);
    return {
      slug,
      title: issue?.title || proposal?.title || slug,
      error: failed,
      reason: proposal?.reason,
      internalAdded: added,
      candidates: failed ? [] : asArray(proposal?.candidates),
      externalShort: Boolean(issue?.external?.short),
      currentCount:
        proposal?.currentCount ?? issue?.external?.currentCount ?? 0,
      needed: proposal?.needed ?? issue?.external?.needed ?? MIN_EXTERNAL_LINKS,
    };
  });
}

function toLiveRow(article) {
  return {
    slug: article.slug,
    title: article.title || article.slug,
    keyword: article.targetKeyword || "",
    keywordRole: keywordRole(article),
    pillarKeyword: article.pillarKeyword || "",
    cluster: article.pillarKeyword || "",
    articleType: "",
    lastDate: article.updatedDate || article.date || "",
    url: article.publishedUrl || "",
    draft: article.draft === true,
    status: article.draft === true ? "drafted" : "published",
    daysSince: article.daysSince,
    bucket: article.bucket,
    internalLinks: null,
    externalLinks: null,
  };
}

function runOp(runOps, key) {
  return !runOps || runOps.has(key);
}

function buildBatches({
  corpus,
  publishedCount,
  cleanup,
  staleCount,
  staleChecked,
  rewriteAuditData,
  rewriteProposed,
  rewriteCommitCount,
  runOps,
}) {
  const cleanupEligible = publishedCount;
  const cleanupScanned = Number(cleanup?.scanned) || 0;
  const cleanupChanged = asArray(cleanup?.previews).length;
  const rewriteEligible = staleCount;
  const rewriteScanned =
    asArray(rewriteAuditData?.items).length +
    asArray(rewriteAuditData?.noSection).length +
    asArray(rewriteAuditData?.rankExcluded).length;

  return {
    corpus,
    published: runOp(runOps, "links") ? publishedCount : null,
    cleanup: runOp(runOps, "cleanup")
      ? {
          eligible: cleanupEligible,
          scanned: cleanupScanned || Math.min(CLEANUP_BATCH_CAP, cleanupEligible),
          cap: CLEANUP_BATCH_CAP,
          proposed: cleanupChanged,
        }
      : null,
    wts: runOp(runOps, "wts")
      ? {
          eligible: staleCount,
          scanned: staleChecked,
          cap: null,
        }
      : null,
    rewrite: runOp(runOps, "rewrite")
      ? {
          eligible: rewriteEligible,
          scanned: rewriteScanned,
          auditCap: REWRITE_AUDIT_CAP,
          commitCap: REWRITE_COMMIT_CAP,
          proposed: rewriteProposed,
          committing: Math.min(REWRITE_COMMIT_CAP, rewriteProposed),
        }
      : null,
  };
}

export function isPartialCorpus(batches) {
  if (!batches) return false;
  const { cleanup, rewrite } = batches;
  if (cleanup && cleanup.eligible > cleanup.cap) return true;
  if (rewrite && rewrite.proposed > rewrite.commitCap) return true;
  return false;
}

export function batchBoundaryLines(batches) {
  if (!batches) return [];
  const lines = [];
  const { cleanup, rewrite, wts, corpus, published } = batches;
  if (cleanup && cleanup.eligible > cleanup.cap) {
    lines.push(
      `Cleanup: fixing ${cleanup.scanned} of ${cleanup.eligible} eligible (oldest first, cap ${cleanup.cap}). Run Facelift again for the rest.`
    );
  } else if (cleanup) {
    lines.push(
      `Cleanup: scanned ${cleanup.scanned} of ${cleanup.eligible} eligible.`
    );
  }
  if (wts) {
    lines.push(
      `WTS Update: checked ${wts.scanned} of ${wts.eligible} stale articles (≥ 30 days).`
    );
  }
  if (rewrite && rewrite.proposed > rewrite.commitCap) {
    lines.push(
      `Section optimization: committing ${rewrite.committing} of ${rewrite.proposed} proposed this batch (API cap ${rewrite.commitCap}). ${rewrite.eligible} stale eligible; audit cap ${rewrite.auditCap}.`
    );
  } else if (rewrite) {
    lines.push(
      `Section optimization: ${rewrite.proposed} proposed of ${rewrite.eligible} stale eligible (audit cap ${rewrite.auditCap}, commit cap ${rewrite.commitCap}).`
    );
  }
  if (published != null) {
    lines.push(`Links: all ${published} published articles (no batch cap).`);
  }
  if (corpus != null) {
    lines.push(`Live corpus: ${corpus} article${corpus === 1 ? "" : "s"}.`);
  }
  return lines;
}

function shortExternalSlugs(audit) {
  return asArray(audit?.issues)
    .filter((row) => row?.external?.short)
    .map((row) => String(row?.slug || "").trim())
    .filter(Boolean);
}

function isTimeoutMessage(message) {
  return /504|timed out|timeout/i.test(String(message || ""));
}

async function proposeExternalBatched(dest, slugs, { onProgress, messagePrefix } = {}) {
  const unique = [
    ...new Set(
      (Array.isArray(slugs) ? slugs : [])
        .map((slug) => String(slug || "").trim())
        .filter(Boolean)
    ),
  ];
  const rows = [];
  const failed = [];

  for (let i = 0; i < unique.length; i += EXTERNAL_PROPOSE_BATCH) {
    const batch = unique.slice(i, i + EXTERNAL_PROPOSE_BATCH);
    onProgress?.({
      phase: "links",
      message: `${messagePrefix || "Planning external links…"} ${Math.min(
        i + batch.length,
        unique.length
      )}/${unique.length}`,
    });
    try {
      const data = await proposeExternalFixes(dest, { slugs: batch });
      rows.push(...asArray(data?.rows));
    } catch (err) {
      const reason = err?.message || "planning failed";
      if (batch.length === 1) {
        failed.push({ slug: batch[0], reason });
        continue;
      }
      for (const slug of batch) {
        try {
          const data = await proposeExternalFixes(dest, { slugs: [slug] });
          rows.push(...asArray(data?.rows));
        } catch (inner) {
          failed.push({
            slug,
            reason: inner?.message || reason,
          });
        }
      }
    }
  }

  const failedRows = failed.map((item) => ({
    slug: item.slug,
    error: true,
    available: false,
    reason: item.reason,
    candidates: [],
  }));
  const timedOut = failed.some((item) => isTimeoutMessage(item.reason));
  return {
    rows: [...rows, ...failedRows],
    timedOut,
    failedCount: failed.length,
    error: failed.length
      ? timedOut
        ? `External link planning timed out for ${failed.length} article${
            failed.length === 1 ? "" : "s"
          }.`
        : `External link planning failed for ${failed.length} article${
            failed.length === 1 ? "" : "s"
          }.`
      : "",
  };
}

function buildReviewRows({
  articles,
  linkRows,
  linksAudit,
  cleanup,
  wtsChecks,
  wtsAudit,
  rewriteAuditData,
  rewriteProposals,
  proposeFailed = false,
}) {
  const linkBySlug = indexBySlug(linkRows);
  const cleanupPreviewBySlug = indexBySlug(cleanup?.previews);
  const cleanupSkippedBySlug = indexBySlug(cleanup?.skipped);
  const cleanupTouched = new Set([
    ...asArray(cleanup?.previews).map((item) => item.slug),
    ...asArray(cleanup?.skipped).map((item) => item.slug),
  ]);
  const rewriteItemBySlug = indexBySlug(rewriteAuditData?.items);
  const rewriteNoSection = new Set(
    asArray(rewriteAuditData?.noSection).map((item) =>
      typeof item === "string" ? item : item?.slug
    )
  );
  const rewriteRankExcluded = indexBySlug(rewriteAuditData?.rankExcluded);
  const rewriteTouched = new Set([
    ...asArray(rewriteAuditData?.items).map((item) => item.slug),
    ...[...rewriteNoSection],
    ...asArray(rewriteAuditData?.rankExcluded).map((item) => item.slug),
  ]);
  const proposalList = asArray(rewriteProposals?.proposals);
  const rewriteProposalBySlug = indexBySlug(proposalList);
  const droppedBySlug = indexBySlug(rewriteProposals?.dropped);
  const rewriteCommitSlugs = new Set(
    proposalList.slice(0, REWRITE_COMMIT_CAP).map((item) => item.slug)
  );

  return articles.map((article) => {
    const slug = article.slug;
    const stale = Boolean(article.needsUpdateCheck);
    const draft = article.draft === true;

    let links;
    const linkRow = linkBySlug.get(slug);
    if (draft) {
      links = gatedOp("draft — skipped");
    } else if (!linksAudit) {
      links = gatedOp("not scanned");
    } else if (linkRow?.error) {
      links = gatedOp(linkRow.reason || "planning failed", {
        state: "error",
      });
    } else if (
      linkRow &&
      (linkRow.internalAdded.length > 0 || linkRow.candidates.length > 0)
    ) {
      links = proposedOp({
        internalAdded: linkRow.internalAdded,
        candidates: linkRow.candidates,
        externalShort: linkRow.externalShort,
        currentCount: linkRow.currentCount,
        needed: linkRow.needed,
      });
    } else if (linkRow?.externalShort) {
      links = gatedOp(
        linkRow.reason ||
          (proposeFailed
            ? "external planning timed out"
            : "no external sources found")
      );
    } else {
      links = gatedOp("no change needed");
    }

    let cleanupOp;
    const preview = cleanupPreviewBySlug.get(slug);
    const cleanupSkip = cleanupSkippedBySlug.get(slug);
    if (draft) {
      cleanupOp = gatedOp("draft — skipped");
    } else if (preview?.rankSkip) {
      cleanupOp = gatedOp("ranking well — skipped", {
        diffs: preview.diffs,
        stats: preview.stats,
      });
    } else if (preview) {
      cleanupOp = proposedOp({ diffs: preview.diffs, stats: preview.stats });
    } else if (!cleanup) {
      cleanupOp = gatedOp("not scanned");
    } else if (cleanupSkip?.reason === "already_clean") {
      cleanupOp = gatedOp("no change needed");
    } else if (cleanupSkip) {
      cleanupOp = gatedOp(cleanupSkip.message || cleanupSkip.reason || "skipped");
    } else if (!cleanupTouched.has(slug)) {
      cleanupOp = gatedOp(
        `deferred — next batch (fixing ${CLEANUP_BATCH_CAP} of eligible)`
      );
    } else {
      cleanupOp = gatedOp("no change needed");
    }

    let wts;
    const check = wtsChecks[slug];
    if (draft) {
      wts = gatedOp("draft — skipped");
    } else if (!wtsAudit) {
      wts = gatedOp("not scanned");
    } else if (!stale) {
      wts = gatedOp("skipped — recently updated");
    } else if (!article.canCheck) {
      wts = gatedOp("cannot check — missing live URL or keywords");
    } else if (check?.status === "error") {
      wts = gatedOp(check.error || "check failed", { state: "error" });
    } else if (
      check?.result?.updateWarranted &&
      String(check.result.proposedParagraph || "").trim()
    ) {
      wts = proposedOp({
        proposedParagraph: check.result.proposedParagraph,
        newSources: check.result.newSources,
      });
    } else if (check?.result) {
      wts = gatedOp("no change needed");
    } else {
      wts = gatedOp("no change needed");
    }

    let rewrite;
    const rewriteItem = rewriteItemBySlug.get(slug);
    const rewriteProposal = rewriteProposalBySlug.get(slug);
    const dropped = droppedBySlug.get(slug);
    if (draft) {
      rewrite = gatedOp("draft — skipped");
    } else if (!rewriteAuditData) {
      rewrite = gatedOp("not scanned");
    } else if (!stale) {
      rewrite = gatedOp("skipped — recently updated");
    } else if (rewriteRankExcluded.has(slug)) {
      rewrite = gatedOp("ranking well — skipped");
    } else if (rewriteNoSection.has(slug)) {
      rewrite = gatedOp("no eligible section");
    } else if (dropped) {
      rewrite = gatedOp(dropped.reason || "dropped by guardrails");
    } else if (rewriteProposal && !rewriteCommitSlugs.has(slug)) {
      rewrite = gatedOp(
        `deferred — next batch (API cap ${REWRITE_COMMIT_CAP})`,
        {
          heading: rewriteProposal.heading,
          proposedSectionText: rewriteProposal.proposedSectionText,
        }
      );
    } else if (rewriteProposal) {
      rewrite = proposedOp({
        heading: rewriteProposal.heading,
        option: rewriteProposal.option,
        proposedSectionText: rewriteProposal.proposedSectionText,
      });
    } else if (rewriteItem && (rewriteItem.recommended === "skip" || !rewriteItem.recommended)) {
      rewrite = gatedOp("no change needed");
    } else if (!rewriteTouched.has(slug)) {
      rewrite = gatedOp(
        `deferred — next batch (fixing ${REWRITE_AUDIT_CAP} of stale eligible)`
      );
    } else {
      rewrite = gatedOp("no change needed");
    }

    return {
      slug,
      title: article.title || slug,
      draft,
      daysSince: article.daysSince,
      bucket: article.bucket,
      ops: { links, cleanup: cleanupOp, wts, rewrite },
    };
  });
}

export function defaultSelections(rows) {
  const next = {};
  for (const row of rows) {
    next[row.slug] = {
      links: Boolean(row.ops.links.checkedDefault),
      cleanup: Boolean(row.ops.cleanup.checkedDefault),
      wts: Boolean(row.ops.wts.checkedDefault),
      rewrite: Boolean(row.ops.rewrite.checkedDefault),
    };
  }
  return next;
}

export function formatFaceliftPhaseError(message, { approvedCount = 0 } = {}) {
  const text = String(message || "").trim();
  if (!text) return "";
  if (isTimeoutMessage(text)) {
    if (approvedCount > 0) {
      return `${text} Internal link fixes are still available.`;
    }
    return `${text} Re-run Links to finish external source planning.`;
  }
  return text;
}

export function countApproved(rows, selections) {
  let n = 0;
  for (const row of rows) {
    const sel = selections[row.slug] || {};
    for (const key of OP_KEYS) {
      if (!row.ops[key].disabled && sel[key]) n += 1;
    }
  }
  return n;
}

export async function runFaceliftScan(dest, { onProgress, ops } = {}) {
  const requested = (Array.isArray(ops) ? ops : OP_KEYS).filter((key) =>
    OP_KEYS.includes(key)
  );
  const runOps = new Set(requested.length ? requested : OP_KEYS);
  const phaseErrors = {};

  let linksAudit = null;
  let linksProposals = { rows: [] };
  if (runOps.has("links")) {
    onProgress?.({ phase: "links", message: "Scanning links…" });
    try {
      linksAudit = await auditLiveLinks(dest);
    } catch (err) {
      phaseErrors.links = err?.message || "Links audit failed";
    }
    if (linksAudit) {
      const shortSlugs = shortExternalSlugs(linksAudit);
      if (shortSlugs.length) {
        const proposed = await proposeExternalBatched(dest, shortSlugs, {
          onProgress,
        });
        linksProposals = { rows: proposed.rows };
        if (proposed.error) {
          phaseErrors.linksPropose = proposed.error;
        }
      }
    }
  }

  let cleanup = null;
  if (runOps.has("cleanup")) {
    onProgress?.({ phase: "cleanup", message: "Scanning cleanup…" });
    try {
      cleanup = await cleanupAudit(dest, {
        batchSize: CLEANUP_BATCH_CAP,
        excludeBuckets: [],
        maxCommit: CLEANUP_BATCH_CAP,
      });
    } catch (err) {
      phaseErrors.cleanup = err?.message || "Cleanup audit failed";
    }
  }

  let wtsAudit = null;
  const wtsChecks = {};
  if (runOps.has("wts")) {
    onProgress?.({ phase: "wts", message: "Checking freshness…" });
    try {
      wtsAudit = await auditLiveArticleUpdates(dest);
    } catch (err) {
      phaseErrors.wts = err?.message || "Freshness audit failed";
    }
  }

  const articles = asArray(wtsAudit?.articles);
  const published = articles.filter((article) => article.draft !== true);
  const stale = published.filter(
    (article) => article.needsUpdateCheck && article.canCheck
  );
  if (runOps.has("wts")) {
    for (let i = 0; i < stale.length; i++) {
      const article = stale[i];
      onProgress?.({
        phase: "wts",
        message: `Checking freshness… ${i + 1}/${stale.length}`,
        current: article.title || article.slug,
      });
      try {
        const result = await checkArticleUpdate(article);
        wtsChecks[article.slug] = { status: "done", result };
      } catch (err) {
        wtsChecks[article.slug] = {
          status: "error",
          error: err?.message || "Check failed",
        };
      }
    }
  }

  let rewriteAuditData = null;
  let rewriteProposals = { proposals: [], dropped: [] };
  if (runOps.has("rewrite")) {
    onProgress?.({ phase: "rewrite", message: "Reviewing sections…" });
    try {
      rewriteAuditData = await rewriteAudit(dest, {
        batchSize: REWRITE_AUDIT_CAP,
        excludeBuckets: STALE_EXCLUDE_BUCKETS,
      });
      const items = asArray(rewriteAuditData?.items)
        .map((item) => ({
          slug: item.slug,
          heading: item.heading,
          option: item.recommended,
        }))
        .filter((item) => item.option && item.option !== "skip");
      if (items.length > 0) {
        rewriteProposals = await rewritePropose(dest, items);
      }
    } catch (err) {
      phaseErrors.rewrite = err?.message || "Section review failed";
    }
  }

  const corpusArticles =
    articles.length > 0
      ? articles
      : [
          ...asArray(linksAudit?.issues).map((row) => ({
            slug: row.slug,
            title: row.title,
            draft: false,
            needsUpdateCheck: false,
            canCheck: false,
          })),
          ...asArray(linksAudit?.healthy).map((row) => ({
            slug: row.slug,
            title: row.title,
            draft: false,
            needsUpdateCheck: false,
            canCheck: false,
          })),
        ];
  if (corpusArticles.length === 0) {
    const seen = new Set();
    const add = (item, extra = {}) => {
      const slug = String(
        item?.slug || (typeof item === "string" ? item : "")
      ).trim();
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      corpusArticles.push({
        slug,
        title: item?.title || slug,
        draft: false,
        needsUpdateCheck: false,
        canCheck: false,
        daysSince: item?.daysSince,
        bucket: item?.bucket,
        ...extra,
      });
    };
    for (const item of [
      ...asArray(cleanup?.previews),
      ...asArray(cleanup?.skipped),
    ]) {
      add(item);
    }
    if (corpusArticles.length === 0) {
      for (const item of asArray(rewriteAuditData?.items)) {
        add(item, { needsUpdateCheck: true });
      }
      for (const item of asArray(rewriteAuditData?.rankExcluded)) {
        add(item, { needsUpdateCheck: true });
      }
      for (const item of asArray(rewriteAuditData?.noSection)) {
        add(item, { needsUpdateCheck: true });
      }
    }
  }

  const linkRows = buildLinkRows(linksAudit, linksProposals);
  const rows = buildReviewRows({
    articles: corpusArticles,
    linkRows,
    linksAudit,
    cleanup,
    wtsChecks,
    wtsAudit,
    rewriteAuditData,
    rewriteProposals,
    proposeFailed: Boolean(phaseErrors.linksPropose),
  });
  const batches = buildBatches({
    corpus: corpusArticles.length,
    publishedCount:
      published.length ||
      Number(linksAudit?.publishedCount) ||
      corpusArticles.filter((article) => article.draft !== true).length,
    cleanup,
    staleCount: published.filter((article) => article.needsUpdateCheck).length,
    staleChecked: stale.length,
    rewriteAuditData,
    rewriteProposed: asArray(rewriteProposals?.proposals).length,
    rewriteCommitCount: Math.min(
      REWRITE_COMMIT_CAP,
      asArray(rewriteProposals?.proposals).length
    ),
    runOps,
  });

  return {
    rows,
    batches,
    liveRows: corpusArticles.map(toLiveRow),
    linkHealth: buildLinkHealth(linksAudit),
    phaseErrors,
    raw: {
      linksAudit,
      linksProposals,
      cleanup,
      wtsAudit,
      wtsChecks,
      rewriteAuditData,
      rewriteProposals,
    },
  };
}

function statusFromCommit(slug, result, errorMessage, selected) {
  if (!selected) {
    return { status: "skipped", reason: "not selected" };
  }
  if (errorMessage && !result) {
    return { status: "failed", reason: errorMessage };
  }
  if (!result) {
    return { status: "skipped", reason: "not in this commit" };
  }
  if (committedSlugs(result).has(slug)) {
    return {
      status: "done",
      reason: "",
      branch: result.branch || "",
      mergeCommitSha: result.mergeCommitSha || "",
    };
  }
  const skip = skippedBySlug(result).get(slug);
  if (skip) {
    return {
      status: "skipped",
      reason: skip.message || skip.reason || "skipped",
    };
  }
  const fail = errorsBySlug(result).get(slug);
  if (fail) {
    return { status: "failed", reason: fail.message || "failed" };
  }
  if (result.ok === false && asArray(result.errors).length && !result.committed?.length) {
    return {
      status: "failed",
      reason: result.errors[0]?.message || errorMessage || "commit failed",
    };
  }
  return { status: "skipped", reason: "not in this commit" };
}

export async function runFaceliftApply(
  dest,
  rows,
  selections,
  { onProgress } = {}
) {
  const bySlug = {};
  for (const row of rows) {
    bySlug[row.slug] = {
      title: row.title,
      links: row.ops.links.disabled
        ? { status: "skipped", reason: row.ops.links.reason }
        : { status: "pending", reason: "" },
      cleanup: row.ops.cleanup.disabled
        ? { status: "skipped", reason: row.ops.cleanup.reason }
        : { status: "pending", reason: "" },
      wts: row.ops.wts.disabled
        ? { status: "skipped", reason: row.ops.wts.reason }
        : { status: "pending", reason: "" },
      rewrite: row.ops.rewrite.disabled
        ? { status: "skipped", reason: row.ops.rewrite.reason }
        : { status: "pending", reason: "" },
    };
    const sel = selections[row.slug] || {};
    for (const key of OP_KEYS) {
      if (!row.ops[key].disabled && !sel[key]) {
        bySlug[row.slug][key] = { status: "skipped", reason: "not selected" };
      }
    }
  }

  const selectedCleanup = rows
    .filter(
      (row) =>
        !row.ops.cleanup.disabled && selections[row.slug]?.cleanup
    )
    .map((row) => row.slug);

  let cleanupResult = null;
  let cleanupError = "";
  if (selectedCleanup.length > 0) {
    onProgress?.({ phase: "cleanup", message: "Cleanup: committing…" });
    try {
      cleanupResult = await cleanupCommit(dest, selectedCleanup, [], {
        maxCommit: CLEANUP_BATCH_CAP,
      });
    } catch (err) {
      cleanupError = err?.message || "Cleanup commit failed";
      cleanupResult = err?.result || null;
    }
    for (const slug of selectedCleanup) {
      bySlug[slug].cleanup = statusFromCommit(
        slug,
        cleanupResult,
        cleanupError,
        true
      );
    }
  }

  const wtsUpdates = rows
    .filter((row) => !row.ops.wts.disabled && selections[row.slug]?.wts)
    .map((row) => ({
      slug: row.slug,
      newParagraph: row.ops.wts.proposedParagraph,
    }))
    .filter((item) => String(item.newParagraph || "").trim());

  let wtsResult = null;
  let wtsError = "";
  if (wtsUpdates.length > 0) {
    onProgress?.({ phase: "wts", message: "WTS Update: committing…" });
    try {
      wtsResult = await commitArticleUpdates(dest, wtsUpdates);
    } catch (err) {
      wtsError = err?.message || "WTS commit failed";
      wtsResult = err?.result || null;
    }
    for (const item of wtsUpdates) {
      bySlug[item.slug].wts = statusFromCommit(
        item.slug,
        wtsResult,
        wtsError,
        true
      );
    }
  }

  const rewriteApproved = rows
    .filter(
      (row) => !row.ops.rewrite.disabled && selections[row.slug]?.rewrite
    )
    .map((row) => ({
      slug: row.slug,
      heading: row.ops.rewrite.heading,
      option: row.ops.rewrite.option,
      proposedSectionText: row.ops.rewrite.proposedSectionText,
    }));

  let rewriteResult = null;
  let rewriteError = "";
  if (rewriteApproved.length > 0) {
    onProgress?.({
      phase: "rewrite",
      message: "Section optimization: committing…",
    });
    try {
      rewriteResult = await rewriteCommit(dest, rewriteApproved, {
        maxCommit: REWRITE_COMMIT_CAP,
      });
    } catch (err) {
      rewriteError = err?.message || "Section commit failed";
      rewriteResult = err?.result || null;
    }
    for (const item of rewriteApproved) {
      bySlug[item.slug].rewrite = statusFromCommit(
        item.slug,
        rewriteResult,
        rewriteError,
        true
      );
    }
  }

  const approvedLinkSlugs = new Set(
    rows
      .filter((row) => !row.ops.links.disabled && selections[row.slug]?.links)
      .map((row) => row.slug)
  );

  let linksResult = null;
  let linksError = "";
  let linkHealth = {};
  onProgress?.({
    phase: "links",
    message: "Re-checking links after updates…",
  });
  try {
    const linksAudit = await auditLiveLinks(dest);
    linkHealth = buildLinkHealth(linksAudit);
    const seedProposalRows = rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      candidates: asArray(row.ops.links.candidates),
      currentCount: row.ops.links.currentCount,
      needed: row.ops.links.needed,
      error: row.ops.links.state === "error",
      reason: row.ops.links.reason,
      available: row.ops.links.state !== "error",
    }));
    const haveExternalPlan = new Set(
      seedProposalRows
        .filter((row) => asArray(row.candidates).length > 0)
        .map((row) => row.slug)
    );
    const needPropose = asArray(linksAudit?.issues)
      .filter(
        (item) =>
          approvedLinkSlugs.has(item.slug) &&
          item.external?.short &&
          !haveExternalPlan.has(item.slug)
      )
      .map((item) => item.slug);
    let linksProposals = { rows: seedProposalRows };
    if (needPropose.length) {
      const proposed = await proposeExternalBatched(dest, needPropose, {
        onProgress,
      });
      if (proposed.error) {
        linksError = proposed.error;
      }
      const extraBySlug = indexBySlug(proposed.rows);
      linksProposals = {
        rows: [
          ...seedProposalRows.map((row) => extraBySlug.get(row.slug) || row),
          ...asArray(proposed.rows).filter(
            (row) => !seedProposalRows.some((item) => item.slug === row.slug)
          ),
        ],
      };
    }
    const reviewRows = buildLinkRows(linksAudit, linksProposals);
    const errorSlugs = reviewRows
      .filter((row) => row.error)
      .map((row) => row.slug);
    const publishedSlugs = [
      ...asArray(linksAudit?.issues).map((row) => row.slug),
      ...asArray(linksAudit?.healthy).map((row) => row.slug),
    ];
    const excludeSlugs = [
      ...new Set([
        ...errorSlugs,
        ...publishedSlugs.filter((slug) => !approvedLinkSlugs.has(slug)),
      ]),
    ];
    const confirmedExternal = reviewRows
      .filter((row) => !row.error && approvedLinkSlugs.has(row.slug))
      .map((row) => ({
        slug: row.slug,
        links: asArray(row.candidates).map((link) => ({
          label: link.label || link.title || link.url,
          url: link.url,
        })),
      }))
      .filter((item) => item.links.length);

    const internalNeeded = asArray(linksAudit?.issues).some(
      (item) =>
        approvedLinkSlugs.has(item.slug) &&
        !errorSlugs.includes(item.slug) &&
        asArray(item.internal?.added || item.internal?.missing).length > 0
    );

    if (internalNeeded || confirmedExternal.length > 0) {
      onProgress?.({ phase: "links", message: "Links Fix: committing…" });
      try {
        linksResult = await commitLinkFixes(
          dest,
          confirmedExternal,
          excludeSlugs
        );
        if (linksResult) {
          const after = await auditLiveLinks(dest);
          linkHealth = buildLinkHealth(after);
        }
      } catch (err) {
        linksError = err?.message || "Links commit failed";
        linksResult = err?.result || null;
      }
    }

    for (const slug of approvedLinkSlugs) {
      if (errorSlugs.includes(slug) && !linksResult) {
        bySlug[slug].links = {
          status: "failed",
          reason: "planning failed",
        };
        continue;
      }
      if (!internalNeeded && confirmedExternal.every((item) => item.slug !== slug)) {
        const health = linkHealth[slug];
        bySlug[slug].links = {
          status: "done",
          reason: health?.internalOk && health?.externalOk
            ? "already healthy after earlier updates"
            : "no remaining link work",
        };
        continue;
      }
      bySlug[slug].links = statusFromCommit(
        slug,
        linksResult,
        linksError,
        true
      );
      if (
        bySlug[slug].links.status === "skipped" &&
        bySlug[slug].links.reason === "not in this commit" &&
        linkHealth[slug]?.internalOk &&
        linkHealth[slug]?.externalOk
      ) {
        bySlug[slug].links = {
          status: "done",
          reason: "already healthy after earlier updates",
        };
      }
    }
  } catch (err) {
    const message = err?.message || "Links re-audit failed";
    for (const slug of approvedLinkSlugs) {
      if (bySlug[slug].links.status === "pending") {
        bySlug[slug].links = { status: "failed", reason: message };
      }
    }
  }

  return {
    bySlug,
    linkHealth,
    commits: {
      cleanup: cleanupResult,
      wts: wtsResult,
      rewrite: rewriteResult,
      links: linksResult,
    },
    errors: {
      cleanup: cleanupError,
      wts: wtsError,
      rewrite: rewriteError,
      links: linksError,
    },
  };
}
