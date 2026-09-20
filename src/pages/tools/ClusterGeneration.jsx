import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Loader2, Upload, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import ConfirmGate from "./articlesAutomation/ConfirmGate";
import GenerationReport from "./articlesAutomation/GenerationReport";
import {
  loadAutomationContext,
  persistPlannedCluster,
  requestClusterPlan,
} from "./articlesAutomation/planCluster";
import { generateClusterArticles } from "./articlesAutomation/runGeneration";
import { downloadArticlesZip } from "./articleGeneration/downloadZip";
import { saveGeneratedArticles } from "./articleGeneration/saveGeneratedArticles";
import { syncGeneratedArticlePublished } from "./articleGeneration/syncGeneratedArticlePublished";
import { updateCoveragePublished } from "./articleGeneration/updateCoverageDrafted";
import {
  DEFAULT_PUBLISH_BRANCH,
  formatPublishProgress,
  isPublishDestinationMapped,
  loadCompanyPublishDestination,
  publishArticlesToSite,
} from "./articleGeneration/publishToSite";
import WireInternalLinksPanel from "./articleGeneration/WireInternalLinksPanel";
import { buildClusterTree } from "./articlesAutomation/selectCluster";

const STAGES = [
  { id: "cluster", label: "Cluster Selection" },
  { id: "topic", label: "Topic Generation" },
  { id: "articles", label: "Articles Generation" },
];

const TYPE_LABELS = {
  comprehensive: "Comprehensive",
  howto: "How-to",
  comparison: "Comparison",
  faq: "FAQ",
  flex: "Flex",
};

const TYPE_COLORS = {
  comprehensive: "bg-violet-50 text-violet-700 border-violet-200",
  howto: "bg-blue-50 text-blue-700 border-blue-200",
  comparison: "bg-amber-50 text-amber-800 border-amber-200",
  faq: "bg-teal-50 text-teal-700 border-teal-200",
  flex: "bg-slate-100 text-slate-600 border-slate-200",
};

const IDLE_PHASES = new Set(["idle", "selected", "done", "declined", "error"]);

