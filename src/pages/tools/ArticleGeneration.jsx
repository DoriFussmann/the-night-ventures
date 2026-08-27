import React, { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  Check,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  GENERATE_ARTICLE_MODEL,
  buildUserPrompt,
} from "../../../lib/generate-article/prompt.js";
import {
  articleFilename,
  downloadMarkdownFile,
  serializeArticleMarkdown,
} from "./articleGeneration/serializeArticleMarkdown";
import { downloadArticlesZip } from "./articleGeneration/downloadZip";
import {
  DEFAULT_PUBLISH_BRANCH,
  formatPublishProgress,
  isPublishDestinationMapped,
  loadCompanyPublishDestination,
  publishArticlesToSite,
} from "./articleGeneration/publishToSite";
import { updateCoverageDrafted } from "./articleGeneration/updateCoverageDrafted";
import { saveGeneratedArticles } from "./articleGeneration/saveGeneratedArticles";
import { finishHeroImage } from "./articleGeneration/heroImageStorage";
import {
  downloadGeneratedImage,
  generateOneImage,
  imageSrcFromResult,
} from "./aiImage/generateImageClient";
import { cropImageTo16x9 } from "./aiImage/cropImage";

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
    .select(
      "abstract, short_description, competitors, target_audience, design_guide_abstract"
    )
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load company profile");
  }

  return {
    abstract: data?.abstract || "",
    shortDescription: data?.short_description || "",
    competitors: normalizeCompetitors(data?.competitors),
    audience: String(data?.target_audience || "").trim(),
    designGuideAbstract: String(data?.design_guide_abstract || "").trim(),
  };
}

/** Descriptive blog-hero scene prompt from generated frontmatter + plan fields. */
function buildArticleImagePrompt(article, frontmatter) {
  const title = String(frontmatter?.title || article?.title || "").trim();
  const description = String(frontmatter?.description || "").trim();
  const type = String(article?.type || "").trim();
  const searchIntent = String(article?.searchIntent || "").trim();

  const typeHint =
    type === "howto"
      ? "practical how-to / process atmosphere"
      : type === "comparison"
        ? "balanced comparison / decision-making atmosphere"
        : type === "faq"
          ? "clarity and answers / approachable guidance atmosphere"
          : type === "comprehensive"
            ? "authoritative overview / landmark resource atmosphere"
            : "editorial thought-leadership atmosphere";

  const parts = [
    "Photorealistic blog hero image, wide landscape composition, no text, no letters, no watermarks, no logos.",
    "No people, no humans, no faces, no figures, no body parts, no silhouettes of people.",
    title ? `Topic: ${title}.` : "",
    description ? `Mood and subject: ${description}` : "",
    searchIntent ? `Reader intent: ${searchIntent}.` : "",
    `Visual tone: ${typeHint}.`,
    "Show a single cohesive scene that evokes the article's subject through environments, objects, materials, or symbolic still life — not a collage or UI mockup.",
  ];

  return parts.filter(Boolean).join(" ");
}

async function generateAndCropArticleImage({
  article,
  frontmatter,
  styleContext,
}) {
  const prompt = buildArticleImagePrompt(article, frontmatter);
  const raw = await generateOneImage({
    prompt,
    size: "1536x1024",
    styleContext: styleContext || "",
  });
  const src = imageSrcFromResult(raw);
  if (!src) {
    throw new Error("No image returned");
  }
  return cropImageTo16x9(src);
}

function skippedImageState() {
  return { status: "skipped", result: null, error: null };
}

function pendingImageState() {
  return { status: "pending", result: null, error: null };
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
      audience: positioning.audience,
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
        expertInput: article.expertInput || "",
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

function initJobRows(ordered, generateImageIndices) {
  const wantImage = generateImageIndices || new Set();
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
    image: wantImage.has(index) ? pendingImageState() : skippedImageState(),
  }));
}

