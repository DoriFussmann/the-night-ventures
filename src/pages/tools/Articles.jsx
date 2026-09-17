import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Download, ExternalLink, Loader2, Radar, Search, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { scanLiveArticles } from "./articles/scanLiveApi";
import FaceliftPanel from "./articles/FaceliftPanel";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  articlesSummaryFilename,
  buildArticlesSummaryMarkdown,
} from "./articleGeneration/buildArticlesSummaryMarkdown";
import {
  daysSinceUpdate,
  daysSinceUpdateBadgeClass,
  formatDaysSinceUpdateLabel,
} from "./articleGeneration/daysSinceUpdate";
import { downloadMarkdownFile } from "./articleGeneration/serializeArticleMarkdown";
import {
  DEFAULT_PUBLISH_BRANCH,
  formatPublishProgress,
  generatedArticleToPublishItem,
  isPublishDestinationMapped,
  loadCompanyPublishDestination,
  publishArticlesToSite,
} from "./articleGeneration/publishToSite";

const TYPE_OPTIONS = [
  { value: "comprehensive", label: "Comprehensive" },
  { value: "howto", label: "How-to" },
  { value: "comparison", label: "Comparison" },
  { value: "faq", label: "FAQ" },
  { value: "flex", label: "Flex" },
];

const TYPE_LABELS = Object.fromEntries(
  TYPE_OPTIONS.map((option) => [option.value, option.label])
);

const TYPE_COLORS = {
  comprehensive: "bg-violet-50 text-violet-700 border-violet-200",
  howto: "bg-blue-50 text-blue-700 border-blue-200",
  comparison: "bg-amber-50 text-amber-800 border-amber-200",
  faq: "bg-teal-50 text-teal-700 border-teal-200",
  flex: "bg-slate-100 text-slate-600 border-slate-200",
};

const KEYWORD_ROLE_LABELS = {
  pillar: "Pillar",
  supporting: "Supporting",
};

const KEYWORD_ROLE_COLORS = {
  pillar: "bg-indigo-50 text-indigo-700 border-indigo-200",
  supporting: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_LABELS = {
  drafted: "Drafted",
  published: "Published",
};

const STATUS_COLORS = {
  drafted: "bg-orange-50 text-orange-700 border-orange-200",
  published: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function isPillarArticle(article) {
  return !String(article?.supporting_keyword || "").trim();
}

function articleKeywordRole(article) {
  if (!article) return "";
  if (article.keywordRole) return article.keywordRole;
  return isPillarArticle(article) ? "pillar" : "supporting";
}

function articleTypeKey(article) {
  const type = String(article?.articleType || article?.type || "").trim().toLowerCase();
  return TYPE_COLORS[type] ? type : "";
}

function TypeBadge({ type }) {
  if (!type || !TYPE_COLORS[type]) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[type]}`}
    >
      {TYPE_LABELS[type] || type}
    </span>
  );
}

function KeywordTypeBadge({ role }) {
  if (!role || !KEYWORD_ROLE_COLORS[role]) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${KEYWORD_ROLE_COLORS[role]}`}
    >
      {KEYWORD_ROLE_LABELS[role]}
    </span>
  );
}

function StatusBadge({ status }) {
  const key = STATUS_COLORS[status] ? status : "drafted";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[key]}`}
    >
      {STATUS_LABELS[key] || key}
    </span>
  );
}

function PillarBadge({ keyword }) {
  if (!keyword) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground max-w-[10rem] truncate">
      {keyword}
    </span>
  );
}

function DaysSinceUpdateBadge({ dateValue }) {
  const days = daysSinceUpdate(dateValue);
  if (days == null) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${daysSinceUpdateBadgeClass(days)}`}
      title={`updatedDate: ${dateValue}`}
    >
      {formatDaysSinceUpdateLabel(days)}
    </span>
  );
}

