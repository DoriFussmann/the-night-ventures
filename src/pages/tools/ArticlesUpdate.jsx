import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ExternalLink, GitMerge, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  bucketNeedsUpdateCheck,
  CHECK_THRESHOLD_OPTIONS,
  DEFAULT_CHECK_THRESHOLD,
  daysSinceUpdateBadgeClass,
  formatDaysSinceUpdateLabel,
  formatLastCheckedLabel,
  lastCheckedIsRecent,
  STALENESS_BUCKETS,
} from "./articleGeneration/daysSinceUpdate";

function checkThresholdStorageKey(companyId) {
  return `articles-update-check-threshold:${companyId}`;
}

function readStoredCheckThreshold(companyId) {
  if (!companyId || typeof localStorage === "undefined") {
    return DEFAULT_CHECK_THRESHOLD;
  }
  try {
    const n = Number(localStorage.getItem(checkThresholdStorageKey(companyId)));
    if (CHECK_THRESHOLD_OPTIONS.includes(n)) return n;
  } catch {
    // ignore
  }
  return DEFAULT_CHECK_THRESHOLD;
}

function writeStoredCheckThreshold(companyId, days) {
  if (!companyId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(checkThresholdStorageKey(companyId), String(days));
  } catch {
    // ignore
  }
}

function parseStoredAuditSnapshot(snapshot, fallbackCheckedAt) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const hasArticles = Array.isArray(snapshot.articles);
  const hasBuckets =
    snapshot.buckets &&
    typeof snapshot.buckets === "object" &&
    !Array.isArray(snapshot.buckets);
  if (!hasArticles && !hasBuckets) return null;
  return {
    articles: hasArticles ? snapshot.articles : [],
    buckets: hasBuckets ? snapshot.buckets : {},
    corpusCount: snapshot.corpusCount,
    publishedCount: snapshot.publishedCount,
    lastCheckedAt: snapshot.lastCheckedAt || fallbackCheckedAt || null,
  };
}

async function loadCompanyArticlesUpdateMeta(companyId) {
  const full = await supabase
    .from("companies")
    .select("name, articles_update_checked_at, articles_update_snapshot")
    .eq("id", companyId)
    .maybeSingle();

  if (!full.error) return { data: full.data, error: null };

  if (
    /articles_update_snapshot/i.test(full.error.message || "") ||
    full.error.code === "PGRST204"
  ) {
    const mid = await supabase
      .from("companies")
      .select("name, articles_update_checked_at")
      .eq("id", companyId)
      .maybeSingle();
    if (!mid.error) return { data: mid.data, error: null };
    if (
      /articles_update_checked_at/i.test(mid.error.message || "") ||
      mid.error.code === "PGRST204"
    ) {
      const nameOnly = await supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      return { data: nameOnly.data, error: nameOnly.error };
    }
    return { data: null, error: mid.error };
  }

  return { data: null, error: full.error };
}
import {
  isPublishDestinationMapped,
  loadCompanyPublishDestination,
  DEFAULT_PUBLISH_BRANCH,
} from "./articleGeneration/publishToSite";
import {
  auditLiveArticleUpdates,
  commitArticleUpdates,
} from "./articles/articleUpdatesApi";

function sortArticlesByStaleness(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const da = a.daysSince == null ? -1 : a.daysSince;
    const db = b.daysSince == null ? -1 : b.daysSince;
    return db - da;
  });
}

