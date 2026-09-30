import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Download, ExternalLink, Loader2, Radar, Search, Square, Upload, Wand2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { scanLiveArticles } from "./articles/scanLiveApi";
import FaceliftPanel from "./articles/FaceliftPanel";
import ArticleCmsDialog from "./articles/ArticleCmsDialog";
import { isLibraryDraft, publishDrafts } from "./articles/publishDrafts";
import { Input } from "@/components/ui/input";
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

const BULK_PHASE_LABELS = {
  checking: "Checking",
  image: "Generating image",
  publishing: "Publishing",
  done: "Done",
};

const OUTCOME_COLORS = {
  published: "text-emerald-700",
  skipped: "text-amber-700",
  failed: "text-red-700",
};

function countOutcome(results, outcome) {
  return results.filter((r) => r.outcome === outcome).length;
}

// Mirrors StatusBadge: anything not "published" displays (and filters) as drafted.
function articleStatusKey(article) {
  return article?.status === "published" ? "published" : "drafted";
}

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

function formatDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  return raw;
}

function indexLiveRows(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const slug = String(row?.slug || "").trim();
    if (slug) map.set(slug, row);
  }
  return map;
}

function overlayLibraryArticle(article, live) {
  if (!live) return article;
  const found = !live.error;
  return {
    ...article,
    status: found
      ? live.status || (live.draft ? "drafted" : "published")
      : article.status,
    updated_date: live.lastDate || article.updated_date,
    date: live.lastDate || article.date,
    published_url: live.url || article.published_url,
    internalLinks: live.internalLinks,
    externalLinks: live.externalLinks,
    liveError: live.error || null,
  };
}

