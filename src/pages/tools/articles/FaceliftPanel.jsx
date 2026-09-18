import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEFAULT_PUBLISH_BRANCH } from "../articleGeneration/publishToSite";
import {
  OP_KEYS,
  OP_LABELS,
  batchBoundaryLines,
  countApproved,
  defaultSelections,
  runFaceliftApply,
  runFaceliftScan,
} from "./faceliftScan";

const DIALOG_CLASS =
  "flex h-[min(90vh,calc(min(96vw,1400px)*9/16))] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-lg";

function destFrom(destination, companyId) {
  return {
    companyId,
    owner: destination?.owner,
    repo: destination?.repo,
    tokenKey: destination?.tokenKey,
    branch: DEFAULT_PUBLISH_BRANCH,
  };
}

function statusClass(status) {
  if (status === "done") return "text-emerald-700";
  if (status === "failed") return "text-destructive";
  return "text-muted-foreground";
}

function OpCell({ op, checked, onToggle }) {
  if (op.disabled) {
    return (
      <span className="text-[11px] leading-snug text-muted-foreground">
        {op.reason || "skipped"}
      </span>
    );
  }
  return (
    <Checkbox
      checked={Boolean(checked)}
      onCheckedChange={(value) => onToggle(Boolean(value))}
      aria-label={op.reason || "include"}
    />
  );
}

function ResultCell({ entry }) {
  if (!entry) return <span className="text-[11px] text-muted-foreground">—</span>;
  const label =
    entry.status === "done"
      ? "Done"
      : entry.status === "failed"
        ? "Failed"
        : "Skipped";
  return (
    <span className={`text-[11px] leading-snug ${statusClass(entry.status)}`}>
      {label}
      {entry.reason ? ` — ${entry.reason}` : ""}
    </span>
  );
}

