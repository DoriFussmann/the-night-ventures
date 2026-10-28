import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Copy, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  loadCompanyPublishDestination,
  loadSavedScan,
  saveScan,
  saveSignoffs,
  scanSitePlaceholders,
  summarize,
} from "./placeholdersApi";

const STATE_META = {
  placeholder: {
    label: "Placeholder",
    className: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  },
  replaced: {
    label: "Replaced",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  },
  review: {
    label: "Needs sign-off",
    className: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  },
  confirmed: {
    label: "Confirmed",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  },
  unknown: {
    label: "Can't check",
    className: "bg-muted text-muted-foreground border-border",
  },
};

const STATE_ORDER = { placeholder: 0, unknown: 1, review: 2, confirmed: 3, replaced: 4 };
const FINDINGS_SHOWN = 8;

function timeAgo(iso) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function StatePill({ state }) {
  const meta = STATE_META[state] || STATE_META.unknown;
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.className)}>
      {meta.label}
    </span>
  );
}

function PromptBox({ prompt }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-[10px] border border-border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Prompt for Claude Chat or Cursor</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={copy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs text-foreground">{prompt}</pre>
      {prompt.includes("[") && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">Replace the parts in [square brackets] before sending.</p>
      )}
    </div>
  );
}

function ItemRow({ item, expanded, onToggle, onSignoff, signing }) {
  const extra = item.findings.length - FINDINGS_SHOWN;
  return (
    <div className={cn("rounded-[14px] border border-border bg-card transition-colors", expanded ? "bg-accent/30" : "hover:bg-accent/40")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded ? "rotate-0" : "-rotate-90")} />
          <span className="truncate text-sm text-foreground">{item.label}</span>
          {item.level === "suggested" && <span className="text-[11px] text-muted-foreground">suggested</span>}
          {item.findings.length > 0 && item.state === "placeholder" && (
            <span className="text-[11px] text-muted-foreground">· {item.findings.length}</span>
          )}
        </div>
        <StatePill state={item.state} />
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {item.help && <p className="text-sm text-foreground">{item.help}</p>}
          {item.steps?.length > 0 && (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground marker:text-muted-foreground">
              {item.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          )}
          {item.prompt && <PromptBox prompt={item.prompt} />}
          {item.findings.length > 0 && <p className="text-[11px] font-medium text-muted-foreground">Found in</p>}
          {item.findings.length > 0 && (
            <ul className="space-y-1">
              {item.findings.slice(0, FINDINGS_SHOWN).map((f, index) => (
                <li key={`${f.file}-${f.line}-${index}`} className="text-xs">
                  <code className="text-muted-foreground">
                    {f.file}
                    {f.line ? `:${f.line}` : ""}
                  </code>{" "}
                  <span className="text-foreground">{f.detail}</span>
                </li>
              ))}
              {extra > 0 && <li className="text-xs text-muted-foreground">+{extra} more</li>}
            </ul>
          )}
          {item.review && (item.state === "review" || item.state === "confirmed") && (
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={item.signed}
                disabled={signing}
                onChange={(event) => onSignoff(item.id, event.target.checked)}
              />
              I confirm the new content was reviewed
              {item.signedBy && <span className="text-muted-foreground">({item.signedBy})</span>}
            </label>
          )}
          {item.review && item.state === "placeholder" && (
            <p className="text-xs text-muted-foreground">Sign-off opens once the template text is gone.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Live Placeholders stage of the Build Blueprint: scans the company's site
 * repo and shows what is still template content.
 * @param {{ companyId: string, onSummary?: (s: object|null) => void }} props
 */
export default function PlaceholdersStage({ companyId, onSummary }) {
  const [destination, setDestination] = useState(null);
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);

  const runScan = useCallback(
    async (dest) => {
      setScanning(true);
      setError("");
      try {
        const scan = await scanSitePlaceholders(dest);
        let saveError = "";
        try {
          await saveScan(companyId, scan);
        } catch (err) {
          saveError = err.message;
        }
        setRow((prev) => ({
          ...(prev || {}),
          scanned_at: scan.scannedAt,
          commit_sha: scan.commitSha,
          branch: scan.project?.branch,
          site_root: scan.siteRoot,
          core_version: scan.coreVersion,
          manifest_source: scan.manifestSource,
          report: scan.report,
          signoffs: prev?.signoffs || {},
          tree_truncated: scan.treeTruncated,
        }));
        if (saveError) setError(`Scan done, but not saved: ${saveError}`);
      } catch (err) {
        setError(err.message || "Scan failed");
      } finally {
        setScanning(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const dest = await loadCompanyPublishDestination(companyId);
        if (cancelled) return;
        const hasRepo = dest?.owner && dest?.repo && dest?.tokenKey;
        setDestination(hasRepo ? dest : null);
        let saved = null;
        try {
          saved = await loadSavedScan(companyId);
        } catch (err) {
          if (!cancelled) setError(err.message);
        }
        if (cancelled) return;
        setRow(saved);
        setLoading(false);
        // First visit: scan right away.
        if (hasRepo && !saved?.report) await runScan(dest);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, runScan]);

  const repoName = destination ? `${destination.owner}/${destination.repo}` : "";
  const summary = useMemo(
    () => (row?.report ? summarize(row.report, row.signoffs || {}, repoName) : null),
    [row, repoName]
  );

  useEffect(() => {
    onSummary?.(summary);
  }, [summary, onSummary]);

  const onSignoff = async (id, checked) => {
    const current = { ...(row?.signoffs || {}) };
    if (checked) {
      const { data } = await supabase.auth.getUser();
      current[id] = { at: new Date().toISOString(), by: data?.user?.email || "" };
    } else {
      delete current[id];
    }
    setSigning(true);
    setError("");
    try {
      await saveSignoffs(companyId, current);
      setRow((prev) => ({ ...(prev || {}), signoffs: current }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!destination) {
    return (
      <div className="space-y-3 rounded-[14px] border border-border bg-card px-4 py-3">
        <p className="text-sm text-foreground">
          This stage reads the site&apos;s GitHub repo live, so it needs the company&apos;s Publish Destination.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={`/company/${companyId}/company-data`}>Set Publish Destination →</Link>
        </Button>
      </div>
    );
  }

  const groups = [];
  if (summary) {
    const sorted = [...summary.items].sort(
      (a, b) =>
        (a.level === "suggested") - (b.level === "suggested") ||
        STATE_ORDER[a.state] - STATE_ORDER[b.state]
    );
    for (const item of sorted) {
      const name = item.level === "suggested" ? "Suggested" : item.group;
      let group = groups.find((g) => g.name === name);
      if (!group) groups.push((group = { name, items: [] }));
      group.items.push({ ...item, signedBy: row?.signoffs?.[item.id]?.by || "" });
    }
    // Groups with open work first; Suggested last.
    groups.sort(
      (a, b) =>
        (a.name === "Suggested") - (b.name === "Suggested") ||
        Math.min(...a.items.map((i) => STATE_ORDER[i.state])) - Math.min(...b.items.map((i) => STATE_ORDER[i.state]))
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
        <div className="space-y-1">
          {summary ? (
            <p className="text-sm text-foreground">
              {summary.complete
                ? "Every required placeholder is replaced and signed off."
                : `${summary.requiredDone} of ${summary.requiredTotal} required items done${
                    summary.openSignoffs ? ` · ${summary.openSignoffs} need sign-off` : ""
                  }`}
            </p>
          ) : (
            <p className="text-sm text-foreground">{scanning ? "Scanning the site repo…" : "Not scanned yet."}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {destination.owner}/{destination.repo}
            {row?.branch ? `@${row.branch}` : ""}
            {row?.site_root ? ` · ${row.site_root}/` : ""}
            {row?.commit_sha ? ` · commit ${String(row.commit_sha).slice(0, 7)}` : ""}
            {row?.scanned_at ? ` · scanned ${timeAgo(row.scanned_at)}` : ""}
            {row?.manifest_source ? ` · checklist from ${row.manifest_source}` : ""}
          </p>
          {row?.tree_truncated && (
            <p className="text-[11px] text-orange-700">GitHub returned a partial file list; some items may show as can&apos;t check.</p>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => runScan(destination)} disabled={scanning}>
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-scan
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {groups.map((group) => (
        <div key={group.name} className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground">{group.name}</p>
          {group.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              expanded={expanded === item.id}
              onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
              onSignoff={onSignoff}
              signing={signing}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