function DaysBadge({ days, dateValue }) {
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
      publishedUrl: article.publishedUrl,
      targetKeyword: article.targetKeyword,
      pillarKeyword: article.pillarKeyword,
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

  const [companyName, setCompanyName] = useState("");
  const [destination, setDestination] = useState(null);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState("");

  const [articles, setArticles] = useState([]);
  const [buckets, setBuckets] = useState(null);
  const [corpusCount, setCorpusCount] = useState(0);
  const [publishedCount, setPublishedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [hasAudited, setHasAudited] = useState(false);

  const [checkResults, setCheckResults] = useState(() => ({}));
  const [expandedSlug, setExpandedSlug] = useState(null);

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStep, setBatchStep] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchTitle, setBatchTitle] = useState("");

  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null);
  const [checkThreshold, setCheckThreshold] = useState(DEFAULT_CHECK_THRESHOLD);

  const mapped = isPublishDestinationMapped(destination);
  const dest = {
    companyId,
    owner: destination?.owner,
    repo: destination?.repo,
    tokenKey: destination?.tokenKey,
    branch: DEFAULT_PUBLISH_BRANCH,
  };

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      if (!companyId) {
        setCompanyName("");
        setDestination(null);
        setLastCheckedAt(null);
        setArticles([]);
        setBuckets(null);
        setHasAudited(false);
        setLoadingMeta(false);
        return;
      }

      setLoadingMeta(true);
      setError("");
      setArticles([]);
      setBuckets(null);
      setHasAudited(false);
      setCheckResults({});
      setCommitResult(null);
      setExpandedSlug(null);
      setCheckThreshold(readStoredCheckThreshold(companyId));

      const [companyRes, destRes] = await Promise.all([
        loadCompanyArticlesUpdateMeta(companyId),
        loadCompanyPublishDestination(companyId).catch((err) => {
          console.error(err);
          return { owner: "", repo: "", tokenKey: "" };
        }),
      ]);

      if (cancelled) return;

      if (companyRes.error) {
        console.error(companyRes.error);
        setError(companyRes.error.message || "Failed to load company");
        setCompanyName("");
        setLastCheckedAt(null);
      } else {
        setCompanyName(companyRes.data?.name || "");
        const checkedAt = companyRes.data?.articles_update_checked_at || null;
        const stored = parseStoredAuditSnapshot(
          companyRes.data?.articles_update_snapshot,
          checkedAt
        );
        if (stored) {
          const rows = sortArticlesByStaleness(stored.articles);
          setArticles(rows);
          setBuckets(stored.buckets);
          setCorpusCount(Number(stored.corpusCount) || 0);
          setPublishedCount(
            Number(stored.publishedCount) || rows.length
          );
          setLastCheckedAt(stored.lastCheckedAt || checkedAt);
          setHasAudited(true);
        } else {
          setLastCheckedAt(checkedAt);
        }
      }

      setDestination(destRes);
      setLoadingMeta(false);
    }

    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const includedEntries = useMemo(() => {
    const entries = [];
    for (const article of articles) {
      const entry = checkResults[article.slug];
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
          currentParagraph: entry.result.currentParagraph,
        });
      }
    }
    return entries;
  }, [articles, checkResults]);

  const progressPct =
    batchTotal > 0 ? Math.round((batchStep / batchTotal) * 100) : 0;

  const recentCheck = lastCheckedIsRecent(lastCheckedAt);
  const lastCheckedLabel = formatLastCheckedLabel(lastCheckedAt);

  const patchResult = (slug, patch) => {
    setCheckResults((prev) => ({
      ...prev,
      [slug]: { ...(prev[slug] || {}), ...patch },
    }));
  };

  const applyAudit = (data) => {
    const rows = sortArticlesByStaleness(data?.articles || []);
    setArticles(rows);
    setBuckets(data?.buckets || null);
    setCorpusCount(Number(data?.corpusCount) || 0);
    setPublishedCount(Number(data?.publishedCount) || rows.length);
    if (data?.lastCheckedAt) setLastCheckedAt(data.lastCheckedAt);
    setHasAudited(true);
  };

  const refresh = async () => {
    if (!mapped || refreshing || batchRunning || committing) return;
    setRefreshing(true);
    setError("");
    setCommitResult(null);
    try {
      const data = await auditLiveArticleUpdates(dest);
      applyAudit(data);
      setCheckResults({});
      setExpandedSlug(null);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to read live destination articles");
    } finally {
      setRefreshing(false);
    }
  };

  const runChecks = async (targets) => {
    if (!targets.length || batchRunning || committing || refreshing) return;

    setBatchRunning(true);
    setBatchTotal(targets.length);
    setBatchStep(0);
    setBatchTitle("");
    setError("");
    setCommitResult(null);

    setCheckResults((prev) => {
      const next = { ...prev };
      for (const article of targets) {
        next[article.slug] = {
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
      patchResult(article.slug, {
        status: "running",
        result: null,
        error: "",
        included: false,
      });

      try {
        const data = await requestArticleUpdateCheck(article);
        patchResult(article.slug, {
          status: "done",
          result: data,
          error: "",
          included: Boolean(data?.updateWarranted && data?.proposedParagraph),
        });
      } catch (err) {
        console.error(err);
        patchResult(article.slug, {
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

  const checkOne = (article) => {
    if (!article?.slug || batchRunning) return;
    runChecks([article]);
  };

  const checkBucket = (bucketId) => {
    const targets = articles.filter(
      (article) =>
        article.bucket === bucketId &&
        bucketNeedsUpdateCheck(article.bucket, checkThreshold) &&
        article.canCheck
    );
    runChecks(targets);
  };

  const onCheckThresholdChange = (value) => {
    const n = Number(value);
    const next = CHECK_THRESHOLD_OPTIONS.includes(n)
      ? n
      : DEFAULT_CHECK_THRESHOLD;
    setCheckThreshold(next);
    writeStoredCheckThreshold(companyId, next);
  };

  const setIncluded = (slug, included) => {
    patchResult(slug, { included: Boolean(included) });
  };

  const confirmCommit = async () => {
    if (includedEntries.length === 0 || committing || batchRunning) return;
    setCommitting(true);
    setError("");
    try {
      const data = await commitArticleUpdates(
        dest,
        includedEntries.map((entry) => ({
          slug: entry.slug,
          newParagraph: entry.newParagraph,
        }))
      );
      setCommitResult(data);
      if (data?.ok) {
        setCheckResults({});
        setExpandedSlug(null);
        try {
          const audit = await auditLiveArticleUpdates(dest);
          applyAudit(audit);
        } catch (err) {
          console.error(err);
        }
      }
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to commit Where Things Stand updates");
      if (err?.result) setCommitResult(err.result);
    } finally {
      setCommitting(false);
    }
  };

  const busy = refreshing || batchRunning || committing || loadingMeta;

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xs text-foreground mb-1">Articles Update</h1>
        <p className="text-sm text-muted-foreground">
          Refresh reads live articles from the destination repo, groups them by
          days since update, and checks stale pieces for substantive &quot;Where
          Things Stand&quot; changes. Approved replacements commit on one branch
          and merge to main — only the marked WTS section is rewritten.
          {companyName ? ` · ${companyName}` : ""}
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!mapped || busy}
          onClick={refresh}
        >
          {refreshing ? (
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
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span>Check from</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            value={checkThreshold}
            disabled={busy}
            onChange={(e) => onCheckThresholdChange(e.target.value)}
            aria-label="Check for Updates threshold in days"
          >
            {CHECK_THRESHOLD_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-muted-foreground">
          <span>{lastCheckedLabel}</span>
          {recentCheck && (
            <span className="ml-2 text-emerald-700">
              Checked less than 7 days ago — you can skip Refresh
            </span>
          )}
        </div>
        {!mapped && !loadingMeta && (
          <p className="text-sm text-muted-foreground">
            No destination repo set. Add GitHub owner/repo/token key in{" "}
            <Link
              to={`/company/${companyId}/company-data`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Company Data
            </Link>
            .
          </p>
        )}
      </div>

      {hasAudited && buckets && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Live corpus: {publishedCount} published
            {corpusCount ? ` / ${corpusCount} files` : ""}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {STALENESS_BUCKETS.map((id) => {
              const count = Number(buckets[id] || 0);
              const stale = bucketNeedsUpdateCheck(id, checkThreshold);
              const checkable = articles.filter(
                (article) =>
                  article.bucket === id && stale && article.canCheck
              ).length;
              return (
                <div
                  key={id}
                  className="rounded-md border border-border px-3 py-2 space-y-2"
                >
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {id} days
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {count}
                  </p>
                  {stale && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={busy || checkable === 0}
                      onClick={() => checkBucket(id)}
                    >
                      Check for Updates
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          {Number(buckets.unknown || 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {buckets.unknown} article{buckets.unknown === 1 ? "" : "s"}{" "}
              missing a date (not in a staleness bucket).
            </p>
          )}
        </div>
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
            batch can finish. &quot;No update warranted&quot; is a normal
            outcome.
          </p>
        </div>
      )}

      {committing && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Committing Where Things Stand updates on one branch…
        </p>
      )}

      {commitResult && (
        <div
          className={`text-sm rounded-md px-3 py-2 space-y-1.5 ${
            commitResult.ok
              ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
              : "text-amber-800 bg-amber-50 border border-amber-200"
          }`}
        >
          <p className="font-medium">
            {commitResult.ok
              ? "Where Things Stand updates committed"
              : "Commit did not complete"}
          </p>
          {commitResult.branch && (
            <p>
              Branch:{" "}
              <span className="font-mono">{commitResult.branch}</span>
            </p>
          )}
          {commitResult.mergeCommitSha && (
            <p>
              Merge SHA:{" "}
              <span className="font-mono break-all">
                {commitResult.mergeCommitSha}
              </span>
            </p>
          )}
          {commitResult.pullRequestUrl && (
            <p>
              Pull request:{" "}
              <a
                href={commitResult.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {commitResult.pullRequestUrl}
              </a>
            </p>
          )}
          {Array.isArray(commitResult.committed) &&
            commitResult.committed.length > 0 && (
              <div>
                <p className="font-medium">Committed</p>
                <ul className="list-disc pl-5 font-mono text-xs">
                  {commitResult.committed.map((file) => (
                    <li key={file.path || file.slug}>
                      {file.path || file.slug}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          {Array.isArray(commitResult.skipped) &&
            commitResult.skipped.length > 0 && (
              <div>
                <p className="font-medium">Skipped</p>
                <ul className="list-disc pl-5 text-xs">
                  {commitResult.skipped.map((item, i) => (
                    <li key={`${item.slug || "skipped"}-${i}`}>
                      {item.slug ? `${item.slug}: ` : ""}
                      {item.reason || item.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          {Array.isArray(commitResult.errors) &&
            commitResult.errors.length > 0 && (
              <div>
                <p className="font-medium">Errors</p>
                <ul className="list-disc pl-5 text-xs">
                  {commitResult.errors.map((item, i) => (
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

      {loadingMeta ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading company…
        </div>
      ) : !hasAudited ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-foreground font-medium">
            Refresh to read live destination articles
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Staleness is computed from each article&apos;s{" "}
            <span className="font-mono">updatedDate</span> /{" "}
            <span className="font-mono">date</span> in the repo.
          </p>
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-foreground font-medium">
            No published articles in the destination repo
          </p>
        </div>
      ) : (
        <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {articles.map((article) => {
            const entry = checkResults[article.slug];
            const isExpanded = expandedSlug === article.slug;
            const warranted =
              entry?.status === "done" && entry.result?.updateWarranted;
            const canInclude = warranted && entry.result?.proposedParagraph;
            const showCheck = bucketNeedsUpdateCheck(
              article.bucket,
              checkThreshold
            );

            return (
              <li key={article.slug} className="px-3 py-2.5 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {article.title || "(untitled)"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {article.targetKeyword || "—"}
                      {article.pillarKeyword
                        ? ` · ${article.pillarKeyword}`
                        : ""}
                      {article.bucket ? ` · ${article.bucket} days` : ""}
                    </p>
                    {entry?.status === "error" && entry.error && (
                      <p className="text-xs text-destructive">{entry.error}</p>
                    )}
                    {entry?.status === "done" && !warranted && (
                      <p className="text-xs text-muted-foreground">
                        {entry.result?.reasoning || "No update warranted"}
                      </p>
                    )}
                    {showCheck && !article.canCheck && (
                      <p className="text-xs text-muted-foreground">
                        Missing published URL or keywords — cannot run a live
                        page check.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">
                    <DaysBadge
                      days={article.daysSince}
                      dateValue={article.updatedDate || article.date}
                    />
                    <ResultBadge entry={entry} />

                    {canInclude && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                        <Checkbox
                          checked={Boolean(entry.included)}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            setIncluded(article.slug, checked === true)
                          }
                          aria-label={`Include ${article.title || "article"} in commit`}
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
                          setExpandedSlug(isExpanded ? null : article.slug)
                        }
                      >
                        {isExpanded ? "Hide" : "Details"}
                      </Button>
                    )}

                    {showCheck && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={busy || !article.canCheck}
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
                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                    {article.publishedUrl && (
                      <a
                        href={article.publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        {article.publishedUrl}
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
                            Source URL(s) found — shown for review, not written
                            as external links.
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

      {includedEntries.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Review before commit
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Confirm replaces only the Where Things Stand section on these
              live .md files, then merges one branch to main.
            </p>
          </div>
          <ul className="space-y-4">
            {includedEntries.map((entry) => (
              <li
                key={entry.slug}
                className="rounded-md border border-border bg-background/80 p-3 space-y-3"
              >
                <p className="text-xs font-mono font-medium text-foreground">
                  {entry.slug}
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Current
                    </p>
                    <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                      {entry.currentParagraph || "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Proposed
                    </p>
                    <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                      {entry.newParagraph}
                    </p>
                  </div>
                </div>
                {Array.isArray(entry.newSources) &&
                  entry.newSources.length > 0 && (
                    <ul className="space-y-1">
                      {entry.newSources.map((source, index) => (
                        <li
                          key={`${entry.slug}-${source.url || source.title}-${index}`}
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
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loadingMeta && hasAudited && articles.length > 0 && (
        <div className="fixed bottom-0 left-52 right-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-4xl px-8 py-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">
              <span className="font-medium">{includedEntries.length}</span>
              <span className="text-muted-foreground">
                {" "}
                approved update
                {includedEntries.length === 1 ? "" : "s"} ready to commit
              </span>
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={includedEntries.length === 0 || busy}
                onClick={confirmCommit}
              >
                {committing ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                )}
                Confirm & Commit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
