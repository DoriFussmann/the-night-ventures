import React, { useMemo, useState } from "react";
import { Copy, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_PUBLISH_BRANCH } from "../articleGeneration/publishToSite";
import { cleanupAudit, cleanupCommit } from "./articleUpdatesApi";

function statsLine(stats) {
  if (!stats) return "";
  const parts = [];
  if (stats.emDashBefore !== stats.emDashAfter) {
    parts.push(
      `em-dash ${stats.emDashPer1kBefore}/1k → ${stats.emDashPer1kAfter}/1k`
    );
  }
  if (stats.quotesChanged) parts.push(`quotes ${stats.quotesChanged}`);
  if (stats.trackingChanged) parts.push(`tracking ${stats.trackingChanged}`);
  if (stats.strayMarkdownChanged) parts.push(`stray-md ${stats.strayMarkdownChanged}`);
  return parts.join(" · ");
}

function truncate(value, max = 90) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function formatReviewText(previews, selected) {
  const lines = ["Deterministic cleanup — review", ""];
  for (const p of previews) {
    const mark = selected.has(p.slug) ? "[x]" : "[ ]";
    const rank = p.rankSkip ? ` (ranking #${p.position} — skip suggested)` : "";
    lines.push(`${mark} ${p.slug}${rank}`);
    lines.push(`    ${statsLine(p.stats)}`);
    for (const d of p.diffs || []) {
      lines.push(`    [${d.pass}] ${truncate(d.before, 60)} → ${truncate(d.after, 60)}`);
    }
    for (const f of p.flags || []) {
      lines.push(`    ! flag: ${f.kind} (left for review)`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function CopyButton({ text, disabled }) {
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

export default function CleanupPanel({ companyId, destination }) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [audit, setAudit] = useState(null);
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
  const busy = phase === "auditing" || phase === "committing";

  const previews = Array.isArray(audit?.previews) ? audit.previews : [];
  const reviewText = useMemo(
    () => formatReviewText(previews, selected),
    [previews, selected]
  );

  const refresh = async () => {
    if (busy || !mapped) return;
    setPhase("auditing");
    setError(null);
    setResult(null);
    setSelected(new Set());
    try {
      const data = await cleanupAudit(dest);
      setAudit(data);
      // default-select changed items that are not ranking well
      const next = new Set();
      for (const p of data.previews || []) {
        if (!p.rankSkip) next.add(p.slug);
      }
      setSelected(next);
      setPhase("review");
    } catch (err) {
      setError(err?.message || "Failed to read live articles");
      setPhase("idle");
    }
  };

  const toggle = (slug, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(slug);
      else next.delete(slug);
      return next;
    });
  };

  const confirm = async () => {
    if (busy || !mapped) return;
    const slugs = [...selected];
    if (slugs.length === 0) {
      setError("Select at least one article to clean up.");
      return;
    }
    // Any selected article that ranks well must be force-committed past the
    // server's default rank skip.
    const forceSlugs = previews
      .filter((p) => p.rankSkip && selected.has(p.slug))
      .map((p) => p.slug);
    setPhase("committing");
    setError(null);
    try {
      const data = await cleanupCommit(dest, slugs, forceSlugs);
      setResult(data);
      setPhase("done");
    } catch (err) {
      setError(err?.message || "Failed to commit cleanup");
      if (err?.result) setResult(err.result);
      setPhase("review");
    }
  };

  const committedCount = Array.isArray(result?.committed) ? result.committed.length : 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">Cleanup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deterministic AI-writing cleanup on the oldest articles — em-dash
          density, stray markdown, tracking params, curly quotes. Reviewable
          diffs, one merge. Pages ranking in the top 30 are flagged and
          deselected by default.
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
              Scan
            </>
          )}
        </Button>
        {phase === "review" && previews.length > 0 && (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={confirm}>
              {phase === "committing" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Committing…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Clean up selected ({selected.size})
                </>
              )}
            </Button>
            <CopyButton text={reviewText} disabled={busy} />
          </>
        )}
      </div>

      {!mapped && (
        <p className="text-sm text-muted-foreground">
          Set a destination repo for this company to enable cleanup.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {phase === "review" && previews.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing to clean in this batch{" "}
          {audit?.scanned != null ? `(scanned ${audit.scanned}).` : "."}
        </p>
      )}

      {phase === "review" && previews.length > 0 && (
        <ul className="space-y-2">
          {previews.map((p) => (
            <li
              key={p.slug}
              className="rounded-md border border-border p-3 text-sm"
            >
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={selected.has(p.slug)}
                  onCheckedChange={(v) => toggle(p.slug, Boolean(v))}
                  className="mt-0.5"
                />
                <span className="flex-1">
                  <span className="font-medium text-foreground">
                    {p.title || p.slug}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.bucket} · {p.daysSince}d
                    {p.rankSkip
                      ? ` · ranking #${p.position} — skip suggested`
                      : p.position != null
                        ? ` · rank #${p.position}`
                        : ""}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {statsLine(p.stats)}
                  </span>
                  {(p.diffs || []).slice(0, 6).map((d, i) => (
                    <span
                      key={i}
                      className="mt-1 block font-mono text-[11px] text-muted-foreground"
                    >
                      [{d.pass}] {truncate(d.before, 70)} → {truncate(d.after, 70)}
                    </span>
                  ))}
                  {(p.flags || []).map((f, i) => (
                    <span key={i} className="mt-1 block text-[11px] text-amber-600">
                      flag: {f.kind} (left for review)
                    </span>
                  ))}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {phase === "done" && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">
            Committed {committedCount} article(s).
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