function LinkHealthCell({ kind, row, health }) {
  const entry = health?.[row.slug];
  const raw = kind === "internal" ? row.internalLinks : row.externalLinks;
  if (!entry?.audited) {
    return (
      <span className="tabular-nums text-muted-foreground">
        {raw == null ? "—" : raw}
      </span>
    );
  }
  if (kind === "internal") {
    if (entry.internalOk) {
      return (
        <span className="tabular-nums font-medium text-emerald-700">
          {raw == null ? "ok" : raw}
        </span>
      );
    }
    return (
      <span className="tabular-nums font-medium text-red-700">
        {entry.internalMissing} missing
      </span>
    );
  }
  const needed = entry.externalNeeded || 3;
  const current = entry.externalCurrent;
  if (entry.externalOk) {
    return (
      <span className="tabular-nums font-medium text-emerald-700">
        {current == null ? (raw == null ? "ok" : `${raw}/${needed}`) : `${current}/${needed}`}
      </span>
    );
  }
  const shown = current == null ? raw ?? 0 : current;
  return (
    <span className="tabular-nums font-medium text-red-700">
      {shown}/{needed}
    </span>
  );
}

function bodyForReader(body) {
  return String(body || "")
    .replace(/<!--\s*WHERE-THINGS-STAND:START\s*-->\s*/gi, "")
    .replace(/<!--\s*WHERE-THINGS-STAND:END\s*-->\s*/gi, "")
    .trim();
}

const markdownComponents = {
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
    <h3 className="text-lg font-medium text-foreground mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-xs leading-[1.75] text-foreground/90">{children}</p>
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

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "")).filter(Boolean);
}

function asFaqList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object");
}

function asSourceList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      url: String(item.url || "").trim(),
      note: String(item.note || "").trim(),
    }))
    .filter((item) => item.url || item.note);
}

function formatDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  return raw;
}

