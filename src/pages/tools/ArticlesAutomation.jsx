import React, { useCallback, useMemo, useRef, useState } from "react";
import { Check, Download, Loader2, Play, Workflow, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import ConfirmGate from "./articlesAutomation/ConfirmGate";
import {
  loadAutomationContext,
  persistPlannedCluster,
  requestClusterPlan,
} from "./articlesAutomation/planCluster";
import {
  generateClusterArticles,
  saveAndDownloadGenerated,
} from "./articlesAutomation/runGeneration";
import { downloadArticlesZip } from "./articleGeneration/downloadZip";
import {
  listEligibleClusters,
  pickUnplannedCluster,
} from "./articlesAutomation/selectCluster";

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

const IDLE_PHASES = new Set(["idle", "done", "declined", "error"]);

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

export default function ArticlesAutomation() {
  const { companyId } = useParams();
  const runTokenRef = useRef(0);

  const [phase, setPhase] = useState("idle");
  const [currentStage, setCurrentStage] = useState("cluster");
  const [viewingStage, setViewingStage] = useState("cluster");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [picked, setPicked] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [plannedArticles, setPlannedArticles] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [coverageWarning, setCoverageWarning] = useState("");
  const [finishNote, setFinishNote] = useState("");

  const contextRef = useRef(null);
  const pickedRef = useRef(null);
  const proposalRef = useRef(null);
  const plannedRef = useRef([]);
  const jobsRef = useRef([]);
  const stageRef = useRef(currentStage);
  stageRef.current = currentStage;

  const busy = !IDLE_PHASES.has(phase);

  const resetRunState = () => {
    setPicked(null);
    setProposal(null);
    setPlannedArticles([]);
    setJobs([]);
    setCurrentStep(0);
    setCoverageWarning("");
    setFinishNote("");
    setError("");
    setStatusMessage("");
    contextRef.current = null;
    pickedRef.current = null;
    proposalRef.current = null;
    plannedRef.current = [];
    jobsRef.current = [];
  };

  const stillCurrent = (token) => runTokenRef.current === token;

  const declineFlow = useCallback(() => {
    runTokenRef.current += 1;
    const stage = stageRef.current;
    setPhase("declined");
    if (stage === "articles") {
      setStatusMessage(
        "Flow declined. Drafts were not saved or downloaded. Coverage may already be marked drafted from generation."
      );
    } else if (stage === "topic") {
      setStatusMessage("Flow declined. The plan was not saved.");
    } else {
      setStatusMessage("Flow declined. Nothing further was saved for this run.");
    }
  }, []);

  const runTopicGeneration = useCallback(
    async (token) => {
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
    },
    []
  );

  const runArticleGeneration = useCallback(async (token) => {
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
      }. Confirm to save and download.`
    );
  }, [companyId]);

  const confirmCluster = useCallback(async () => {
    const token = runTokenRef.current;
    try {
      await runTopicGeneration(token);
    } catch (err) {
      if (!stillCurrent(token)) return;
      setPhase("error");
      setError(err?.message || "Topic generation failed");
    }
  }, [runTopicGeneration]);

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

  const confirmArticles = useCallback(async () => {
    const token = runTokenRef.current;
    const cluster = pickedRef.current;
    try {
      setPhase("finishing");
      setViewingStage("articles");
      setStatusMessage("Saving articles and downloading markdown…");
      const result = await saveAndDownloadGenerated({
        companyId,
        pillarKeyword: cluster?.pillarKeyword || "",
        supportingKeyword: cluster?.clusterKeyword || "",
        articles: plannedRef.current,
        jobs: jobsRef.current,
      });
      if (!stillCurrent(token)) return;
      setFinishNote(
        `Saved ${result.saved} article${result.saved === 1 ? "" : "s"} to the library and downloaded the zip.`
      );
      setPhase("done");
      setStatusMessage("Flow complete.");
    } catch (err) {
      if (!stillCurrent(token)) return;
      setPhase("error");
      setError(err?.message || "Failed to save or download articles");
    }
  }, [companyId]);

  const startFlow = async () => {
    if (!companyId || busy) return;
    const token = ++runTokenRef.current;
    resetRunState();
    setCurrentStage("cluster");
    setViewingStage("cluster");
    setPhase("selecting");
    setStatusMessage("Choosing a supporting keyword cluster…");

    try {
      const ctx = await loadAutomationContext(companyId);
      if (!stillCurrent(token)) return;
      contextRef.current = ctx;
      setCompanyName(ctx.companyName);

      const published = listEligibleClusters(ctx.pillars);
      const next = pickUnplannedCluster(ctx.pillars);
      if (!next) {
        setPhase("error");
        setError(
          published.length === 0
            ? "No supporting cluster has a published pillar article yet. Publish a pillar article in Topic Generator first."
            : `All ${published.length} supporting cluster${
                published.length === 1 ? "" : "s"
              } under published pillars already have a plan.`
        );
        return;
      }

      pickedRef.current = next;
      setPicked(next);
      setPhase("cluster_review");
      setStatusMessage(
        `Selected “${next.clusterKeyword}” under published pillar “${next.pillarKeyword}”.`
      );
    } catch (err) {
      if (!stillCurrent(token)) return;
      setPhase("error");
      setError(err?.message || "Failed to start Articles Automation");
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
  const progressPct =
    jobs.length > 0 ? Math.round((currentStep / jobs.length) * 100) : 0;
  const currentJob =
    phase === "generating" && currentStep > 0
      ? jobs.find((job) => job.status === "running") ||
        jobs[Math.min(currentStep - 1, jobs.length - 1)]
      : null;

  const reached = {
    cluster: Boolean(picked) || phase === "selecting",
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
      phase === "finishing" ||
      phase === "done",
  };

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xs text-foreground mb-1">Articles Automation</h1>
        <p className="text-sm text-muted-foreground">
          One supporting cluster per run: pick a cluster under a published
          pillar, plan it the same way as Topic Generator, then generate
          articles with images the same way as Article Generator. Confirm or
          Decline at each step; the countdown auto-confirms after 10 seconds.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-4">
        <Button type="button" onClick={startFlow} disabled={!companyId || busy}>
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 mr-1.5" />
              Flow Activation
            </>
          )}
        </Button>

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
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">
            Cluster Selection
          </h2>
          {phase === "selecting" && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Looking for a supporting cluster with a published pillar article…
            </div>
          )}
          {picked && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-2 text-sm">
              {companyName ? (
                <p className="text-muted-foreground">{companyName}</p>
              ) : null}
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
                This cluster has no plan yet. Confirm to run Topic Generator
                Plan Cluster for it.
              </p>
            </div>
          )}
          {phase === "cluster_review" && (
            <ConfirmGate
              key="cluster-gate"
              onConfirm={confirmCluster}
              onDecline={declineFlow}
            />
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
                Same Plan Cluster call as Topic Generator (one of each article
                type by default).
              </p>
            </div>
          )}
          {proposal && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Cluster </span>
                <span className="font-medium">
                  {picked?.clusterKeyword}
                </span>
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
                each successful draft — the same defaults as Article Generator.
              </p>
            </div>
          )}
          {phase === "finishing" && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving to the Articles library and downloading markdown…
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
          {(phase === "generate_review" || phase === "done") && (
            <p className="text-sm text-foreground">
              <span className="font-medium">{successJobs.length}</span> succeeded
              <span className="text-muted-foreground"> / </span>
              <span className="font-medium">{failedJobs.length}</span> failed
            </p>
          )}
          {finishNote && (
            <p className="text-sm text-foreground">{finishNote}</p>
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
          {phase === "generate_review" && (
            <ConfirmGate
              key="articles-gate"
              onConfirm={confirmArticles}
              onDecline={declineFlow}
            />
          )}
        </section>
      )}

      {phase === "idle" && (
        <p className="text-sm text-muted-foreground flex items-start gap-2">
          <Workflow className="h-4 w-4 mt-0.5 shrink-0" />
          Press Flow Activation to start. Decline stops the run; it does not
          pick another cluster.
        </p>
      )}
    </div>
  );
}
