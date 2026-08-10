import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  Circle,
  Download,
  Eye,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseClusterMarkdown } from "./articleGeneration/parseClusterMarkdown";
import { syncGeneratedArticlePublished } from "./articleGeneration/syncGeneratedArticlePublished";

const ARTICLE_TYPES = [
  { value: "comprehensive", label: "Comprehensive" },
  { value: "howto", label: "How-to" },
  { value: "comparison", label: "Comparison" },
  { value: "faq", label: "FAQ" },
  { value: "flex", label: "Flex" },
];

const DEFAULT_ARTICLE_TYPE_COUNTS = {
  comprehensive: 1,
  howto: 1,
  comparison: 1,
  faq: 1,
  flex: 1,
};

const DEFAULT_ARTICLE_TYPE_ENABLED = {
  comprehensive: true,
  howto: true,
  comparison: true,
  faq: true,
  flex: true,
};

/** Build request payload: only enabled types with positive integer counts. */
function buildArticleTypeCountsPayload(enabled, counts) {
  const out = {};
  for (const { value } of ARTICLE_TYPES) {
    if (!enabled?.[value]) continue;
    const n = Number(counts?.[value]);
    if (Number.isInteger(n) && n >= 1) out[value] = n;
  }
  return out;
}

const ARTICLE_STATUSES = ["planned", "drafted", "published"];

const TYPE_LABEL = Object.fromEntries(ARTICLE_TYPES.map((t) => [t.value, t.label]));

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "untitled";
}

function uniqueSlug(base, used) {
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `art_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeFaqs(value) {
  if (!Array.isArray(value)) return undefined;
  const faqs = value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      question: String(item.question || "").trim(),
      answer: String(item.answer || "").trim(),
    }))
    .filter((item) => item.question || item.answer);
  return faqs.length > 0 ? faqs : undefined;
}

/** Optional fields written by Article Generator after a successful draft. */
function extractGeneratedFields(raw) {
  if (!raw || typeof raw !== "object") return {};
  const fields = {};
  if (raw.description != null && String(raw.description).trim()) {
    fields.description = String(raw.description).trim();
  }
  if (raw.slug != null && String(raw.slug).trim()) {
    fields.slug = String(raw.slug).trim();
  }
  if (raw.date != null && String(raw.date).trim()) {
    fields.date = String(raw.date).trim();
  }
  if (raw.updatedDate != null && String(raw.updatedDate).trim()) {
    fields.updatedDate = String(raw.updatedDate).trim();
  }
  if (raw.category != null && String(raw.category).trim()) {
    fields.category = String(raw.category).trim();
  }
  if (Array.isArray(raw.tags) && raw.tags.length > 0) {
    fields.tags = asStringArray(raw.tags);
  }
  if (raw.imageAlt != null && String(raw.imageAlt).trim()) {
    fields.imageAlt = String(raw.imageAlt).trim();
  }
  if (Array.isArray(raw.keywords) && raw.keywords.length > 0) {
    fields.keywords = asStringArray(raw.keywords);
  }
  const faqs = normalizeFaqs(raw.faqs);
  if (faqs) fields.faqs = faqs;
  if (raw.draft != null) fields.draft = Boolean(raw.draft);
  if (raw.author !== undefined) fields.author = raw.author;
  if (Array.isArray(raw.externalLinks)) {
    fields.externalLinks = asStringArray(raw.externalLinks);
  }
  if (raw.image !== undefined) fields.image = raw.image;
  if (raw.image2 !== undefined) fields.image2 = raw.image2;
  if (raw.image3 !== undefined) fields.image3 = raw.image3;
  return fields;
}

function hasGeneratedFrontmatter(article) {
  if (!article || typeof article !== "object") return false;
  return Boolean(
    article.slug ||
      article.description ||
      (Array.isArray(article.tags) && article.tags.length > 0) ||
      (Array.isArray(article.faqs) && article.faqs.length > 0)
  );
}

function normalizeArticle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = ARTICLE_STATUSES.includes(raw.status) ? raw.status : "planned";
  const type = ARTICLE_TYPES.some((t) => t.value === raw.type) ? raw.type : "flex";
  const wordCountRaw = Number(raw.wordCount);
  return {
    id: String(raw.id || newId()),
    title: String(raw.title || "").trim(),
    targetKeyword: String(raw.targetKeyword || "").trim(),
    type,
    status,
    searchIntent: raw.searchIntent ? String(raw.searchIntent).trim() : undefined,
    keyMessages: asStringArray(raw.keyMessages),
    wordCount: Number.isFinite(wordCountRaw) ? wordCountRaw : undefined,
    internalLinks: asStringArray(raw.internalLinks),
    ctaAngle: raw.ctaAngle ? String(raw.ctaAngle).trim() : undefined,
    publishedUrl: raw.publishedUrl ? String(raw.publishedUrl) : undefined,
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    ...extractGeneratedFields(raw),
  };
}

function normalizePillarArticle(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    return ARTICLE_STATUSES.includes(raw) ? { status: raw } : null;
  }
  if (typeof raw !== "object") return null;
  const status = ARTICLE_STATUSES.includes(raw.status) ? raw.status : null;
  if (!status) return null;

  const title = String(raw.title || "").trim();
  const targetKeyword = String(raw.targetKeyword || "").trim();
  const pillarRationale = String(raw.pillarRationale || "").trim();
  const type = ARTICLE_TYPES.some((t) => t.value === raw.type) ? raw.type : undefined;
  const wordCountRaw = Number(raw.wordCount);
  const generated = extractGeneratedFields(raw);
  const base = {
    status,
    publishedUrl: raw.publishedUrl ? String(raw.publishedUrl) : undefined,
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    ...generated,
  };

  if (!title && !targetKeyword) return base;

  return {
    ...base,
    ...(title ? { title } : {}),
    ...(targetKeyword ? { targetKeyword } : {}),
    ...(type ? { type } : {}),
    ...(raw.searchIntent
      ? { searchIntent: String(raw.searchIntent).trim() }
      : {}),
    keyMessages: asStringArray(raw.keyMessages),
    ...(Number.isFinite(wordCountRaw) ? { wordCount: wordCountRaw } : {}),
    internalLinks: asStringArray(raw.internalLinks),
    ...(raw.ctaAngle ? { ctaAngle: String(raw.ctaAngle).trim() } : {}),
    ...(pillarRationale ? { pillarRationale } : {}),
  };
}

function pillarProposalKey(pillarSlug) {
  return `pillar::${pillarSlug}`;
}

function extractCorePillars(coreKeywords) {
  const source = Array.isArray(coreKeywords) ? coreKeywords : [];
  const pillars = [];

  for (const item of source) {
    let keyword = "";
    let supportingRaw = [];

    if (typeof item === "string") {
      keyword = item.trim();
      supportingRaw = [];
    } else if (item && typeof item === "object") {
      keyword = String(item.keyword || "").trim();
      supportingRaw = Array.isArray(item.supporting) ? item.supporting : [];
    }

    if (!keyword) continue;

    const supporting = supportingRaw
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    pillars.push({ keyword, supporting });
  }

  return pillars;
}

function findExistingPillar(existingPillars, keyword) {
  const slug = slugify(keyword);
  const lower = keyword.toLowerCase();
  return (
    existingPillars.find((p) => p.slug === slug) ||
    existingPillars.find((p) => String(p.keyword || "").toLowerCase() === lower) ||
    null
  );
}

function findExistingSupporting(existingSupporting, keyword) {
  const slug = slugify(keyword);
  const lower = keyword.toLowerCase();
  return (
    existingSupporting.find((s) => s.slug === slug) ||
    existingSupporting.find((s) => String(s.keyword || "").toLowerCase() === lower) ||
    null
  );
}

/** Build coverage tree from Company Data, preserving planned articles by keyword/slug. */
function buildCoverageFromCompanyData(coreKeywords, existingPillars = []) {
  const corePillars = extractCorePillars(coreKeywords);
  const usedPillarSlugs = new Set();
  const existing = Array.isArray(existingPillars) ? existingPillars : [];

  return corePillars.map((core) => {
    const prev = findExistingPillar(existing, core.keyword);
    const slug = uniqueSlug(slugify(core.keyword), usedPillarSlugs);
    const prevSupporting = Array.isArray(prev?.supporting) ? prev.supporting : [];
    const usedSupportingSlugs = new Set();

    const supporting = core.supporting.map((keyword) => {
      const prevSup = findExistingSupporting(prevSupporting, keyword);
      const plannedArticles = Array.isArray(prevSup?.plannedArticles)
        ? prevSup.plannedArticles.map(normalizeArticle).filter(Boolean)
        : [];
      const clusterRationale = String(prevSup?.clusterRationale || "").trim();

      return {
        slug: uniqueSlug(slugify(keyword), usedSupportingSlugs),
        keyword,
        plannedArticles,
        ...(clusterRationale ? { clusterRationale } : {}),
      };
    });

    return {
      slug,
      keyword: core.keyword,
      pillarArticle: normalizePillarArticle(prev?.pillarArticle),
      supporting,
    };
  });
}

function coverageChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function pillarArticleStatus(pillarArticle) {
  if (!pillarArticle) return "missing";
  if (typeof pillarArticle === "string") return pillarArticle;
  return pillarArticle.status || "missing";
}

function statusChipClass(status) {
  switch (status) {
    case "published":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "drafted":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "planned":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "missing":
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function statusLabel(status) {
  switch (status) {
    case "published":
      return "Published";
    case "drafted":
      return "Drafted";
    case "planned":
      return "Planned";
    default:
      return "Missing";
  }
}

function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusChipClass(status)}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function TypeBadge({ type }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {TYPE_LABEL[type] || type}
    </span>
  );
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Pillar article: none → planned → drafted → published → none */
function nextPillarStatus(status) {
  if (!status || status === "missing") return "planned";
  if (status === "planned") return "drafted";
  if (status === "drafted") return "published";
  return null;
}

/** Supporting article: planned → drafted → published → planned */
function nextArticleStatus(status) {
  if (status === "planned") return "drafted";
  if (status === "drafted") return "published";
  if (status === "published") return "planned";
  return "planned";
}

function cycleButtonLabel(status) {
  if (!status || status === "missing") return "Mark Planned";
  return statusLabel(status);
}

function StatusCycleButton({ status, onClick, disabled }) {
  const resolved = status && status !== "missing" ? status : "missing";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={`h-7 text-xs shrink-0 ${statusChipClass(resolved)}`}
      onClick={onClick}
      disabled={disabled}
    >
      {cycleButtonLabel(resolved)}
    </Button>
  );
}

function buildContentMapPayload(pillars) {
  return (Array.isArray(pillars) ? pillars : []).map((pillar) => ({
    keyword: pillar.keyword,
    pillarArticle: pillar.pillarArticle
      ? { status: pillarArticleStatus(pillar.pillarArticle) }
      : null,
    supporting: (pillar.supporting || []).map((sup) => ({
      keyword: sup.keyword,
      articles: (sup.plannedArticles || []).map((article) => ({
        title: article.title,
        targetKeyword: article.targetKeyword,
        type: article.type,
        status: article.status,
      })),
    })),
  }));
}

function proposalTypeSummary(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const counts = {};
  for (const article of list) {
    const key = article.type || "flex";
    counts[key] = (counts[key] || 0) + 1;
  }
  const parts = ARTICLE_TYPES.filter((t) => counts[t.value]).map(
    (t) => `${counts[t.value]} ${t.value}`
  );
  const n = list.length;
  return `${n} article${n === 1 ? "" : "s"} proposed: ${parts.join(", ")}`;
}

function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pickMarkdownFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,text/markdown";
    input.onchange = () => {
      resolve(input.files?.[0] || null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function articlesToMarkdownSections(articles) {
  const lines = [];
  const list = Array.isArray(articles) ? articles : [];

  for (const article of list) {
    lines.push(`## ${article.title || "(untitled)"}`, "");
    lines.push(`- **targetKeyword:** ${article.targetKeyword || ""}`);
    lines.push(`- **type:** ${article.type || ""}`);
    lines.push(`- **status:** ${article.status || "planned"}`);
    lines.push(`- **searchIntent:** ${article.searchIntent || ""}`);
    lines.push(`- **wordCount:** ${article.wordCount ?? ""}`);
    lines.push(`- **ctaAngle:** ${article.ctaAngle || ""}`);
    lines.push("- **keyMessages:**");
    const messages = asStringArray(article.keyMessages);
    if (messages.length) {
      for (const msg of messages) lines.push(`  - ${msg}`);
    } else {
      lines.push("  - _(none)_");
    }
    lines.push("- **internalLinks:**");
    const links = asStringArray(article.internalLinks);
    if (links.length) {
      for (const link of links) lines.push(`  - ${link}`);
    } else {
      lines.push("  - _(none)_");
    }
    lines.push("");
  }

  return lines;
}