export default function FaceliftPanel({ companyId, destination, onHealthChange }) {
  const dest = destFrom(destination, companyId);
  const mapped = Boolean(dest.owner && dest.repo && dest.tokenKey);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [scan, setScan] = useState(null);
  const [selections, setSelections] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());
  const [applyResult, setApplyResult] = useState(null);

  const rows = scan?.rows || [];
  const batchLines = useMemo(
    () => batchBoundaryLines(scan?.batches),
    [scan?.batches]
  );
  const approvedCount = useMemo(
    () => countApproved(rows, selections),
    [rows, selections]
  );
  const busy = phase === "scanning" || phase === "applying";

  const reset = () => {
    setPhase("idle");
    setProgress("");
    setError("");
    setScan(null);
    setSelections({});
    setExpanded(new Set());
    setApplyResult(null);
  };

  const startScan = async (ops) => {
    if (!mapped || busy) return;
    setOpen(true);
    setPhase("scanning");
    setProgress("Scanning links…");
    setError("");
    setScan(null);
    setApplyResult(null);
    setExpanded(new Set());
    try {
      const result = await runFaceliftScan(dest, {
        onProgress: (info) => setProgress(info.message || "Scanning…"),
        ops: Array.isArray(ops) ? ops : undefined,
      });
      setScan(result);
      setSelections(defaultSelections(result.rows));
      onHealthChange?.({
        liveRows: result.liveRows,
        linkHealth: result.linkHealth,
      });
      const phaseError = Object.values(result.phaseErrors || {}).filter(Boolean);
      if (phaseError.length) {
        setError(phaseError.join(" · "));
      }
      setPhase("review");
    } catch (err) {
      setError(err?.message || "Facelift scan failed");
      setPhase("idle");
    } finally {
      setProgress("");
    }
  };

  const toggleOp = (slug, key, checked) => {
    setSelections((prev) => ({
      ...prev,
      [slug]: { ...(prev[slug] || {}), [key]: checked },
    }));
  };

  const toggleExpand = (slug) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const apply = async () => {
    if (!mapped || busy || approvedCount === 0 || !scan) return;
    setPhase("applying");
    setProgress("Fix & Optimize: starting…");
    setError("");
    try {
      const result = await runFaceliftApply(dest, rows, selections, {
        onProgress: (info) => setProgress(info.message || "Applying…"),
      });
      setApplyResult(result);
      onHealthChange?.({
        liveRows: scan.liveRows,
        linkHealth: result.linkHealth || scan.linkHealth,
      });
      setPhase("done");
    } catch (err) {
      setError(err?.message || "Fix & Optimize failed");
      setPhase("review");
    } finally {
      setProgress("");
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!mapped || busy}
          onClick={startScan}
        >
          {phase === "scanning" ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          )}
          {phase === "scanning"
            ? "Scanning…"
            : "Review Articles & Suggest Facelift"}
        </Button>
        {[
          { label: "Links", ops: ["links"] },
          { label: "Cleanup", ops: ["cleanup"] },
          { label: "WTS", ops: ["wts"] },
          { label: "Section", ops: ["rewrite"] },
        ].map((item) => (
          <Button
            key={item.label}
            type="button"
            size="sm"
            variant="outline"
            disabled={!mapped || busy}
            onClick={() => startScan(item.ops)}
          >
            {item.label}
          </Button>
        ))}
        {!mapped && (
          <p className="text-sm text-muted-foreground">
            Set a destination repo in Company Data to enable Facelift.
          </p>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>
              {phase === "done"
                ? "Facelift complete"
                : phase === "applying"
                  ? "Fix & Optimize"
                  : "Review Articles & Suggest Facelift"}
            </DialogTitle>
            <DialogDescription>
              Cleanup, then WTS, then section optimization, then a links
              re-audit — serialized merges, never concurrent writes.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {batchLines.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 space-y-1">
                <p className="font-medium">This batch is not necessarily the whole corpus</p>
                {batchLines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {(phase === "scanning" || phase === "applying") && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress || "Working…"}
              </div>
            )}

            {phase === "review" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || approvedCount === 0}
                    onClick={apply}
                  >
                    Fix & Optimize
                    {approvedCount ? ` (${approvedCount})` : ""}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Uncheck anything you do not want in this run.
                  </span>
                </div>

                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No live articles found in the destination repo.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[52rem] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Article</th>
                          {OP_KEYS.map((key) => (
                            <th
                              key={key}
                              className="px-3 py-2 font-medium whitespace-nowrap"
                            >
                              {OP_LABELS[key]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map((row) => {
                          const openRow = expanded.has(row.slug);
                          const hasDetails = OP_KEYS.some((key) => {
                            const op = row.ops[key];
                            return (
                              op.proposedParagraph ||
                              op.proposedSectionText ||
                              (op.candidates || []).length ||
                              (op.diffs || []).length
                            );
                          });
                          return (
                            <React.Fragment key={row.slug}>
                              <tr className="align-top">
                                <td className="px-3 py-2.5">
                                  <button
                                    type="button"
                                    className="flex items-start gap-1.5 text-left"
                                    onClick={() =>
                                      hasDetails && toggleExpand(row.slug)
                                    }
                                    disabled={!hasDetails}
                                  >
                                    {hasDetails ? (
                                      openRow ? (
                                        <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      ) : (
                                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                      )
                                    ) : (
                                      <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    )}
                                    <span className="font-medium text-foreground">
                                      {row.title}
                                    </span>
                                  </button>
                                </td>
                                {OP_KEYS.map((key) => (
                                  <td key={key} className="px-3 py-2.5">
                                    <OpCell
                                      op={row.ops[key]}
                                      checked={selections[row.slug]?.[key]}
                                      onToggle={(checked) =>
                                        toggleOp(row.slug, key, checked)
                                      }
                                    />
                                  </td>
                                ))}
                              </tr>
                              {openRow && (
                                <tr>
                                  <td
                                    colSpan={5}
                                    className="bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1"
                                  >
                                    {row.ops.links.candidates?.length ? (
                                      <p>
                                        External candidates:{" "}
                                        {row.ops.links.candidates
                                          .map(
                                            (link) =>
                                              link.label || link.title || link.url
                                          )
                                          .join(" · ")}
                                      </p>
                                    ) : null}
                                    {row.ops.cleanup.diffs?.length ? (
                                      <p>
                                        Cleanup diffs: {row.ops.cleanup.diffs.length}
                                      </p>
                                    ) : null}
                                    {row.ops.wts.proposedParagraph ? (
                                      <p className="whitespace-pre-wrap">
                                        WTS: {row.ops.wts.proposedParagraph}
                                      </p>
                                    ) : null}
                                    {row.ops.rewrite.proposedSectionText ? (
                                      <p>
                                        Section ({row.ops.rewrite.heading}):{" "}
                                        {row.ops.rewrite.proposedSectionText.slice(
                                          0,
                                          280
                                        )}
                                        {row.ops.rewrite.proposedSectionText.length >
                                        280
                                          ? "…"
                                          : ""}
                                      </p>
                                    ) : null}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {phase === "done" && applyResult && (
              <div className="space-y-3">
                <p className="text-sm text-foreground">
                  Per-article results. Failures did not abort the rest of the run.
                </p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[52rem] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Article</th>
                        {OP_KEYS.map((key) => (
                          <th
                            key={key}
                            className="px-3 py-2 font-medium whitespace-nowrap"
                          >
                            {OP_LABELS[key]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => (
                        <tr key={row.slug} className="align-top">
                          <td className="px-3 py-2.5 font-medium text-foreground">
                            {row.title}
                          </td>
                          {OP_KEYS.map((key) => (
                            <td key={key} className="px-3 py-2.5">
                              <ResultCell
                                entry={applyResult.bySlug?.[row.slug]?.[key]}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5 font-mono">
                  {["cleanup", "wts", "rewrite", "links"].map((key) => {
                    const commit = applyResult.commits?.[key];
                    if (!commit) return null;
                    return (
                      <p key={key}>
                        {OP_LABELS[key] || key}:{" "}
                        {commit.branch || "no branch"}
                        {commit.mergeCommitSha
                          ? ` · ${commit.mergeCommitSha}`
                          : commit.pullRequestUrl
                            ? ` · ${commit.pullRequestUrl}`
                            : ""}
                      </p>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