function ImageStatusBadge({ image }) {
  const status = image?.status || "skipped";
  if (status === "done") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        <ImageIcon className="h-3 w-3" />
        Image ready
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <ImageIcon className="h-3 w-3" />
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
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <ImageIcon className="h-3 w-3" />
        Image pending
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      No image
    </span>
  );
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
    <p className="mb-4 text-xs leading-[1.75] text-foreground/90">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 ml-5 list-disc space-y-1.5 text-xs leading-[1.7] text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-5 list-decimal space-y-1.5 text-xs leading-[1.7] text-foreground/90">
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
  const [generateImageIndices, setGenerateImageIndices] = useState(
    () => new Set()
  );
  const [designGuideAbstract, setDesignGuideAbstract] = useState("");
  const [detailIndex, setDetailIndex] = useState(null);

  const [phase, setPhase] = useState("intake"); // intake | generating | summary
  const [jobs, setJobs] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [batchContext, setBatchContext] = useState([]);
  const [coverageWarning, setCoverageWarning] = useState(null);
  const [runError, setRunError] = useState(null);
  const [retryingIndex, setRetryingIndex] = useState(null);
  const [retryingImageIndex, setRetryingImageIndex] = useState(null);
  const [readerIndex, setReaderIndex] = useState(null);
  const [deleteIndex, setDeleteIndex] = useState(null);
  const [savedIndexes, setSavedIndexes] = useState(() => new Set());
  const [savingIndexes, setSavingIndexes] = useState(() => new Set());
  const [savingAll, setSavingAll] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(null);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [publishDestination, setPublishDestination] = useState(null);
  const [sourcesCopied, setSourcesCopied] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState("");
  const [promptEntries, setPromptEntries] = useState([]);
  const [promptEntryIndex, setPromptEntryIndex] = useState(0);
  const [promptCopied, setPromptCopied] = useState(false);

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

  const clearSaveState = () => {
    setSavedIndexes(new Set());
    setSavingIndexes(new Set());
    setSavingAll(false);
    setSaveError(null);
  };

  const clearPublishState = () => {
    setPublishing(false);
    setPublishProgress(null);
    setPublishResult(null);
    setPublishError(null);
  };

  const resetIntake = () => {
    setParsed(null);
    setSelected(new Set());
    setGenerateImageIndices(new Set());
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
    setRetryingImageIndex(null);
    setReaderIndex(null);
    setDeleteIndex(null);
    clearSaveState();
    clearPublishState();
  };

  const applyParsed = (result, name) => {
    const articles = (result.articles || []).map((article) => ({
      ...article,
      expertInput: String(article.expertInput || ""),
    }));
    const next = { ...result, articles };
    const indices = new Set(articles.map((_, i) => i));
    setParsed(next);
    setSelected(indices);
    setGenerateImageIndices(new Set(indices));
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
    setRetryingImageIndex(null);
    setReaderIndex(null);
    setDeleteIndex(null);
    clearSaveState();
    clearPublishState();
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
      setGenerateImageIndices(new Set());
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
      setGenerateImageIndices(new Set());
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
    setGenerateImageIndices((prev) => {
      const next = new Set(prev);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const toggleGenerateImage = (index, checked) => {
    if (!selected.has(index)) return;
    setGenerateImageIndices((prev) => {
      const next = new Set(prev);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const selectAll = () => {
    if (!parsed) return;
    const indices = new Set(parsed.articles.map((_, i) => i));
    setSelected(indices);
    setGenerateImageIndices(new Set(indices));
  };

  const setExpertInput = (index, value) => {
    setParsed((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        articles: prev.articles.map((article, i) =>
          i === index ? { ...article, expertInput: value } : article
        ),
      };
    });
  };

  const copyPromptText = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      setPromptCopied(false);
    }
  };

  const openGeneratePrompt = async () => {
    if (!parsed || !companyId) return;

    setPromptOpen(true);
    setPromptLoading(true);
    setPromptError("");
    setPromptCopied(false);
    setPromptEntries([]);
    setPromptEntryIndex(0);

    try {
      const positioning = await loadCompanyPositioning(companyId);
      const indices =
        selected.size > 0
          ? selected
          : new Set(parsed.articles.map((_, i) => i));
      const ordered = orderSelectedArticles(parsed.articles, indices);
      const entries = ordered.map(({ article }, step) => {
        const batchContext = ordered.slice(0, step).map(({ article: prior }) => ({
          title: prior.title || "",
          slug: "",
          type: prior.type || "",
          targetKeyword: prior.targetKeyword || "",
          oneLinerSummary:
            "(sibling summary is filled after that article is generated)",
        }));
        return {
          title: article.title || "(untitled)",
          prompt: buildUserPrompt({
            abstract: positioning.abstract,
            shortDescription: positioning.shortDescription,
            competitors: positioning.competitors,
            audience: positioning.audience,
            article,
            pillarKeyword: parsed.meta.pillar || "",
            supportingKeyword: parsed.meta.supportingKeyword || "",
            batchContext,
          }),
        };
      });
      if (!entries.length) {
        throw new Error("No articles to preview.");
      }
      setPromptEntries(entries);
    } catch (err) {
      setPromptError(err?.message || "Failed to build prompt preview.");
    } finally {
      setPromptLoading(false);
    }
  };

  const selectNone = () => {
    setSelected(new Set());
    setGenerateImageIndices(new Set());
  };

  const detailArticle =
    parsed && detailIndex != null ? parsed.articles[detailIndex] : null;

  const sourceType = parsed ? resolveSourceType(parsed.meta) : null;
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
      setDesignGuideAbstract(positioning.designGuideAbstract || "");
    } catch (err) {
      setRunError(err?.message || "Failed to load company positioning.");
      return;
    }

    const styleContext = positioning.designGuideAbstract || "";
    const ordered = orderSelectedArticles(parsed.articles, selected);
    const rows = initJobRows(ordered, generateImageIndices);
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

        let image = generateImageIndices.has(index)
          ? pendingImageState()
          : skippedImageState();

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
          image,
        };
        updateJob(index, successJob);
        successAcc.push(successJob);

        if (generateImageIndices.has(index)) {
          updateJob(index, {
            image: { status: "running", result: null, error: null },
          });
          try {
            const cropped = await generateAndCropArticleImage({
              article,
              frontmatter: data.frontmatter,
              styleContext,
            });
            image = await finishHeroImage({
              companyId,
              slug: String(data.frontmatter?.slug || "").trim(),
              cropped,
            });
          } catch (imgErr) {
            image = {
              status: "failed",
              result: null,
              error: imgErr?.message || "Image generation failed",
            };
          }
          updateJob(index, { image });
          successAcc[successAcc.length - 1] = {
            ...successAcc[successAcc.length - 1],
            image,
          };
        }
      } catch (err) {
        updateJob(index, {
          status: "failed",
          error: err?.message || "Generation failed",
          validationErrors: err?.validationErrors || [],
          image: skippedImageState(),
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
      setDesignGuideAbstract(positioning.designGuideAbstract || "");
      const styleContext = positioning.designGuideAbstract || "";
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
      let image = generateImageIndices.has(jobIndex)
        ? pendingImageState()
        : skippedImageState();

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
        image,
      };
      updateJob(jobIndex, successJob);
      setSavedIndexes((prev) => {
        if (!prev.has(jobIndex)) return prev;
        const next = new Set(prev);
        next.delete(jobIndex);
        return next;
      });

      if (generateImageIndices.has(jobIndex)) {
        updateJob(jobIndex, {
          image: { status: "running", result: null, error: null },
        });
        try {
          const cropped = await generateAndCropArticleImage({
            article,
            frontmatter: data.frontmatter,
            styleContext,
          });
          image = await finishHeroImage({
            companyId,
            slug: String(data.frontmatter?.slug || "").trim(),
            cropped,
          });
        } catch (imgErr) {
          image = {
            status: "failed",
            result: null,
            error: imgErr?.message || "Image generation failed",
          };
        }
        updateJob(jobIndex, { image });
        successJob.image = image;
      }

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
        image: skippedImageState(),
      });
    } finally {
      setRetryingIndex(null);
    }
  };

  const retryImage = async (jobIndex) => {
    if (!parsed || !companyId || retryingImageIndex != null) return;
    const job = jobs.find((j) => j.index === jobIndex);
    const article = parsed.articles[jobIndex];
    if (!job?.frontmatter || !article || job.status !== "done") return;

    setRetryingImageIndex(jobIndex);
    updateJob(jobIndex, {
      image: { status: "running", result: null, error: null },
    });

    try {
      let styleContext = designGuideAbstract;
      if (!styleContext) {
        const positioning = await loadCompanyPositioning(companyId);
        styleContext = positioning.designGuideAbstract || "";
        setDesignGuideAbstract(styleContext);
      }

      const cropped = await generateAndCropArticleImage({
        article,
        frontmatter: job.frontmatter,
        styleContext,
      });
      updateJob(jobIndex, {
        image: await finishHeroImage({
          companyId,
          slug: String(job.frontmatter?.slug || "").trim(),
          cropped,
        }),
      });
    } catch (err) {
      updateJob(jobIndex, {
        image: {
          status: "failed",
          result: null,
          error: err?.message || "Image generation failed",
        },
      });
    } finally {
      setRetryingImageIndex(null);
    }
  };

  const successJobs = jobs.filter((j) => j.status === "done" && j.markdown);
  const failedJobs = jobs.filter((j) => j.status === "failed");
  const destinationMapped = isPublishDestinationMapped(publishDestination);
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
    setRetryingImageIndex(null);
    setReaderIndex(null);
    setDeleteIndex(null);
    clearSaveState();
    clearPublishState();
  };

  const publishToSite = async () => {
    if (publishing || successJobs.length === 0 || !destinationMapped) return;
    const ok = window.confirm(
      `Publish ${successJobs.length} article(s) to ${publishDestination.owner}/${publishDestination.repo} (${DEFAULT_PUBLISH_BRANCH})? This merges via the GitHub API.`
    );
    if (!ok) return;

    setPublishing(true);
    setPublishProgress(null);
    setPublishError(null);
    setPublishResult(null);
    try {
      const result = await publishArticlesToSite(
        successJobs.map((j) => ({
          frontmatter: j.frontmatter,
          body: j.body,
          markdown: j.markdown,
          heroStoragePath: j.image?.storagePath || null,
          image:
            j.image?.status === "done"
              ? {
                  ...(j.image.result || {}),
                  storagePath: j.image.storagePath || null,
                }
              : null,
        })),
        {
          companyId,
          owner: publishDestination.owner,
          repo: publishDestination.repo,
          tokenKey: publishDestination.tokenKey,
          branch: DEFAULT_PUBLISH_BRANCH,
        },
        {
          onProgress: (progress) => setPublishProgress(progress),
        }
      );
      setPublishResult(result);
    } catch (err) {
      setPublishError(err?.message || "Publish failed");
      if (err?.result) setPublishResult(err.result);
    } finally {
      setPublishing(false);
      setPublishProgress(null);
    }
  };

  const downloadOneArticle = async (job) => {
    if (!job?.markdown) return;
    const mdName = articleFilename(job.frontmatter);
    downloadMarkdownFile(mdName, job.markdown);
    if (job.image?.status === "done" && job.image?.result?.b64_json) {
      const pngLabel = mdName.replace(/\.md$/i, "");
      await downloadGeneratedImage(pngLabel, job.image.result);
    }
  };

  const jobToSavePayload = (job) => {
    const article = parsed?.articles[job.index] || {};
    return {
      type: job.type || article.type,
      targetKeyword: article.targetKeyword || "",
      frontmatter: job.frontmatter,
      body: job.body,
      whereThingsStandSources: job.whereThingsStandSources,
      heroStoragePath: job.image?.storagePath || null,
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
        <h1 className="text-xs text-foreground mb-1">Article Generator</h1>
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
                  Accepts Topic Generator exports — cluster (types and count as
                  configured) or pillar (1 article)
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

              <ul className="space-y-3">
                {parsed.articles.map((article, index) => {
                  const isChecked = selected.has(index);
                  const wantImage = generateImageIndices.has(index);
                  const keyMessages = Array.isArray(article.keyMessages)
                    ? article.keyMessages
                    : [];
                  return (
                    <li
                      key={`${article.title}-${index}`}
                      className="rounded-lg border border-border bg-card px-4 py-3 space-y-3"
                    >
                      <div className="flex items-start gap-3">
                        <div className="pt-0.5 shrink-0">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) =>
                              toggleSelected(index, checked === true)
                            }
                            aria-label={`Select ${article.title}`}
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-start gap-2">
                            <h3 className="text-sm font-medium text-foreground leading-snug min-w-0 flex-1">
                              {article.title}
                            </h3>
                            <TypeBadge type={article.type} />
                            <label
                              className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] ${
                                isChecked
                                  ? "text-muted-foreground cursor-pointer"
                                  : "text-muted-foreground/40 cursor-not-allowed"
                              }`}
                            >
                              <Checkbox
                                checked={wantImage}
                                disabled={!isChecked}
                                onCheckedChange={(checked) =>
                                  toggleGenerateImage(index, checked === true)
                                }
                                aria-label={`Generate image for ${article.title}`}
                              />
                              Generate Image
                            </label>
                          </div>

                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                              Key messages
                            </p>
                            {keyMessages.length > 0 ? (
                              <ul className="list-disc pl-4 space-y-1 text-sm text-foreground">
                                {keyMessages.map((msg, i) => (
                                  <li key={i}>{msg}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-muted-foreground">—</p>
                            )}
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor={`expert-input-${index}`}>
                              Expert Input
                            </Label>
                            <Textarea
                              id={`expert-input-${index}`}
                              value={article.expertInput || ""}
                              onChange={(e) =>
                                setExpertInput(index, e.target.value)
                              }
                              placeholder="Add your own view on this article…"
                              rows={3}
                            />
                          </div>

                          <button
                            type="button"
                            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            onClick={() => setDetailIndex(index)}
                          >
                            View details
                          </button>
                        </div>
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
                Articles run one at a time
                {generateImageIndices.size > 0
                  ? ", with hero images generated sequentially after each successful draft"
                  : ""}
                . Failures are skipped so the rest of the batch can finish.
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
                        image:
                          j.image?.status === "done" && j.image?.result?.b64_json
                            ? j.image.result
                            : null,
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
                  size="sm"
                  variant="secondary"
                  disabled={
                    successJobs.length === 0 ||
                    publishing ||
                    !destinationMapped
                  }
                  onClick={publishToSite}
                >
                  {publishing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      {formatPublishProgress(publishProgress)}
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Publish to Site
                    </>
                  )}
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
              {publishing && publishProgress && (
                <p className="text-sm text-muted-foreground">
                  {publishProgress.phase === "merge"
                    ? "Merging publish branch…"
                    : `Committing ${publishProgress.current}/${publishProgress.total}${
                        publishProgress.filename
                          ? `: ${publishProgress.filename}`
                          : ""
                      }`}
                </p>
              )}
              {publishError && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                  {publishError}
                </p>
              )}
              {publishDestination && !destinationMapped && (
                <p className="text-sm text-muted-foreground">
                  No destination repo set for this company.
                </p>
              )}
              {publishResult && (
                <div
                  className={`text-sm rounded-md px-3 py-2 space-y-1.5 ${
                    publishResult.ok
                      ? "text-emerald-800 bg-emerald-50 border border-emerald-200"
                      : "text-amber-800 bg-amber-50 border border-amber-200"
                  }`}
                >
                  <p className="font-medium">
                    {publishResult.ok
                      ? "Published to site"
                      : "Publish did not complete"}
                  </p>
                  {publishResult.branch && (
                    <p>
                      Branch:{" "}
                      <span className="font-mono">{publishResult.branch}</span>
                    </p>
                  )}
                  {publishResult.mergeCommitSha && (
                    <p>
                      Merge SHA:{" "}
                      <span className="font-mono break-all">
                        {publishResult.mergeCommitSha}
                      </span>
                    </p>
                  )}
                  {publishResult.pullRequestUrl && (
                    <p>
                      Pull request:{" "}
                      <a
                        href={publishResult.pullRequestUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {publishResult.pullRequestUrl}
                      </a>
                    </p>
                  )}
                  {Array.isArray(publishResult.committed) &&
                    publishResult.committed.length > 0 && (
                      <div>
                        <p className="font-medium">Committed files</p>
                        <ul className="list-disc pl-5 font-mono text-xs">
                          {publishResult.committed.map((file) => (
                            <li key={file.path || file.filename}>
                              {file.path || file.filename}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {Array.isArray(publishResult.skipped) &&
                    publishResult.skipped.length > 0 && (
                      <div>
                        <p className="font-medium">Skipped</p>
                        <ul className="list-disc pl-5 text-xs">
                          {publishResult.skipped.map((item, i) => (
                            <li key={`${item.filename || "skipped"}-${i}`}>
                              {item.filename ? `${item.filename}: ` : ""}
                              {item.message || item.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {Array.isArray(publishResult.errors) &&
                    publishResult.errors.length > 0 && (
                      <div>
                        <p className="font-medium">Errors</p>
                        <ul className="list-disc pl-5 text-xs">
                          {publishResult.errors.map((item, i) => (
                            <li key={`${item.filename || "error"}-${i}`}>
                              {item.filename ? `${item.filename}: ` : ""}
                              {item.message || String(item)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}
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
                        {(phase === "summary" ||
                          job.image?.status === "running" ||
                          job.image?.status === "done" ||
                          job.image?.status === "failed") && (
                          <ImageStatusBadge image={job.image} />
                        )}
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
                      {job.image?.status === "failed" && job.image?.error && (
                        <p className="text-xs text-destructive break-words">
                          Image: {job.image.error}
                        </p>
                      )}
                      {job.status === "done" && job.frontmatter?.slug && (
                        <p className="text-xs text-muted-foreground">
                          {articleFilename(job.frontmatter)}
                          {job.image?.status === "done"
                            ? ` · ${articleFilename(job.frontmatter).replace(/\.md$/i, ".png")}`
                            : ""}
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
                            downloadOneArticle(job);
                          }}
                        >
                          Download
                        </Button>
                      )}
                      {phase === "summary" &&
                        job.status === "done" &&
                        job.image?.status === "done" &&
                        job.image?.result?.b64_json && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              const base = articleFilename(job.frontmatter).replace(
                                /\.md$/i,
                                ""
                              );
                              downloadGeneratedImage(base, job.image.result);
                            }}
                          >
                            <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
                            Image
                          </Button>
                        )}
                      {phase === "summary" &&
                        job.status === "done" &&
                        job.image?.status === "failed" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={retryingImageIndex != null}
                            onClick={(e) => {
                              e.stopPropagation();
                              retryImage(job.index);
                            }}
                          >
                            {retryingImageIndex === job.index ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                Retrying image…
                              </>
                            ) : (
                              "Retry image"
                            )}
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
                              <p className="font-medium text-foreground text-xs">
                                {faq.question}
                              </p>
                              <p className="mt-1.5 text-xs leading-[1.7] text-foreground/90">
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

      <Dialog
        open={promptOpen}
        onOpenChange={(open) => {
          setPromptOpen(open);
          if (!open) {
            setPromptCopied(false);
            setPromptError("");
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 pr-12">
            <DialogTitle>Article generation prompt</DialogTitle>
            <DialogDescription>
              This is the full user prompt sent to {GENERATE_ARTICLE_MODEL}{" "}
              with web search. Company Data, the plan .md fields, and Expert
              Input are already filled in. Later articles in a batch receive
              sibling summaries only after those drafts exist — this preview
              uses a placeholder for that slot.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6 flex-1 min-h-0 flex flex-col gap-3">
            {promptLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading company data and building prompt…
              </div>
            )}
            {promptError && (
              <p className="text-sm text-destructive">{promptError}</p>
            )}
            {!promptLoading && !promptError && promptEntries.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {promptEntries.length > 1 && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 flex-1">
                      <span className="shrink-0">Article</span>
                      <select
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                        value={promptEntryIndex}
                        onChange={(e) => {
                          setPromptEntryIndex(Number(e.target.value));
                          setPromptCopied(false);
                        }}
                      >
                        {promptEntries.map((entry, i) => (
                          <option key={`${entry.title}-${i}`} value={i}>
                            {i + 1}. {entry.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {promptEntries.length === 1 && (
                    <p className="text-xs text-muted-foreground min-w-0 flex-1 truncate">
                      {promptEntries[0].title}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto shrink-0"
                    onClick={() =>
                      void copyPromptText(
                        promptEntries[promptEntryIndex]?.prompt || ""
                      )
                    }
                  >
                    {promptCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy prompt
                      </>
                    )}
                  </Button>
                </div>
                <pre className="flex-1 min-h-0 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground">
                  {promptEntries[promptEntryIndex]?.prompt}
                </pre>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={!companyId || promptLoading}
              onClick={() => void openGeneratePrompt()}
            >
              Show Article Generation Prompt
            </Button>
            <Button
              type="button"
              size="sm"
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
