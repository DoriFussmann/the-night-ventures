import React, { useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  parseClusterMarkdown,
  resolveSourceType,
  totalWordCount,
} from "./articleGeneration/parseClusterMarkdown";

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

export default function ArticleGeneration() {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [detailIndex, setDetailIndex] = useState(null);

  const resetIntake = () => {
    setParsed(null);
    setSelected(new Set());
    setDetailIndex(null);
    setParseError(null);
    setFileName("");
  };

  const applyParsed = (result, name) => {
    const indices = new Set(result.articles.map((_, i) => i));
    setParsed(result);
    setSelected(indices);
    setDetailIndex(null);
    setParseError(null);
    setFileName(name || "");
  };

  const handleFile = async (file) => {
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".markdown") && file.type !== "text/markdown") {
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

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-[15px] text-foreground mb-1">Article Generator</h1>
        <p className="text-sm text-muted-foreground">
          Drop a cluster or pillar markdown export to review and select articles.
        </p>
      </div>

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
              Loaded <span className="font-medium">{fileName || "markdown file"}</span>
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
              Accepts Topic Generator exports — cluster (3–6 articles) or pillar (1 article)
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
          <p className="text-sm font-medium text-destructive mb-0.5">Could not parse file</p>
          <p className="text-sm text-destructive/90">{parseError}</p>
          {fileName && (
            <p className="text-xs text-muted-foreground mt-1">File: {fileName}</p>
          )}
        </div>
      )}

      {parsed && (
        <>
          {/* Summary strip */}
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

          {/* Article list */}
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

      {/* Detail modal */}
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
                <DetailRow label="targetKeyword" value={detailArticle.targetKeyword} />
                <DetailRow
                  label="type"
                  value={<TypeBadge type={detailArticle.type} />}
                />
                <DetailRow
                  label="status"
                  value={<StatusBadge status={detailArticle.status} />}
                />
                <DetailRow label="searchIntent" value={detailArticle.searchIntent} />
                <DetailRow
                  label="wordCount"
                  value={formatNumber(detailArticle.wordCount)}
                />
                <DetailRow label="ctaAngle" value={detailArticle.ctaAngle} />
                <DetailList label="keyMessages" items={detailArticle.keyMessages} />
                <DetailList label="internalLinks" items={detailArticle.internalLinks} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Selection footer */}
      {parsed && (
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
              <Button type="button" variant="outline" size="sm" onClick={selectNone}>
                Select none
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled
              title="Coming soon"
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
