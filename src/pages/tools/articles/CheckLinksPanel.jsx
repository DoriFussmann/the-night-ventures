import React, { useMemo, useState } from "react";
import { Copy, Link2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_PUBLISH_BRANCH } from "../articleGeneration/publishToSite";
import {
  auditLiveLinks,
  commitLinkFixes,
  proposeExternalFixes,
} from "./checkLinksApi";

function issueKey(slug, url) {
  return `${slug}::${url}`;
}

function formatInternalLink(link) {
  if (!link?.slug) return "";
  return link.anchor ? `${link.slug} (“${link.anchor}”)` : link.slug;
}

function formatIssuesText(audit, issues) {
  const lines = [
    "Check Links — issues",
    `Live corpus: ${audit?.publishedCount ?? 0} published / ${audit?.corpusCount ?? 0} files`,
    "",
  ];
  if (!issues.length) {
    lines.push("No link issues on live articles.");
    return lines.join("\n");
  }
  for (const article of issues) {
    lines.push(article.slug);
    for (const link of article.internal?.added ||
      article.internal?.missing ||
      []) {
      lines.push(`  Missing internal: ${formatInternalLink(link)}`);
    }
    if (article.external?.short) {
      lines.push(
        `  External sources: has ${article.external.currentCount}, needs ${article.external.needed}`
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function formatReviewText(reviewRows, selected) {
  const lines = ["Check Links — review before wiring", ""];
  for (const row of reviewRows) {
    lines.push(row.slug);
    if (row.error) {
      lines.push(
        `  ERROR (excluded from Confirm & Wire All): ${row.reason || "planning failed"}`
      );
    }
    const kept = row.internal?.kept || [];
    const added = row.internal?.added || [];
    lines.push("  Internal links (merged — existing preserved, not replaced):");
    if (!kept.length && !added.length) {
      lines.push("    (none existing, none being added)");
    }
    for (const link of kept) {
      lines.push(`    existing (kept): ${formatInternalLink(link)}`);
    }
    for (const link of added) {
      lines.push(`    new (will be added): ${formatInternalLink(link)}`);
    }
    if (!row.error) {
      const candidates = row.candidates || [];
      if (candidates.length) {
        lines.push("  External proposals:");
        for (const link of candidates) {
          const mark = selected.has(issueKey(row.slug, link.url))
            ? "[x]"
            : "[ ]";
          lines.push(`    ${mark} ${link.label || link.title || link.url}`);
          lines.push(`        ${link.url}`);
        }
      } else if (row.externalShort) {
        lines.push("  External proposals: none found");
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function CopyPanelButton({ text, disabled }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!text || disabled) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2"
      disabled={disabled || !text}
      onClick={copy}
    >
      <Copy className="h-3.5 w-3.5 mr-1.5" />
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export default function CheckLinksPanel({ companyId, destination }) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState(null);
  const [proposals, setProposals] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [result, setResult] = useState(null);

  const dest = {
    companyId,
    owner: destination?.owner,
    repo: destination?.repo,
    tokenKey: destination?.tokenKey,
    branch: DEFAULT_PUBLISH_BRANCH,
  };
  const mapped = Boolean(dest.owner && dest.repo && dest.tokenKey);
  const busy =
    phase === "auditing" ||
    phase === "proposing" ||
    phase === "committing";

  const issues = Array.isArray(audit?.issues) ? audit.issues : [];
  const internalIssues = issues.filter(
    (item) => (item.internal?.added || item.internal?.missing || []).length > 0
  );
  const externalIssues = issues.filter((item) => item.external?.short);
  const proposalRows = Array.isArray(proposals?.rows) ? proposals.rows : [];

  const reviewRows = useMemo(() => {
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
      const failed =
        Boolean(proposal?.error) || proposal?.available === false;
      return {
        slug,
        title: issue?.title || proposal?.title || slug,
        error: failed,
        reason: proposal?.reason,
        fromCache: proposal?.fromCache,
        internal: issue?.internal || { kept: [], added: [] },
        candidates: failed ? [] : proposal?.candidates || [],
        externalShort: Boolean(issue?.external?.short),
        currentCount:
          proposal?.currentCount ?? issue?.external?.currentCount ?? 0,
        needed: proposal?.needed ?? issue?.external?.needed ?? 3,
      };
    });
  }, [issues, proposalRows]);

  const errorSlugs = useMemo(
    () => reviewRows.filter((row) => row.error).map((row) => row.slug),
    [reviewRows]
  );
  const errorSlugSet = useMemo(() => new Set(errorSlugs), [errorSlugs]);
  const selectedCount = useMemo(() => selected.size, [selected]);
  const canWireInternal = internalIssues.some(
    (item) => !errorSlugSet.has(item.slug)
  );
  const issuesCopyText = useMemo(
    () => formatIssuesText(audit, issues),
    [audit, issues]
  );
  const reviewCopyText = useMemo(
    () => formatReviewText(reviewRows, selected),
    [reviewRows, selected]
  );

  const refresh = async () => {
    if (busy || !mapped) return;
    setPhase("auditing");
    setError(null);
    setResult(null);
    setProposals(null);
    setSelected(new Set());
    try {
      const data = await auditLiveLinks(dest);
      setAudit(data);
      setPhase("issues");
    } catch (err) {
      setError(err?.message || "Failed to read live articles");
      setPhase("idle");
    }
  };

  const fixAll = async () => {
    if (busy || !mapped || issues.length === 0) return;
    setError(null);
    setResult(null);
    if (externalIssues.length === 0) {
      setProposals({ rows: [] });
      setSelected(new Set());
      setPhase("review");
      return;
    }
    setPhase("proposing");
    try {
      const data = await proposeExternalFixes(dest);
      setProposals(data);
      const next = new Set();
      for (const row of data.rows || []) {
        if (row?.error || row?.available === false) continue;
        for (const link of row.candidates || []) {
          if (link?.url) next.add(issueKey(row.slug, link.url));
        }
      }
      setSelected(next);
      setPhase("review");
    } catch (err) {
      setError(err?.message || "Failed to propose external links");
      setPhase("issues");
    }
  };

  const toggleLink = (slug, url, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = issueKey(slug, url);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const confirm = async () => {
    if (busy || !mapped) return;
    const confirmedExternal = reviewRows
      .filter((row) => !row.error)
      .map((row) => ({
        slug: row.slug,
        links: (row.candidates || [])
          .filter((link) => selected.has(issueKey(row.slug, link.url)))
          .map((link) => ({
            label: link.label || link.title || link.url,
            url: link.url,
          })),
      }))
      .filter((item) => item.links.length);
    if (!canWireInternal && confirmedExternal.length === 0) {
      setError(
        errorSlugs.length
          ? "Errored articles are excluded until planning succeeds. Resolve them with Refresh / Fix all, or select other proposals."
          : "Select at least one external source, or refresh if only internal issues remain."
      );
      return;
    }
    setPhase("committing");
    setError(null);
    try {
      const data = await commitLinkFixes(
        dest,
        confirmedExternal,
        errorSlugs
      );
      setResult(data);
      setPhase("done");
    } catch (err) {
      setError(err?.message || "Failed to commit link fixes");
      if (err?.result) setResult(err.result);
      setPhase("review");
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">Check Links</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit internal and external links on the live destination repo,
          then wire missing internals and confirmed external sources in one
          merge.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!mapped || busy}
          onClick={refresh}
        >
          {phase === "auditing" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Reading live repo…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </>
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!mapped || busy || issues.length === 0}
          onClick={fixAll}
        >
          {phase === "proposing" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Finding sources…
            </>
          ) : (
            <>
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Fix all
            </>
          )}
        </Button>
        {!mapped && (
          <p className="text-sm text-muted-foreground">
            No destination repo set for this company.
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {audit && (phase === "issues" || phase === "review" || phase === "proposing") && (
        <div className="text-sm rounded-md px-3 py-2 space-y-2 text-amber-900 bg-amber-50 border border-amber-200">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">
              {issues.length === 0
                ? "No link issues on live articles"
                : `${issues.length} article${issues.length === 1 ? "" : "s"} need link work`}
            </p>
            <CopyPanelButton text={issuesCopyText} disabled={busy} />
          </div>
          <p className="text-xs">
            Live corpus: {audit.publishedCount ?? 0} published /{" "}
            {audit.corpusCount ?? 0} files
            {internalIssues.length
              ? ` · ${internalIssues.length} missing internal links`
              : ""}
            {externalIssues.length
              ? ` · ${externalIssues.length} short on external sources`
              : ""}
            . Draft files are ignored.
          </p>
          {issues.length > 0 && (
            <ul className="space-y-2">
              {issues.map((article) => (
                <li key={article.slug}>
                  <p className="font-medium font-mono text-xs">{article.slug}</p>
                  <ul className="list-disc pl-5 text-xs">
                    {(article.internal?.added ||
                      article.internal?.missing ||
                      []).map((link) => (
                      <li key={`${article.slug}-int-${link.slug}`}>
                        Missing internal: {formatInternalLink(link)}
                      </li>
                    ))}
                    {article.external?.short && (
                      <li>
                        External sources: has {article.external.currentCount},
                        needs {article.external.needed}
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {phase === "review" && (
        <div className="text-sm rounded-md px-3 py-2 space-y-2 text-amber-900 bg-amber-50 border border-amber-200">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">Review before wiring</p>
            <CopyPanelButton text={reviewCopyText} disabled={busy} />
          </div>
          <p className="text-xs">
            Internal links are merged into the existing list — existing
            targets are kept, new targets are added. External sources come
            from live search — uncheck any you do not want. Confirm writes
            one branch and merges to main. Articles with planning errors are
            excluded until they succeed.
          </p>
          {errorSlugs.length > 0 && (
            <p className="text-xs text-destructive">
              {errorSlugs.length} article
              {errorSlugs.length === 1 ? "" : "s"} failed planning and will
              not be wired: {errorSlugs.join(", ")}
            </p>
          )}
          {reviewRows.length === 0 ? (
            <p className="text-xs">Nothing to review.</p>
          ) : (
            <ul className="space-y-3">
              {reviewRows.map((row) => (
                <li key={row.slug}>
                  <p className="font-medium font-mono text-xs">
                    {row.slug}
                    {row.fromCache ? " · cached SERP" : ""}
                    {row.error ? " · excluded" : ""}
                  </p>
                  {row.error && (
                    <p className="text-xs text-destructive">
                      Planning error: {row.reason || "unavailable"}. This
                      article will not be wired.
                    </p>
                  )}
                  <div className="mt-1 text-xs space-y-1">
                    <p className="font-medium">
                      Internal links — existing kept, new added
                    </p>
                    <ul className="pl-0 space-y-0.5">
                      {(row.internal?.kept || []).map((link) => (
                        <li key={`${row.slug}-kept-${link.slug}`}>
                          <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-800 mr-1.5">
                            existing
                          </span>
                          {formatInternalLink(link)}
                        </li>
                      ))}
                      {(row.internal?.added || []).map((link) => (
                        <li key={`${row.slug}-new-${link.slug}`}>
                          <span className="inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-1.5 py-0 text-[10px] font-medium text-sky-800 mr-1.5">
                            new
                          </span>
                          {formatInternalLink(link)}
                        </li>
                      ))}
                      {(row.internal?.kept || []).length === 0 &&
                        (row.internal?.added || []).length === 0 && (
                          <li className="text-amber-800/80">
                            No internal links on this article; none being added.
                          </li>
                        )}
                    </ul>
                  </div>
                  {!row.error && (row.candidates || []).length > 0 && (
                    <ul className="mt-1.5 space-y-1.5">
                      {(row.candidates || []).map((link) => {
                        const key = issueKey(row.slug, link.url);
                        return (
                          <li key={key} className="flex items-start gap-2 text-xs">
                            <Checkbox
                              className="mt-0.5"
                              checked={selected.has(key)}
                              onCheckedChange={(value) =>
                                toggleLink(row.slug, link.url, value === true)
                              }
                            />
                            <span>
                              <span className="font-medium">
                                {link.label || link.title || link.url}
                              </span>
                              <br />
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline break-all"
                              >
                                {link.url}
                              </a>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!row.error &&
                    row.externalShort &&
                    (row.candidates || []).length === 0 && (
                      <p className="text-xs mt-1">
                        No new external candidates (has {row.currentCount},
                        needs {row.needed}).
                      </p>
                    )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={busy || (!canWireInternal && selectedCount === 0)}
              onClick={confirm}
            >
              {phase === "committing" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Wiring…
                </>
              ) : (
                `Confirm & Wire All${
                  selectedCount ? ` (${selectedCount})` : ""
                }`
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setProposals(null);
                setSelected(new Set());
                setPhase("issues");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === "committing" && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Committing internal and external links on one branch…
        </p>
      )}

      {result && (
        <div
          className={`text-sm rounded-md px-3 py-2 space-y-1.5 ${
            result.ok
              ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
              : "text-amber-800 bg-amber-50 border border-amber-200"
          }`}
        >
          <p className="font-medium">
            {result.ok
              ? "Links committed"
              : "Link commit did not complete"}
          </p>
          {result.branch && (
            <p>
              Branch: <span className="font-mono">{result.branch}</span>
            </p>
          )}
          {result.mergeCommitSha && (
            <p>
              Merge SHA:{" "}
              <span className="font-mono break-all">
                {result.mergeCommitSha}
              </span>
            </p>
          )}
          {result.pullRequestUrl && (
            <p>
              Pull request:{" "}
              <a
                href={result.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {result.pullRequestUrl}
              </a>
            </p>
          )}
          {Array.isArray(result.committed) && result.committed.length > 0 && (
            <div>
              <p className="font-medium">Committed</p>
              <ul className="list-disc pl-5 font-mono text-xs">
                {result.committed.map((file) => (
                  <li key={file.path || file.slug}>
                    {file.path || file.slug}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(result.skipped) && result.skipped.length > 0 && (
            <div>
              <p className="font-medium">Skipped</p>
              <ul className="list-disc pl-5 text-xs">
                {result.skipped.map((item, i) => (
                  <li key={`${item.slug || "skipped"}-${i}`}>
                    {item.slug ? `${item.slug}: ` : ""}
                    {item.reason || item.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(result.errors) && result.errors.length > 0 && (
            <div>
              <p className="font-medium">Errors</p>
              <ul className="list-disc pl-5 text-xs">
                {result.errors.map((item, i) => (
                  <li key={`${item.slug || "error"}-${i}`}>
                    {item.slug ? `${item.slug}: ` : ""}
                    {item.message || String(item)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