function liveOnlyArticle(live) {
  return {
    id: null,
    slug: live.slug,
    title: live.title || live.slug,
    type: live.articleType,
    articleType: live.articleType,
    pillar_keyword: live.pillarKeyword,
    target_keyword: live.keyword,
    supporting_keyword: live.keywordRole === "supporting" ? live.keyword : "",
    keywordRole: live.keywordRole,
    status: live.status || (live.draft ? "drafted" : "published"),
    updated_date: live.lastDate,
    date: live.lastDate,
    published_url: live.url,
    internalLinks: live.internalLinks,
    externalLinks: live.externalLinks,
    liveError: live.error || null,
    liveOnly: true,
  };
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
  const [statusFilter, setStatusFilter] = useState("all");

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkError, setBulkError] = useState("");
  const bulkStopRef = useRef(false);

  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [linkHealth, setLinkHealth] = useState(null);
  const [faceliftLiveRows, setFaceliftLiveRows] = useState([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setScanResult(null);
    setScanError("");
    setLinkHealth(null);
    setFaceliftLiveRows([]);
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

  const liveBySlug = useMemo(() => {
    const map = indexLiveRows(faceliftLiveRows);
    for (const [slug, row] of indexLiveRows(scanResult?.articles)) {
      map.set(slug, row);
    }
    return map;
  }, [faceliftLiveRows, scanResult]);

  const displayArticles = useMemo(() => {
    const used = new Set();
    const merged = articles.map((article) => {
      const slug = String(article.slug || "").trim();
      const live = slug ? liveBySlug.get(slug) : null;
      if (slug && live) used.add(slug);
      return overlayLibraryArticle(article, live);
    });
    for (const [slug, live] of liveBySlug) {
      if (used.has(slug)) continue;
      merged.push(liveOnlyArticle(live));
    }
    return merged;
  }, [articles, liveBySlug]);

  const pillarOptions = useMemo(() => {
    const set = new Set();
    for (const article of displayArticles) {
      const key = cleanPillar(article.pillar_keyword);
      if (key) set.add(key);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [displayArticles]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return displayArticles.filter((article) => {
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
      if (statusFilter !== "all" && articleStatusKey(article) !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const title = String(article.title || "").toLowerCase();
      const target = String(article.target_keyword || "").toLowerCase();
      return title.includes(q) || target.includes(q);
    });
  }, [
    displayArticles,
    debouncedSearch,
    pillarFilter,
    keywordRoleFilter,
    typeFilter,
    statusFilter,
    slugFilter,
  ]);

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

  const draftsInView = useMemo(
    () => filtered.filter(isLibraryDraft),
    [filtered]
  );

  const upsertArticleRow = (row) => {
    if (!row?.id) return;
    setArticles((prev) =>
      prev.map((item) => (item.id === row.id ? { ...item, ...row } : item))
    );
  };

  const publishDraftsInView = async () => {
    if (bulkRunning || draftsInView.length === 0 || !destinationMapped) return;
    const ok = window.confirm(
      `Publish ${draftsInView.length} drafted article(s) to ${publishDestination.owner}/${publishDestination.repo}?\n\n` +
        "For each one: check title, description, slug and body (skipped if any are missing), " +
        "generate a hero image if there isn't one, then publish. Runs one at a time — keep this tab open."
    );
    if (!ok) return;

    // Library data, not the live-scan overlay.
    const byId = new Map(articles.map((a) => [a.id, a]));
    const rows = draftsInView.map((a) => byId.get(a.id)).filter(Boolean);

    bulkStopRef.current = false;
    setBulkRunning(true);
    setBulkError("");
    setBulkResults([]);
    setBulkProgress(null);
    try {
      await publishDrafts({
        companyId,
        destination: publishDestination,
        rows,
        shouldStop: () => bulkStopRef.current,
        onRowUpdated: upsertArticleRow,
        onItem: (update) => {
          setBulkProgress(update);
          if (update.phase === "done") {
            setBulkResults((prev) => [...(prev || []), update]);
          }
        },
      });
    } catch (err) {
      setBulkError(err?.message || "Bulk publish failed");
    } finally {
      setBulkRunning(false);
      setBulkProgress(null);
    }
  };

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

  const hasLibraryArticles = articles.length > 0;
  const hasAnyArticles = displayArticles.length > 0;
  const showLiveFields = liveBySlug.size > 0 || Boolean(linkHealth);
  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    pillarFilter !== "all" ||
    keywordRoleFilter !== "all" ||
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    Boolean(slugFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xs text-foreground mb-1">Articles</h1>
          <p className="text-sm text-muted-foreground">
            CMS for this company’s destination site. Open an article to edit,
            replace its image, save, or publish — each action commits to the
            live repo. Scan Live updates this table from the published site.
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

      {scanResult ? (
        <p className="text-sm text-muted-foreground">
          Table updated from{" "}
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
          {typeof scanResult.articleCount === "number"
            ? ` · ${scanResult.articleCount} live ${
                scanResult.articleCount === 1 ? "article" : "articles"
              }`
            : ""}
          . Live fields stay in this view and are not saved to the library.
        </p>
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
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          disabled={!hasAnyArticles}
        >
          <SelectTrigger className="w-full sm:w-[150px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="drafted">Drafted</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          disabled={!hasLibraryArticles || loading || downloadingSummary}
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
      {draftsInView.length > 0 || bulkRunning || bulkResults ? (
        <div className="rounded-lg border border-border px-3 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-9"
              disabled={
                bulkRunning ||
                publishing ||
                loading ||
                draftsInView.length === 0 ||
                !destinationMapped
              }
              onClick={publishDraftsInView}
            >
              {bulkRunning ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              )}
              {bulkRunning
                ? "Publishing drafts…"
                : `Fix & publish drafts (${draftsInView.length})`}
            </Button>
            {bulkRunning ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  bulkStopRef.current = true;
                }}
              >
                <Square className="h-3.5 w-3.5 mr-1.5" />
                Stop after current
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">
              Drafts in the current view. Adds a hero image where missing, then publishes.
            </span>
          </div>
          {bulkProgress ? (
            <p className="text-sm text-muted-foreground">
              {bulkProgress.index + 1}/{bulkProgress.total} ·{" "}
              {BULK_PHASE_LABELS[bulkProgress.phase] || "Working"}:{" "}
              <span className="text-foreground">{bulkProgress.title}</span>
            </p>
          ) : null}
          {bulkError ? (
            <p className="text-sm text-destructive">{bulkError}</p>
          ) : null}
          {bulkResults && bulkResults.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {countOutcome(bulkResults, "published")} published ·{" "}
                {countOutcome(bulkResults, "skipped")} skipped ·{" "}
                {countOutcome(bulkResults, "failed")} failed ·{" "}
                {bulkResults.filter((r) => r.imageGenerated).length} images generated
              </p>
              <ul className="text-xs space-y-0.5 max-h-48 overflow-y-auto">
                {bulkResults.map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <span className={`shrink-0 font-medium ${OUTCOME_COLORS[r.outcome] || ""}`}>
                      {r.outcome}
                    </span>
                    <span className="truncate text-foreground">{r.title}</span>
                    <span className="text-muted-foreground">— {r.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {publishDestination && !destinationMapped && hasLibraryArticles && (
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
          <p className="text-sm text-foreground font-medium">
            {scanResult ? "No live articles found" : "No articles saved yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {scanResult ? (
              "Sitemap, RSS, and the /articles/ listing returned no article URLs for this domain."
            ) : (
              <>
                Nothing in the library yet. Generate articles in{" "}
                <Link
                  to={`/company/${companyId}/article-generation`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Cluster Generation
                </Link>{" "}
                or{" "}
                <Link
                  to={`/company/${companyId}/pillar-automation`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Pillar Generation
                </Link>
                , then edit and publish them here.
              </>
            )}
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className={`w-full text-sm${showLiveFields ? " min-w-[56rem]" : ""}`}>
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Related Pillar
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Refresh Days
                </th>
                <th className="px-3 py-2 font-medium">Date</th>
                {showLiveFields ? (
                  <>
                    <th className="px-3 py-2 font-medium text-center">URL</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                      Internal
                    </th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">
                      External
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((article) => {
                const days = daysSinceUpdate(
                  article.updated_date || article.date
                );
                const canOpen = Boolean(article.id) && !article.liveOnly;
                const liveUrl = article.published_url;
                return (
                  <tr
                    key={article.id || article.slug}
                    onClick={() => {
                      if (canOpen) setSelectedId(article.id);
                    }}
                    className={
                      canOpen ? "cursor-pointer hover:bg-muted/40" : "align-top"
                    }
                  >
                    <td className="max-w-[24rem] px-3 py-2.5 font-medium text-foreground">
                      <span className="block truncate">
                        {article.title || "(untitled)"}
                      </span>
                      {article.liveError ? (
                        <p className="mt-0.5 text-xs font-normal text-destructive">
                          {article.liveError}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <TypeBadge type={articleTypeKey(article)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <PillarBadge keyword={article.pillar_keyword} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={article.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      {days == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={`tabular-nums ${daysSinceUpdateBadgeClass(days)}`}
                        >
                          {days}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                      {formatDisplayDate(
                        article.updated_date || article.date
                      )}
                    </td>
                    {showLiveFields ? (
                      <>
                        <td className="px-3 py-2.5 text-center">
                          {liveUrl ? (
                            <a
                              href={liveUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open ${liveUrl}`}
                              aria-label={`Open ${article.title || article.slug || "article"}`}
                              onClick={(event) => event.stopPropagation()}
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
                            row={article}
                            health={linkHealth}
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <LinkHealthCell
                            kind="external"
                            row={article}
                            health={linkHealth}
                          />
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ArticleCmsDialog
        article={selected}
        companyId={companyId}
        destination={publishDestination}
        open={selected != null}
        deleting={deleting}
        onOpenChange={(next) => {
          if (!next) setSelectedId(null);
        }}
        onDelete={() => selected && setDeleteId(selected.id)}
        onUpdated={upsertArticleRow}
        badges={
          selected ? (
            <>
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
            </>
          ) : null
        }
      />

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

