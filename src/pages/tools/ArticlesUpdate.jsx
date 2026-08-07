import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  daysSinceUpdate,
  daysSinceUpdateBadgeClass,
  formatDaysSinceUpdateLabel,
} from "./articleGeneration/daysSinceUpdate";
import {
  articleUpdatesFilename,
  buildApprovedUpdatesPayload,
  downloadJsonFile,
} from "./articleGeneration/buildArticleUpdatesDownload";
import {
  applyConfirmationReceipt,
  parseConfirmationReceipt,
} from "./articleGeneration/importConfirmationReceipt";

function sortArticlesByStaleness(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const da = daysSinceUpdate(a.updated_date || a.date);
    const db = daysSinceUpdate(b.updated_date || b.date);
    const na = da == null ? -1 : da;
    const nb = db == null ? -1 : db;
    return nb - na;
  });
}

function DaysBadge({ dateValue }) {
  const days = daysSinceUpdate(dateValue);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${daysSinceUpdateBadgeClass(days)}`}
      title={dateValue ? `updatedDate: ${dateValue}` : "No updatedDate"}
    >
      {formatDaysSinceUpdateLabel(days)}
    </span>
  );
}

function ResultBadge({ entry }) {
  if (!entry) return null;
  if (entry.status === "running") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking…
      </span>
    );
  }
  if (entry.status === "error") {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive max-w-[14rem] truncate"
        title={entry.error || "Check failed"}
      >
        Error
      </span>
    );
  }
  if (entry.status === "done") {
    if (entry.result?.updateWarranted) {
      return (
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
          Update warranted
        </span>
      );
    }
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        No update needed
      </span>
    );
  }
  return null;
}

async function requestArticleUpdateCheck(article) {
  const res = await fetch("/api/check-article-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publishedUrl: article.published_url,
      targetKeyword: article.target_keyword,
      pillarKeyword: article.pillar_keyword,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Check failed (${res.status})`);
  }
  return data;
}