function uniqueSorted(values) {
  const set = new Set();
  for (const value of values) {
    const key = String(value || "").trim();
    if (key) set.add(key);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Strip the "(no volume data)" marker so a pillar doesn't split into phantom
// filter entries. Mirrors lib/stripNoVolumeTag so options and the filter agree.
function cleanPillar(value) {
  return String(value || "")
    .replace(/\s*\(\s*no volume data\s*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default function Articles() {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const slugFilter = (searchParams.get("slug") || "").trim();

  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingSummary, setDownloadingSummary] = useState(false);
  const [publishDestination, setPublishDestination] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(null);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pillarFilter, setPillarFilter] = useState("all");
  const [keywordRoleFilter, setKeywordRoleFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [linkHealth, setLinkHealth] = useState(null);
  const [faceliftLiveRows, setFaceliftLiveRows] = useState([]);
  const [liveSearchInput, setLiveSearchInput] = useState("");
  const [liveDebouncedSearch, setLiveDebouncedSearch] = useState("");
  const [livePillarFilter, setLivePillarFilter] = useState("all");
  const [liveClusterFilter, setLiveClusterFilter] = useState("all");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLiveDebouncedSearch(liveSearchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [liveSearchInput]);

  useEffect(() => {
    setScanResult(null);
    setScanError("");
    setLinkHealth(null);
    setFaceliftLiveRows([]);
    setLiveSearchInput("");
    setLiveDebouncedSearch("");
    setLivePillarFilter("all");
    setLiveClusterFilter("all");
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
    let cancelled = false;

    async function load() {
      if (!companyId) {
        setArticles([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      const { data, error: fetchError } = await supabase
        .from("generated_articles")
        .select("*")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false });

      if (cancelled) return;

      if (fetchError) {
        console.error(fetchError);
        setError(fetchError.message || "Failed to load articles");
        setArticles([]);
        setLoading(false);
        return;
      }

      setArticles(data || []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const pillarOptions = useMemo(() => {
    const set = new Set();
    for (const article of articles) {
      const key = cleanPillar(article.pillar_keyword);
      if (key) set.add(key);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [articles]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return articles.filter((article) => {
      if (slugFilter && article.slug !== slugFilter) return false;
      if (pillarFilter !== "all" && cleanPillar(article.pillar_keyword) !== pillarFilter) {
        return false;
      }
      if (
        keywordRoleFilter !== "all" &&
        articleKeywordRole(article) !== keywordRoleFilter
      ) {
        return false;
      }
      if (typeFilter !== "all" && articleTypeKey(article) !== typeFilter) {
        return false;
      }
      if (!q) return true;
      const title = String(article.title || "").toLowerCase();
      const target = String(article.target_keyword || "").toLowerCase();
      return title.includes(q) || target.includes(q);
    });
  }, [articles, debouncedSearch, pillarFilter, keywordRoleFilter, typeFilter, slugFilter]);

  const selected = useMemo(
    () => articles.find((article) => article.id === selectedId) || null,
    [articles, selectedId]
  );

  const deleteTarget = useMemo(
    () => articles.find((article) => article.id === deleteId) || null,
    [articles, deleteId]
  );

  const clearSlugFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("slug");
    setSearchParams(next, { replace: true });
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id || !companyId || deleting) return;

    setDeleting(true);
    setError("");

    const { error: deleteError } = await supabase
      .from("generated_articles")
      .delete()
      .eq("id", deleteTarget.id)
      .eq("company_id", companyId);

    setDeleting(false);

    if (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || "Failed to delete article");
      setDeleteId(null);
      return;
    }

    setArticles((prev) => prev.filter((item) => item.id !== deleteTarget.id));
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setDeleteId(null);
  };

  const runLiveScan = async () => {
    if (!companyId || scanLoading) return;

    setScanLoading(true);
    setScanError("");

    try {
      const result = await scanLiveArticles(companyId);
      setScanResult(result);
    } catch (err) {
      console.error(err);
      setScanError(err?.message || "Failed to scan live articles");
    } finally {
      setScanLoading(false);
    }
  };

  const downloadSummary = async () => {
    if (!companyId || downloadingSummary || articles.length === 0) return;

    setDownloadingSummary(true);
    setError("");

    try {
      const [companyResult, coverageResult] = await Promise.all([
        supabase
          .from("companies")
          .select("name")
          .eq("id", companyId)
          .maybeSingle(),
        supabase
          .from("content_coverage")
          .select("pillars")
          .eq("company_id", companyId)
          .maybeSingle(),
      ]);

      if (companyResult.error) {
        throw new Error(
          companyResult.error.message || "Failed to load company"
        );
      }
      if (coverageResult.error) {
        throw new Error(
          coverageResult.error.message || "Failed to load content coverage"
        );
      }

      const companyName = companyResult.data?.name || "";
      const pillars = Array.isArray(coverageResult.data?.pillars)
        ? coverageResult.data.pillars
        : [];
      const generatedAt = new Date();
      const markdown = buildArticlesSummaryMarkdown({
        companyName,
        articles,
        pillars,
        generatedAt,
      });

      downloadMarkdownFile(
        articlesSummaryFilename(companyName, generatedAt),
        markdown
      );
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to download articles summary");
    } finally {
      setDownloadingSummary(false);
    }
  };

  const destinationMapped = isPublishDestinationMapped(publishDestination);

  const publishFilteredToSite = async () => {
    if (publishing || filtered.length === 0 || !destinationMapped) return;
    const ok = window.confirm(
      `Publish ${filtered.length} article(s) from the library to ${publishDestination.owner}/${publishDestination.repo} (${DEFAULT_PUBLISH_BRANCH})? Heroes are read from storage by slug. This merges via the GitHub API.`
    );
    if (!ok) return;

    setPublishing(true);
    setPublishProgress(null);
    setPublishError(null);
    setPublishResult(null);
    try {
      const result = await publishArticlesToSite(
        filtered.map(generatedArticleToPublishItem),
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

  const hasAnyArticles = articles.length > 0;
  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    pillarFilter !== "all" ||
    keywordRoleFilter !== "all" ||
    typeFilter !== "all" ||
    Boolean(slugFilter);

  const liveArticles = Array.isArray(scanResult?.articles)
    ? scanResult.articles
    : faceliftLiveRows;
  const showLiveSection = Boolean(scanResult) || faceliftLiveRows.length > 0;

  const livePillarOptions = useMemo(
    () => uniqueSorted(liveArticles.map((row) => row.pillarKeyword)),
    [liveArticles]
  );

  const liveClusterOptions = useMemo(() => {
    const rows =
      livePillarFilter === "all"
        ? liveArticles
        : liveArticles.filter((row) => row.pillarKeyword === livePillarFilter);
    return uniqueSorted(rows.map((row) => row.cluster));
  }, [liveArticles, livePillarFilter]);

  const filteredLiveArticles = useMemo(() => {
    const q = liveDebouncedSearch.toLowerCase();
    return liveArticles.filter((row) => {
      if (
        livePillarFilter !== "all" &&
        row.pillarKeyword !== livePillarFilter
      ) {
        return false;
      }
      if (liveClusterFilter !== "all" && row.cluster !== liveClusterFilter) {
        return false;
      }
      if (!q) return true;
      return String(row.title || "")
        .toLowerCase()
        .includes(q);
    });
  }, [
    liveArticles,
    liveDebouncedSearch,
    livePillarFilter,
    liveClusterFilter,
  ]);

  const liveFiltersActive =
    Boolean(liveDebouncedSearch) ||
    livePillarFilter !== "all" ||
    liveClusterFilter !== "all";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xs text-foreground mb-1">Articles</h1>
          <p className="text-sm text-muted-foreground">
            Saved drafts from Article Generator — full frontmatter and body.
            Status is read-only here; mark articles published in Topic Generator
            after shipping through the site CMS. Scan Live reads the published
            site independently of this library.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={!companyId || scanLoading}
          onClick={runLiveScan}
        >
          {scanLoading ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Radar className="h-3.5 w-3.5 mr-1.5" />
          )}
          {scanLoading ? "Scanning live site…" : "Scan Live"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {scanError && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {scanError}
        </p>
      )}

      <FaceliftPanel
        companyId={companyId}
        destination={publishDestination}
        onHealthChange={({ liveRows, linkHealth: nextHealth }) => {
          if (Array.isArray(liveRows)) setFaceliftLiveRows(liveRows);
          if (nextHealth) setLinkHealth(nextHealth);
        }}
      />

      {showLiveSection && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">Live on site</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {liveFiltersActive
                ? `${filteredLiveArticles.length} of ${liveArticles.length} articles`
                : `${liveArticles.length} ${
                    liveArticles.length === 1 ? "article" : "articles"
                  }`}{" "}
              {scanResult ? (
                <>
                  from{" "}
                  <a
                    href={scanResult.articlesIndexUrl || scanResult.siteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {displayLiveUrl(scanResult.siteUrl)}
                  </a>
                  {scanResult.scannedAt
                    ? ` · scanned ${formatScannedAt(scanResult.scannedAt)}`
                    : ""}
                  . Read-only — this does not save into the library below.
                </>
              ) : (
                <>from the destination repo (Facelift scan).</>
              )}
            </p>
          </div>

          {liveArticles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-foreground font-medium">
                No live articles found
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sitemap, RSS, and the /articles/ listing returned no article
                URLs for this domain.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={liveSearchInput}
                    onChange={(e) => setLiveSearchInput(e.target.value)}
                    placeholder="Search by title…"
                    className="pl-8 h-9"
                  />
                </div>
                <Select
                  value={livePillarFilter}
                  onValueChange={(value) => {
                    setLivePillarFilter(value);
                    setLiveClusterFilter("all");
                  }}
                >
                  <SelectTrigger className="w-full sm:w-[200px] h-9">
                    <SelectValue placeholder="Keyword (pillar)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All pillars</SelectItem>
                    {livePillarOptions.map((pillar) => (
                      <SelectItem key={pillar} value={pillar}>
                        {pillar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={liveClusterFilter}
                  onValueChange={setLiveClusterFilter}
                >
                  <SelectTrigger className="w-full sm:w-[200px] h-9">
                    <SelectValue placeholder="Cluster" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clusters</SelectItem>
                    {liveClusterOptions.map((cluster) => (
                      <SelectItem key={cluster} value={cluster}>
                        {cluster}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {filteredLiveArticles.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm text-foreground font-medium">
                    No matching live articles
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try clearing search or filters.
                  </p>
                </div>
              ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Keyword</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium whitespace-nowrap">
                      Last Date
                    </th>
                    <th className="px-3 py-2 font-medium text-center">URL</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                      Internal
                    </th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                      External
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLiveArticles.map((row) => (
                    <tr key={row.slug || row.url} className="align-top">
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        {row.title || row.slug || "(untitled)"}
                        {row.error ? (
                          <p className="mt-0.5 text-xs font-normal text-destructive">
                            {row.error}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-muted-foreground">
                            {row.keyword || "—"}
                          </span>
                          {row.keywordRole ? (
                            <KeywordTypeBadge role={row.keywordRole} />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <TypeBadge type={row.articleType} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge
                          status={
                            row.status || (row.draft ? "drafted" : "published")
                          }
                        />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="tabular-nums text-muted-foreground">
                            {row.lastDate || "—"}
                          </span>
                          <DaysSinceUpdateBadge dateValue={row.lastDate} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.url ? (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${row.url}`}
                            aria-label={`Open ${row.title || row.slug || "article"}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <LinkHealthCell
                          kind="internal"
                          row={row}
                          health={linkHealth}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <LinkHealthCell
                          kind="external"
                          row={row}
                          health={linkHealth}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}
            </>
          )}
        </section>
      )}

      {scanResult ? (
        <h2 className="text-sm font-medium text-foreground">Saved drafts</h2>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title or target keyword…"
            className="pl-8 h-9"
            disabled={!hasAnyArticles && !loading}
          />
        </div>
        <Select
          value={pillarFilter}
          onValueChange={setPillarFilter}
          disabled={!hasAnyArticles}
        >
          <SelectTrigger className="w-full sm:w-[180px] h-9">
            <SelectValue placeholder="Pillar Keyword" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pillars</SelectItem>
            {pillarOptions.map((pillar) => (
              <SelectItem key={pillar} value={pillar}>
                {pillar}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={keywordRoleFilter}
          onValueChange={setKeywordRoleFilter}
          disabled={!hasAnyArticles}
        >
          <SelectTrigger className="w-full sm:w-[160px] h-9">
            <SelectValue placeholder="Keyword type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All keywords</SelectItem>
            <SelectItem value="pillar">Pillar</SelectItem>
            <SelectItem value="supporting">Supporting</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={setTypeFilter}
          disabled={!hasAnyArticles}
        >
          <SelectTrigger className="w-full sm:w-[160px] h-9">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TYPE_OPTIONS.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={!hasAnyArticles || loading || downloadingSummary}
          onClick={downloadSummary}
        >
          {downloadingSummary ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5 mr-1.5" />
          )}
          Download Summary
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-9 shrink-0"
          disabled={
            filtered.length === 0 ||
            loading ||
            publishing ||
            !destinationMapped
          }
          onClick={publishFilteredToSite}
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
      </div>
      {publishDestination && !destinationMapped && hasAnyArticles && (
        <p className="text-sm text-muted-foreground">
          No destination repo set for this company.
        </p>
      )}
      {publishing && publishProgress && (
        <p className="text-sm text-muted-foreground">
          {publishProgress.phase === "merge"
            ? "Merging publish branch…"
            : `Committing ${publishProgress.current}/${publishProgress.total}${
                publishProgress.filename ? `: ${publishProgress.filename}` : ""
              }`}
        </p>
      )}
      {publishError && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {publishError}
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

      {slugFilter && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Filtered to slug{" "}
            <span className="font-mono text-foreground">{slugFilter}</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={clearSlugFilter}>
            Clear
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading articles…
        </div>
      ) : !hasAnyArticles ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-foreground font-medium">No articles saved yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This library only shows drafts saved from{" "}
            <Link
              to={`/company/${companyId}/article-generation`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Article Generator
            </Link>
            . Use Scan Live to list articles already on the published site.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-foreground font-medium">No matching articles</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasActiveFilters
              ? "Try clearing search or filters to see more results."
              : "Nothing to show."}
          </p>
        </div>
      ) : (
        <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {filtered.map((article) => (
            <li key={article.id}>
              <button
                type="button"
                onClick={() => setSelectedId(article.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {article.title || "(untitled)"}
                </span>
                <PillarBadge keyword={article.pillar_keyword} />
                <KeywordTypeBadge role={articleKeywordRole(article)} />
                <TypeBadge type={articleTypeKey(article)} />
                <StatusBadge status={article.status} />
                <DaysSinceUpdateBadge
                  dateValue={article.updated_date || article.date}
                />
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums w-[5.5rem] text-right">
                  {formatDisplayDate(article.updated_date || article.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] h-[90vh] overflow-hidden flex flex-col gap-0 p-0 min-h-0">
          {selected && (
            <>
              <div className="shrink-0 border-b border-border px-6 pt-6 pb-4 pr-14">
                <DialogHeader className="space-y-2 text-left">
                  <DialogTitle className="text-xl leading-snug font-semibold tracking-tight">
                    {selected.title || "(untitled)"}
                  </DialogTitle>
                  {selected.description && (
                    <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                      {selected.description}
                    </DialogDescription>
                  )}
                </DialogHeader>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <PillarBadge keyword={selected.pillar_keyword} />
                  <KeywordTypeBadge role={articleKeywordRole(selected)} />
                  <TypeBadge type={articleTypeKey(selected)} />
                  <StatusBadge status={selected.status} />
                  {selected.status === "published" && selected.published_at ? (
                    <span className="text-xs text-muted-foreground">
                      {formatDisplayDate(
                        String(selected.published_at).slice(0, 10)
                      )}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    disabled={deleting}
                    onClick={() => setDeleteId(selected.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="border-b border-border px-6 py-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <DetailRow label="slug" value={selected.slug} mono />
                    <DetailRow label="category" value={selected.category} />
                    <DetailRow label="date" value={selected.date} />
                    <DetailRow
                      label="updatedDate"
                      value={selected.updated_date}
                    />
                    <DetailRow label="author" value={selected.author} />
                    <DetailRow label="imageAlt" value={selected.image_alt} />
                    <DetailRow
                      label="pillarKeyword"
                      value={selected.pillar_keyword}
                    />
                    <DetailRow
                      label="supportingKeyword"
                      value={selected.supporting_keyword}
                    />
                    <DetailRow
                      label="articleType"
                      value={selected.type}
                    />
                    <DetailRow
                      label="targetKeyword"
                      value={selected.target_keyword}
                    />
                    <DetailRow
                      label="draft"
                      value={selected.draft ? "true" : "false"}
                    />
                    <DetailRow
                      label="publishedAt"
                      value={
                        selected.published_at
                          ? String(selected.published_at).slice(0, 10)
                          : null
                      }
                    />
                    <DetailRow
                      label="publishedUrl"
                      value={selected.published_url}
                    />
                  </div>
                  <div className="space-y-2 text-sm">
                    <DetailList label="tags" items={asStringList(selected.tags)} />
                    <DetailList
                      label="keywords"
                      items={asStringList(selected.keywords)}
                    />
                    <DetailList
                      label="internalLinks"
                      items={asStringList(selected.internal_links)}
                    />
                    <DetailList
                      label="externalLinks"
                      items={asStringList(selected.external_links)}
                    />
                  </div>
                  {asFaqList(selected.faqs).length > 0 && (
                    <div className="text-sm">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                        faqs
                      </p>
                      <div className="space-y-2">
                        {asFaqList(selected.faqs).map((faq, i) => (
                          <div key={`faq-${i}`}>
                            <p className="font-medium text-foreground">
                              {faq.question || "—"}
                            </p>
                            <p className="mt-0.5 text-muted-foreground">
                              {faq.answer || "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="px-6 py-6 bg-[linear-gradient(180deg,hsl(var(--muted)/0.35)_0%,transparent_120px)]">
                  <article className="mx-auto max-w-2xl">
                    <ReactMarkdown components={markdownComponents}>
                      {bodyForReader(selected.body)}
                    </ReactMarkdown>

                    {asSourceList(selected.where_things_stand_sources).length >
                      0 && (
                      <section className="mt-10 pt-6 border-t border-border">
                        <h2 className="text-xl font-semibold tracking-tight text-foreground mb-4">
                          Sources
                        </h2>
                        <ul className="space-y-2 text-sm">
                          {asSourceList(
                            selected.where_things_stand_sources
                          ).map((source, i) => (
                            <li key={`article-source-${i}`}>
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
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete article?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes “
              {deleteTarget?.title || deleteTarget?.slug || "this article"}
              ” from the Articles library. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function displayLiveUrl(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function formatScannedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function DetailRow({ label, value, mono }) {
  const display = value != null && String(value).trim() !== "" ? String(value) : null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </p>
      <div
        className={`text-foreground break-words ${mono ? "font-mono text-xs" : ""}`}
      >
        {display || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function DetailList({ label, items }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground">—</p>
      ) : (
        <p className="text-foreground break-words">{items.join(", ")}</p>
      )}
    </div>
  );
}
