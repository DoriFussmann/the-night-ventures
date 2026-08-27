import React, { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_PUBLISH_BRANCH } from "./publishToSite";
import {
  commitInternalLinks,
  proposeInternalLinks,
} from "./wireInternalLinks";

export default function WireInternalLinksPanel({
  companyId,
  destination,
  visible,
}) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [result, setResult] = useState(null);

  if (!visible) return null;

  const dest = {
    companyId,
    owner: destination?.owner,
    repo: destination?.repo,
    tokenKey: destination?.tokenKey,
    branch: DEFAULT_PUBLISH_BRANCH,
  };
  const mapped = Boolean(dest.owner && dest.repo && dest.tokenKey);
  const busy = phase === "proposing" || phase === "committing";
  const proposed = Array.isArray(proposal?.proposed) ? proposal.proposed : [];
  const skipped = Array.isArray(proposal?.skipped) ? proposal.skipped : [];
  const addedCount = proposed.reduce(
    (sum, item) => sum + (Array.isArray(item.added) ? item.added.length : 0),
    0
  );

  const propose = async () => {
    if (busy || !mapped) return;
    setPhase("proposing");
    setError(null);
    setResult(null);
    setProposal(null);
    try {
      const data = await proposeInternalLinks(dest);
      setProposal(data);
      setPhase("review");
    } catch (err) {
      setError(err?.message || "Failed to propose internal links");
      setPhase("idle");
    }
  };

  const confirm = async () => {
    if (busy || !mapped || proposed.length === 0) return;
    setPhase("committing");
    setError(null);
    try {
      const data = await commitInternalLinks(dest);
      setResult(data);
      setPhase("done");
    } catch (err) {
      setError(err?.message || "Failed to commit internal links");
      if (err?.result) setResult(err.result);
      setPhase("review");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!mapped || busy}
          onClick={propose}
        >
          {phase === "proposing" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Reading live repo…
            </>
          ) : (
            <>
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Wire All Links
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

      {phase === "review" && proposal && (
        <div className="text-sm rounded-md px-3 py-2 space-y-2 text-amber-900 bg-amber-50 border border-amber-200">
          <p className="font-medium">Proposed internal links</p>
          <p className="text-xs">
            Live corpus: {proposal.publishedCount ?? 0} published /{" "}
            {proposal.corpusCount ?? 0} files. {addedCount} new link
            {addedCount === 1 ? "" : "s"} across {proposed.length} article
            {proposed.length === 1 ? "" : "s"}. Nothing is written until you
            confirm.
          </p>
          {proposed.length === 0 ? (
            <p>No internal-link changes needed.</p>
          ) : (
            <ul className="space-y-2">
              {proposed.map((article) => (
                <li key={article.slug}>
                  <p className="font-medium font-mono text-xs">{article.slug}</p>
                  <ul className="list-disc pl-5 text-xs">
                    {(article.added || []).map((link) => (
                      <li key={`${article.slug}-${link.slug}`}>
                        → {link.slug}
                        {link.anchor ? ` (“${link.anchor}”)` : ""}
                      </li>
                    ))}
                    {(article.added || []).length === 0 && (
                      <li>No new targets (frontmatter/signpost refresh only)</li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {skipped.length > 0 && (
            <p className="text-xs">
              Already wired: {skipped.map((item) => item.slug).join(", ")}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={busy || proposed.length === 0}
              onClick={confirm}
            >
              {phase === "committing" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Committing…
                </>
              ) : (
                "Confirm and commit"
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setProposal(null);
                setPhase("idle");
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
          Committing internal links on one branch…
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
              ? "Internal links committed"
              : "Internal-link commit did not complete"}
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
              <p className="font-medium">Committed files</p>
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
    </div>
  );
}
