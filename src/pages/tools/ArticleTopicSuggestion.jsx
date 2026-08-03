import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  Circle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ARTICLE_TYPES = [
  { value: "comprehensive", label: "Comprehensive" },
  { value: "howto", label: "How-to" },
  { value: "comparison", label: "Comparison" },
  { value: "faq", label: "FAQ" },
  { value: "flex", label: "Flex" },
];

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

function normalizeArticle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = ARTICLE_STATUSES.includes(raw.status) ? raw.status : "planned";
  const type = ARTICLE_TYPES.some((t) => t.value === raw.type) ? raw.type : "flex";
  return {
    id: String(raw.id || newId()),
    title: String(raw.title || "").trim(),
    targetKeyword: String(raw.targetKeyword || "").trim(),
    type,
    status,
    publishedUrl: raw.publishedUrl ? String(raw.publishedUrl) : undefined,
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

function normalizePillarArticle(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    return ARTICLE_STATUSES.includes(raw) ? raw : null;
  }
  const article = normalizeArticle(raw);
  return article?.status || null;
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

      return {
        slug: uniqueSlug(slugify(keyword), usedSupportingSlugs),
        keyword,
        plannedArticles,
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

function typeCountsLabel(articles) {
  if (!articles.length) return null;
  const counts = {};
  for (const article of articles) {
    counts[article.type] = (counts[article.type] || 0) + 1;
  }
  return ARTICLE_TYPES.filter((t) => counts[t.value])
    .map((t) => `${counts[t.value]} ${t.label.toLowerCase()}`)
    .join(" · ");
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

function nextStatus(status) {
  if (status === "planned") return "drafted";
  if (status === "drafted") return "published";
  return null;
}

const EMPTY_ARTICLE_FORM = {
  title: "",
  targetKeyword: "",
  type: "comprehensive",
};

export default function ArticleTopicSuggestion() {
  const { companyId } = useParams();

  const [companyName, setCompanyName] = useState("");
  const [pillars, setPillars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const [expandedPillar, setExpandedPillar] = useState(null);
  const [expandedSupporting, setExpandedSupporting] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addContext, setAddContext] = useState(null);
  const [articleForm, setArticleForm] = useState(EMPTY_ARTICLE_FORM);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishContext, setPublishContext] = useState(null);
  const [publishUrl, setPublishUrl] = useState("");

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
        .select("core_keywords")
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

  const totals = useMemo(() => {
    let planned = 0;
    let published = 0;
    for (const pillar of pillars) {
      for (const supporting of pillar.supporting) {
        for (const article of supporting.plannedArticles) {
          planned += 1;
          if (article.status === "published") published += 1;
        }
      }
    }
    return { planned, published };
  }, [pillars]);

  const togglePillar = (slug) => {
    setExpandedPillar((prev) => (prev === slug ? null : slug));
    setExpandedSupporting(null);
  };

  const toggleSupporting = (pillarSlug, supportingSlug) => {
    const key = `${pillarSlug}::${supportingSlug}`;
    setExpandedSupporting((prev) => (prev === key ? null : key));
  };

  const openAddArticle = (pillarSlug, supportingSlug, defaultKeyword) => {
    setAddContext({ pillarSlug, supportingSlug });
    setArticleForm({
      ...EMPTY_ARTICLE_FORM,
      targetKeyword: defaultKeyword || "",
    });
    setAddOpen(true);
  };

  const handleAddArticle = async (e) => {
    e.preventDefault();
    if (!addContext || saving) return;

    const title = articleForm.title.trim();
    const targetKeyword = articleForm.targetKeyword.trim();
    if (!title || !targetKeyword) {
      setError("Title and target keyword are required");
      return;
    }

    const now = new Date().toISOString();
    const article = {
      id: newId(),
      title,
      targetKeyword,
      type: articleForm.type,
      status: "planned",
      updatedAt: now,
    };

    await applyPillars((prev) =>
      prev.map((pillar) => {
        if (pillar.slug !== addContext.pillarSlug) return pillar;
        return {
          ...pillar,
          supporting: pillar.supporting.map((sup) => {
            if (sup.slug !== addContext.supportingSlug) return sup;
            return {
              ...sup,
              plannedArticles: [...sup.plannedArticles, article],
            };
          }),
        };
      })
    );

    setAddOpen(false);
    setAddContext(null);
    setArticleForm(EMPTY_ARTICLE_FORM);
  };

  const advanceArticleStatus = (pillarSlug, supportingSlug, article) => {
    const next = nextStatus(article.status);
    if (!next) return;

    if (next === "published") {
      setPublishContext({ pillarSlug, supportingSlug, articleId: article.id });
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
              plannedArticles: sup.plannedArticles.map((item) =>
                item.id === article.id
                  ? { ...item, status: next, updatedAt: now }
                  : item
              ),
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

    await applyPillars((prev) =>
      prev.map((pillar) => {
        if (pillar.slug !== publishContext.pillarSlug) return pillar;
        return {
          ...pillar,
          supporting: pillar.supporting.map((sup) => {
            if (sup.slug !== publishContext.supportingSlug) return sup;
            return {
              ...sup,
              plannedArticles: sup.plannedArticles.map((item) =>
                item.id === publishContext.articleId
                  ? {
                      ...item,
                      status: "published",
                      publishedUrl: url || undefined,
                      publishedAt: now,
                      updatedAt: now,
                    }
                  : item
              ),
            };
          }),
        };
      })
    );

    setPublishOpen(false);
    setPublishContext(null);
    setPublishUrl("");
  };

  const advancePillarArticle = (pillarSlug) => {
    void applyPillars((prev) =>
      prev.map((pillar) => {
        if (pillar.slug !== pillarSlug) return pillar;
        const current = pillarArticleStatus(pillar.pillarArticle);
        let next = null;
        if (current === "missing") next = "planned";
        else if (current === "planned") next = "drafted";
        else if (current === "drafted") next = "published";
        if (!next) return pillar;
        return { ...pillar, pillarArticle: next };
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
          <h1 className="text-[15px] text-foreground mb-1">Topic Generation</h1>
          <p className="text-sm text-muted-foreground">
            {companyName
              ? `Content coverage for ${companyName} — pillars, supporting keywords, and planned articles.`
              : "Content coverage for this company’s pillar and supporting keywords."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {savedMessage && (
            <span className="text-xs text-muted-foreground">{savedMessage}</span>
          )}
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {pillars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground space-y-2">
          <p>No pillar keywords yet — nothing to track coverage for.</p>
          <p>
            Add pillar and supporting keywords in{" "}
            <Link
              to={`/company/${companyId}/company-data`}
              className="text-foreground underline underline-offset-2 hover:text-primary"
            >
              Company Data
            </Link>
            , then return here.
          </p>
        </div>
      ) : (
        <>
          {totals.planned === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
              No articles planned yet. Expand a pillar, open a supporting keyword, and add
              planned articles to start building coverage. Ideal coverage is whatever you
              plan per keyword — not a fixed template.
            </div>
          )}

          <div className="space-y-2">
            {pillars.map((pillar) => {
              const isPillarOpen = expandedPillar === pillar.slug;
              const pillarStatus = pillarArticleStatus(pillar.pillarArticle);
              const supportingTotal = pillar.supporting.length;
              const supportingWithPublished = pillar.supporting.filter((sup) =>
                sup.plannedArticles.some((a) => a.status === "published")
              ).length;
              const coveragePct =
                supportingTotal > 0
                  ? Math.round((supportingWithPublished / supportingTotal) * 100)
                  : 0;
              const hasAnyPlan = pillar.supporting.some(
                (sup) => sup.plannedArticles.length > 0
              );
              const hasAnyPublished = supportingWithPublished > 0;
              const noCoverage = !hasAnyPlan && !hasAnyPublished && pillarStatus === "missing";

              return (
                <div
                  key={pillar.slug}
                  className="rounded-lg border border-border bg-card overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => togglePillar(pillar.slug)}
                    className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-accent/40 transition-colors"
                  >
                    <span className="mt-0.5 text-muted-foreground shrink-0">
                      {isPillarOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {pillar.keyword}
                        </span>
                        <StatusChip status={pillarStatus} />
                      </div>

                      {noCoverage ? (
                        <p className="text-xs text-muted-foreground">
                          No coverage yet — no pillar article or supporting articles planned.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">
                            {supportingWithPublished} of {supportingTotal} supporting
                            keywords have any published article
                          </p>
                          <Progress value={coveragePct} className="h-1.5 max-w-xs" />
                        </div>
                      )}
                    </div>
                  </button>

                  {isPillarOpen && (
                    <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                          Pillar article
                        </p>
                        {pillarStatus !== "published" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => advancePillarArticle(pillar.slug)}
                            disabled={saving}
                          >
                            {pillarStatus === "missing"
                              ? "Mark planned"
                              : pillarStatus === "planned"
                                ? "Mark drafted"
                                : "Mark published"}
                          </Button>
                        )}
                      </div>

                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium pt-1">
                        Supporting keywords ({pillar.supporting.length})
                      </p>

                      {pillar.supporting.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                          No supporting keywords for this pillar. Add them in Company Data.
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {pillar.supporting.map((sup) => {
                            const detailKey = `${pillar.slug}::${sup.slug}`;
                            const isDetailOpen = expandedSupporting === detailKey;
                            const plannedCount = sup.plannedArticles.length;
                            const publishedCount = sup.plannedArticles.filter(
                              (a) => a.status === "published"
                            ).length;
                            const typeLabel = typeCountsLabel(sup.plannedArticles);
                            const clusterNotPlanned = plannedCount === 0;
                            const hasGap = plannedCount > 0 && publishedCount < plannedCount;

                            return (
                              <div
                                key={sup.slug}
                                className="rounded-md border border-border bg-background overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleSupporting(pillar.slug, sup.slug)}
                                  className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors"
                                >
                                  <span className="mt-0.5 text-muted-foreground shrink-0">
                                    {isDetailOpen ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    )}
                                  </span>
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm text-foreground">
                                        {sup.keyword}
                                      </span>
                                      {clusterNotPlanned && (
                                        <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                          Cluster not planned
                                        </span>
                                      )}
                                      {hasGap && (
                                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                                          Gap: {publishedCount}/{plannedCount} published
                                        </span>
                                      )}
                                    </div>
                                    {plannedCount > 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        {typeLabel}
                                        <span className="text-muted-foreground/50"> · </span>
                                        {publishedCount} published / {plannedCount} planned
                                      </p>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">
                                        No articles planned
                                      </p>
                                    )}
                                  </div>
                                </button>

                                {isDetailOpen && (
                                  <div className="border-t border-border px-3 py-3 space-y-3 bg-muted/10">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                                        Article checklist
                                      </p>
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-7 text-xs"
                                        onClick={() =>
                                          openAddArticle(
                                            pillar.slug,
                                            sup.slug,
                                            sup.keyword
                                          )
                                        }
                                      >
                                        <Plus className="w-3.5 h-3.5" />
                                        Add planned article
                                      </Button>
                                    </div>

                                    {sup.plannedArticles.length === 0 ? (
                                      <div className="rounded-md border border-dashed border-border px-3 py-5 text-xs text-muted-foreground text-center">
                                        Empty checklist — add planned articles to define ideal
                                        coverage for this keyword.
                                      </div>
                                    ) : (
                                      <ul className="space-y-2">
                                        {sup.plannedArticles.map((article) => {
                                          const done = article.status === "published";
                                          const incomplete = article.status !== "published";
                                          const advance = nextStatus(article.status);

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
                                                <div className="flex-1 min-w-0 space-y-1.5">
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
                                                    <StatusChip status={article.status} />
                                                    {incomplete && (
                                                      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                                                        Missing
                                                      </span>
                                                    )}
                                                  </div>
                                                  <p className="text-xs text-muted-foreground">
                                                    {TYPE_LABEL[article.type] || article.type}
                                                    <span className="text-muted-foreground/50">
                                                      {" "}
                                                      ·{" "}
                                                    </span>
                                                    Target: {article.targetKeyword}
                                                  </p>
                                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                                    {article.publishedAt && (
                                                      <span>
                                                        Published {formatDate(article.publishedAt)}
                                                      </span>
                                                    )}
                                                    {article.updatedAt &&
                                                      article.status !== "published" && (
                                                        <span>
                                                          Updated {formatDate(article.updatedAt)}
                                                        </span>
                                                      )}
                                                    {article.publishedUrl && (
                                                      <a
                                                        href={article.publishedUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="underline underline-offset-2 hover:text-foreground"
                                                        onClick={(ev) => ev.stopPropagation()}
                                                      >
                                                        View URL
                                                      </a>
                                                    )}
                                                  </div>
                                                </div>
                                                {advance && (
                                                  <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-xs shrink-0"
                                                    disabled={saving}
                                                    onClick={() =>
                                                      advanceArticleStatus(
                                                        pillar.slug,
                                                        sup.slug,
                                                        article
                                                      )
                                                    }
                                                  >
                                                    Mark {advance}
                                                  </Button>
                                                )}
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
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
        </>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add planned article</DialogTitle>
            <DialogDescription>
              Define one piece of ideal coverage for this supporting keyword. Ideal set size
              varies per keyword.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddArticle} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="article_title">Title</Label>
              <Input
                id="article_title"
                value={articleForm.title}
                onChange={(e) =>
                  setArticleForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Article title"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="article_keyword">Target keyword</Label>
              <Input
                id="article_keyword"
                value={articleForm.targetKeyword}
                onChange={(e) =>
                  setArticleForm((prev) => ({
                    ...prev,
                    targetKeyword: e.target.value,
                  }))
                }
                placeholder="Primary target keyword"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={articleForm.type}
                onValueChange={(value) =>
                  setArticleForm((prev) => ({ ...prev, type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ARTICLE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Add article"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
