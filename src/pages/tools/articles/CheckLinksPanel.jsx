import React, { useMemo, useState } from "react";
import { Link2, Loader2, RefreshCw } from "lucide-react";
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
    (item) => (item.internal?.missing || []).length > 0
  );
  const externalIssues = issues.filter((item) => item.external?.short);
  const proposalRows = Array.isArray(proposals?.rows) ? proposals.rows : [];

  const selectedCount = useMemo(() => selected.size, [selected]);

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
    const confirmedExternal = proposalRows
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
    if (internalIssues.length === 0 && confirmedExternal.length === 0) {
      setError("Select at least one external source, or refresh if only internal issues remain.");
      return;
    }
    setPhase("committing");
    setError(null);
    try {
      const data = await commitLinkFixes(dest, confirmedExternal);
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
          <p className="font-medium">
            {issues.length === 0
              ? "No link issues on live articles"
              : `${issues.length} article${issues.length === 1 ? "" : "s"} need link work`}
          </p>
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
                    {(article.internal?.missing || []).map((link) => (
                      <li key={`${article.slug}-int-${link.slug}`}>
                        Missing internal: {link.slug}
                        {link.anchor ? ` (“${link.anchor}”)` : ""}
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
          <p className="font-medium">Review before wiring</p>
          <p className="text-xs">
            Internal gaps above will be wired from the live corpus. External
            sources come from live search — uncheck any you do not want.
            Confirm writes one branch and merges to main.
          </p>
          {proposalRows.length === 0 ? (
            <p className="text-xs">
              {externalIssues.length === 0
                ? "No external proposals needed."
                : "No new external sources found."}
            </p>
          ) : (
            <ul className="space-y-3">
              {proposalRows.map((row) => (
                <li key={row.slug}>
                  <p className="font-medium font-mono text-xs">
                    {row.slug}
                    {row.fromCache ? " · cached SERP" : ""}
                  </p>
                  {!row.available && (
                    <p className="text-xs text-destructive">
                      {row.reason || "Search unavailable"}
                    </p>
                  )}
                  {(row.candidates || []).length === 0 ? (
                    <p className="text-xs">No new candidates (has {row.currentCount}, needs {row.needed}).</p>
                  ) : (
                    <ul className="mt-1 space-y-1.5">
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
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={
                busy ||
                (internalIssues.length === 0 && selectedCount === 0)
              }
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
