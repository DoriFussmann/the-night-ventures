import React, { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/lib/supabase";
import {
  parseClusterMarkdown,
  resolveSourceType,
  totalWordCount,
} from "./articleGeneration/parseClusterMarkdown";
import { orderSelectedArticles } from "./articleGeneration/orderSelectedArticles";
import {
  articleFilename,
  downloadMarkdownFile,
  serializeArticleMarkdown,
} from "./articleGeneration/serializeArticleMarkdown";
import { downloadArticlesZip } from "./articleGeneration/downloadZip";
import { updateCoverageDrafted } from "./articleGeneration/updateCoverageDrafted";
import { saveGeneratedArticles } from "./articleGeneration/saveGeneratedArticles";

const TYPE_COLORS = {
  comprehensive: "bg-violet-50 text-violet-700 border-violet-200",
  howto: "bg-blue-50 text-blue-700 border-blue-200",
  comparison: "bg-amber-50 text-amber-800 border-amber-200",
  faq: "bg-teal-50 text-teal-700 border-teal-200",
  flex: "bg-slate-100 text-slate-600 border-slate-200",
};

const TYPE_LABELS = {
  comprehensive: "comprehensive",
  howto: "howto",
  comparison: "comparison",
  faq: "faq",
  flex: "flex",
};

const STATUS_COLORS = {
  planned: "bg-sky-50 text-sky-700 border-sky-200",
  drafted: "bg-orange-50 text-orange-700 border-orange-200",
  published: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

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

function StatusBadge({ status }) {
  const key = STATUS_COLORS[status] ? status : "planned";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[key]}`}
    >
      {key}
    </span>
  );
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

function normalizeCompetitors(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      name: String(item.name || "").trim(),
      url: String(item.url || "").trim(),
    }))
    .filter((item) => item.name || item.url);
}

async function loadCompanyPositioning(companyId) {
  const { data, error } = await supabase
    .from("company_profiles")
    .select("abstract, short_description, competitors")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load company profile");
  }

  return {
    abstract: data?.abstract || "",
    shortDescription: data?.short_description || "",
    competitors: normalizeCompetitors(data?.competitors),
  };
}

async function generateOneArticle({
  positioning,
  article,
  pillarKeyword,
  supportingKeyword,
  batchContext,
}) {
  const res = await fetch("/api/generate-article", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      abstract: positioning.abstract,
      shortDescription: positioning.shortDescription,
      competitors: positioning.competitors,
      pillarKeyword,
      supportingKeyword: supportingKeyword || undefined,
      batchContext,
      article: {
        title: article.title,
        targetKeyword: article.targetKeyword,
        type: article.type,
        searchIntent: article.searchIntent,
        wordCount: article.wordCount,
        ctaAngle: article.ctaAngle,
        keyMessages: article.keyMessages,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(data.validationErrors)
      ? data.validationErrors.join("; ")
      : "";
    const message = data.error || `Generation failed (${res.status})`;
    const err = new Error(details ? `${message}: ${details}` : message);
    err.validationErrors = data.validationErrors || [];
    throw err;
  }

  return data;
}

function buildBatchContextEntry(frontmatter, article) {
  return {
    title: frontmatter.title || article.title || "",
    slug: frontmatter.slug || "",
    type: article.type || "",
    targetKeyword: article.targetKeyword || "",
    oneLinerSummary: frontmatter.description || "",
  };
}

function initJobRows(ordered) {
  return ordered.map(({ index, article }) => ({
    index,
    title: article.title || "(untitled)",
    type: article.type,
    status: "pending",
    error: null,
    validationErrors: [],
    frontmatter: null,
    body: null,
    markdown: null,
    lengthAdjusted: false,
    whereThingsStandSources: [],
  }));
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      url: String(item.url || "").trim(),
      note: String(item.note || "").trim(),
    }))
    .filter((item) => item.url || item.note);
}

function formatSourcesForCopy(sources) {
  return normalizeSources(sources)
    .map((source) => {
      const note = source.note || "Source";
      return source.url ? `${note}: ${source.url}` : note;
    })
    .join("\n");
}

function bodyForReader(body) {
  return String(body || "")
    .replace(/<!--\s*WHERE-THINGS-STAND:START\s*-->\s*/gi, "")
    .replace(/<!--\s*WHERE-THINGS-STAND:END\s*-->\s*/gi, "")
    .trim();
}

const readerMarkdownComponents = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold tracking-tight text-foreground mt-2 mb-4">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold tracking-tight text-foreground mt-9 mb-3 pb-2 border-b border-border/60">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-medium text-foreground mt-6 mb-2">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-[15px] leading-[1.75] text-foreground/90">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 ml-5 list-disc space-y-1.5 text-[15px] leading-[1.7] text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-5 list-decimal space-y-1.5 text-[15px] leading-[1.7] text-foreground/90">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="underline underline-offset-2 text-foreground hover:text-foreground/80"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-8 border-border" />,
};

export default function ArticleGeneration() {
  const { companyId } = useParams();
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [detailIndex, setDetailIndex] = useState(null);

  const [phase, setPhase] = useState("intake"); // intake | generating | summary
  const [jobs, setJobs] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [batchContext, setBatchContext] = useState([]);
  const [coverageWarning, setCoverageWarning] = useState(null);
  const [runError, setRunError] = useState(null);
  const [retryingIndex, setRetryingIndex] = useState(null);
  const [readerIndex, setReaderIndex] = useState(null);
  const [deleteIndex, setDeleteIndex] = useState(null);
  const [savedIndexes, setSavedIndexes] = useState(() => new Set());
  const [savingIndexes, setSavingIndexes] = useState(() => new Set());
  const [savingAll, setSavingAll] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [sourcesCopied, setSourcesCopied] = useState(false);

  const clearSaveState = () => {
    setSavedIndexes(new Set());
    setSavingIndexes(new Set());
    setSavingAll(false);
    setSaveError(null);
  };

  const resetIntake = () => {
    setParsed(null);
    setSelected(new Set());
    setDetailIndex(null);
    setParseError(null);
    setFileName("");
    setPhase("intake");
    setJobs([]);
    setCurrentStep(0);
    setBatchContext([]);
    setCoverageWarning(null);
    setRunError(null);
    setRetryingIndex(null);
    setReaderIndex(null);
    setDeleteIndex(null);
    clearSaveState();
  };

  const applyParsed = (result, name) => {
    const indices = new Set(result.articles.map((_, i) => i));
    setParsed(result);
    setSelected(indices);
    setDetailIndex(null);
    setParseError(null);
    setFileName(name || "");
    setPhase("intake");
    setJobs([]);
    setCurrentStep(0);
    setBatchContext([]);
    setCoverageWarning(null);
    setRunError(null);
    setRetryingIndex(null);
    setReaderIndex(null);
    setDeleteIndex(null);
    clearSaveState();
  };

  const handleFile = async (file) => {
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (
      !lower.endsWith(".md") &&
      !lower.endsWith(".markdown") &&
      file.type !== "text/markdown"
    ) {
      setParseError("Please drop a single .md markdown file.");
      setParsed(null);
      setSelected(new Set());
      setFileName("");
      return;
    }

    try {
      const text = await file.text();
      const result = parseClusterMarkdown(text);
      applyParsed(result, file.name);
    } catch (err) {
      setParsed(null);
      setSelected(new Set());
      setDetailIndex(null);
      setFileName(file.name || "");
      setParseError(err?.message || "Failed to parse this file.");
    }
  };

  const processFileList = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (files.length > 1) {
      setParseError("Only one .md file can be loaded at a time.");
      return;
    }
    handleFile(files[0]);
  };

  const toggleSelected = (index, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const selectAll = () => {
    if (!parsed) return;
    setSelected(new Set(parsed.articles.map((_, i) => i)));
  };

  const selectNone = () => setSelected(new Set());

  const detailArticle =
    parsed && detailIndex != null ? parsed.articles[detailIndex] : null;

  const sourceType = parsed
    ? resolveSourceType(parsed.meta, parsed.articles)
    : null;
  const combinedWords = parsed ? totalWordCount(parsed.articles) : 0;

  const updateJob = (index, patch) => {
    setJobs((prev) =>
      prev.map((job) => (job.index === index ? { ...job, ...patch } : job))
    );
  };

  const persistCoverageForSuccesses = async (successJobs) => {
    if (!companyId || !parsed || successJobs.length === 0) return;

    try {
      const result = await updateCoverageDrafted({
        companyId,
        pillarKeyword: parsed.meta.pillar || "",
        supportingKeyword: parsed.meta.supportingKeyword || "",
        successes: successJobs.map((job) => ({
          targetKeyword: parsed.articles[job.index]?.targetKeyword,
          title: parsed.articles[job.index]?.title,
          frontmatter: job.frontmatter,
        })),
      });
      if (result.warning) setCoverageWarning(result.warning);
      else setCoverageWarning(null);
    } catch (err) {
      setCoverageWarning(
        err?.message || "Coverage store update failed. Downloads are still available."
      );
    }
  };

  const runBatch = async () => {
    if (!parsed || selected.size === 0 || !companyId) return;

    setRunError(null);
    setCoverageWarning(null);

    let positioning;
    try {
      positioning = await loadCompanyPositioning(companyId);
    } catch (err) {
      setRunError(err?.message || "Failed to load company positioning.");
      return;
    }

    const ordered = orderSelectedArticles(parsed.articles, selected);
    const rows = initJobRows(ordered);
    setJobs(rows);
    setPhase("generating");
    setCurrentStep(0);

    const context = [];
    const successAcc = [];

    for (let step = 0; step < ordered.length; step++) {
      const { index, article } = ordered[step];
      setCurrentStep(step + 1);
      updateJob(index, {
        status: "running",
        error: null,
        validationErrors: [],
      });

      try {
        const data = await generateOneArticle({
          positioning,
          article,
          pillarKeyword: parsed.meta.pillar || "",
          supportingKeyword: parsed.meta.supportingKeyword || "",
          batchContext: context,
        });

        const markdown = serializeArticleMarkdown(data.frontmatter, data.body);
        const entry = buildBatchContextEntry(data.frontmatter, article);
        context.push(entry);

        const successJob = {
          index,
          title: article.title || data.frontmatter?.title || "(untitled)",
          type: article.type,
          status: "done",
          error: null,
          validationErrors: [],
          frontmatter: data.frontmatter,
          body: data.body,
          markdown,
          lengthAdjusted: Boolean(data.lengthAdjusted),
          whereThingsStandSources: normalizeSources(
            data.whereThingsStandSources
          ),
        };
        updateJob(index, successJob);
        successAcc.push(successJob);
      } catch (err) {
        updateJob(index, {
          status: "failed",
          error: err?.message || "Generation failed",
          validationErrors: err?.validationErrors || [],
        });
      }
    }

    setBatchContext(context);
    await persistCoverageForSuccesses(successAcc);
    setPhase("summary");
  };

  const retryFailed = async (jobIndex) => {
    if (!parsed || !companyId || retryingIndex != null) return;
    const article = parsed.articles[jobIndex];
    if (!article) return;

    setRetryingIndex(jobIndex);
    setRunError(null);
    updateJob(jobIndex, {
      status: "running",
      error: null,
      validationErrors: [],
    });

    try {
      const positioning = await loadCompanyPositioning(companyId);
      const contextFromDone = jobs
        .filter((j) => j.status === "done" && j.frontmatter)
        .map((j) =>
          buildBatchContextEntry(j.frontmatter, parsed.articles[j.index] || {})
        );

      const data = await generateOneArticle({
        positioning,
        article,
        pillarKeyword: parsed.meta.pillar || "",
        supportingKeyword: parsed.meta.supportingKeyword || "",
        batchContext: contextFromDone,
      });

      const markdown = serializeArticleMarkdown(data.frontmatter, data.body);
      const successJob = {
        index: jobIndex,
        title: article.title || data.frontmatter?.title || "(untitled)",
        type: article.type,
        status: "done",
        error: null,
        validationErrors: [],
        frontmatter: data.frontmatter,
        body: data.body,
        markdown,
        lengthAdjusted: Boolean(data.lengthAdjusted),
        whereThingsStandSources: normalizeSources(
          data.whereThingsStandSources
        ),
      };
      updateJob(jobIndex, successJob);
      setSavedIndexes((prev) => {
        if (!prev.has(jobIndex)) return prev;
        const next = new Set(prev);
        next.delete(jobIndex);
        return next;
      });

      const nextContext = [
        ...contextFromDone,
        buildBatchContextEntry(data.frontmatter, article),
      ];
      setBatchContext(nextContext);
      await persistCoverageForSuccesses([successJob]);
    } catch (err) {
      updateJob(jobIndex, {
        status: "failed",
        error: err?.message || "Generation failed",
        validationErrors: err?.validationErrors || [],
      });
    } finally {
      setRetryingIndex(null);
    }
  };

  const successJobs = jobs.filter((j) => j.status === "done" && j.markdown);
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const progressPct =
    jobs.length > 0 ? Math.round((currentStep / jobs.length) * 100) : 0;
  const currentJob =
    phase === "generating" && currentStep > 0
      ? jobs.find((j) => j.status === "running") ||
        jobs[Math.min(currentStep - 1, jobs.length - 1)]
      : null;

  const backToSelection = () => {
    setPhase("intake");
    setJobs([]);
    setCurrentStep(0);
    setBatchContext([]);
    setCoverageWarning(null);
    setRunError(null);
    setRetryingIndex(null);
    setReaderIndex(null);
    setDeleteIndex(null);
    clearSaveState();
  };

  const jobToSavePayload = (job) => {
    const article = parsed?.articles[job.index] || {};
    return {
      type: job.type || article.type,
      targetKeyword: article.targetKeyword || "",
      frontmatter: job.frontmatter,
      body: job.body,
      whereThingsStandSources: job.whereThingsStandSources,
    };
  };

  const markJobsSaved = (indexes) => {
    setSavedIndexes((prev) => {
      const next = new Set(prev);
      for (const index of indexes) next.add(index);
      return next;
    });
  };

  const saveJobs = async (jobsToSave) => {
    if (!companyId || !parsed || jobsToSave.length === 0) return false;

    setSaveError(null);
    const { error } = await saveGeneratedArticles({
      supabase,
      companyId,
      pillarKeyword: parsed.meta.pillar || "",
      supportingKeyword: parsed.meta.supportingKeyword || "",
      articles: jobsToSave.map(jobToSavePayload),
    });

    if (error) {
      setSaveError(error.message || "Failed to save articles");
      return false;
    }

    markJobsSaved(jobsToSave.map((job) => job.index));
    return true;
  };

  const saveOneArticle = async (job) => {
    if (!job || savingAll || savingIndexes.has(job.index)) return;
    setSavingIndexes((prev) => new Set(prev).add(job.index));
    try {
      await saveJobs([job]);
    } finally {
      setSavingIndexes((prev) => {
        const next = new Set(prev);
        next.delete(job.index);
        return next;
      });
    }
  };

  const saveAllArticles = async () => {
    const unsaved = successJobs.filter((job) => !savedIndexes.has(job.index));
    if (unsaved.length === 0 || savingAll) return;
    setSavingAll(true);
    try {
      await saveJobs(unsaved);
    } finally {
      setSavingAll(false);
    }
  };

  const readerJob =
    readerIndex != null ? jobs.find((j) => j.index === readerIndex) : null;
  const deleteJob =
    deleteIndex != null ? jobs.find((j) => j.index === deleteIndex) : null;

  const confirmDeleteGenerated = () => {
    if (deleteIndex == null) return;
    const job = jobs.find((j) => j.index === deleteIndex);
    const slug = job?.frontmatter?.slug;

    setJobs((prev) => prev.filter((j) => j.index !== deleteIndex));
    if (slug) {
      setBatchContext((prev) => prev.filter((entry) => entry.slug !== slug));
    }
    setSavedIndexes((prev) => {
      if (!prev.has(deleteIndex)) return prev;
      const next = new Set(prev);
      next.delete(deleteIndex);
      return next;
    });
    if (readerIndex === deleteIndex) setReaderIndex(null);
    setDeleteIndex(null);
  };

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-[15px] text-foreground mb-1">Article Generator</h1>
        <p className="text-sm text-muted-foreground">
          Drop a cluster or pillar markdown export to review, select, and generate
          draft articles.
        </p>
      </div>

      {phase === "intake" && (
        <>
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            className={`rounded-lg border border-dashed p-8 text-center transition-colors cursor-pointer ${
              dragOver ? "border-foreground bg-muted/40" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              processFileList(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            {parsed ? (
              <>
                <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-foreground mb-1">
                  Loaded{" "}
                  <span className="font-medium">
                    {fileName || "markdown file"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Drop another .md file or click to replace
                </p>
              </>
            ) : (
              <>
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-foreground mb-1">
                  Drop a cluster or pillar .md file here
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Accepts Topic Generator exports — cluster (3–6 articles) or
                  pillar (1 article)
                </p>
                <span className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm">
                  Choose file
                </span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept=".md,.markdown,text/markdown"
              onChange={(e) => {
                processFileList(e.target.files);
                e.target.value = "";
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {parseError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-medium text-destructive mb-0.5">
                Could not parse file
              </p>
              <p className="text-sm text-destructive/90">{parseError}</p>
              {fileName && (
                <p className="text-xs text-muted-foreground mt-1">
                  File: {fileName}
                </p>
              )}
            </div>
          )}

          {runError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-destructive">{runError}</p>
            </div>
          )}

          {parsed && (
            <>
              <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                  {sourceType}
                </span>
                <div className="min-w-0">
                  <span className="text-muted-foreground">Pillar </span>
                  <span className="font-medium text-foreground break-words">
                    {parsed.meta.pillar || "—"}
                  </span>
                </div>
                {parsed.meta.supportingKeyword && (
                  <div className="min-w-0">
                    <span className="text-muted-foreground">Supporting </span>
                    <span className="font-medium text-foreground break-words">
                      {parsed.meta.supportingKeyword}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Articles </span>
                  <span className="font-medium text-foreground">
                    {parsed.meta.articleCount || parsed.articles.length}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Words </span>
                  <span className="font-medium text-foreground">
                    {formatNumber(combinedWords)}
                  </span>
                </div>
                {parsed.meta.company && (
                  <div className="text-xs text-muted-foreground ml-auto">
                    {parsed.meta.company}
                  </div>
                )}
              </div>

              <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {parsed.articles.map((article, index) => {
                  const isChecked = selected.has(index);
                  return (
                    <li key={`${article.title}-${index}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40 cursor-pointer transition-colors"
                        onClick={() => setDetailIndex(index)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetailIndex(index);
                          }
                        }}
                      >
                        <div
                          className="shrink-0"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) =>
                              toggleSelected(index, checked === true)
                            }
                            aria-label={`Select ${article.title}`}
                          />
                        </div>
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {article.title}
                        </span>
                        <TypeBadge type={article.type} />
                        <span className="shrink-0 tabular-nums text-xs text-muted-foreground w-16 text-right">
                          {formatNumber(article.wordCount)}
                        </span>
                        <StatusBadge status={article.status} />
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={resetIntake}>
                  Clear file
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {(phase === "generating" || phase === "summary") && (
        <div className="space-y-4">
          {phase === "generating" && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  Generating {currentStep} of {jobs.length}
                  {currentJob?.title ? `: ${currentJob.title}` : ""}
                  …
                </span>
              </div>
              <Progress value={progressPct} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                Articles run one at a time. Failures are skipped so the rest of
                the batch can finish.
              </p>
            </div>
          )}

          {phase === "summary" && (
            <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
              <p className="text-sm text-foreground">
                <span className="font-medium">{successJobs.length}</span> succeeded
                <span className="text-muted-foreground"> / </span>
                <span className="font-medium">{failedJobs.length}</span> failed
              </p>
              {coverageWarning && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  {coverageWarning}
                </p>
              )}
              {saveError && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                  {saveError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={successJobs.length === 0}
                  onClick={() =>
                    downloadArticlesZip(
                      successJobs.map((j) => ({
                        frontmatter: j.frontmatter,
                        markdown: j.markdown,
                      })),
                      `${(parsed?.meta?.pillar || "articles")
                        .toLowerCase()
                        .replace(/[^\w]+/g, "-")
                        .replace(/^-|-$/g, "") || "articles"}-drafts.zip`
                    )
                  }
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download All (.zip)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    successJobs.length === 0 ||
                    savingAll ||
                    successJobs.every((j) => savedIndexes.has(j.index))
                  }
                  onClick={saveAllArticles}
                >
                  {savingAll ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Saving…
                    </>
                  ) : successJobs.length > 0 &&
                    successJobs.every((j) => savedIndexes.has(j.index)) ? (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                      All Saved
                    </>
                  ) : (
                    "Save All"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={backToSelection}
                >
                  Back to selection
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetIntake}
                >
                  Clear file
                </Button>
              </div>
            </div>
          )}

          <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {jobs.map((job) => {
              const canOpenReader =
                phase === "summary" && job.status === "done" && job.body;
              return (
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
                    <div
                      className={`min-w-0 flex-1 space-y-1 ${
                        canOpenReader
                          ? "cursor-pointer rounded-md -mx-1 px-1 hover:bg-muted/40 transition-colors"
                          : ""
                      }`}
                      role={canOpenReader ? "button" : undefined}
                      tabIndex={canOpenReader ? 0 : undefined}
                      onClick={() => {
                        if (canOpenReader) setReaderIndex(job.index);
                      }}
                      onKeyDown={(e) => {
                        if (
                          canOpenReader &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          setReaderIndex(job.index);
                        }
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground break-words">
                          {job.frontmatter?.title || job.title}
                        </span>
                        <TypeBadge type={job.type} />
                        {canOpenReader && (
                          <span className="text-[11px] text-muted-foreground">
                            View article
                          </span>
                        )}
                      </div>
                      {job.status === "failed" && job.error && (
                        <p className="text-xs text-destructive break-words">
                          {job.error}
                        </p>
                      )}
                      {job.status === "done" && job.frontmatter?.slug && (
                        <p className="text-xs text-muted-foreground">
                          {articleFilename(job.frontmatter)}
                        </p>
                      )}
                      {job.status === "done" && job.lengthAdjusted && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                          Title/description length was auto-adjusted — give it a
                          quick glance before publishing.
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">
                      {job.status === "done" && job.markdown && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadMarkdownFile(
                              articleFilename(job.frontmatter),
                              job.markdown
                            );
                          }}
                        >
                          Download
                        </Button>
                      )}
                      {phase === "summary" && job.status === "done" && (
                        savedIndexes.has(job.index) ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <Check className="h-3.5 w-3.5" />
                              Saved
                            </span>
                            {job.frontmatter?.slug && (
                              <Link
                                to={`/company/${companyId}/articles?slug=${encodeURIComponent(
                                  job.frontmatter.slug
                                )}`}
                                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View in Articles
                              </Link>
                            )}
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={savingAll || savingIndexes.has(job.index)}
                            onClick={(e) => {
                              e.stopPropagation();
                              saveOneArticle(job);
                            }}
                          >
                            {savingIndexes.has(job.index) ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Saving…
                              </>
                            ) : (
                              "Save"
                            )}
                          </Button>
                        )
                      )}
                      {phase === "summary" && job.status === "done" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteIndex(job.index);
                          }}
                          aria-label={`Delete ${job.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {phase === "summary" && job.status === "failed" && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={retryingIndex != null}
                          onClick={() => retryFailed(job.index)}
                        >
                          {retryingIndex === job.index ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              Retrying…
                            </>
                          ) : (
                            "Retry"
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Plan detail modal (intake) */}
      <Dialog
        open={detailArticle != null}
        onOpenChange={(open) => {
          if (!open) setDetailIndex(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {detailArticle && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 text-base leading-snug">
                  {detailArticle.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <DetailRow
                  label="targetKeyword"
                  value={detailArticle.targetKeyword}
                />
                <DetailRow
                  label="type"
                  value={<TypeBadge type={detailArticle.type} />}
                />
                <DetailRow
                  label="status"
                  value={<StatusBadge status={detailArticle.status} />}
                />
                <DetailRow
                  label="searchIntent"
                  value={detailArticle.searchIntent}
                />
                <DetailRow
                  label="wordCount"
                  value={formatNumber(detailArticle.wordCount)}
                />
                <DetailRow label="ctaAngle" value={detailArticle.ctaAngle} />
                <DetailList
                  label="keyMessages"
                  items={detailArticle.keyMessages}
                />
                <DetailList
                  label="internalLinks"
                  items={detailArticle.internalLinks}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Generated article reader */}
      <Dialog
        open={readerJob != null}
        onOpenChange={(open) => {
          if (!open) {
            setReaderIndex(null);
            setSourcesCopied(false);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
          {readerJob && (
            <>
              <div className="shrink-0 border-b border-border px-6 pt-6 pb-4 pr-14">
                <DialogHeader className="space-y-2 text-left">
                  <DialogTitle className="text-xl leading-snug font-semibold tracking-tight">
                    {readerJob.frontmatter?.title || readerJob.title}
                  </DialogTitle>
                  {readerJob.frontmatter?.description && (
                    <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                      {readerJob.frontmatter.description}
                    </DialogDescription>
                  )}
                </DialogHeader>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <TypeBadge type={readerJob.type} />
                  {readerJob.frontmatter?.slug && (
                    <span className="font-mono">
                      {readerJob.frontmatter.slug}
                    </span>
                  )}
                  {readerJob.frontmatter?.category && (
                    <span>{readerJob.frontmatter.category}</span>
                  )}
                  {readerJob.lengthAdjusted && (
                    <span className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      Length adjusted
                    </span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadMarkdownFile(
                        articleFilename(readerJob.frontmatter),
                        readerJob.markdown
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteIndex(readerJob.index)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6 bg-[linear-gradient(180deg,hsl(var(--muted)/0.35)_0%,transparent_120px)]">
                <article className="mx-auto max-w-2xl">
                  <ReactMarkdown components={readerMarkdownComponents}>
                    {bodyForReader(readerJob.body)}
                  </ReactMarkdown>

                  {Array.isArray(readerJob.frontmatter?.faqs) &&
                    readerJob.frontmatter.faqs.length > 0 && (
                      <section className="mt-10 pt-6 border-t border-border">
                        <h2 className="text-xl font-semibold tracking-tight text-foreground mb-4">
                          FAQs
                        </h2>
                        <div className="space-y-4">
                          {readerJob.frontmatter.faqs.map((faq, i) => (
                            <div key={`reader-faq-${i}`}>
                              <p className="font-medium text-foreground text-[15px]">
                                {faq.question}
                              </p>
                              <p className="mt-1.5 text-[15px] leading-[1.7] text-foreground/90">
                                {faq.answer}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                  {normalizeSources(readerJob.whereThingsStandSources).length >
                    0 && (
                    <section className="mt-10 pt-6 border-t border-border">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <h2 className="text-xl font-semibold tracking-tight text-foreground">
                          Where Things Stand sources
                        </h2>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const text = formatSourcesForCopy(
                              readerJob.whereThingsStandSources
                            );
                            try {
                              await navigator.clipboard.writeText(text);
                              setSourcesCopied(true);
                              setTimeout(() => setSourcesCopied(false), 1500);
                            } catch (err) {
                              console.error("Copy failed:", err);
                            }
                          }}
                        >
                          {sourcesCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mr-1.5" />
                              Copy
                            </>
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Not written into frontmatter — copy for manual
                        externalLinks.
                      </p>
                      <ul className="space-y-2 text-sm">
                        {normalizeSources(
                          readerJob.whereThingsStandSources
                        ).map((source, i) => (
                          <li
                            key={`reader-source-${i}`}
                            className="rounded-md border border-border px-3 py-2"
                          >
                            <p className="font-medium text-foreground">
                              {source.note || "Source"}
                            </p>
                            {source.url ? (
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-0.5 block break-all text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
                              >
                                {source.url}
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </article>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteJob != null}
        onOpenChange={(open) => {
          if (!open) setDeleteIndex(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete generated article?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes “
              {deleteJob?.frontmatter?.title || deleteJob?.title || "this article"}
              ” from the current batch. You can regenerate it later from
              selection. The downloaded file (if any) is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteGenerated}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Selection footer */}
      {phase === "intake" && parsed && (
        <div className="fixed bottom-0 left-52 right-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-3xl px-8 py-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">
              <span className="font-medium">{selected.size}</span>
              <span className="text-muted-foreground"> of </span>
              <span className="font-medium">{parsed.articles.length}</span>
              <span className="text-muted-foreground"> articles selected</span>
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={selectAll}>
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectNone}
              >
                Select none
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={selected.size === 0 || !companyId}
              onClick={runBatch}
            >
              Generate Selected
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </p>
      <div className="text-foreground break-words">
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function DetailList({ label, items }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </p>
      {list.length === 0 ? (
        <p className="text-muted-foreground">—</p>
      ) : (
        <ul className="list-disc pl-5 space-y-1 text-foreground">
          {list.map((item, i) => (
            <li key={`${label}-${i}`} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