export default function ArticlesUpdate() {
  const { companyId } = useParams();
  const receiptInputRef = useRef(null);

  const [articles, setArticles] = useState([]);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(() => new Set());
  const [checkResults, setCheckResults] = useState(() => ({}));
  const [expandedId, setExpandedId] = useState(null);

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStep, setBatchStep] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchTitle, setBatchTitle] = useState("");

  const [receiptDragOver, setReceiptDragOver] = useState(false);
  const [receiptImporting, setReceiptImporting] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [receiptError, setReceiptError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!companyId) {
        setArticles([]);
        setCompanyName("");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      const [articlesRes, companyRes] = await Promise.all([
        supabase
          .from("generated_articles")
          .select(
            "id, title, slug, updated_date, date, published_url, target_keyword, pillar_keyword, status, last_synced_at"
          )
          .eq("company_id", companyId)
          .not("published_url", "is", null)
          .order("updated_at", { ascending: false }),
        supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      ]);

      if (cancelled) return;

      if (articlesRes.error) {
        // Tolerate missing last_synced_at until migration is applied.
        if (
          /last_synced_at/i.test(articlesRes.error.message || "") ||
          articlesRes.error.code === "PGRST204"
        ) {
          const fallback = await supabase
            .from("generated_articles")
            .select(
              "id, title, slug, updated_date, date, published_url, target_keyword, pillar_keyword, status"
            )
            .eq("company_id", companyId)
            .not("published_url", "is", null)
            .order("updated_at", { ascending: false });

          if (cancelled) return;

          if (fallback.error) {
            console.error(fallback.error);
            setError(fallback.error.message || "Failed to load published articles");
            setArticles([]);
            setLoading(false);
            return;
          }

          const rows = sortArticlesByStaleness(
            (fallback.data || []).filter((row) =>
              String(row.published_url || "").trim()
            )
          );
          setCompanyName(companyRes.data?.name || "");
          setArticles(rows);
          setSelected(new Set());
          setCheckResults({});
          setExpandedId(null);
          setLoading(false);
          return;
        }

        console.error(articlesRes.error);
        setError(articlesRes.error.message || "Failed to load published articles");
        setArticles([]);
        setLoading(false);
        return;
      }

      if (companyRes.error) {
        console.error(companyRes.error);
      }
      setCompanyName(companyRes.data?.name || "");

      const rows = sortArticlesByStaleness(
        (articlesRes.data || []).filter((row) =>
          String(row.published_url || "").trim()
        )
      );

      setArticles(rows);
      setSelected(new Set());
      setCheckResults({});
      setExpandedId(null);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const selectedArticles = useMemo(() => {
    return articles.filter((article) => selected.has(article.id));
  }, [articles, selected]);

  const includedEntries = useMemo(() => {
    const entries = [];
    for (const article of articles) {
      const entry = checkResults[article.id];
      if (
        entry?.status === "done" &&
        entry.included &&
        entry.result?.updateWarranted &&
        entry.result?.proposedParagraph
      ) {
        entries.push({
          slug: article.slug,
          newParagraph: entry.result.proposedParagraph,
          newSources: entry.result.newSources,
        });
      }
    }
    return entries;
  }, [articles, checkResults]);

  const progressPct =
    batchTotal > 0 ? Math.round((batchStep / batchTotal) * 100) : 0;

  const multiSelected = selected.size > 1;
  const showPerRowCheck = !multiSelected;

  const toggleSelected = (id, checked) => {
    if (batchRunning) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAll = () => {
    if (batchRunning) return;
    setSelected(new Set(articles.map((article) => article.id)));
  };

  const selectNone = () => {
    if (batchRunning) return;
    setSelected(new Set());
  };

  const patchResult = (id, patch) => {
    setCheckResults((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch },
    }));
  };

  const runChecks = async (targets) => {
    if (!targets.length || batchRunning) return;

    setBatchRunning(true);
    setBatchTotal(targets.length);
    setBatchStep(0);
    setBatchTitle("");
    setError("");

    setCheckResults((prev) => {
      const next = { ...prev };
      for (const article of targets) {
        next[article.id] = {
          status: "pending",
          result: null,
          error: "",
          included: false,
        };
      }
      return next;
    });

    for (let step = 0; step < targets.length; step++) {
      const article = targets[step];
      setBatchStep(step + 1);
      setBatchTitle(article.title || article.slug || "(untitled)");
      patchResult(article.id, {
        status: "running",
        result: null,
        error: "",
        included: false,
      });

      try {
        const data = await requestArticleUpdateCheck(article);
        patchResult(article.id, {
          status: "done",
          result: data,
          error: "",
          included: Boolean(data?.updateWarranted && data?.proposedParagraph),
        });
      } catch (err) {
        console.error(err);
        patchResult(article.id, {
          status: "error",
          result: null,
          error: err?.message || "Failed to check for updates",
          included: false,
        });
      }
    }

    setBatchRunning(false);
    setBatchTitle("");
  };

  const checkSelected = () => {
    if (selectedArticles.length === 0) return;
    runChecks(selectedArticles);
  };

  const checkOne = (article) => {
    if (!article?.id || batchRunning) return;
    setSelected(new Set([article.id]));
    runChecks([article]);
  };

  const setIncluded = (id, included) => {
    patchResult(id, { included: Boolean(included) });
  };

  const downloadIncluded = () => {
    if (includedEntries.length === 0) return;
    const payload = buildApprovedUpdatesPayload(includedEntries);
    downloadJsonFile(articleUpdatesFilename(companyName), payload);
  };

  const importReceiptFile = async (file) => {
    if (!file || !companyId || receiptImporting) return;

    const name = String(file.name || "").toLowerCase();
    if (!name.endsWith(".json") && file.type !== "application/json") {
      setReceiptError("Please drop a confirmation receipt .json file");
      setReceiptMessage("");
      return;
    }

    setReceiptImporting(true);
    setReceiptError("");
    setReceiptMessage("");

    try {
      const text = await file.text();
      const entries = parseConfirmationReceipt(text);
      const { updated, unmatched } = await applyConfirmationReceipt({
        companyId,
        entries,
      });

      if (updated.length > 0) {
        const byId = new Map(updated.map((row) => [row.id, row]));
        const bySlug = new Map(updated.map((row) => [row.slug, row]));
        setArticles((prev) =>
          sortArticlesByStaleness(
            prev.map((article) => {
              const sync = byId.get(article.id) || bySlug.get(article.slug);
              if (!sync) return article;
              return {
                ...article,
                updated_date: sync.updated_date,
                last_synced_at: sync.last_synced_at,
              };
            })
          )
        );

        // Clear stale check results for synced articles so badges reflect reality.
        setCheckResults((prev) => {
          const next = { ...prev };
          for (const row of updated) {
            if (next[row.id]) delete next[row.id];
          }
          return next;
        });
      }

      const parts = [`Synced ${updated.length} article${updated.length === 1 ? "" : "s"}`];
      if (unmatched.length) {
        parts.push(
          `${unmatched.length} unmatched slug${unmatched.length === 1 ? "" : "s"}: ${unmatched.join(", ")}`
        );
      }
      setReceiptMessage(parts.join(" · "));
    } catch (err) {
      console.error(err);
      setReceiptError(err?.message || "Failed to import confirmation receipt");
    } finally {
      setReceiptImporting(false);
    }
  };

  const processReceiptFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    void importReceiptFile(files[0]);
  };

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xs text-foreground mb-1">Articles Update</h1>
        <p className="text-sm text-muted-foreground">
          Check published articles for substantive &quot;Where Things Stand&quot;
          updates, download a batch for the destination CMS, then import the CMS
          confirmation receipt to refresh Days Since Update here.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div
        role="button"
        tabIndex={0}
        className={`rounded-lg border border-dashed p-6 text-center transition-colors cursor-pointer ${
          receiptDragOver ? "border-foreground bg-muted/40" : "border-border"
        } ${receiptImporting ? "opacity-60 pointer-events-none" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setReceiptDragOver(true);
        }}
        onDragLeave={() => setReceiptDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setReceiptDragOver(false);
          processReceiptFiles(e.dataTransfer.files);
        }}
        onClick={() => receiptInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            receiptInputRef.current?.click();
          }
        }}
      >
        {receiptImporting ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Importing confirmation receipt…
          </div>
        ) : (
          <>
            <Upload className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-foreground mb-1">
              Import Confirmation Receipt
            </p>
            <p className="text-xs text-muted-foreground">
              Drop the JSON receipt from the destination CMS after Confirm Update
              — syncs <span className="font-mono">updatedDate</span> and refreshes
              Days Since Update
            </p>
          </>
        )}
        <input
          ref={receiptInputRef}
          type="file"
          className="sr-only"
          accept=".json,application/json"
          onChange={(e) => {
            processReceiptFiles(e.target.files);
            e.target.value = "";
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {receiptMessage && (
        <p className="text-sm text-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
          {receiptMessage}
        </p>
      )}
      {receiptError && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {receiptError}
        </p>
      )}

      {batchRunning && (
        <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              Checking {batchStep} of {batchTotal}
              {batchTitle ? `: ${batchTitle}` : ""}
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
          <p className="text-xs text-muted-foreground">
            Articles run one at a time. Failures are skipped so the rest of the
            batch can finish.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading published articles…
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-foreground font-medium">
            No published articles with a URL
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Mark articles published (with a live URL) in{" "}
            <Link
              to={`/company/${companyId}/article-topic-suggestion`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Topic Generator
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {articles.map((article) => {
            const entry = checkResults[article.id];
            const isChecked = selected.has(article.id);
            const isExpanded = expandedId === article.id;
            const warranted =
              entry?.status === "done" && entry.result?.updateWarranted;
            const canInclude = warranted && entry.result?.proposedParagraph;

            return (
              <li key={article.id} className="px-3 py-2.5 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <Checkbox
                      checked={isChecked}
                      disabled={batchRunning}
                      onCheckedChange={(checked) =>
                        toggleSelected(article.id, checked === true)
                      }
                      aria-label={`Select ${article.title || "article"}`}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {article.title || "(untitled)"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {article.target_keyword || "—"}
                        {article.pillar_keyword
                          ? ` · ${article.pillar_keyword}`
                          : ""}
                      </p>
                      {entry?.status === "error" && entry.error && (
                        <p className="text-xs text-destructive">{entry.error}</p>
                      )}
                      {entry?.status === "done" && !warranted && (
                        <p className="text-xs text-muted-foreground">
                          {entry.result?.reasoning || "No update warranted"}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0 pl-7 sm:pl-0">
                    <DaysBadge dateValue={article.updated_date || article.date} />
                    <ResultBadge entry={entry} />

                    {canInclude && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                        <Checkbox
                          checked={Boolean(entry.included)}
                          disabled={batchRunning}
                          onCheckedChange={(checked) =>
                            setIncluded(article.id, checked === true)
                          }
                          aria-label={`Include ${article.title || "article"} in download`}
                        />
                        Include
                      </label>
                    )}

                    {entry?.status === "done" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : article.id)
                        }
                      >
                        {isExpanded ? "Hide" : "Details"}
                      </Button>
                    )}

                    {showPerRowCheck && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={batchRunning}
                        onClick={() => checkOne(article)}
                      >
                        {entry?.status === "running" ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Check for Updates
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && entry?.status === "done" && entry.result && (
                  <div className="ml-7 space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    {article.published_url && (
                      <a
                        href={article.published_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        {article.published_url}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}

                    {entry.result.reasoning && (
                      <p className="text-sm text-muted-foreground">
                        {entry.result.reasoning}
                      </p>
                    )}

                    {!entry.result.updateWarranted ? (
                      <p className="text-sm text-foreground">
                        No update warranted
                      </p>
                    ) : (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Current
                          </p>
                          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                            {entry.result.currentParagraph}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Proposed
                          </p>
                          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                            {entry.result.proposedParagraph}
                          </p>
                        </div>
                      </div>
                    )}

                    {Array.isArray(entry.result.newSources) &&
                      entry.result.newSources.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 space-y-1.5">
                          <p className="text-xs font-medium text-foreground">
                            New source(s) — included in the download for the
                            destination CMS; not written from TNV.
                          </p>
                          <ul className="space-y-1">
                            {entry.result.newSources.map((source, index) => (
                              <li
                                key={`${source.url || source.title}-${index}`}
                                className="text-xs text-foreground/90"
                              >
                                {source.url ? (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 hover:text-foreground"
                                  >
                                    {source.title || source.url}
                                  </a>
                                ) : (
                                  <span>{source.title}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && articles.length > 0 && (
        <div className="fixed bottom-0 left-52 right-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-4xl px-8 py-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">
              <span className="font-medium">{selected.size}</span>
              <span className="text-muted-foreground"> of </span>
              <span className="font-medium">{articles.length}</span>
              <span className="text-muted-foreground"> selected</span>
              {includedEntries.length > 0 && (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <span className="font-medium">{includedEntries.length}</span>
                  <span className="text-muted-foreground"> included</span>
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={batchRunning}
                onClick={selectAll}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={batchRunning}
                onClick={selectNone}
              >
                Select none
              </Button>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={includedEntries.length === 0 || batchRunning}
                onClick={downloadIncluded}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download Included Updates
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={selected.size === 0 || batchRunning}
                onClick={checkSelected}
              >
                {batchRunning ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Check Selected
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