function clusterToMarkdown({
  companyName,
  pillarKeyword,
  supportingKeyword,
  clusterRationale,
  articles,
}) {
  const generated = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const list = Array.isArray(articles) ? articles : [];
  const lines = [
    `# Article Cluster`,
    "",
    `- **Company:** ${companyName || "(unnamed)"}`,
    `- **Pillar:** ${pillarKeyword}`,
    `- **Supporting keyword:** ${supportingKeyword}`,
    `- **Cluster rationale:** ${clusterRationale || ""}`,
    `- **Generated:** ${generated}`,
    `- **Articles:** ${list.length}`,
    "",
    ...articlesToMarkdownSections(list),
  ];

  return lines.join("\n").trim() + "\n";
}

function pillarArticleToMarkdown({ companyName, pillarKeyword, pillarArticle }) {
  const generated = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const article = pillarArticle && typeof pillarArticle === "object" ? pillarArticle : {};
  const lines = [
    `# Article Cluster`,
    "",
    `- **Company:** ${companyName || "(unnamed)"}`,
    `- **Pillar:** ${pillarKeyword}`,
    `- **Pillar rationale:** ${article.pillarRationale || ""}`,
    `- **Generated:** ${generated}`,
    `- **Articles:** 1`,
    "",
    ...articlesToMarkdownSections([article]),
  ];

  return lines.join("\n").trim() + "\n";
}

function normalizeProposalArticles(articles) {
  if (!Array.isArray(articles)) return [];
  return articles
    .map((raw) => {
      const type = ARTICLE_TYPES.some((t) => t.value === raw?.type)
        ? raw.type
        : "flex";
      const wordCountRaw = Number(raw?.wordCount);
      return {
        id: newId(),
        title: String(raw?.title || "").trim(),
        targetKeyword: String(raw?.targetKeyword || "").trim(),
        type,
        searchIntent: String(raw?.searchIntent || "").trim(),
        keyMessages: asStringArray(raw?.keyMessages),
        wordCount: Number.isFinite(wordCountRaw)
          ? wordCountRaw
          : type === "comprehensive"
            ? 2000
            : 1500,
        internalLinks: asStringArray(raw?.internalLinks),
        ctaAngle: String(raw?.ctaAngle || "").trim(),
      };
    })
    .filter((item) => item.title && item.targetKeyword);
}

