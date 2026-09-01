import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Loader2,
  Moon,
  Pause,
  Play,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_PUBLISH_BRANCH,
  isPublishDestinationMapped,
  loadCompanyPublishDestination,
} from "./articleGeneration/publishToSite";
import { scanLiveArticles } from "./articles/scanLiveApi";
import {
  auditLiveLinks,
  commitLinkFixes,
  proposeExternalFixes,
} from "./articles/checkLinksApi";
import {
  auditLiveArticleUpdates,
  cleanupAudit,
  cleanupCommit,
  commitArticleUpdates,
  rewriteAudit,
  rewriteCommit,
  rewritePropose,
} from "./articles/articleUpdatesApi";
import {
  AUTO_ADVANCE_SECONDS,
  STEPS,
  SUMMARY_INDEX,
  REVIEW_NOTE,
  emptyStepMaps,
  issueKey,
  nextDueDate,
  formatDueDate,
  formatLastRun,
  formatElapsed,
  formatUsd,
  refreshArticles,
  refreshWarranted,
  refreshParagraph,
  defaultRefreshSelected,
  buildLinkReviewRows,
  defaultLinksSelected,
  cleanupPreviews,
  defaultCleanupSelected,
  rewriteProposeItems,
  rewriteProposals,
  defaultPolishSelected,
  stepSummary,
  estimateCost,
  commitCount,
} from "./nightwatch/steps";

function destFrom(destination, companyId) {
  return {
    ...destination,
    companyId,
    branch: destination?.branch || DEFAULT_PUBLISH_BRANCH,
  };
}

function toggleSet(prev, key, checked) {
  const next = new Set(prev);
  if (checked) next.add(key);
  else next.delete(key);
  return next;
}