function TypeBadge({ type }) {
  const key = TYPE_COLORS[type] ? type : "flex";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[key]}`}
    >
      {TYPE_LABELS[key] || type}
    </span>
  );
}

function ImageStatusBadge({ image }) {
  const status = image?.status || "skipped";
  if (status === "done") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        Image ready
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[11px] font-medium text-destructive">
        Image failed
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Image…
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        Image pending
      </span>
    );
  }
  return null;
}

function stageStatus(stageId, currentStage, phase) {
  const order = { cluster: 0, topic: 1, articles: 2 };
  const current = order[currentStage] ?? -1;
  const target = order[stageId];
  if (phase === "declined" && stageId === currentStage) return "declined";
  if (phase === "done" && target <= 2) return "done";
  if (target < current) return "done";
  if (target === current) {
    if (phase === "error") return "error";
    return "active";
  }
  return "pending";
}

function ClusterTile({ cluster, selected, busy, onSelect }) {
  const base =
    "min-w-[11rem] max-w-xs flex-1 rounded-lg border px-3 py-2.5 text-left text-sm";

  if (cluster.status === "completed") {
    return (
      <div
        className={`${base} pointer-events-none border-emerald-200 bg-emerald-50/80 text-emerald-900/70`}
      >
        <p className="font-medium leading-snug">{cluster.clusterKeyword}</p>
        <p className="mt-1 text-[11px]">Completed</p>
      </div>
    );
  }

  if (cluster.status === "blocked") {
    return (
      <div
        className={`${base} pointer-events-none border-border bg-muted/40 text-muted-foreground`}
      >
        <p className="font-medium leading-snug text-foreground/70">
          {cluster.clusterKeyword}
        </p>
        <p className="mt-1 text-[11px]">Publish pillar first</p>
      </div>
    );
  }

  if (cluster.status === "planned") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onSelect(cluster)}
        className={`${base} transition-colors hover:bg-amber-100 disabled:opacity-50 ${
          selected
            ? "border-foreground bg-accent text-foreground ring-1 ring-foreground/20"
            : "border-amber-200 bg-amber-50 text-amber-950"
        }`}
      >
        <p className="font-medium leading-snug">{cluster.clusterKeyword}</p>
        <p
          className={`mt-1 text-[11px] ${
            selected ? "text-foreground/70" : "text-amber-800/80"
          }`}
        >
          {selected ? "Selected" : "Planned"}
        </p>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSelect(cluster)}
      className={`${base} transition-colors hover:bg-accent/50 disabled:opacity-50 ${
        selected
          ? "border-foreground bg-accent text-foreground ring-1 ring-foreground/20"
          : "border-border bg-card"
      }`}
    >
      <p className="font-medium leading-snug text-foreground">
        {cluster.clusterKeyword}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {selected ? "Selected" : "Available"}
      </p>
    </button>
  );
}

export default function ClusterGeneration() {
  const { companyId } = useParams();
  const runTokenRef = useRef(0);

  const [phase, setPhase] = useState("idle");
  const [currentStage, setCurrentStage] = useState("cluster");
  const [viewingStage, setViewingStage] = useState("cluster");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [pillars, setPillars] = useState([]);
  const [contextLoading, setContextLoading] = useState(true);
  const [picked, setPicked] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [plannedArticles, setPlannedArticles] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [coverageWarning, setCoverageWarning] = useState("");
  const [finishNote, setFinishNote] = useState("");
  const [publishDestination, setPublishDestination] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(null);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [wireActive, setWireActive] = useState(false);

  const contextRef = useRef(null);
  const pickedRef = useRef(null);
  const proposalRef = useRef(null);
  const plannedRef = useRef([]);
  const jobsRef = useRef([]);
  const stageRef = useRef(currentStage);
  stageRef.current = currentStage;

  const busy = !IDLE_PHASES.has(phase) || wireActive;
  const tree = useMemo(() => buildClusterTree(pillars), [pillars]);

  const refreshContext = useCallback(async () => {
    if (!companyId) return null;
    const ctx = await loadAutomationContext(companyId);
    contextRef.current = ctx;
    setCompanyName(ctx.companyName);
    setPillars(Array.isArray(ctx.pillars) ? ctx.pillars : []);
    return ctx;
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setPublishDestination(null);
      return;
    }
    let cancelled = false;
    loadCompanyPublishDestination(companyId)
      .then((destination) => {
        if (!cancelled) setPublishDestination(destination);
      })
      .catch((err) => {
        if (!cancelled) {
          setPublishDestination({ owner: "", repo: "", tokenKey: "" });
          console.error("Failed to load publish destination:", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setPillars([]);
      setCompanyName("");
      setContextLoading(false);
      return;
    }
    let cancelled = false;
    setContextLoading(true);
    setError("");
    refreshContext()
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load cluster tree");
        }
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, refreshContext]);

  const resetRunOutputs = () => {
    setProposal(null);
    setPlannedArticles([]);
    setJobs([]);
    setCurrentStep(0);
    setCoverageWarning("");
    setFinishNote("");
    setError("");
    setPublishing(false);
    setPublishProgress(null);
    setPublishResult(null);
    setPublishError(null);
    setWireActive(false);
    proposalRef.current = null;
    plannedRef.current = [];
    jobsRef.current = [];
  };

  const resetRunState = () => {
    resetRunOutputs();
    setPicked(null);
    setStatusMessage("");
    pickedRef.current = null;
  };

  const stillCurrent = (token) => runTokenRef.current === token;

  const declineFlow = useCallback(() => {
    runTokenRef.current += 1;
    const stage = stageRef.current;
    setPhase("declined");
    if (stage === "articles") {
      setStatusMessage(
        "Flow declined. Drafts were not published. Coverage may already be marked drafted from generation."
      );
    } else if (stage === "topic") {
      setStatusMessage("Flow declined. The plan was not saved.");
    } else {
      setStatusMessage("Flow declined. Nothing further was saved for this run.");
    }
  }, []);

  const runTopicGeneration = useCallback(async (token) => {
    const ctx = contextRef.current;
    const cluster = pickedRef.current;
    if (!ctx || !cluster) throw new Error("Missing cluster context");

    setCurrentStage("topic");
    setViewingStage("topic");
    setPhase("planning");
    setStatusMessage(`Planning “${cluster.clusterKeyword}” cluster…`);

    const result = await requestClusterPlan({
      pillarKeyword: cluster.pillarKeyword,
      supportingKeyword: cluster.clusterKeyword,
      abstract: ctx.abstract,
      shortDescription: ctx.shortDescription,
      audience: ctx.audience,
      competitors: ctx.competitors,
      pillars: ctx.pillars,
    });
    if (!stillCurrent(token)) return;
    proposalRef.current = result;
    setProposal(result);
    setPhase("plan_review");
    setStatusMessage(
      `Plan ready for “${cluster.clusterKeyword}”. Confirm to save as planned.`
    );
  }, []);

  const runArticleGeneration = useCallback(
    async (token) => {
      const cluster = pickedRef.current;
      const articles = plannedRef.current;
      if (!companyId || !cluster || !articles.length) {
        throw new Error("Missing planned articles");
      }

      setCurrentStage("articles");
      setViewingStage("articles");
      setPhase("generating");
      setJobs([]);
      setCurrentStep(0);
      setStatusMessage(
        `Generating ${articles.length} article${articles.length === 1 ? "" : "s"} with images…`
      );

      const result = await generateClusterArticles({
        companyId,
        pillarKeyword: cluster.pillarKeyword,
        supportingKeyword: cluster.clusterKeyword,
        articles,
        withImages: true,
        onJobsChange: (next) => {
          if (!stillCurrent(token)) return;
          jobsRef.current = next;
          setJobs(next);
        },
        onStep: (step) => {
          if (!stillCurrent(token)) return;
          setCurrentStep(step);
        },
        onStatus: (message) => {
          if (!stillCurrent(token)) return;
          setStatusMessage(message);
        },
      });
      if (!stillCurrent(token)) return;

      jobsRef.current = result.jobs;
      setJobs(result.jobs);
      setCoverageWarning(result.coverageWarning || "");
      const succeeded = result.jobs.filter((job) => job.status === "done").length;
      const failed = result.jobs.filter((job) => job.status === "failed").length;
      if (succeeded === 0) {
        setPhase("error");
        setError(
          failed
            ? "Every article in this cluster failed to generate."
            : "No articles were generated."
        );
        return;
      }
      setPhase("generate_review");
      setStatusMessage(
        `${succeeded} article${succeeded === 1 ? "" : "s"} generated${
          failed ? `, ${failed} failed` : ""
        }. Confirm to publish to the site.`
      );
    },
    [companyId]
  );

  const confirmPlan = useCallback(async () => {
    const token = runTokenRef.current;
    const cluster = pickedRef.current;
    const nextProposal = proposalRef.current;
    if (!companyId || !cluster || !nextProposal) return;

    try {
      setPhase("persisting");
      setStatusMessage("Saving cluster as planned…");
      const saved = await persistPlannedCluster({
        companyId,
        pillarSlug: cluster.pillarSlug,
        pillarKeyword: cluster.pillarKeyword,
        supportingSlug: cluster.clusterSlug,
        supportingKeyword: cluster.clusterKeyword,
        articles: nextProposal.articles,
        clusterRationale: nextProposal.clusterRationale,
      });
      if (!stillCurrent(token)) return;
      plannedRef.current = saved.plannedArticles;
      setPlannedArticles(saved.plannedArticles);
      setPillars(saved.pillars);
      if (contextRef.current) {
        contextRef.current = {
          ...contextRef.current,
          pillars: saved.pillars,
        };
      }
      await runArticleGeneration(token);
    } catch (err) {
      if (!stillCurrent(token)) return;
      setPhase("error");
      setError(err?.message || "Failed to save planned cluster");
    }
  }, [companyId, runArticleGeneration]);

  const confirmPublish = useCallback(async () => {
    const token = runTokenRef.current;
    const cluster = pickedRef.current;
    const destination = publishDestination;

    if (!isPublishDestinationMapped(destination)) {
      setPhase("error");
      setPublishError("Set Publish Destination in Company Data first");
      setError("Set Publish Destination in Company Data first");
      setStatusMessage("Set Publish Destination in Company Data first");
      return;
    }

    const readyJobs = jobsRef.current.filter(
      (job) => job.status === "done" && job.markdown
    );
    if (readyJobs.length === 0) {
      setPhase("error");
      setError("No successful articles to publish.");
      return;
    }

    try {
      setPhase("publishing");
      setViewingStage("articles");
      setPublishing(true);
      setPublishProgress(null);
      setPublishError(null);
      setPublishResult(null);
      setStatusMessage("Saving articles, then publishing to the destination site…");

      const saved = await saveGeneratedArticles({
        supabase,
        companyId,
        pillarKeyword: cluster?.pillarKeyword || "",
        supportingKeyword: cluster?.clusterKeyword || "",
        articles: readyJobs.map((job) => {
          const article = plannedRef.current[job.index] || {};
          return {
            type: job.type || article.type,
            targetKeyword: article.targetKeyword || "",
            frontmatter: job.frontmatter,
            body: job.body,
            whereThingsStandSources: job.whereThingsStandSources,
            heroStoragePath: job.image?.storagePath || null,
          };
        }),
      });
      if (saved.error) throw saved.error;
      if (!stillCurrent(token)) return;

      const result = await publishArticlesToSite(
        readyJobs.map((job) => ({
          frontmatter: job.frontmatter,
          body: job.body,
          markdown: job.markdown,
          heroStoragePath: job.image?.storagePath || null,
          image:
            job.image?.status === "done"
              ? {
                  ...(job.image.result || {}),
                  storagePath: job.image.storagePath || null,
                }
              : null,
        })),
        {
          companyId,
          owner: destination.owner,
          repo: destination.repo,
          tokenKey: destination.tokenKey,
          branch: DEFAULT_PUBLISH_BRANCH,
        },
        {
          onProgress: (progress) => {
            if (!stillCurrent(token)) return;
            setPublishProgress(progress);
            setStatusMessage(
              progress.phase === "merge"
                ? "Merging publish branch…"
                : `Committing ${progress.current}/${progress.total}${
                    progress.filename ? `: ${progress.filename}` : ""
                  }`
            );
          },
        }
      );
      if (!stillCurrent(token)) return;

      setPublishResult(result);
      const committedCount = Array.isArray(result.committed)
        ? result.committed.length
        : 0;
      const skippedCount = Array.isArray(result.skipped)
        ? result.skipped.length
        : 0;

      if (!result.ok || committedCount === 0) {
        setPhase("error");
        setPublishError(
          "Publish did not complete. See the report below."
        );
        setStatusMessage("Publish did not complete. See the report below.");
        return;
      }

      const now = new Date().toISOString();
      const publishedUrl = result.pullRequestUrl || "";
      const coverage = await updateCoveragePublished({
        companyId,
        pillarKeyword: cluster?.pillarKeyword || "",
        supportingKeyword: cluster?.clusterKeyword || "",
        successes: readyJobs.map((job) => {
          const article = plannedRef.current[job.index] || {};
          return {
            targetKeyword: article.targetKeyword,
            title: job.frontmatter?.title || job.title || article.title,
            frontmatter: job.frontmatter,
          };
        }),
        publishedUrl,
      });
      if (!stillCurrent(token)) return;
      if (coverage.pillars?.length) {
        setPillars(coverage.pillars);
        if (contextRef.current) {
          contextRef.current = {
            ...contextRef.current,
            pillars: coverage.pillars,
          };
        }
      }
      if (coverage.warning) setCoverageWarning(coverage.warning);

      for (const job of readyJobs) {
        const article = plannedRef.current[job.index] || {};
        await syncGeneratedArticlePublished({
          companyId,
          pillarKeyword: cluster?.pillarKeyword || "",
          supportingKeyword: cluster?.clusterKeyword || "",
          article: {
            slug: job.frontmatter?.slug,
            title: job.frontmatter?.title || job.title,
            targetKeyword: article.targetKeyword || job.frontmatter?.targetKeyword,
          },
          publishedUrl,
          publishedAt: now,
        });
        if (!stillCurrent(token)) return;
      }

      setFinishNote(
        `Published ${committedCount} file${committedCount === 1 ? "" : "s"} to ${destination.owner}/${destination.repo}${skippedCount ? `, ${skippedCount} skipped` : ""}.`
      );
      setPhase("done");
      setStatusMessage(
        `Published to ${destination.owner}/${destination.repo}. ${committedCount} file${committedCount === 1 ? "" : "s"} committed${skippedCount ? `, ${skippedCount} skipped` : ""}.`
      );
      await refreshContext();
    } catch (err) {
      if (!stillCurrent(token)) return;
      setPhase("error");
      setPublishError(err?.message || "Publish failed");
      if (err?.result) setPublishResult(err.result);
      setError(err?.message || "Publish failed");
      setStatusMessage(err?.message || "Publish failed");
    } finally {
      if (stillCurrent(token)) {
        setPublishing(false);
        setPublishProgress(null);
      }
    }
  }, [companyId, publishDestination, refreshContext]);

  const selectCluster = (cluster) => {
    if (!companyId || busy || !cluster) return;
    if (cluster.status !== "available" && cluster.status !== "planned") return;

    runTokenRef.current += 1;
    resetRunOutputs();
    pickedRef.current = cluster;
    setPicked(cluster);
    setCurrentStage("cluster");
    setViewingStage("cluster");
    setPhase("selected");
    setStatusMessage(
      `Selected “${cluster.clusterKeyword}”. Click Generate to start.`
    );
  };

  const startFlow = async () => {
    const cluster = pickedRef.current;
    if (!companyId || busy || !cluster) return;
    if (cluster.status !== "available" && cluster.status !== "planned") return;

    const token = ++runTokenRef.current;
    resetRunOutputs();
    setCurrentStage("cluster");
    setViewingStage("cluster");
    setPhase("selecting");
    setStatusMessage(`Starting “${cluster.clusterKeyword}”…`);

    try {
      const ctx = await refreshContext();
      if (!stillCurrent(token)) return;
      const freshTree = buildClusterTree(ctx?.pillars || []);
      const fresh = freshTree
        .flatMap((pillar) => pillar.clusters)
        .find(
          (item) =>
            item.clusterSlug === cluster.clusterSlug ||
            item.clusterKeyword.toLowerCase() ===
              cluster.clusterKeyword.toLowerCase()
        );
      if (!fresh) {
        setPhase("error");
        setError(`Could not find cluster “${cluster.clusterKeyword}”.`);
        return;
      }
      if (fresh.status === "blocked") {
        setPhase("error");
        setError(
          `Publish the pillar article for “${fresh.pillarKeyword}” before generating this cluster.`
        );
        return;
      }
      if (fresh.status === "completed") {
        setPhase("error");
        setError(
          `“${fresh.clusterKeyword}” already has generated articles.`
        );
        return;
      }

      pickedRef.current = fresh;
      setPicked(fresh);

      if (fresh.status === "planned") {
        const articles = Array.isArray(fresh.plannedArticles)
          ? fresh.plannedArticles
          : [];
        if (articles.length === 0) {
          setPhase("error");
          setError(
            `“${fresh.clusterKeyword}” is marked planned but has no saved articles to generate.`
          );
          return;
        }
        plannedRef.current = articles;
        setPlannedArticles(articles);
        setStatusMessage(
          `Resuming saved plan for “${fresh.clusterKeyword}” — skipping planning.`
        );
        await runArticleGeneration(token);
        return;
      }

      await runTopicGeneration(token);
    } catch (err) {
      if (!stillCurrent(token)) return;
      setPhase("error");
      setError(err?.message || "Failed to start Cluster Generation");
    }
  };

  const successJobs = useMemo(
    () => jobs.filter((job) => job.status === "done" && job.markdown),
    [jobs]
  );
  const failedJobs = useMemo(
    () => jobs.filter((job) => job.status === "failed"),
    [jobs]
  );
  const destinationMapped = isPublishDestinationMapped(publishDestination);
  const handleWireActiveChange = useCallback((active) => {
    setWireActive(Boolean(active));
  }, []);
  const progressPct =
    jobs.length > 0 ? Math.round((currentStep / jobs.length) * 100) : 0;
  const currentJob =
    phase === "generating" && currentStep > 0
      ? jobs.find((job) => job.status === "running") ||
        jobs[Math.min(currentStep - 1, jobs.length - 1)]
      : null;

  const reached = {
    cluster: true,
    topic:
      Boolean(proposal) ||
      phase === "planning" ||
      phase === "plan_review" ||
      phase === "persisting" ||
      currentStage === "topic" ||
      currentStage === "articles",
    articles:
      jobs.length > 0 ||
      phase === "generating" ||
      phase === "generate_review" ||
      phase === "publishing" ||
      phase === "done",
  };

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xs text-foreground mb-1">Cluster Generation</h1>
        <p className="text-sm text-muted-foreground">
          Select a supporting cluster, then Generate. The run plans topics,
          writes articles with images, publishes them, then offers to wire
          internal links. Confirm or Decline at each step; the countdown
          auto-confirms after 10 seconds.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {STAGES.map((stage) => {
            const status = stageStatus(stage.id, currentStage, phase);
            const enabled = reached[stage.id];
            return (
              <Button
                key={stage.id}
                type="button"
                size="sm"
                variant={viewingStage === stage.id ? "default" : "outline"}
                disabled={!enabled}
                onClick={() => enabled && setViewingStage(stage.id)}
              >
                {status === "done" && <Check className="h-3.5 w-3.5 mr-1.5" />}
                {status === "active" && busy && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                {status === "declined" && <X className="h-3.5 w-3.5 mr-1.5" />}
                {stage.label}
              </Button>
            );
          })}
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
          {statusMessage}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {coverageWarning && viewingStage === "articles" && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {coverageWarning}
        </p>
      )}

      {viewingStage === "cluster" && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-foreground">
            Cluster Selection
          </h2>
          {companyName ? (
            <p className="text-sm text-muted-foreground">{companyName}</p>
          ) : null}
          {contextLoading && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading clusters from coverage…
            </div>
          )}
          {!contextLoading && tree.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No pillars found. Add pillar keywords in Company Data, then open
              Cluster Generation once so coverage is initialized.
            </p>
          )}
          {!contextLoading &&
            tree.map((pillar) => (
              <div key={pillar.slug || pillar.keyword} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">
                    {pillar.keyword}
                  </h3>
                  {pillar.pillarPublished ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      <Check className="h-3 w-3" />
                      Published
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Pillar not published
                    </span>
                  )}
                </div>
                {pillar.clusters.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No supporting clusters. Add them in Company Data.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {pillar.clusters.map((cluster) => (
                      <ClusterTile
                        key={cluster.clusterSlug || cluster.clusterKeyword}
                        cluster={cluster}
                        selected={
                          picked?.clusterSlug === cluster.clusterSlug ||
                          picked?.clusterKeyword === cluster.clusterKeyword
                        }
                        busy={busy}
                        onSelect={selectCluster}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          {picked && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Pillar </span>
                <span className="font-medium">{picked.pillarKeyword}</span>
                <span className="ml-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Published
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Supporting cluster </span>
                <span className="font-medium">{picked.clusterKeyword}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {picked.status === "planned"
                  ? "This cluster already has a saved plan. Generate will use it and will not re-plan."
                  : "This cluster has no plan yet. Generate will plan topics, then write the articles."}
              </p>
              {phase === "selected" && (
                <div className="pt-1">
                  <Button type="button" size="sm" onClick={startFlow}>
                    Generate
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {viewingStage === "topic" && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">
            Topic Generation
          </h2>
          {(phase === "planning" || phase === "persisting") && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {phase === "persisting"
                    ? "Saving planned cluster…"
                    : `Planning “${picked?.clusterKeyword || "cluster"}” cluster…`}
                </span>
              </div>
              <Progress value={phase === "persisting" ? 90 : 40} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                Same Plan Cluster call (one of each article type by default).
              </p>
            </div>
          )}
          {proposal && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Cluster </span>
                <span className="font-medium">{picked?.clusterKeyword}</span>
                <span className="text-muted-foreground"> under </span>
                <span className="font-medium">{picked?.pillarKeyword}</span>
              </p>
              {proposal.clusterRationale ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {proposal.clusterRationale}
                </p>
              ) : null}
              <ul className="space-y-2">
                {proposal.articles.map((article) => (
                  <li
                    key={article.id}
                    className="rounded-md border border-border px-3 py-2 text-sm space-y-1"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{article.title}</span>
                      <TypeBadge type={article.type} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {article.targetKeyword}
                      {article.wordCount ? ` · ${article.wordCount} words` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {phase === "plan_review" && (
            <ConfirmGate
              key="plan-gate"
              onConfirm={confirmPlan}
              onDecline={declineFlow}
            />
          )}
        </section>
      )}

      {viewingStage === "articles" && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">
            Articles Generation
          </h2>
          {phase === "generating" && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  Generating {currentStep} of {jobs.length || plannedArticles.length}
                  {currentJob?.title ? `: ${currentJob.title}` : ""}
                  …
                </span>
              </div>
              <Progress value={progressPct} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                Articles run one at a time, with hero images generated after
                each successful draft.
              </p>
            </div>
          )}
          {(phase === "publishing" || publishing) && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {formatPublishProgress(publishProgress)}
            </div>
          )}
          {jobs.length > 0 && (
            <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
              {jobs.map((job) => (
                <li key={`job-${job.index}`} className="px-3 py-3 text-sm">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0" aria-hidden>
                      {job.status === "done" && (
                        <Check className="h-4 w-4 text-emerald-600" />
                      )}
                      {job.status === "failed" && (
                        <X className="h-4 w-4 text-destructive" />
                      )}
                      {job.status === "running" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {job.status === "pending" && (
                        <span className="block h-4 w-4 rounded-full border border-border" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground break-words">
                          {job.frontmatter?.title || job.title}
                        </span>
                        <TypeBadge type={job.type} />
                        <ImageStatusBadge image={job.image} />
                      </div>
                      {job.status === "failed" && job.error && (
                        <p className="text-xs text-destructive break-words">
                          {job.error}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(phase === "generate_review" ||
            phase === "publishing" ||
            phase === "done") && (
            <p className="text-sm text-foreground">
              <span className="font-medium">{successJobs.length}</span> succeeded
              <span className="text-muted-foreground"> / </span>
              <span className="font-medium">{failedJobs.length}</span> failed
            </p>
          )}
          {phase === "done" && successJobs.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                downloadArticlesZip(
                  successJobs.map((job) => ({
                    frontmatter: job.frontmatter,
                    markdown: job.markdown,
                    image:
                      job.image?.status === "done" &&
                      job.image?.result?.b64_json
                        ? job.image.result
                        : null,
                  })),
                  `${(picked?.clusterKeyword || "articles")
                    .toLowerCase()
                    .replace(/[^\w]+/g, "-")
                    .replace(/^-|-$/g, "") || "articles"}-drafts.zip`
                )
              }
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download All (.zip)
            </Button>
          )}
          {viewingStage === "articles" &&
            publishDestination &&
            !destinationMapped && (
              <p className="text-sm text-muted-foreground">
                No destination repo set for this company.
              </p>
            )}
          {publishError && viewingStage === "articles" && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
              {publishError}
            </p>
          )}
          {publishResult && viewingStage === "articles" && (
            <GenerationReport
              title={
                publishResult.ok
                  ? "Cluster published"
                  : "Publish did not complete"
              }
              summary={
                publishResult.ok
                  ? `Generated ${successJobs.length} article${
                      successJobs.length === 1 ? "" : "s"
                    } for “${picked?.clusterKeyword || "this cluster"}” under “${
                      picked?.pillarKeyword || "its pillar"
                    }”, then committed them to the site.`
                  : "Articles were generated, but the site commit did not finish. Review the problems below."
              }
              destinationLabel={
                destinationMapped
                  ? `Published to ${publishDestination.owner}/${publishDestination.repo}. A rebuild should start from this commit.`
                  : null
              }
              jobs={jobs}
              publishResult={publishResult}
            />
          )}
          {phase === "error" &&
            successJobs.length > 0 &&
            !publishResult?.ok && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={publishing || !destinationMapped}
                onClick={confirmPublish}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Retry Publish
              </Button>
            )}
          {viewingStage === "articles" && (
            <WireInternalLinksPanel
              companyId={companyId}
              destination={publishDestination}
              visible={Boolean(publishResult?.ok)}
              autoStart
              onActiveChange={handleWireActiveChange}
            />
          )}
          {phase === "generate_review" && (
            <ConfirmGate
              key="articles-gate"
              confirmLabel="Publish"
              onConfirm={confirmPublish}
              onDecline={declineFlow}
            />
          )}
        </section>
      )}
    </div>
  );
}