export default function ArticleTopicSuggestion() {
  const { companyId } = useParams();

  const [companyName, setCompanyName] = useState("");
  const [abstract, setAbstract] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [pillars, setPillars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const [expandedPillar, setExpandedPillar] = useState(null);
  const [expandedSupporting, setExpandedSupporting] = useState(null);

  const [proposalKey, setProposalKey] = useState(null);
  const [proposalRationale, setProposalRationale] = useState("");
  const [proposalArticles, setProposalArticles] = useState([]);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [steeringNotes, setSteeringNotes] = useState("");
  const [articleTypeCounts, setArticleTypeCounts] = useState({
    ...DEFAULT_ARTICLE_TYPE_COUNTS,
  });
  const [articleTypeEnabled, setArticleTypeEnabled] = useState({
    ...DEFAULT_ARTICLE_TYPE_ENABLED,
  });
  const [expandedProposalId, setExpandedProposalId] = useState(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishContext, setPublishContext] = useState(null);
  const [publishUrl, setPublishUrl] = useState("");
  const [librarySyncWarning, setLibrarySyncWarning] = useState("");
  const [detailArticle, setDetailArticle] = useState(null);
  const [detailCluster, setDetailCluster] = useState(null);

  const persistCoverage = useCallback(
    async (nextPillars) => {
      if (!companyId) return false;
      setSaving(true);
      setError("");

      const payload = {
        company_id: companyId,
        pillars: nextPillars,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("content_coverage")
        .upsert(payload, { onConflict: "company_id" });

      if (upsertError) {
        console.error("Failed to save content coverage:", upsertError);
        setError(upsertError.message || "Failed to save coverage");
        setSaving(false);
        return false;
      }

      setSaving(false);
      setSavedMessage("Saved");
      window.setTimeout(() => setSavedMessage(""), 2500);
      return true;
    },
    [companyId]
  );

  const applyPillars = useCallback(
    async (updater) => {
      let next;
      setPillars((prev) => {
        next = typeof updater === "function" ? updater(prev) : updater;
        return next;
      });
      if (next) {
        await persistCoverage(next);
      }
    },
    [persistCoverage]
  );

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, profileResult, coverageResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "core_keywords, abstract, short_description, competitors, target_audience"
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("content_coverage")
        .select("id, pillars, updated_at")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

    if (companyResult.error) {
      console.error(companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
    } else {
      setCompanyName(companyResult.data?.name || "");
    }

    if (profileResult.error) {
      console.error(profileResult.error);
      setError(profileResult.error.message || "Failed to load company data");
      setPillars([]);
      setLoading(false);
      return;
    }

    setAbstract(profileResult.data?.abstract || "");
    setShortDescription(profileResult.data?.short_description || "");
    setTargetAudience(profileResult.data?.target_audience || "");
    setCompetitors(
      Array.isArray(profileResult.data?.competitors)
        ? profileResult.data.competitors
            .filter((item) => item && typeof item === "object")
            .map((item) => ({
              name: String(item.name || "").trim(),
              url: String(item.url || "").trim(),
            }))
            .filter((item) => item.name || item.url)
        : []
    );

    if (coverageResult.error) {
      console.error(coverageResult.error);
      setError(coverageResult.error.message || "Failed to load content coverage");
      setPillars([]);
      setLoading(false);
      return;
    }

    const existingPillars = Array.isArray(coverageResult.data?.pillars)
      ? coverageResult.data.pillars
      : [];
    const nextPillars = buildCoverageFromCompanyData(
      profileResult.data?.core_keywords,
      existingPillars
    );

    setPillars(nextPillars);

    if (
      nextPillars.length > 0 &&
      (!coverageResult.data || coverageChanged(existingPillars, nextPillars))
    ) {
      const payload = {
        company_id: companyId,
        pillars: nextPillars,
        updated_at: new Date().toISOString(),
      };
      const { error: upsertError } = await supabase
        .from("content_coverage")
        .upsert(payload, { onConflict: "company_id" });
      if (upsertError) {
        console.error("Failed to initialize content coverage:", upsertError);
        setError(upsertError.message || "Failed to initialize coverage");
      }
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const togglePillar = (slug) => {
    setExpandedPillar((prev) => (prev === slug ? null : slug));
    setExpandedSupporting(null);
  };

  const toggleSupporting = (pillarSlug, supportingSlug) => {
    const key = `${pillarSlug}::${supportingSlug}`;
    setExpandedSupporting((prev) => (prev === key ? null : key));
  };

  const clearProposal = () => {
    setProposalKey(null);
    setProposalRationale("");
    setProposalArticles([]);
    setProposalError("");
    setSteeringNotes("");
    setExpandedProposalId(null);
  };

  const requestClusterProposal = async ({
    pillar,
    supporting,
    regenerate = false,
  }) => {
    const key = `${pillar.slug}::${supporting.slug}`;
    setProposalLoading(true);
    setProposalError("");
    setError("");
    setExpandedPillar(pillar.slug);
    setExpandedSupporting(key);
    setProposalKey(key);

    if (!regenerate) {
      setProposalRationale("");
      setProposalArticles([]);
      setSteeringNotes("");
      setExpandedProposalId(null);
    }

    try {
      const typeCounts = buildArticleTypeCountsPayload(
        articleTypeEnabled,
        articleTypeCounts
      );
      if (Object.keys(typeCounts).length === 0) {
        throw new Error("Select at least one article type");
      }

      const body = {
        pillarKeyword: pillar.keyword,
        supportingKeyword: supporting.keyword,
        abstract,
        shortDescription,
        audience: targetAudience.trim(),
        contentMap: buildContentMapPayload(pillars),
        competitors,
        articleTypeCounts: typeCounts,
      };

      if (regenerate) {
        body.steeringNotes = steeringNotes.trim();
        body.previousProposal = {
          clusterRationale: proposalRationale,
          articles: proposalArticles.map(
            ({
              title,
              targetKeyword,
              type,
              searchIntent,
              keyMessages,
              wordCount,
              internalLinks,
              ctaAngle,
            }) => ({
              title,
              targetKeyword,
              type,
              searchIntent,
              keyMessages,
              wordCount,
              internalLinks,
              ctaAngle,
            })
          ),
        };
      }

      const res = await fetch("/api/plan-cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Plan cluster failed (${res.status})`);
      }

      const articles = normalizeProposalArticles(data.articles);
      if (!articles.length) {
        throw new Error("No articles returned in proposal");
      }

      setProposalRationale(String(data.clusterRationale || "").trim());
      setProposalArticles(articles);
      setExpandedProposalId(null);
    } catch (err) {
      console.error("Plan cluster failed:", err);
      setProposalError(err.message || "Failed to plan cluster");
      setProposalArticles([]);
      setProposalRationale("");
    } finally {
      setProposalLoading(false);
    }
  };

  const handlePlanCluster = (pillar, supporting) => {
    if (proposalLoading || saving) return;

    if (supporting.plannedArticles.length > 0) {
      const ok = window.confirm(
        `“${supporting.keyword}” already has ${supporting.plannedArticles.length} planned article${
          supporting.plannedArticles.length === 1 ? "" : "s"
        }. Generate a new AI proposal? Confirming cluster creation later will replace the existing articles.`
      );
      if (!ok) return;
    }

    const key = `${pillar.slug}::${supporting.slug}`;
    setExpandedPillar(pillar.slug);
    setExpandedSupporting(key);
    setProposalKey(key);
    setProposalRationale("");
    setProposalArticles([]);
    setProposalError("");
    setSteeringNotes("");
    setArticleTypeCounts({ ...DEFAULT_ARTICLE_TYPE_COUNTS });
    setArticleTypeEnabled({ ...DEFAULT_ARTICLE_TYPE_ENABLED });
    setExpandedProposalId(null);
  };

  const handleRegenerate = (pillar, supporting) => {
    if (proposalLoading || saving) return;
    void requestClusterProposal({ pillar, supporting, regenerate: true });
  };

  const removeProposalArticle = (articleId) => {
    setProposalArticles((prev) => prev.filter((item) => item.id !== articleId));
    setExpandedProposalId((prev) => (prev === articleId ? null : prev));
  };

  const handleConfirmCluster = async (pillar, supporting) => {
    if (!proposalArticles.length || saving || proposalLoading) return;

    const now = new Date().toISOString();
    const articles = proposalArticles.map((item) => ({
      id: item.id || newId(),
      title: item.title,
      targetKeyword: item.targetKeyword,
      type: item.type,
      status: "planned",
      searchIntent: item.searchIntent || undefined,
      keyMessages: asStringArray(item.keyMessages),
      wordCount: item.wordCount,
      internalLinks: asStringArray(item.internalLinks),
      ctaAngle: item.ctaAngle || undefined,
      updatedAt: now,
    }));

    await applyPillars((prev) =>
      prev.map((p) => {
        if (p.slug !== pillar.slug) return p;
        return {
          ...p,
          supporting: p.supporting.map((sup) => {
            if (sup.slug !== supporting.slug) return sup;
            return {
              ...sup,
              plannedArticles: articles,
              clusterRationale: String(proposalRationale || "").trim(),
            };
          }),
        };
      })
    );

    clearProposal();
    setExpandedPillar(pillar.slug);
    setExpandedSupporting(`${pillar.slug}::${supporting.slug}`);
  };

  const handleDownloadCluster = (pillar, supporting) => {
    const markdown = clusterToMarkdown({
      companyName,
      pillarKeyword: pillar.keyword,
      supportingKeyword: supporting.keyword,
      clusterRationale: supporting.clusterRationale,
      articles: supporting.plannedArticles,
    });
    const filename = `${pillar.slug}--${supporting.slug}-cluster.md`;
    downloadMarkdown(filename, markdown);
  };

  const requestPillarProposal = async ({ pillar, regenerate = false }) => {
    const key = pillarProposalKey(pillar.slug);
    setProposalLoading(true);
    setProposalError("");
    setError("");
    setExpandedPillar(pillar.slug);
    setProposalKey(key);

    if (!regenerate) {
      setProposalRationale("");
      setProposalArticles([]);
      setSteeringNotes("");
      setExpandedProposalId(null);
    }

    try {
      const body = {
        mode: "pillar",
        pillarKeyword: pillar.keyword,
        abstract,
        shortDescription,
        audience: targetAudience.trim(),
        contentMap: buildContentMapPayload(pillars),
        competitors,
      };

      if (regenerate) {
        const previousArticle = proposalArticles[0];
        body.steeringNotes = steeringNotes.trim();
        body.previousProposal = {
          pillarRationale: proposalRationale,
          article: previousArticle
            ? {
                title: previousArticle.title,
                targetKeyword: previousArticle.targetKeyword,
                type: previousArticle.type,
                searchIntent: previousArticle.searchIntent,
                keyMessages: previousArticle.keyMessages,
                wordCount: previousArticle.wordCount,
                internalLinks: previousArticle.internalLinks,
                ctaAngle: previousArticle.ctaAngle,
              }
            : null,
        };
      }

      const res = await fetch("/api/plan-cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Plan pillar article failed (${res.status})`);
      }

      const articles = normalizeProposalArticles(
        data.article ? [data.article] : []
      );
      if (!articles.length) {
        throw new Error("No pillar article returned in proposal");
      }

      setProposalRationale(String(data.pillarRationale || "").trim());
      setProposalArticles(articles);
      setExpandedProposalId(null);
    } catch (err) {
      console.error("Plan pillar article failed:", err);
      setProposalError(err.message || "Failed to plan pillar article");
      setProposalArticles([]);
      setProposalRationale("");
    } finally {
      setProposalLoading(false);
    }
  };

  const handlePlanPillarArticle = (pillar) => {
    if (proposalLoading || saving) return;

    const key = pillarProposalKey(pillar.slug);
    setExpandedPillar(pillar.slug);
    setExpandedSupporting(null);
    setProposalKey(key);
    setProposalRationale("");
    setProposalArticles([]);
    setProposalError("");
    setSteeringNotes("");
    setExpandedProposalId(null);
  };

  const handleRegeneratePillar = (pillar) => {
    if (proposalLoading || saving) return;
    void requestPillarProposal({ pillar, regenerate: true });
  };

  const handleConfirmPillarArticle = async (pillar) => {
    if (!proposalArticles.length || saving || proposalLoading) return;

    const now = new Date().toISOString();
    const article = proposalArticles[0];
    const pillarArticle = {
      status: "planned",
      title: article.title,
      targetKeyword: article.targetKeyword,
      type: article.type || "comprehensive",
      searchIntent: article.searchIntent || undefined,
      keyMessages: asStringArray(article.keyMessages),
      wordCount: article.wordCount,
      internalLinks: asStringArray(article.internalLinks),
      ctaAngle: article.ctaAngle || undefined,
      pillarRationale: String(proposalRationale || "").trim() || undefined,
      updatedAt: now,
    };

    await applyPillars((prev) =>
      prev.map((p) =>
        p.slug === pillar.slug ? { ...p, pillarArticle } : p
      )
    );

    clearProposal();
    setExpandedPillar(pillar.slug);
  };

  const handleDownloadPillarArticle = (pillar) => {
    const markdown = pillarArticleToMarkdown({
      companyName,
      pillarKeyword: pillar.keyword,
      pillarArticle: pillar.pillarArticle,
    });
    const filename = `${pillar.slug}--pillar-article.md`;
    downloadMarkdown(filename, markdown);
  };

  const handleUploadPillarArticle = async (pillar) => {
    if (proposalLoading || saving) return;

    if (pillar.pillarArticle?.title) {
      const ok = window.confirm(
        `“${pillar.keyword}” already has a pillar article. Upload a file to replace it?`
      );
      if (!ok) return;
    }

    const file = await pickMarkdownFile();
    if (!file) return;

    try {
      const text = await file.text();
      const { meta, articles } = parseClusterMarkdown(text);
      if (!articles.length) {
        throw new Error("No articles found in this file.");
      }
      if (articles.length > 1) {
        const ok = window.confirm(
          `This file has ${articles.length} articles. Use the first as the pillar article?`
        );
        if (!ok) return;
      }

      const article = articles[0];
      const now = new Date().toISOString();
      const pillarArticle = {
        status: article.status || "planned",
        title: article.title,
        targetKeyword: article.targetKeyword,
        type: article.type || "comprehensive",
        searchIntent: article.searchIntent || undefined,
        keyMessages: asStringArray(article.keyMessages),
        wordCount: article.wordCount || undefined,
        internalLinks: asStringArray(article.internalLinks),
        ctaAngle: article.ctaAngle || undefined,
        pillarRationale: String(meta.rationale || "").trim() || undefined,
        updatedAt: now,
      };

      clearProposal();
      await applyPillars((prev) =>
        prev.map((p) =>
          p.slug === pillar.slug ? { ...p, pillarArticle } : p
        )
      );
      setExpandedPillar(pillar.slug);
      setExpandedSupporting(null);
    } catch (err) {
      console.error("Upload pillar article failed:", err);
      setError(err?.message || "Failed to upload pillar article");
    }
  };

  const handleUploadCluster = async (pillar, supporting) => {
    if (proposalLoading || saving) return;

    if (supporting.plannedArticles.length > 0) {
      const ok = window.confirm(
        `“${supporting.keyword}” already has ${supporting.plannedArticles.length} planned article${
          supporting.plannedArticles.length === 1 ? "" : "s"
        }. Upload a file to replace them?`
      );
      if (!ok) return;
    }

    const file = await pickMarkdownFile();
    if (!file) return;

    try {
      const text = await file.text();
      const { meta, articles } = parseClusterMarkdown(text);
      if (!articles.length) {
        throw new Error("No articles found in this file.");
      }

      const now = new Date().toISOString();
      const plannedArticles = articles.map((item) => ({
        id: newId(),
        title: item.title,
        targetKeyword: item.targetKeyword,
        type: item.type,
        status: item.status || "planned",
        searchIntent: item.searchIntent || undefined,
        keyMessages: asStringArray(item.keyMessages),
        wordCount: item.wordCount || undefined,
        internalLinks: asStringArray(item.internalLinks),
        ctaAngle: item.ctaAngle || undefined,
        updatedAt: now,
      }));
      const clusterRationale = String(meta.rationale || "").trim();

      clearProposal();
      await applyPillars((prev) =>
        prev.map((p) => {
          if (p.slug !== pillar.slug) return p;
          return {
            ...p,
            supporting: p.supporting.map((sup) => {
              if (sup.slug !== supporting.slug) return sup;
              const { clusterRationale: _prevRationale, ...rest } = sup;
              return {
                ...rest,
                plannedArticles,
                ...(clusterRationale ? { clusterRationale } : {}),
              };
            }),
          };
        })
      );
      setExpandedPillar(pillar.slug);
      setExpandedSupporting(`${pillar.slug}::${supporting.slug}`);
    } catch (err) {
      console.error("Upload cluster failed:", err);
      setError(err?.message || "Failed to upload cluster");
    }
  };

  const handleSaveCoverage = async () => {
    if (saving || !pillars.length) return;
    await persistCoverage(pillars);
  };

  const clearDetailIfMatch = (candidate) => {
    if (!detailArticle || !candidate) return;
    if (candidate.id && detailArticle.id === candidate.id) {
      setDetailArticle(null);
      return;
    }
    if (
      detailArticle.title === candidate.title &&
      detailArticle.targetKeyword === candidate.targetKeyword
    ) {
      setDetailArticle(null);
    }
  };

  const removePillarArticle = (pillar) => {
    if (saving || proposalLoading || !pillar.pillarArticle) return;
    const title = pillar.pillarArticle.title || pillar.keyword;
    const ok = window.confirm(
      `Remove the pillar article “${title}”? This cannot be undone.`
    );
    if (!ok) return;

    clearDetailIfMatch(pillar.pillarArticle);

    if (proposalKey === pillarProposalKey(pillar.slug)) {
      clearProposal();
    }

    void applyPillars((prev) =>
      prev.map((item) =>
        item.slug === pillar.slug ? { ...item, pillarArticle: null } : item
      )
    );
  };

  const removeCluster = (pillar, supporting) => {
    if (saving || proposalLoading || supporting.plannedArticles.length === 0) {
      return;
    }
    const count = supporting.plannedArticles.length;
    const ok = window.confirm(
      `Remove the entire cluster for “${supporting.keyword}” (${count} article${
        count === 1 ? "" : "s"
      })? This cannot be undone.`
    );
    if (!ok) return;

    for (const article of supporting.plannedArticles) {
      clearDetailIfMatch(article);
    }
    if (
      detailCluster &&
      detailCluster.pillarSlug === pillar.slug &&
      detailCluster.supportingSlug === supporting.slug
    ) {
      setDetailCluster(null);
    }

    const detailKey = `${pillar.slug}::${supporting.slug}`;
    if (proposalKey === detailKey) {
      clearProposal();
    }

    void applyPillars((prev) =>
      prev.map((p) => {
        if (p.slug !== pillar.slug) return p;
        return {
          ...p,
          supporting: p.supporting.map((sup) => {
            if (sup.slug !== supporting.slug) return sup;
            const { clusterRationale: _prevRationale, ...rest } = sup;
            return {
              ...rest,
              plannedArticles: [],
            };
          }),
        };
      })
    );
  };

  const removeClusterArticle = (pillarSlug, supportingSlug, article) => {
    if (saving || proposalLoading || !article) return;
    const title = article.title || "(untitled)";
    const ok = window.confirm(
      `Remove “${title}” from this cluster? This cannot be undone.`
    );
    if (!ok) return;

    clearDetailIfMatch(article);

    void applyPillars((prev) =>
      prev.map((pillar) => {
        if (pillar.slug !== pillarSlug) return pillar;
        return {
          ...pillar,
          supporting: pillar.supporting.map((sup) => {
            if (sup.slug !== supportingSlug) return sup;
            const plannedArticles = sup.plannedArticles.filter(
              (item) => item.id !== article.id
            );
            if (plannedArticles.length === 0) {
              const { clusterRationale: _prevRationale, ...rest } = sup;
              return { ...rest, plannedArticles };
            }
            return { ...sup, plannedArticles };
          }),
        };
      })
    );
  };

  const advanceArticleStatus = (pillarSlug, supportingSlug, article) => {
    const next = nextArticleStatus(article.status);

    if (next === "published" && article.status !== "published") {
      setPublishContext({ kind: "article", pillarSlug, supportingSlug, articleId: article.id });
      setPublishUrl(article.publishedUrl || "");
      setPublishOpen(true);
      return;
    }

    const now = new Date().toISOString();
    void applyPillars((prev) =>
      prev.map((pillar) => {
        if (pillar.slug !== pillarSlug) return pillar;
        return {
          ...pillar,
          supporting: pillar.supporting.map((sup) => {
            if (sup.slug !== supportingSlug) return sup;
            return {
              ...sup,
              plannedArticles: sup.plannedArticles.map((item) => {
                if (item.id !== article.id) return item;
                if (next === "planned" && article.status === "published") {
                  return {
                    ...item,
                    status: "planned",
                    publishedUrl: undefined,
                    publishedAt: undefined,
                    updatedAt: now,
                  };
                }
                return { ...item, status: next, updatedAt: now };
              }),
            };
          }),
        };
      })
    );
  };

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!publishContext || saving) return;

    const now = new Date().toISOString();
    const url = publishUrl.trim();

    const pillar = pillars.find(
      (item) => item.slug === publishContext.pillarSlug
    );
    const pillarKeyword = pillar?.keyword || "";
    let supportingKeyword = "";
    let coverageArticle = null;

    if (publishContext.kind === "pillar") {
      coverageArticle =
        pillar?.pillarArticle && typeof pillar.pillarArticle === "object"
          ? pillar.pillarArticle
          : {};
    } else {
      const supporting = (pillar?.supporting || []).find(
        (sup) => sup.slug === publishContext.supportingSlug
      );
      supportingKeyword = supporting?.keyword || "";
      coverageArticle =
        (supporting?.plannedArticles || []).find(
          (item) => item.id === publishContext.articleId
        ) || {};
    }

    if (publishContext.kind === "pillar") {
      await applyPillars((prev) =>
        prev.map((item) => {
          if (item.slug !== publishContext.pillarSlug) return item;
          const existing =
            item.pillarArticle && typeof item.pillarArticle === "object"
              ? item.pillarArticle
              : {};
          return {
            ...item,
            pillarArticle: {
              ...existing,
              status: "published",
              publishedUrl: url || undefined,
              publishedAt: now,
              updatedAt: now,
            },
          };
        })
      );
    } else {
      await applyPillars((prev) =>
        prev.map((item) => {
          if (item.slug !== publishContext.pillarSlug) return item;
          return {
            ...item,
            supporting: item.supporting.map((sup) => {
              if (sup.slug !== publishContext.supportingSlug) return sup;
              return {
                ...sup,
                plannedArticles: sup.plannedArticles.map((article) =>
                  article.id === publishContext.articleId
                    ? {
                        ...article,
                        status: "published",
                        publishedUrl: url || undefined,
                        publishedAt: now,
                        updatedAt: now,
                      }
                    : article
                ),
              };
            }),
          };
        })
      );
    }

    const syncResult = await syncGeneratedArticlePublished({
      companyId,
      pillarKeyword,
      supportingKeyword:
        publishContext.kind === "pillar" ? undefined : supportingKeyword,
      article: {
        slug: coverageArticle?.slug,
        title: coverageArticle?.title,
        targetKeyword: coverageArticle?.targetKeyword,
      },
      publishedUrl: url,
      publishedAt: now,
    });

    if (!syncResult.matched) {
      setLibrarySyncWarning(
        syncResult.warning ||
          "No matching Articles library entry found for this article"
      );
    } else {
      setLibrarySyncWarning("");
    }

    setPublishOpen(false);
    setPublishContext(null);
    setPublishUrl("");
  };

  const advancePillarArticle = (pillar) => {
    const current = pillarArticleStatus(pillar.pillarArticle);
    const next = nextPillarStatus(current);

    if (current === "published") {
      void applyPillars((prev) =>
        prev.map((item) =>
          item.slug === pillar.slug ? { ...item, pillarArticle: null } : item
        )
      );
      return;
    }

    if (next === "published") {
      const existing =
        pillar.pillarArticle && typeof pillar.pillarArticle === "object"
          ? pillar.pillarArticle
          : null;
      setPublishContext({ kind: "pillar", pillarSlug: pillar.slug });
      setPublishUrl(existing?.publishedUrl || "");
      setPublishOpen(true);
      return;
    }

    void applyPillars((prev) =>
      prev.map((item) => {
        if (item.slug !== pillar.slug) return item;
        const existing =
          item.pillarArticle && typeof item.pillarArticle === "object"
            ? item.pillarArticle
            : {};
        return {
          ...item,
          pillarArticle: { ...existing, status: next },
        };
      })
    );
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading topic coverage...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xs text-foreground mb-1">Topic Generation</h1>
          {companyName && (
            <p className="text-sm text-foreground">{companyName}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {savedMessage && (
            <span className="text-xs text-muted-foreground">{savedMessage}</span>
          )}
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
          {pillars.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving || proposalLoading}
              onClick={() => void handleSaveCoverage()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {librarySyncWarning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start justify-between gap-3">
          <p>{librarySyncWarning}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 h-7 px-2"
            onClick={() => setLibrarySyncWarning("")}
          >
            Dismiss
          </Button>
        </div>
      )}

      {pillars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm">
          <Link
            to={`/company/${companyId}/company-data`}
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Company Data
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {pillars.map((pillar) => {
            const isPillarOpen = expandedPillar === pillar.slug;
            const pillarStatus = pillarArticleStatus(pillar.pillarArticle);
            const pillarKey = pillarProposalKey(pillar.slug);
            const showPillarProposal = proposalKey === pillarKey;
            const hasPillarPlan = Boolean(pillar.pillarArticle?.title);
            const supportingTotal = pillar.supporting.length;
            const supportingWithPublished = pillar.supporting.filter((sup) =>
              sup.plannedArticles.some((a) => a.status === "published")
            ).length;
            const coveragePct =
              supportingTotal > 0
                ? Math.round((supportingWithPublished / supportingTotal) * 100)
                : 0;
            const showProgress =
              supportingTotal > 0 &&
              (pillarStatus !== "missing" ||
                pillar.supporting.some((sup) => sup.plannedArticles.length > 0));

            return (
              <div
                key={pillar.slug}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => togglePillar(pillar.slug)}
                    className="flex flex-1 items-center gap-3 min-w-0 text-left hover:opacity-80 transition-opacity"
                  >
                    <span className="text-muted-foreground shrink-0">
                      {isPillarOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground leading-snug">
                          {pillar.keyword}
                        </span>
                        <StatusChip status={pillarStatus} />
                        {showPillarProposal && proposalLoading && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Planning…
                          </span>
                        )}
                      </div>
                      {showProgress && (
                        <Progress value={coveragePct} className="h-1 max-w-xs" />
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {pillarStatus === "missing" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={proposalLoading || saving}
                        onClick={() => handlePlanPillarArticle(pillar)}
                      >
                        {showPillarProposal && proposalLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        Plan
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={proposalLoading || saving}
                      onClick={() => void handleUploadPillarArticle(pillar)}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload
                    </Button>
                  </div>
                </div>

                {isPillarOpen && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-3">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                            Pillar Article
                          </p>
                          {pillarStatus === "published" &&
                            pillar.pillarArticle?.publishedUrl && (
                              <a
                                href={pillar.pillarArticle.publishedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                              >
                                View URL
                              </a>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {hasPillarPlan && !showPillarProposal && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() =>
                                  setDetailArticle(pillar.pillarArticle)
                                }
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View details
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => handleDownloadPillarArticle(pillar)}
                              >
                                <Download className="w-3.5 h-3.5" />
                                Download .md
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                disabled={saving || proposalLoading}
                                onClick={() => removePillarArticle(pillar)}
                                aria-label="Remove pillar article"
                                title="Remove pillar article"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          <StatusCycleButton
                            status={pillarStatus}
                            disabled={saving}
                            onClick={() => advancePillarArticle(pillar)}
                          />
                        </div>
                      </div>

                      {hasPillarPlan &&
                        !showPillarProposal &&
                        pillar.pillarArticle && (
                          <button
                            type="button"
                            className="w-full text-left rounded-md border border-border bg-background hover:bg-muted/40 cursor-pointer px-3 py-2.5"
                            onClick={() =>
                              setDetailArticle(pillar.pillarArticle)
                            }
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm text-foreground font-medium">
                                {pillar.pillarArticle.title || "(untitled)"}
                              </span>
                              {pillar.pillarArticle.type && (
                                <TypeBadge type={pillar.pillarArticle.type} />
                              )}
                              <span className="text-[11px] text-muted-foreground">
                                View details
                              </span>
                            </div>
                            {pillar.pillarArticle.slug && (
                              <p className="text-[11px] text-muted-foreground mt-1">
                                {pillar.pillarArticle.slug}
                              </p>
                            )}
                          </button>
                        )}

                      {showPillarProposal && (
                        <div className="rounded-md border border-border bg-background px-3 py-3 space-y-3">
                          {proposalArticles.length === 0 &&
                            !proposalLoading &&
                            !proposalError && (
                              <Button
                                type="button"
                                size="sm"
                                disabled={saving}
                                onClick={() =>
                                  requestPillarProposal({
                                    pillar,
                                    regenerate: false,
                                  })
                                }
                              >
                                Generate Proposal
                              </Button>
                            )}

                          {proposalLoading && proposalArticles.length === 0 && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Generating pillar article proposal…
                            </div>
                          )}

                          {proposalError && (
                            <p className="text-sm text-destructive">
                              {proposalError}
                            </p>
                          )}

                          {proposalArticles.length > 0 && (
                            <>
                              <div className="space-y-1.5">
                                {proposalRationale && (
                                  <p className="text-sm text-foreground">
                                    {proposalRationale}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  {proposalTypeSummary(proposalArticles)}
                                  {proposalLoading ? " · Regenerating…" : ""}
                                </p>
                              </div>

                              <ul className="space-y-2">
                                {proposalArticles.map((article) => {
                                  const isExpanded =
                                    expandedProposalId === article.id;
                                  return (
                                    <li
                                      key={article.id}
                                      className="rounded-md border border-dashed border-border bg-slate-50/80 px-3 py-2.5"
                                    >
                                      <div className="flex items-start gap-2">
                                        <button
                                          type="button"
                                          className="flex flex-1 items-start gap-2 min-w-0 text-left"
                                          onClick={() =>
                                            setExpandedProposalId((prev) =>
                                              prev === article.id
                                                ? null
                                                : article.id
                                            )
                                          }
                                        >
                                          <span className="mt-0.5 text-muted-foreground shrink-0">
                                            {isExpanded ? (
                                              <ChevronDown className="w-3.5 h-3.5" />
                                            ) : (
                                              <ChevronRight className="w-3.5 h-3.5" />
                                            )}
                                          </span>
                                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                                            <span className="text-sm text-foreground">
                                              {article.title}
                                            </span>
                                            <TypeBadge type={article.type} />
                                          </div>
                                        </button>
                                      </div>

                                      {isExpanded && (
                                        <div className="mt-2 ml-5 space-y-1.5 text-xs text-muted-foreground">
                                          <p>
                                            <span className="font-medium text-foreground/80">
                                              Target keyword:
                                            </span>{" "}
                                            {article.targetKeyword}
                                          </p>
                                          <p>
                                            <span className="font-medium text-foreground/80">
                                              Search intent:
                                            </span>{" "}
                                            {article.searchIntent || "—"}
                                          </p>
                                          <p>
                                            <span className="font-medium text-foreground/80">
                                              Word count:
                                            </span>{" "}
                                            {article.wordCount ?? "—"}
                                          </p>
                                          <p>
                                            <span className="font-medium text-foreground/80">
                                              CTA angle:
                                            </span>{" "}
                                            {article.ctaAngle || "—"}
                                          </p>
                                          <div>
                                            <p className="font-medium text-foreground/80">
                                              Key messages:
                                            </p>
                                            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                                              {article.keyMessages.length > 0 ? (
                                                article.keyMessages.map(
                                                  (msg, i) => (
                                                    <li key={i}>{msg}</li>
                                                  )
                                                )
                                              ) : (
                                                <li>—</li>
                                              )}
                                            </ul>
                                          </div>
                                          <div>
                                            <p className="font-medium text-foreground/80">
                                              Internal links:
                                            </p>
                                            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                                              {article.internalLinks.length >
                                              0 ? (
                                                article.internalLinks.map(
                                                  (link, i) => (
                                                    <li key={i}>{link}</li>
                                                  )
                                                )
                                              ) : (
                                                <li>—</li>
                                              )}
                                            </ul>
                                          </div>
                                        </div>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>

                              <div className="space-y-2 pt-1">
                                <div className="space-y-1.5">
                                  <Label htmlFor={`steering_${pillarKey}`}>
                                    Steering notes
                                  </Label>
                                  <Textarea
                                    id={`steering_${pillarKey}`}
                                    value={steeringNotes}
                                    onChange={(e) =>
                                      setSteeringNotes(e.target.value)
                                    }
                                    placeholder="Optional guidance for regeneration…"
                                    rows={2}
                                    disabled={proposalLoading}
                                  />
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={proposalLoading || saving}
                                    onClick={() =>
                                      handleRegeneratePillar(pillar)
                                    }
                                  >
                                    {proposalLoading ? (
                                      <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Regenerating…
                                      </>
                                    ) : (
                                      "Regenerate"
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={
                                      proposalLoading ||
                                      saving ||
                                      proposalArticles.length === 0
                                    }
                                    onClick={() =>
                                      handleConfirmPillarArticle(pillar)
                                    }
                                  >
                                    {saving
                                      ? "Saving…"
                                      : "Save Pillar Article"}
                                  </Button>
                                </div>
                              </div>
                            </>
                          )}

                          {proposalError &&
                            proposalArticles.length === 0 &&
                            !proposalLoading && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={saving}
                                onClick={() =>
                                  requestPillarProposal({
                                    pillar,
                                    regenerate: false,
                                  })
                                }
                              >
                                Retry
                              </Button>
                            )}
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium pt-1">
                      Supporting keyword clusters ({pillar.supporting.length})
                    </p>

                    {pillar.supporting.length > 0 && (
                      <div className="space-y-1.5">
                        {pillar.supporting.map((sup) => {
                          const detailKey = `${pillar.slug}::${sup.slug}`;
                          const isDetailOpen = expandedSupporting === detailKey;
                          const plannedCount = sup.plannedArticles.length;
                          const publishedCount = sup.plannedArticles.filter(
                            (a) => a.status === "published"
                          ).length;
                          const draftedCount = sup.plannedArticles.filter(
                            (a) => a.status === "drafted"
                          ).length;
                          const clusterNotPlanned = plannedCount === 0;
                          const clusterComplete =
                            plannedCount > 0 && publishedCount === plannedCount;
                          const clusterInProgress =
                            plannedCount > 0 && publishedCount < plannedCount;
                          const isProposalTarget = proposalKey === detailKey;
                          const showProposal = isProposalTarget;

                          return (
                            <div
                              key={sup.slug}
                              className={`rounded-md border overflow-hidden ${
                                clusterComplete
                                  ? "border-emerald-200 bg-emerald-50/40"
                                  : clusterInProgress
                                    ? "border-amber-200/80 bg-background"
                                    : "border-border bg-background"
                              }`}
                            >
                              <div className="flex items-center gap-2 px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleSupporting(pillar.slug, sup.slug)}
                                  className="flex flex-1 items-center gap-2.5 min-w-0 text-left hover:opacity-80 transition-opacity"
                                >
                                  <span className="text-muted-foreground shrink-0">
                                    {isDetailOpen ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    )}
                                  </span>
                                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    <span className="text-sm text-foreground leading-snug">
                                      {sup.keyword}
                                    </span>
                                    {clusterNotPlanned && !showProposal && (
                                      <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                        Cluster not planned
                                      </span>
                                    )}
                                    {clusterInProgress && !showProposal && (
                                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                                        In progress · {publishedCount}/
                                        {plannedCount} published
                                        {draftedCount > 0
                                          ? ` · ${draftedCount} drafted`
                                          : ""}
                                      </span>
                                    )}
                                    {clusterComplete && !showProposal && (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                        <Check className="w-3 h-3" />
                                        Complete · {publishedCount}/{plannedCount}{" "}
                                        published
                                      </span>
                                    )}
                                    {isProposalTarget && proposalLoading && (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Planning…
                                      </span>
                                    )}
                                  </div>
                                </button>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {plannedCount > 0 && !showProposal && (
                                    <>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() =>
                                          setDetailCluster({
                                            pillarSlug: pillar.slug,
                                            supportingSlug: sup.slug,
                                            pillarKeyword: pillar.keyword,
                                            supportingKeyword: sup.keyword,
                                            clusterRationale:
                                              sup.clusterRationale || "",
                                            articles: sup.plannedArticles,
                                          })
                                        }
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                        View details
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        onClick={() =>
                                          handleDownloadCluster(pillar, sup)
                                        }
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        Download .md
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                        disabled={proposalLoading || saving}
                                        onClick={() => removeCluster(pillar, sup)}
                                        aria-label="Remove cluster"
                                        title="Remove cluster"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    </>
                                  )}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={proposalLoading || saving}
                                    onClick={() => handlePlanCluster(pillar, sup)}
                                  >
                                    {isProposalTarget && proposalLoading ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Plus className="w-3.5 h-3.5" />
                                    )}
                                    Plan
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={proposalLoading || saving}
                                    onClick={() => void handleUploadCluster(pillar, sup)}
                                  >
                                    <Upload className="w-3.5 h-3.5" />
                                    Upload
                                  </Button>
                                </div>
                              </div>

                              {isDetailOpen && showProposal && (
                                <div className="border-t border-border px-3 py-3 space-y-3 bg-muted/10">
                                  <div className="space-y-1.5">
                                    <Label>Article types</Label>
                                    <div className="space-y-1.5 rounded-md border border-border bg-background px-3 py-2">
                                      {ARTICLE_TYPES.map((t) => {
                                        const checked = Boolean(
                                          articleTypeEnabled[t.value]
                                        );
                                        return (
                                          <div
                                            key={t.value}
                                            className="flex items-center gap-3"
                                          >
                                            <label className="flex flex-1 items-center gap-2 text-sm text-foreground cursor-pointer min-w-0">
                                              <input
                                                type="checkbox"
                                                className="h-3.5 w-3.5 shrink-0"
                                                checked={checked}
                                                disabled={proposalLoading}
                                                onChange={(e) =>
                                                  setArticleTypeEnabled((prev) => ({
                                                    ...prev,
                                                    [t.value]: e.target.checked,
                                                  }))
                                                }
                                              />
                                              <span className="truncate">{t.label}</span>
                                            </label>
                                            <Input
                                              type="number"
                                              min={1}
                                              step={1}
                                              value={articleTypeCounts[t.value] ?? 1}
                                              disabled={!checked || proposalLoading}
                                              onChange={(e) => {
                                                const raw = Number(e.target.value);
                                                const next =
                                                  Number.isFinite(raw) && raw >= 1
                                                    ? Math.floor(raw)
                                                    : 1;
                                                setArticleTypeCounts((prev) => ({
                                                  ...prev,
                                                  [t.value]: next,
                                                }));
                                              }}
                                              className="h-7 w-16 text-xs"
                                              aria-label={`${t.label} quantity`}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {Object.keys(
                                      buildArticleTypeCountsPayload(
                                        articleTypeEnabled,
                                        articleTypeCounts
                                      )
                                    ).length === 0 && (
                                      <p className="text-xs text-destructive">
                                        Select at least one article type
                                      </p>
                                    )}
                                  </div>

                                  {proposalArticles.length === 0 &&
                                    !proposalLoading &&
                                    !proposalError && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      disabled={
                                        saving ||
                                        Object.keys(
                                          buildArticleTypeCountsPayload(
                                            articleTypeEnabled,
                                            articleTypeCounts
                                          )
                                        ).length === 0
                                      }
                                      onClick={() =>
                                        requestClusterProposal({
                                          pillar,
                                          supporting: sup,
                                          regenerate: false,
                                        })
                                      }
                                    >
                                      Generate Proposal
                                    </Button>
                                  )}

                                  {proposalLoading && proposalArticles.length === 0 && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      Generating cluster proposal…
                                    </div>
                                  )}

                                  {proposalError && (
                                    <p className="text-sm text-destructive">{proposalError}</p>
                                  )}

                                  {proposalArticles.length > 0 && (
                                    <>
                                      <div className="space-y-1.5">
                                        {proposalRationale && (
                                          <p className="text-sm text-foreground">
                                            {proposalRationale}
                                          </p>
                                        )}
                                        <p className="text-xs text-muted-foreground">
                                          {proposalTypeSummary(proposalArticles)}
                                          {proposalLoading ? " · Regenerating…" : ""}
                                        </p>
                                      </div>

                                      <ul className="space-y-2">
                                        {proposalArticles.map((article) => {
                                          const isExpanded =
                                            expandedProposalId === article.id;
                                          return (
                                            <li
                                              key={article.id}
                                              className="rounded-md border border-dashed border-border bg-slate-50/80 px-3 py-2.5"
                                            >
                                              <div className="flex items-start gap-2">
                                                <button
                                                  type="button"
                                                  className="flex flex-1 items-start gap-2 min-w-0 text-left"
                                                  onClick={() =>
                                                    setExpandedProposalId((prev) =>
                                                      prev === article.id
                                                        ? null
                                                        : article.id
                                                    )
                                                  }
                                                >
                                                  <span className="mt-0.5 text-muted-foreground shrink-0">
                                                    {isExpanded ? (
                                                      <ChevronDown className="w-3.5 h-3.5" />
                                                    ) : (
                                                      <ChevronRight className="w-3.5 h-3.5" />
                                                    )}
                                                  </span>
                                                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                                                    <span className="text-sm text-foreground">
                                                      {article.title}
                                                    </span>
                                                    <TypeBadge type={article.type} />
                                                  </div>
                                                </button>
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="ghost"
                                                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                                                  disabled={proposalLoading}
                                                  onClick={() =>
                                                    removeProposalArticle(article.id)
                                                  }
                                                  aria-label="Remove article"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                              </div>

                                              {isExpanded && (
                                                <div className="mt-2 ml-5 space-y-1.5 text-xs text-muted-foreground">
                                                  <p>
                                                    <span className="font-medium text-foreground/80">
                                                      Target keyword:
                                                    </span>{" "}
                                                    {article.targetKeyword}
                                                  </p>
                                                  <p>
                                                    <span className="font-medium text-foreground/80">
                                                      Search intent:
                                                    </span>{" "}
                                                    {article.searchIntent || "—"}
                                                  </p>
                                                  <p>
                                                    <span className="font-medium text-foreground/80">
                                                      Word count:
                                                    </span>{" "}
                                                    {article.wordCount ?? "—"}
                                                  </p>
                                                  <p>
                                                    <span className="font-medium text-foreground/80">
                                                      CTA angle:
                                                    </span>{" "}
                                                    {article.ctaAngle || "—"}
                                                  </p>
                                                  <div>
                                                    <p className="font-medium text-foreground/80">
                                                      Key messages:
                                                    </p>
                                                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                                                      {article.keyMessages.length > 0 ? (
                                                        article.keyMessages.map(
                                                          (msg, i) => (
                                                            <li key={i}>{msg}</li>
                                                          )
                                                        )
                                                      ) : (
                                                        <li>—</li>
                                                      )}
                                                    </ul>
                                                  </div>
                                                  <div>
                                                    <p className="font-medium text-foreground/80">
                                                      Internal links:
                                                    </p>
                                                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                                                      {article.internalLinks.length >
                                                      0 ? (
                                                        article.internalLinks.map(
                                                          (link, i) => (
                                                            <li key={i}>{link}</li>
                                                          )
                                                        )
                                                      ) : (
                                                        <li>—</li>
                                                      )}
                                                    </ul>
                                                  </div>
                                                </div>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>

                                      <div className="space-y-2 pt-1">
                                        <div className="space-y-1.5">
                                          <Label htmlFor={`steering_${detailKey}`}>
                                            Steering notes
                                          </Label>
                                          <Textarea
                                            id={`steering_${detailKey}`}
                                            value={steeringNotes}
                                            onChange={(e) =>
                                              setSteeringNotes(e.target.value)
                                            }
                                            placeholder="Optional guidance for regeneration…"
                                            rows={2}
                                            disabled={proposalLoading}
                                          />
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={proposalLoading || saving}
                                            onClick={() =>
                                              handleRegenerate(pillar, sup)
                                            }
                                          >
                                            {proposalLoading ? (
                                              <>
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                Regenerating…
                                              </>
                                            ) : (
                                              "Regenerate"
                                            )}
                                          </Button>
                                          <Button
                                            type="button"
                                            size="sm"
                                            disabled={
                                              proposalLoading ||
                                              saving ||
                                              proposalArticles.length === 0
                                            }
                                            onClick={() =>
                                              handleConfirmCluster(pillar, sup)
                                            }
                                          >
                                            {saving
                                              ? "Saving…"
                                              : "Save Cluster"}
                                          </Button>
                                        </div>
                                      </div>
                                    </>
                                  )}

                                  {proposalError && proposalArticles.length === 0 && !proposalLoading && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={
                                        saving ||
                                        Object.keys(
                                          buildArticleTypeCountsPayload(
                                            articleTypeEnabled,
                                            articleTypeCounts
                                          )
                                        ).length === 0
                                      }
                                      onClick={() =>
                                        requestClusterProposal({
                                          pillar,
                                          supporting: sup,
                                          regenerate: false,
                                        })
                                      }
                                    >
                                      Retry
                                    </Button>
                                  )}
                                </div>
                              )}

                              {isDetailOpen &&
                                !showProposal &&
                                plannedCount > 0 && (
                                  <div className="border-t border-border px-3 py-3 space-y-3 bg-muted/10">
                                    <ul className="space-y-2">
                                      {sup.plannedArticles.map((article) => {
                                        const done = article.status === "published";
                                        const incomplete =
                                          article.status !== "published";

                                        return (
                                          <li
                                            key={article.id}
                                            className={`rounded-md border px-3 py-2.5 ${
                                              incomplete
                                                ? "border-dashed border-border bg-slate-50/80"
                                                : "border-border bg-background"
                                            }`}
                                          >
                                            <div className="flex items-start gap-2.5">
                                              <span
                                                className={`mt-0.5 shrink-0 ${
                                                  done
                                                    ? "text-emerald-600"
                                                    : "text-muted-foreground/50"
                                                }`}
                                                aria-hidden
                                              >
                                                {done ? (
                                                  <Check className="w-4 h-4" />
                                                ) : (
                                                  <Circle className="w-4 h-4" />
                                                )}
                                              </span>
                                              <div
                                                className="flex-1 min-w-0 space-y-1.5 cursor-pointer"
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => {
                                                  setDetailArticle(article);
                                                }}
                                                onKeyDown={(ev) => {
                                                  if (
                                                    ev.key === "Enter" ||
                                                    ev.key === " "
                                                  ) {
                                                    ev.preventDefault();
                                                    setDetailArticle(article);
                                                  }
                                                }}
                                              >
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <span
                                                    className={`text-sm ${
                                                      incomplete
                                                        ? "text-foreground/80"
                                                        : "text-foreground font-medium"
                                                    }`}
                                                  >
                                                    {article.title || "(untitled)"}
                                                  </span>
                                                  <TypeBadge type={article.type} />
                                                  <span className="text-[11px] text-muted-foreground">
                                                    View details
                                                  </span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                                  {article.slug && (
                                                    <span>{article.slug}</span>
                                                  )}
                                                  {article.publishedAt && (
                                                    <span>
                                                      Published{" "}
                                                      {formatDate(article.publishedAt)}
                                                    </span>
                                                  )}
                                                  {article.updatedAt &&
                                                    article.status !== "published" && (
                                                      <span>
                                                        Updated{" "}
                                                        {formatDate(article.updatedAt)}
                                                      </span>
                                                    )}
                                                  {article.publishedUrl && (
                                                    <a
                                                      href={article.publishedUrl}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className="underline underline-offset-2 hover:text-foreground"
                                                      onClick={(ev) =>
                                                        ev.stopPropagation()
                                                      }
                                                    >
                                                      View URL
                                                    </a>
                                                  )}
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-1 shrink-0">
                                                <StatusCycleButton
                                                  status={article.status}
                                                  disabled={saving}
                                                  onClick={() =>
                                                    advanceArticleStatus(
                                                      pillar.slug,
                                                      sup.slug,
                                                      article
                                                    )
                                                  }
                                                />
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="ghost"
                                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                  disabled={saving || proposalLoading}
                                                  onClick={() =>
                                                    removeClusterArticle(
                                                      pillar.slug,
                                                      sup.slug,
                                                      article
                                                    )
                                                  }
                                                  aria-label="Remove article"
                                                  title="Remove article"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                              </div>
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as published</DialogTitle>
            <DialogDescription>
              Optionally add the live URL. Published date will be set to now.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePublish} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="publish_url">Published URL</Label>
              <Input
                id="publish_url"
                type="url"
                value={publishUrl}
                onChange={(e) => setPublishUrl(e.target.value)}
                placeholder="https://"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPublishOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Mark published"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailArticle != null}
        onOpenChange={(open) => {
          if (!open) setDetailArticle(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {detailArticle && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 text-base leading-snug">
                  {detailArticle.title || "(untitled)"}
                </DialogTitle>
                <DialogDescription>
                  {hasGeneratedFrontmatter(detailArticle)
                    ? "Planned topic details and draft frontmatter"
                    : "Planned topic details from Topic Generator"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                <section className="space-y-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                    Plan
                  </p>
                  <ArticlePlanFields article={detailArticle} />
                </section>
                {hasGeneratedFrontmatter(detailArticle) && (
                  <section className="space-y-3 border-t border-border pt-4">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      Draft frontmatter
                    </p>
                    <div className="space-y-3 text-sm">
                      <CoverageDetailRow
                        label="slug"
                        value={detailArticle.slug}
                      />
                      <CoverageDetailRow
                        label="description"
                        value={detailArticle.description}
                      />
                      <CoverageDetailRow
                        label="category"
                        value={detailArticle.category}
                      />
                      <CoverageDetailRow
                        label="date"
                        value={detailArticle.date}
                      />
                      <CoverageDetailRow
                        label="updatedDate"
                        value={detailArticle.updatedDate}
                      />
                      <CoverageDetailRow
                        label="imageAlt"
                        value={detailArticle.imageAlt}
                      />
                      <CoverageDetailList
                        label="tags"
                        items={detailArticle.tags}
                      />
                      <CoverageDetailList
                        label="keywords"
                        items={detailArticle.keywords}
                      />
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                          faqs
                        </p>
                        {Array.isArray(detailArticle.faqs) &&
                        detailArticle.faqs.length > 0 ? (
                          <ul className="space-y-2">
                            {detailArticle.faqs.map((faq, i) => (
                              <li
                                key={`faq-${i}`}
                                className="rounded-md border border-border px-3 py-2"
                              >
                                <p className="font-medium text-foreground">
                                  {faq.question || "—"}
                                </p>
                                <p className="text-muted-foreground mt-1">
                                  {faq.answer || "—"}
                                </p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-muted-foreground">—</p>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailCluster != null}
        onOpenChange={(open) => {
          if (!open) setDetailCluster(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {detailCluster && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6 text-base leading-snug">
                  {detailCluster.supportingKeyword}
                </DialogTitle>
                <DialogDescription>
                  Cluster for pillar “{detailCluster.pillarKeyword}” ·{" "}
                  {detailCluster.articles.length} article
                  {detailCluster.articles.length === 1 ? "" : "s"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <CoverageDetailRow
                  label="cluster rationale"
                  value={detailCluster.clusterRationale}
                />
                <div className="space-y-3">
                  {detailCluster.articles.map((article, index) => (
                    <div
                      key={article.id || `cluster-article-${index}`}
                      className="rounded-md border border-border px-3 py-3 space-y-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {article.title || "(untitled)"}
                        </p>
                        {article.type && <TypeBadge type={article.type} />}
                      </div>
                      <ArticlePlanFields article={article} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArticlePlanFields({ article }) {
  if (!article) return null;
  return (
    <div className="space-y-3 text-sm">
      <CoverageDetailRow label="targetKeyword" value={article.targetKeyword} />
      <CoverageDetailRow
        label="type"
        value={article.type ? <TypeBadge type={article.type} /> : null}
      />
      <CoverageDetailRow label="status" value={article.status} />
      <CoverageDetailRow label="searchIntent" value={article.searchIntent} />
      <CoverageDetailRow
        label="wordCount"
        value={
          article.wordCount != null && article.wordCount !== ""
            ? String(article.wordCount)
            : null
        }
      />
      <CoverageDetailRow label="ctaAngle" value={article.ctaAngle} />
      {article.pillarRationale ? (
        <CoverageDetailRow
          label="pillarRationale"
          value={article.pillarRationale}
        />
      ) : null}
      <CoverageDetailList label="keyMessages" items={article.keyMessages} />
      <CoverageDetailList label="internalLinks" items={article.internalLinks} />
    </div>
  );
}

function CoverageDetailRow({ label, value }) {
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

function CoverageDetailList({ label, items }) {
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