function Stepper({ steps, viewIndex, statusById, frontierIndex, onSelect }) {
  return (
    <ol className="flex flex-wrap items-center gap-1">
      {steps.map((step, index) => {
        const status = statusById[step.id] || "idle";
        const active = index === viewIndex;
        const reachable =
          index <= frontierIndex ||
          status === "done" ||
          status === "failed" ||
          status === "running";
        return (
          <li key={step.id} className="flex items-center gap-1">
            {index > 0 && (
              <span className="hidden sm:block h-px w-5 bg-border" aria-hidden />
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onSelect(index)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                active
                  ? "border-border bg-accent text-foreground"
                  : reachable
                    ? "border-border text-foreground/80 hover:bg-accent hover:text-foreground"
                    : "border-transparent text-muted-foreground"
              }`}
            >
              {status === "running" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {status === "done" && <Check className="h-3.5 w-3.5" />}
              {status === "failed" && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              )}
              {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function Nightwatch() {
  const { companyId } = useParams();

  const [destination, setDestination] = useState(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState("");
  const [lastRunAt, setLastRunAt] = useState(null);

  const [viewIndex, setViewIndex] = useState(0);
  const [frontierIndex, setFrontierIndex] = useState(-1);
  const [executing, setExecuting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(AUTO_ADVANCE_SECONDS);
  const [startedAt, setStartedAt] = useState(null);
  const [endedAt, setEndedAt] = useState(null);

  const [{ status: stepStatus, data: stepData, error: stepError }, setStepMaps] =
    useState(emptyStepMaps);

  const [selectedRefresh, setSelectedRefresh] = useState(() => new Set());
  const [selectedLinks, setSelectedLinks] = useState(() => new Set());
  const [selectedCleanup, setSelectedCleanup] = useState(() => new Set());
  const [selectedPolish, setSelectedPolish] = useState(() => new Set());

  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(null);
  const [commitResults, setCommitResults] = useState({});
  const [commitErrors, setCommitErrors] = useState({});

  const runTokenRef = useRef(0);
  const advanceRef = useRef(null);

  const mapped = isPublishDestinationMapped(destination);
  const dest = useMemo(
    () => destFrom(destination, companyId),
    [destination, companyId]
  );
  const runComplete = frontierIndex >= SUMMARY_INDEX;
  const currentStep = STEPS[viewIndex] || STEPS[0];
  const due = useMemo(
    () => nextDueDate(new Date(), lastRunAt),
    [lastRunAt]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadMeta() {
      if (!companyId) {
        setDestination(null);
        setLastRunAt(null);
        setLoadingMeta(false);
        return;
      }
      setLoadingMeta(true);
      setMetaError("");
      const [destRes, companyRes] = await Promise.all([
        loadCompanyPublishDestination(companyId).catch((err) => {
          console.error(err);
          return { owner: "", repo: "", tokenKey: "" };
        }),
        supabase
          .from("companies")
          .select("articles_update_checked_at")
          .eq("id", companyId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setDestination(destRes);
      if (companyRes.error) {
        console.error(companyRes.error);
        // TODO: persist last Nightwatch run
      } else {
        setLastRunAt(companyRes.data?.articles_update_checked_at || null);
      }
      setLoadingMeta(false);
    }

    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const patchStep = useCallback((id, patch) => {
    setStepMaps((prev) => ({
      status: { ...prev.status, ...(patch.status ? { [id]: patch.status } : {}) },
      data: { ...prev.data, ...(patch.data !== undefined ? { [id]: patch.data } : {}) },
      error: { ...prev.error, ...(patch.error !== undefined ? { [id]: patch.error } : {}) },
    }));
  }, []);

  const waitForAdvance = useCallback(() => {
    return new Promise((resolve) => {
      advanceRef.current = resolve;
    });
  }, []);

  const signalAdvance = useCallback(() => {
    const resolve = advanceRef.current;
    if (!resolve) return;
    advanceRef.current = null;
    resolve("next");
  }, []);

  const abortWait = useCallback(() => {
    const resolve = advanceRef.current;
    if (!resolve) return;
    advanceRef.current = null;
    resolve("abort");
  }, []);

  const executeStep = useCallback(
    async (stepId) => {
      if (stepId === "scan") {
        return scanLiveArticles(companyId);
      }
      if (stepId === "refresh") {
        return auditLiveArticleUpdates(dest);
      }
      if (stepId === "links") {
        const audit = await auditLiveLinks(dest);
        const proposals = await proposeExternalFixes(dest);
        return { audit, proposals };
      }
      if (stepId === "cleanup") {
        return cleanupAudit(dest);
      }
      if (stepId === "polish") {
        const audit = await rewriteAudit(dest);
        const items = rewriteProposeItems(audit);
        const proposals =
          items.length > 0
            ? await rewritePropose(dest, items)
            : { proposals: [], dropped: [] };
        return { audit, proposals };
      }
      return null;
    },
    [companyId, dest]
  );

  const initSelections = useCallback((stepId, data) => {
    if (stepId === "refresh") setSelectedRefresh(defaultRefreshSelected(data));
    if (stepId === "links") {
      setSelectedLinks(defaultLinksSelected(data?.proposals));
    }
    if (stepId === "cleanup") setSelectedCleanup(defaultCleanupSelected(data));
    if (stepId === "polish") {
      setSelectedPolish(defaultPolishSelected(data?.proposals));
    }
  }, []);

  const startRun = async () => {
    if (!mapped || executing || applying) return;
    runTokenRef.current += 1;
    const token = runTokenRef.current;
    abortWait();

    setViewIndex(0);
    setFrontierIndex(-1);
    setExecuting(true);
    setPaused(false);
    setRemaining(AUTO_ADVANCE_SECONDS);
    setStartedAt(Date.now());
    setEndedAt(null);
    setStepMaps(emptyStepMaps());
    setSelectedRefresh(new Set());
    setSelectedLinks(new Set());
    setSelectedCleanup(new Set());
    setSelectedPolish(new Set());
    setApplyProgress(null);
    setCommitResults({});
    setCommitErrors({});

    for (let i = 0; i < SUMMARY_INDEX; i++) {
      if (runTokenRef.current !== token) return;
      const step = STEPS[i];
      setViewIndex(i);
      setFrontierIndex(i);
      setExecuting(true);
      patchStep(step.id, { status: "running", error: null });
      try {
        const data = await executeStep(step.id);
        if (runTokenRef.current !== token) return;
        patchStep(step.id, { status: "done", data, error: null });
        initSelections(step.id, data);
      } catch (err) {
        if (runTokenRef.current !== token) return;
        patchStep(step.id, {
          status: "failed",
          error: err?.message || `${step.label} failed`,
        });
      }
      setExecuting(false);
      setRemaining(AUTO_ADVANCE_SECONDS);
      setPaused(false);

      const action = await waitForAdvance();
      if (runTokenRef.current !== token || action === "abort") return;
    }

    if (runTokenRef.current !== token) return;
    setViewIndex(SUMMARY_INDEX);
    setFrontierIndex(SUMMARY_INDEX);
    setEndedAt(Date.now());
    setRemaining(0);
    patchStep("summary", { status: "done" });
  };

  useEffect(() => {
    const onFrontier =
      !executing &&
      !paused &&
      viewIndex === frontierIndex &&
      frontierIndex >= 0 &&
      frontierIndex < SUMMARY_INDEX &&
      (stepStatus[STEPS[frontierIndex]?.id] === "done" ||
        stepStatus[STEPS[frontierIndex]?.id] === "failed");
    if (!onFrontier) return undefined;

    const id = window.setInterval(() => {
      setRemaining((n) => {
        if (n <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [executing, paused, viewIndex, frontierIndex, stepStatus]);

  useEffect(() => {
    const onFrontier =
      !executing &&
      !paused &&
      viewIndex === frontierIndex &&
      frontierIndex >= 0 &&
      frontierIndex < SUMMARY_INDEX &&
      remaining <= 0 &&
      (stepStatus[STEPS[frontierIndex]?.id] === "done" ||
        stepStatus[STEPS[frontierIndex]?.id] === "failed");
    if (onFrontier) signalAdvance();
  }, [
    remaining,
    executing,
    paused,
    viewIndex,
    frontierIndex,
    stepStatus,
    signalAdvance,
  ]);

  const handleNext = () => {
    if (viewIndex < frontierIndex) {
      setViewIndex((n) => Math.min(n + 1, SUMMARY_INDEX));
      return;
    }
    signalAdvance();
  };

  const handleBack = () => {
    if (viewIndex <= 0) return;
    setPaused(true);
    setViewIndex((n) => n - 1);
  };

  const handlePause = () => {
    setPaused((prev) => !prev);
  };

  const closeRun = () => {
    runTokenRef.current += 1;
    abortWait();
    setViewIndex(0);
    setFrontierIndex(-1);
    setExecuting(false);
    setPaused(false);
    setRemaining(AUTO_ADVANCE_SECONDS);
    setStartedAt(null);
    setEndedAt(null);
    setStepMaps(emptyStepMaps());
    setSelectedRefresh(new Set());
    setSelectedLinks(new Set());
    setSelectedCleanup(new Set());
    setSelectedPolish(new Set());
    setApplyProgress(null);
    setCommitResults({});
    setCommitErrors({});
  };

  const applyApproved = async () => {
    if (!runComplete || applying || executing) return;
    setApplying(true);
    setCommitResults({});
    setCommitErrors({});

    const nextResults = {};
    const nextErrors = {};

    const record = (key, result, error) => {
      if (result) nextResults[key] = result;
      if (error) nextErrors[key] = error;
      setCommitResults({ ...nextResults });
      setCommitErrors({ ...nextErrors });
    };

    const refreshRows = refreshArticles(stepData.refresh)
      .filter(
        (article) =>
          selectedRefresh.has(article.slug) && refreshParagraph(article)
      )
      .map((article) => ({
        slug: article.slug,
        newParagraph: refreshParagraph(article),
      }));
    if (refreshRows.length > 0) {
      setApplyProgress("Refresh: committing…");
      try {
        const data = await commitArticleUpdates(dest, refreshRows);
        record("refresh", data, null);
      } catch (err) {
        record("refresh", err?.result || null, err?.message || "Refresh commit failed");
      }
    }

    const reviewRows = buildLinkReviewRows(
      stepData.links?.audit,
      stepData.links?.proposals
    );
    const errorSlugs = reviewRows.filter((row) => row.error).map((row) => row.slug);
    const errorSlugSet = new Set(errorSlugs);
    const issues = Array.isArray(stepData.links?.audit?.issues)
      ? stepData.links.audit.issues
      : [];
    const internalIssues = issues.filter(
      (item) => (item.internal?.added || item.internal?.missing || []).length > 0
    );
    const canWireInternal = internalIssues.some(
      (item) => !errorSlugSet.has(item.slug)
    );
    const confirmedExternal = reviewRows
      .filter((row) => !row.error)
      .map((row) => ({
        slug: row.slug,
        links: (row.candidates || [])
          .filter((link) => selectedLinks.has(issueKey(row.slug, link.url)))
          .map((link) => ({
            label: link.label || link.title || link.url,
            url: link.url,
          })),
      }))
      .filter((item) => item.links.length);
    if (canWireInternal || confirmedExternal.length > 0) {
      setApplyProgress("Links: committing…");
      try {
        const data = await commitLinkFixes(dest, confirmedExternal, errorSlugs);
        record("links", data, null);
      } catch (err) {
        record("links", err?.result || null, err?.message || "Links commit failed");
      }
    }

    const cleanupSlugs = [...selectedCleanup];
    const previews = cleanupPreviews(stepData.cleanup);
    const forceSlugs = previews
      .filter((p) => p.rankSkip && selectedCleanup.has(p.slug))
      .map((p) => p.slug);
    if (cleanupSlugs.length > 0) {
      setApplyProgress("Cleanup: committing…");
      try {
        const data = await cleanupCommit(dest, cleanupSlugs, forceSlugs);
        record("cleanup", data, null);
      } catch (err) {
        record("cleanup", err?.result || null, err?.message || "Cleanup commit failed");
      }
    }

    const polishApproved = rewriteProposals(stepData.polish?.proposals)
      .filter((p) => selectedPolish.has(p.slug))
      .map((p) => ({
        slug: p.slug,
        heading: p.heading,
        option: p.option,
        proposedSectionText: p.proposedSectionText,
      }));
    if (polishApproved.length > 0) {
      setApplyProgress("Polish: committing…");
      try {
        const data = await rewriteCommit(dest, polishApproved);
        record("polish", data, null);
      } catch (err) {
        record("polish", err?.result || null, err?.message || "Polish commit failed");
      }
    }

    setApplyProgress(null);
    setApplying(false);
    // TODO: persist last Nightwatch run
    setLastRunAt(new Date().toISOString());
  };

  const elapsedMs =
    (endedAt || (startedAt ? Date.now() : 0)) - (startedAt || 0);
  const cost = useMemo(() => estimateCost(stepData), [stepData]);
  const failedSteps = STEPS.filter(
    (step) => step.id !== "summary" && stepStatus[step.id] === "failed"
  );

  const showingCountdown =
    !executing &&
    !paused &&
    viewIndex === frontierIndex &&
    frontierIndex >= 0 &&
    frontierIndex < SUMMARY_INDEX &&
    (stepStatus[currentStep.id] === "done" ||
      stepStatus[currentStep.id] === "failed");

  const linkReviewRows = useMemo(
    () =>
      buildLinkReviewRows(stepData.links?.audit, stepData.links?.proposals),
    [stepData.links]
  );

  return (
    <TooltipProvider>
      <div className="space-y-6 pb-24">
        <div>
          <h1 className="text-xs text-foreground mb-1 flex items-center gap-1.5">
            <Moon className="h-3.5 w-3.5" />
            The Nightwatch
          </h1>
          <p className="text-sm text-muted-foreground">
            Run this on the 1st and 15th. It reviews the whole site, then you
            approve what goes live.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {mapped ? (
              <span>
                Destination{" "}
                <span className="font-mono text-foreground">
                  {destination.owner}/{destination.repo}
                </span>
              </span>
            ) : null}
            <span>Last run: {formatLastRun(lastRunAt)}</span>
            <span>Next due: {formatDueDate(due)}</span>
          </div>
        </div>

        {metaError && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {metaError}
          </p>
        )}

        {!loadingMeta && !mapped && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            No destination repo set for this company. Map it in{" "}
            <Link
              to={`/company/${companyId}/company-data`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Company Data
            </Link>{" "}
            first.
          </p>
        )}

        <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={startRun}
              disabled={!mapped || loadingMeta || executing || applying}
            >
              {executing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Start run
                </>
              )}
            </Button>
            {(frontierIndex >= 0 || executing) && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={viewIndex <= 0 || applying}
                  onClick={handleBack}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    applying ||
                    (viewIndex >= frontierIndex &&
                      (executing || runComplete))
                  }
                  onClick={handleNext}
                >
                  Next
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={runComplete || applying || executing}
                  onClick={handlePause}
                >
                  <Pause className="h-3.5 w-3.5 mr-1.5" />
                  {paused ? "Resume" : "Pause"}
                </Button>
                {showingCountdown && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    Next in {remaining}s
                  </span>
                )}
                {paused && !runComplete && !executing && (
                  <span className="text-xs text-muted-foreground">Paused</span>
                )}
              </>
            )}
          </div>

          <Stepper
            steps={STEPS}
            viewIndex={viewIndex}
            statusById={stepStatus}
            frontierIndex={Math.max(frontierIndex, 0)}
            onSelect={(index) => {
              if (index <= Math.max(frontierIndex, 0)) setViewIndex(index);
            }}
          />
        </div>

        {currentStep.id !== "summary" && frontierIndex >= 0 && (
          <section className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-medium text-foreground">
                {currentStep.label}
              </h2>
              {stepStatus[currentStep.id] === "failed" && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Failed
                </span>
              )}
            </div>
            {executing && viewIndex === frontierIndex && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running {currentStep.label}…
              </p>
            )}
            {stepError[currentStep.id] && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {stepError[currentStep.id]}
              </p>
            )}
            {(stepStatus[currentStep.id] === "done" ||
              stepStatus[currentStep.id] === "failed") &&
              stepData[currentStep.id] && (
                <ul className="text-sm text-foreground space-y-1">
                  {stepSummary(currentStep.id, stepData[currentStep.id]).lines.map(
                    (line) => (
                      <li key={line}>{line}</li>
                    )
                  )}
                </ul>
              )}
            {(stepStatus[currentStep.id] === "done" ||
              stepStatus[currentStep.id] === "failed") && (
              <p className="text-xs text-muted-foreground">{REVIEW_NOTE}</p>
            )}
          </section>
        )}

        {currentStep.id === "summary" && runComplete && (
          <section className="space-y-4">
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-2">
              <h2 className="text-sm font-medium text-foreground">Run stats</h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  Elapsed{" "}
                  <span className="tabular-nums text-foreground">
                    {formatElapsed(elapsedMs)}
                  </span>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-sm text-muted-foreground underline decoration-dotted underline-offset-2"
                    >
                      ~{formatUsd(cost.usd)} estimated (ballpark)
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs space-y-1">
                    {cost.fromUsage ? (
                      <p>Summed from response usage fields.</p>
                    ) : (
                      <p>Rough constants — not an invoice.</p>
                    )}
                    {cost.breakdown.map((row) => (
                      <p key={row.label}>
                        {row.label}: {row.count} × {formatUsd(row.usd / (row.count || 1))}{" "}
                        = {formatUsd(row.usd)}
                      </p>
                    ))}
                  </TooltipContent>
                </Tooltip>
              </div>
              {failedSteps.length > 0 && (
                <ul className="text-sm text-amber-800 space-y-1">
                  {failedSteps.map((step) => (
                    <li key={step.id}>
                      {step.label} failed
                      {stepError[step.id] ? `: ${stepError[step.id]}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-4">
              <h2 className="text-sm font-medium text-foreground">
                Review proposals
              </h2>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Refresh
                </h3>
                {stepStatus.refresh === "failed" && (
                  <p className="text-xs text-destructive">{stepError.refresh}</p>
                )}
                {refreshArticles(stepData.refresh).filter(
                  (article) => refreshParagraph(article)
                ).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No Where Things Stand proposals to apply.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {refreshArticles(stepData.refresh)
                      .filter((article) => refreshParagraph(article))
                      .map((article) => (
                        <li key={article.slug} className="text-sm">
                          <label className="flex items-start gap-2">
                            <Checkbox
                              className="mt-0.5"
                              checked={selectedRefresh.has(article.slug)}
                              onCheckedChange={(v) =>
                                setSelectedRefresh((prev) =>
                                  toggleSet(prev, article.slug, v === true)
                                )
                              }
                            />
                            <span>
                              <span className="font-medium">
                                {article.title || article.slug}
                              </span>
                              {refreshWarranted(article) ? (
                                <span className="ml-2 text-xs text-amber-800">
                                  Update warranted
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Links Audit
                </h3>
                {stepStatus.links === "failed" && (
                  <p className="text-xs text-destructive">{stepError.links}</p>
                )}
                {linkReviewRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No link proposals.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {linkReviewRows.map((row) => (
                      <li key={row.slug} className="text-sm space-y-1">
                        <p className="font-mono text-xs">
                          {row.slug}
                          {row.error ? " · excluded" : ""}
                        </p>
                        {(row.internal?.added || []).length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Internal to add:{" "}
                            {(row.internal.added || [])
                              .map((link) => link.slug)
                              .join(", ")}
                          </p>
                        )}
                        {(row.candidates || []).map((link) => {
                          const key = issueKey(row.slug, link.url);
                          return (
                            <label key={key} className="flex items-start gap-2 text-xs">
                              <Checkbox
                                className="mt-0.5"
                                checked={selectedLinks.has(key)}
                                onCheckedChange={(v) =>
                                  setSelectedLinks((prev) =>
                                    toggleSet(prev, key, v === true)
                                  )
                                }
                              />
                              <span>
                                <span className="font-medium">
                                  {link.label || link.title || link.url}
                                </span>
                                <span className="block break-all text-muted-foreground">
                                  {link.url}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Cleanup
                </h3>
                {stepStatus.cleanup === "failed" && (
                  <p className="text-xs text-destructive">{stepError.cleanup}</p>
                )}
                {cleanupPreviews(stepData.cleanup).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No cleanup diffs.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {cleanupPreviews(stepData.cleanup).map((preview) => (
                      <li key={preview.slug} className="text-sm">
                        <label className="flex items-start gap-2">
                          <Checkbox
                            className="mt-0.5"
                            checked={selectedCleanup.has(preview.slug)}
                            onCheckedChange={(v) =>
                              setSelectedCleanup((prev) =>
                                toggleSet(prev, preview.slug, v === true)
                              )
                            }
                          />
                          <span>
                            <span className="font-medium">
                              {preview.title || preview.slug}
                            </span>
                            {preview.rankSkip ? (
                              <span className="ml-2 text-xs text-amber-800">
                                ranking #{preview.position} — skip suggested
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Polish
                </h3>
                {stepStatus.polish === "failed" && (
                  <p className="text-xs text-destructive">{stepError.polish}</p>
                )}
                {rewriteProposals(stepData.polish?.proposals).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No section proposals.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {rewriteProposals(stepData.polish?.proposals).map((p) => (
                      <li key={p.slug} className="text-sm">
                        <label className="flex items-start gap-2">
                          <Checkbox
                            className="mt-0.5"
                            checked={selectedPolish.has(p.slug)}
                            onCheckedChange={(v) =>
                              setSelectedPolish((prev) =>
                                toggleSet(prev, p.slug, v === true)
                              )
                            }
                          />
                          <span>
                            <span className="font-medium">{p.slug}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              ## {p.heading} · {p.option}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {(applyProgress ||
              Object.keys(commitResults).length > 0 ||
              Object.keys(commitErrors).length > 0) && (
              <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-1.5 text-sm">
                {applyProgress && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {applyProgress}
                  </p>
                )}
                {["refresh", "links", "cleanup", "polish"].map((key) => {
                  const label =
                    key === "refresh"
                      ? "Refresh"
                      : key === "links"
                        ? "Links"
                        : key === "cleanup"
                          ? "Cleanup"
                          : "Polish";
                  if (commitErrors[key]) {
                    return (
                      <p key={key} className="text-destructive">
                        {label}: {commitErrors[key]}
                      </p>
                    );
                  }
                  if (commitResults[key]) {
                    return (
                      <p key={key}>
                        {label}: {commitCount(commitResults[key])} committed
                      </p>
                    );
                  }
                  return null;
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!runComplete || applying || executing}
                onClick={applyApproved}
              >
                {applying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Applying…
                  </>
                ) : (
                  "Apply approved changes"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={applying}
                onClick={closeRun}
              >
                Apply nothing / Close
              </Button>
            </div>
          </section>
        )}
      </div>
    </TooltipProvider>
  );
}
