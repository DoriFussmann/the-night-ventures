import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Copy, Download, Loader2, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
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
import { buildBackfillFrontmatterPrompt } from "./articleGeneration/buildBackfillFrontmatterPrompt";
import {
  daysSinceUpdate,
  daysSinceUpdateBadgeClass,
  formatDaysSinceUpdateLabel,
} from "./articleGeneration/daysSinceUpdate";
import { downloadMarkdownFile } from "./articleGeneration/serializeArticleMarkdown";

const TYPE_OPTIONS = [
  { value: "pillar", label: "Pillar" },
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
  pillar: "bg-indigo-50 text-indigo-700 border-indigo-200",
  comprehensive: "bg-violet-50 text-violet-700 border-violet-200",
  howto: "bg-blue-50 text-blue-700 border-blue-200",
  comparison: "bg-amber-50 text-amber-800 border-amber-200",
  faq: "bg-teal-50 text-teal-700 border-teal-200",
  flex: "bg-slate-100 text-slate-600 border-slate-200",
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

function articleDisplayType(article) {
  if (isPillarArticle(article)) return "pillar";
  return TYPE_COLORS[article?.type] ? article.type : "flex";
}

function TypeBadge({ type }) {
  const key = TYPE_COLORS[type] ? type : "flex";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[key]}`}
    >
      {TYPE_LABELS[key] || key}
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

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pillarFilter, setPillarFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const [backfillPrompt, setBackfillPrompt] = useState("");
  const [backfillScope, setBackfillScope] = useState(null); // "published" | "all" | null
  const [backfillEmptyPublished, setBackfillEmptyPublished] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillCopyMessage, setBackfillCopyMessage] = useState("");
  const [backfillCount, setBackfillCount] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

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
      const key = String(article.pillar_keyword || "").trim();
      if (key) set.add(key);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [articles]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return articles.filter((article) => {
      if (slugFilter && article.slug !== slugFilter) return false;
      if (pillarFilter !== "all" && article.pillar_keyword !== pillarFilter) {
        return false;
      }
      if (typeFilter !== "all" && articleDisplayType(article) !== typeFilter) {
        return false;
      }
      if (!q) return true;
      const title = String(article.title || "").toLowerCase();
      const target = String(article.target_keyword || "").toLowerCase();
      return title.includes(q) || target.includes(q);
    });
  }, [articles, debouncedSearch, pillarFilter, typeFilter, slugFilter]);

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

  const generateBackfillPrompt = async ({ includeAll }) => {
    if (!companyId || backfillLoading) return;

    setBackfillLoading(true);
    setError("");
    setBackfillCopyMessage("");
    setBackfillEmptyPublished(false);

    try {
      let query = supabase
        .from("generated_articles")
        .select(
          "slug, pillar_keyword, supporting_keyword, type, target_keyword, status"
        )
        .eq("company_id", companyId)
        .not("slug", "is", null)
        .order("slug", { ascending: true });

      if (!includeAll) {
        query = query.eq("status", "published");
      }

      const { data, error: fetchError } = await query;
      if (fetchError) {
        throw new Error(fetchError.message || "Failed to load articles");
      }

      const rows = (data || []).filter((row) => String(row.slug || "").trim());

      if (!includeAll && rows.length === 0) {
        setBackfillPrompt("");
        setBackfillScope(null);
        setBackfillCount(0);
        setBackfillEmptyPublished(true);
        return;
      }

      const prompt = buildBackfillFrontmatterPrompt(rows);
      setBackfillPrompt(prompt);
      setBackfillScope(includeAll ? "all" : "published");
      setBackfillCount(rows.length);
      setBackfillEmptyPublished(false);
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to build backfill prompt");
      setBackfillPrompt("");
      setBackfillScope(null);
      setBackfillCount(0);
    } finally {
      setBackfillLoading(false);
    }
  };

  const copyBackfillPrompt = async () => {
    if (!backfillPrompt) return;
    try {
      await navigator.clipboard.writeText(backfillPrompt);
      setBackfillCopyMessage("Copied");
      setTimeout(() => setBackfillCopyMessage(""), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
      setBackfillCopyMessage("Copy failed");
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

  const hasAnyArticles = articles.length > 0;
  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    pillarFilter !== "all" ||
    typeFilter !== "all" ||
    Boolean(slugFilter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xs text-foreground mb-1">Articles</h1>
        <p className="text-sm text-muted-foreground">
          Saved drafts from Article Generator — full frontmatter and body.
          Status is read-only here; mark articles published in Topic Generator
          after shipping through the site CMS.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}

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
      </div>

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
            Generate drafts in{" "}
            <Link
              to={`/company/${companyId}/article-generation`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Article Generator
            </Link>
            , then use Save to add them here.
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
                <TypeBadge type={articleDisplayType(article)} />
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
                  <TypeBadge type={articleDisplayType(selected)} />
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

      <section className="space-y-3 rounded-lg border border-border p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Backfill Frontmatter
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One-time Cursor prompt for already-published site articles that
            predate{" "}
            <span className="font-mono text-xs">pillarKeyword</span> /{" "}
            <span className="font-mono text-xs">supportingKeyword</span> /{" "}
            <span className="font-mono text-xs">articleType</span> /{" "}
            <span className="font-mono text-xs">targetKeyword</span> in generated
            output. New Article Generator downloads already include these
            fields.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!companyId || loading || backfillLoading || !hasAnyArticles}
            onClick={() => generateBackfillPrompt({ includeAll: false })}
          >
            {backfillLoading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : null}
            Generate from Published
          </Button>
          {backfillPrompt && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyBackfillPrompt}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </Button>
          )}
          {backfillCopyMessage && (
            <span className="text-sm text-muted-foreground">
              {backfillCopyMessage}
            </span>
          )}
        </div>

        {backfillEmptyPublished && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-2">
            <p>
              No articles marked Published yet — mark your live articles as
              Published in Topic Generator first, or backfill all rows
              regardless of status.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={backfillLoading}
              onClick={() => generateBackfillPrompt({ includeAll: true })}
            >
              Backfill all rows anyway
            </Button>
          </div>
        )}

        {backfillPrompt && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {backfillCount} article
              {backfillCount === 1 ? "" : "s"} · scope:{" "}
              {backfillScope === "all"
                ? "all rows (status ignored)"
                : "published only"}
            </p>
            <pre className="max-h-[360px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs font-mono whitespace-pre-wrap text-foreground">
              {backfillPrompt}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
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
