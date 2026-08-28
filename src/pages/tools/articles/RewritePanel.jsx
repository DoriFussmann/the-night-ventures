import React, { useMemo, useState } from "react";
import { Copy, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_PUBLISH_BRANCH } from "../articleGeneration/publishToSite";
import { rewriteAudit, rewritePropose, rewriteCommit } from "./articleUpdatesApi";

function truncate(value, max = 200) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export default function RewritePanel({ companyId, destination }) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState(null);
  const [optionBySlug, setOptionBySlug] = useState({});
  const [proposals, setProposals] = useState(null);
  const [approved, setApproved] = useState(() => new Set());
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
    phase === "auditing" || phase === "proposing" || phase === "committing";

  const items = Array.isArray(audit?.items) ? audit.items : [];
  const proposalRows = Array.isArray(proposals?.proposals) ? proposals.proposals : [];
  const droppedRows = Array.isArray(proposals?.dropped) ? proposals.dropped : [];

  const chosenCount = useMemo(
    () => items.filter((it) => (optionBySlug[it.slug] || it.recommended) !== "skip").length,
    [items, optionBySlug]
  );

  const scan = async () => {
    if (busy || !mapped) return;
    setPhase("auditing");
    setError(null);
    setResult(null);
    setProposals(null);
    setApproved(new Set());
    try {
      const data = await rewriteAudit(dest);
      setAudit(data);
      const opts = {};
      for (const it of data.items || []) opts[it.slug] = it.recommended;
      setOptionBySlug(opts);
      setPhase("picking");
    } catch (err) {
      setError(err?.message || "Failed to read live articles");
      setPhase("idle");
    }
  };

  const setOption = (slug, option) => {
    setOptionBySlug((prev) => ({ ...prev, [slug]: option }));
  };

  const propose = async () => {
    if (busy || !mapped) return;
    const chosen = items
      .map((it) => ({
        slug: it.slug,
        heading: it.heading,
        option: optionBySlug[it.slug] || it.recommended,
      }))
      .filter((it) => it.option && it.option !== "skip");
    if (chosen.length === 0) {
      setError("Choose an option for at least one section (or all are skipped).");
      return;
    }
    setPhase("proposing");
    setError(null);
    try {
      const data = await rewritePropose(dest, chosen);
      setProposals(data);
      setApproved(new Set((data.proposals || []).map((p) => p.slug)));
      setPhase("review");
    } catch (err) {
      setError(err?.message || "Failed to propose changes");
      setPhase("picking");
    }
  };

  const toggleApprove = (slug, checked) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (checked) next.add(slug);
      else next.delete(slug);
      return next;
    });
  };

  const commit = async () => {
    if (busy || !mapped) return;
    const list = proposalRows
      .filter((p) => approved.has(p.slug))
      .map((p) => ({
        slug: p.slug,
        heading: p.heading,
        option: p.option,
        proposedSectionText: p.proposedSectionText,
      }));
    if (list.length === 0) {
      setError("Approve at least one proposed change.");
      return;
    }
    setPhase("committing");
    setError(null);
    try {
      const data = await rewriteCommit(dest, list);
      setResult(data);
      setPhase("done");
    } catch (err) {
      setError(err?.message || "Failed to commit rewrites");
      if (err?.result) setResult(err.result);
      setPhase("review");
    }
  };

  const committedCount = Array.isArray(result?.committed) ? result.committed.length : 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">Section improvement</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          One random section per article, oldest first. Pick a change per
          section (or skip), preview an additive proposal, then approve and
          merge. Additive over rewriting; keywords and headings are never
          touched; top-30 pages are excluded.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!mapped || busy}
          onClick={scan}
        >
          {phase === "auditing" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Reading live repo…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Scan
            </>
          )}
        </Button>

        {phase === "picking" && items.length > 0 && (
          <Button type="button" size="sm" disabled={busy} onClick={propose}>
            {phase === "proposing" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Proposing…
              </>
            ) : (
              <>
                <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                Propose changes ({chosenCount})
              </>
            )}
          </Button>
        )}

        {phase === "review" && proposalRows.length > 0 && (
          <Button type="button" size="sm" disabled={busy} onClick={commit}>
            {phase === "committing" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Committing…
              </>
            ) : (
              <>
                <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                Commit approved ({approved.size})
              </>
            )}
          </Button>
        )}
      </div>

      {!mapped && (
        <p className="text-sm text-muted-foreground">
          Set a destination repo for this company to enable section improvement.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {phase === "picking" && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No eligible sections in this batch.
        </p>
      )}

      {phase === "picking" && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.slug} className="rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {it.title || it.slug}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ## {it.heading}
                    {it.position != null ? ` · rank #${it.position}` : ""}
                  </span>
                </span>
                <select
                  className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                  value={optionBySlug[it.slug] || it.recommended}
                  onChange={(e) => setOption(it.slug, e.target.value)}
                >
                  {(it.menu || []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === it.recommended ? `${opt} (recommended)` : opt}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {truncate(it.sectionText, 220)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {phase === "review" && (
        <>
          {proposalRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No proposals passed the guardrails.
            </p>
          )}
          {proposalRows.length > 0 && (
            <ul className="space-y-2">
              {proposalRows.map((p) => (
                <li key={p.slug} className="rounded-md border border-border p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <Checkbox
                      checked={approved.has(p.slug)}
                      onCheckedChange={(v) => toggleApprove(p.slug, Boolean(v))}
                      className="mt-0.5"
                    />
                    <span className="flex-1">
                      <span className="font-medium text-foreground">{p.slug}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        ## {p.heading} · {p.option}
                      </span>
                      <span className="mt-1 block text-xs text-foreground">
                        {p.added ? `+ ${p.added}` : truncate(p.proposedSectionText, 300)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {droppedRows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Dropped:{" "}
              {droppedRows
                .map((d) => `${d.slug} (${d.reason}${d.failures ? `: ${d.failures.join(", ")}` : ""})`)
                .join("; ")}
            </p>
          )}
        </>
      )}

      {phase === "done" && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">
            Committed {committedCount} section change(s).
          </p>
          {result?.branch && (
            <p className="text-xs text-muted-foreground">
              Branch {result.branch}
              {result.mergeStrategy ? ` · ${result.mergeStrategy}` : ""}
            </p>
          )}
          {Array.isArray(result?.skipped) && result.skipped.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Skipped: {result.skipped.map((s) => `${s.slug} (${s.reason})`).join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
