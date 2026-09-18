import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Workflow, X } from "lucide-react";
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
import { saveGeneratedArticles } from "./articleGeneration/saveGeneratedArticles";
import { syncGeneratedArticlePublished } from "./articleGeneration/syncGeneratedArticlePublished";
import {
  DEFAULT_PUBLISH_BRANCH,
  formatPublishProgress,
  isPublishDestinationMapped,
  loadCompanyPublishDestination,
  publishArticlesToSite,
} from "./articleGeneration/publishToSite";

const STAGES = [
  { id: "pillar", label: "Pillar Selection" },
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

const PILLAR_ARTICLE_TYPE_COUNTS = { comprehensive: 1 };

function pillarArticleStatus(pillarArticle) {
  if (!pillarArticle) return "missing";
  if (typeof pillarArticle === "string") return pillarArticle;
  return pillarArticle.status || "missing";
}

function matchesPillar(pillar, slug, keyword) {
  if (slug && pillar?.slug === slug) return true;
  if (
    keyword &&
    String(pillar?.keyword || "").trim().toLowerCase() ===
      String(keyword).trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

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
  const order = { pillar: 0, topic: 1, articles: 2 };
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

async function persistPlannedPillarArticle({
  companyId,
  pillarSlug,
  pillarKeyword,
  article,
  pillarRationale,
}) {
  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }

  const pillars = Array.isArray(data?.pillars) ? data.pillars : [];
  const now = new Date().toISOString();
  const pillarArticle = {
    id: article?.id,
    status: "planned",
    title: article.title,
    targetKeyword: article.targetKeyword,
    type: article.type || "comprehensive",
    searchIntent: article.searchIntent || undefined,
    keyMessages: asStringArray(article.keyMessages),
    wordCount: article.wordCount,
    internalLinks: asStringArray(article.internalLinks),
    ctaAngle: article.ctaAngle || undefined,
    pillarRationale: String(pillarRationale || "").trim() || undefined,
    updatedAt: now,
  };

  let found = false;
  const next = pillars.map((pillar) => {
    if (!matchesPillar(pillar, pillarSlug, pillarKeyword)) return pillar;
    found = true;
    return { ...pillar, pillarArticle };
  });

  if (!found) {
    throw new Error(
      `Could not find pillar “${pillarKeyword || pillarSlug}” in coverage.`
    );
  }

  const { error: upsertError } = await supabase.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars: next,
      updated_at: now,
    },
    { onConflict: "company_id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to save coverage");
  }

  return {
    pillars: next,
    plannedArticles: [{ ...article, ...pillarArticle }],
  };
}

async function markPillarArticlePublished({
  companyId,
  pillarSlug,
  pillarKeyword,
  article,
  publishedUrl,
}) {
  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }

  const pillars = Array.isArray(data?.pillars) ? data.pillars : [];
  const now = new Date().toISOString();
  const url = String(publishedUrl || "").trim();

  let found = false;
  const next = pillars.map((pillar) => {
    if (!matchesPillar(pillar, pillarSlug, pillarKeyword)) return pillar;
    found = true;
    const existing =
      pillar.pillarArticle && typeof pillar.pillarArticle === "object"
        ? pillar.pillarArticle
        : {};
    return {
      ...pillar,
      pillarArticle: {
        ...existing,
        ...(article?.title ? { title: article.title } : {}),
        ...(article?.targetKeyword
          ? { targetKeyword: article.targetKeyword }
          : {}),
        ...(article?.slug ? { slug: article.slug } : {}),
        status: "published",
        publishedUrl: url || existing.publishedUrl || undefined,
        publishedAt: now,
        updatedAt: now,
      },
    };
  });

  if (!found) {
    throw new Error(
      `Could not find pillar “${pillarKeyword || pillarSlug}” in coverage.`
    );
  }

  const { error: upsertError } = await supabase.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars: next,
      updated_at: now,
    },
    { onConflict: "company_id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to save coverage");
  }

  await syncGeneratedArticlePublished({
    companyId,
    pillarKeyword,
    supportingKeyword: undefined,
    article: {
      slug: article?.slug,
      title: article?.title,
      targetKeyword: article?.targetKeyword,
    },
    publishedUrl: url,
    publishedAt: now,
  });

  return next;
}

export default function PillarAutomation() {
  const { companyId } = useParams();
  const runTokenRef = useRef(0);

  const [phase, setPhase] = useState("idle");
  const [currentStage, setCurrentStage] = useState("pillar");
  const [viewingStage, setViewingStage] = useState("pillar");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [pillars, setPillars] = useState([]);
  const [contextLoading, setContextLoading] = useState(false);
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

  const contextRef = useRef(null);
  const pickedRef = useRef(null);
  const proposalRef = useRef(null);
  const plannedRef = useRef([]);
  const jobsRef = useRef([]);
  const stageRef = useRef(currentStage);
  stageRef.current = currentStage;

  const busy = !IDLE_PHASES.has(phase);

  const refreshContext = useCallback(async () => {
    if (!companyId) {
      contextRef.current = null;
      setCompanyName("");
      setPillars([]);
      return null;
    }
    const ctx = await loadAutomationContext(companyId);
    contextRef.current = ctx;
    setCompanyName(ctx.companyName);
    setPillars(Array.isArray(ctx.pillars) ? ctx.pillars : []);
    return ctx;
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setPublishDestination(null);
      setPillars([]);
      setCompanyName("");
      return;
    }
    let cancelled = false;
    setContextLoading(true);
    Promise.all([
      loadAutomationContext(companyId),
      loadCompanyPublishDestination(companyId),
    ])
      .then(([ctx, destination]) => {
        if (cancelled) return;
        contextRef.current = ctx;
        setCompanyName(ctx.companyName);
        setPillars(Array.isArray(ctx.pillars) ? ctx.pillars : []);
        setPublishDestination(destination);
      })
      .catch((err) => {
        if (cancelled) return;
        setPublishDestination({ owner: "", repo: "", tokenKey: "" });
        setError(err?.message || "Failed to load pillar generation");
        console.error("Failed to load Pillar Generation context:", err);
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

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
    setPublishing(false);
    setPublishProgress(null);
    setPublishResult(null);
    setPublishError(null);
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
    const pillar = pickedRef.current;
    if (!ctx || !pillar) throw new Error("Missing pillar context");

    setCurrentStage("topic");
    setViewingStage("topic");
    setPhase("planning");
    setStatusMessage(`Planning pillar article for “${pillar.pillarKeyword}”…`);

    const result = await requestClusterPlan({
      pillarKeyword: pillar.pillarKeyword,
      supportingKeyword: pillar.pillarKeyword,
      abstract: ctx.abstract,
      shortDescription: ctx.shortDescription,
      audience: ctx.audience,
      competitors: ctx.competitors,
      pillars: ctx.pillars,
      articleTypeCounts: PILLAR_ARTICLE_TYPE_COUNTS,
    });
    if (!stillCurrent(token)) return;
    proposalRef.current = result;
    setProposal(result);
    setPhase("plan_review");
    setStatusMessage(
      `Plan ready for pillar “${pillar.pillarKeyword}”. Confirm to save as planned.`
    );
  }, []);

  const runArticleGeneration = useCallback(
    async (token) => {
      const pillar = pickedRef.current;
      const articles = plannedRef.current;
      if (!companyId || !pillar || !articles.length) {
        throw new Error("Missing planned pillar article");
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
        pillarKeyword: pillar.pillarKeyword,
        supportingKeyword: "",
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
            ? "The pillar article failed to generate."
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
    const pillar = pickedRef.current;
    const nextProposal = proposalRef.current;
    if (!companyId || !pillar || !nextProposal) return;

    try {
      setPhase("persisting");
      setStatusMessage("Saving pillar article as planned…");
      const article = nextProposal.articles[0];
      if (!article) throw new Error("No pillar article in the plan");

      const matchingSupporting = (pillar.pillar?.supporting || []).find((sup) =>
        matchesPillar(sup, pillar.pillarSlug, pillar.pillarKeyword)
      );
      if (matchingSupporting) {
        await persistPlannedCluster({
          companyId,
          pillarSlug: pillar.pillarSlug,
          pillarKeyword: pillar.pillarKeyword,
          supportingSlug: matchingSupporting.slug,
          supportingKeyword: matchingSupporting.keyword,
          articles: nextProposal.articles,
          clusterRationale: nextProposal.clusterRationale,
        });
      }

      const saved = await persistPlannedPillarArticle({
        companyId,
        pillarSlug: pillar.pillarSlug,
        pillarKeyword: pillar.pillarKeyword,
        article,
        pillarRationale: nextProposal.clusterRationale,
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
      setError(err?.message || "Failed to save planned pillar article");
    }
  }, [companyId, runArticleGeneration]);

  const confirmPublish = useCallback(async () => {
    const token = runTokenRef.current;
    const pillar = pickedRef.current;
    const destination = publishDestination;

    if (!isPublishDestinationMapped(destination)) {
      setPhase("error");
      setPublishError("Set Publish Destination in Company Data first");
      setError("Set Publish Destination in Company Data first");
      setStatusMessage("Set Publish Destination in Company Data first");
      return;
    }

    const successJobs = jobsRef.current.filter(
      (job) => job.status === "done" && job.markdown
    );
    if (successJobs.length === 0) {
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
        pillarKeyword: pillar?.pillarKeyword || "",
        supportingKeyword: "",
        articles: successJobs.map((job) => {
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
        successJobs.map((job) => ({
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
          "Publish did not complete. See committed, skipped, and errors below."
        );
        setStatusMessage(
          "Publish did not complete. See committed, skipped, and errors below."
        );
        return;
      }

      const primaryJob = successJobs[0];
      const nextPillars = await markPillarArticlePublished({
        companyId,
        pillarSlug: pillar?.pillarSlug,
        pillarKeyword: pillar?.pillarKeyword,
        article: {
          title: primaryJob?.frontmatter?.title || primaryJob?.title,
          targetKeyword:
            plannedRef.current[primaryJob?.index]?.targetKeyword ||
            primaryJob?.frontmatter?.targetKeyword,
          slug: primaryJob?.frontmatter?.slug,
        },
        publishedUrl: result.pullRequestUrl || "",
      });
      if (!stillCurrent(token)) return;
      setPillars(nextPillars);
      if (contextRef.current) {
        contextRef.current = {
          ...contextRef.current,
          pillars: nextPillars,
        };
      }

      setFinishNote(
        `Published ${committedCount} file${committedCount === 1 ? "" : "s"} to ${destination.owner}/${destination.repo}${skippedCount ? `, ${skippedCount} skipped` : ""}. Pillar “${pillar?.pillarKeyword}” is now marked published.`
      );
      setPhase("done");
      setStatusMessage(
        `Published to ${destination.owner}/${destination.repo}. ${committedCount} file${committedCount === 1 ? "" : "s"} committed${skippedCount ? `, ${skippedCount} skipped` : ""}.`
      );
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
  }, [companyId, publishDestination]);

  const startFlow = async (pillar) => {
    if (!companyId || busy || !pillar) return;
    if (pillarArticleStatus(pillar.pillarArticle) === "published") return;

    const token = ++runTokenRef.current;
    resetRunState();
    setCurrentStage("pillar");
    setViewingStage("pillar");
    setPhase("selecting");
    setStatusMessage(`Selected pillar “${pillar.keyword}”. Planning…`);

    try {
      const ctx = await refreshContext();
      if (!stillCurrent(token)) return;
      const fresh =
        (ctx?.pillars || []).find((item) =>
          matchesPillar(item, pillar.slug, pillar.keyword)
        ) || pillar;
      if (pillarArticleStatus(fresh.pillarArticle) === "published") {
        setPhase("error");
        setError(
          `“${fresh.keyword}” already has a published pillar article.`
        );
        return;
      }

      const next = {
        pillarKeyword: String(fresh.keyword || "").trim(),
        pillarSlug: fresh.slug,
        pillar: fresh,
      };
      pickedRef.current = next;
      setPicked(next);
      await runTopicGeneration(token);
    } catch (err) {
      if (!stillCurrent(token)) return;
      setPhase("error");
      setError(err?.message || "Failed to start Pillar Generation");
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

  const progressPct =
    jobs.length > 0 ? Math.round((currentStep / jobs.length) * 100) : 0;
  const currentJob =
    phase === "generating" && currentStep > 0
      ? jobs.find((job) => job.status === "running") ||
        jobs[Math.min(currentStep - 1, jobs.length - 1)]
      : null;

  const reached = {
    pillar: pillars.length > 0 || phase === "selecting" || Boolean(picked),
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

  const runnablePillars = pillars.filter(
    (pillar) =>
      String(pillar?.keyword || "").trim() &&
      pillarArticleStatus(pillar.pillarArticle) !== "published"
  );

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xs text-foreground mb-1">Pillar Generation</h1>
        <p className="text-sm text-muted-foreground">
          One pillar article per run: pick a pillar keyword, plan the
          comprehensive pillar article, generate it with a hero image, then
          publish to the destination site. Confirm or Decline at plan and
          publish; the countdown auto-confirms after 10 seconds.
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

      {viewingStage === "pillar" && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">
            Pillar Selection
          </h2>
          {companyName ? (
            <p className="text-sm text-muted-foreground">{companyName}</p>
          ) : null}
          {contextLoading && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pillars from Company Data…
            </div>
          )}
          {!contextLoading && pillars.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No pillars found. Add pillar keywords in Company Data, then open
              Cluster Generation once so coverage is initialized.
            </p>
          )}
          {!contextLoading && pillars.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pillars.map((pillar) => {
                const keyword = String(pillar?.keyword || "").trim();
                if (!keyword) return null;
                const published =
                  pillarArticleStatus(pillar.pillarArticle) === "published";
                const selected =
                  picked?.pillarSlug === pillar.slug ||
                  picked?.pillarKeyword === keyword;
                return (
                  <Button
                    key={pillar.slug || keyword}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    disabled={published || busy || !companyId}
                    onClick={() => startFlow(pillar)}
                  >
                    {published && <Check className="h-3.5 w-3.5 mr-1.5" />}
                    {keyword}
                    {published ? " · Published" : ""}
                  </Button>
                );
              })}
            </div>
          )}
          {!contextLoading &&
            pillars.length > 0 &&
            runnablePillars.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Every pillar already has a published pillar article.
              </p>
            )}
          {picked && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Pillar </span>
                <span className="font-medium">{picked.pillarKeyword}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                This run plans the comprehensive pillar article (top of the
                cluster), then generates it with a hero image and publishes.
              </p>
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
                    ? "Saving planned pillar article…"
                    : `Planning pillar article for “${picked?.pillarKeyword || "pillar"}”…`}
                </span>
              </div>
              <Progress value={phase === "persisting" ? 90 : 40} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                Same Plan Cluster call, seeded on the pillar
                keyword for the comprehensive article only.
              </p>
            </div>
          )}
          {proposal && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Pillar </span>
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
                Hero images are on for every article — publish skips any draft
                without one.
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
          {viewingStage === "articles" &&
            publishDestination &&
            !destinationMapped && (
              <p className="text-sm text-muted-foreground">
                Set Publish Destination in Company Data first
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
                  ? "Pillar article published"
                  : "Publish did not complete"
              }
              summary={
                publishResult.ok
                  ? `Generated the comprehensive pillar article for “${
                      picked?.pillarKeyword || "this pillar"
                    }” and published it. Supporting clusters under this pillar can now be generated.`
                  : "The pillar article was generated, but the site commit did not finish. Review the problems below."
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
          {phase === "generate_review" && (
            <ConfirmGate
              key="publish-gate"
              confirmLabel="Publish"
              onConfirm={confirmPublish}
              onDecline={declineFlow}
            />
          )}
        </section>
      )}

      {phase === "idle" && (
        <p className="text-sm text-muted-foreground flex items-start gap-2">
          <Workflow className="h-4 w-4 mt-0.5 shrink-0" />
          Click a pillar keyword to start. Decline stops the run; it does not
          pick another pillar.
        </p>
      )}
    </div>
  );
}
