import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Download, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getImageryContext } from "@/lib/design/getImageryContext";
import { CURSOR_IMPLEMENT_PROMPT } from "./siteContentBuild/buildSiteContentPrompt";
import { parsePlaceholders } from "./siteContentBuild/parsePlaceholders";
import LengthCheck from "./siteContentBuild/LengthCheck";
import {
  IMAGE_SIZES,
  downloadGeneratedImage,
  generateOneImage,
  imageSrcFromResult,
} from "./aiImage/generateImageClient";

function PromptBlock({ label, text }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
      setCopyError("Failed to copy to clipboard");
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}
      <pre className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words text-foreground/90">
        {text}
      </pre>
    </div>
  );
}

export default function SiteContentBuild() {
  const { companyId } = useParams();

  const [error, setError] = useState("");
  const [imageryContext, setImageryContext] = useState("");

  const [placeholderReport, setPlaceholderReport] = useState("");
  const [placeholderRows, setPlaceholderRows] = useState([]);
  const [imageSize, setImageSize] = useState("1024x1024");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStep, setBatchStep] = useState(0);
  const [batchLabel, setBatchLabel] = useState("");
  const [singleRunningId, setSingleRunningId] = useState(null);

  useEffect(() => {
    if (!companyId) return undefined;

    let cancelled = false;
    (async () => {
      const { data, error: profileError } = await supabase
        .from("company_profiles")
        .select("design_guide_raw")
        .eq("company_id", companyId)
        .maybeSingle();

      if (cancelled || profileError) return;
      setImageryContext(getImageryContext(data?.design_guide_raw));
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const updatePlaceholderRow = (id, patch) => {
    setPlaceholderRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const handleParsePlaceholders = () => {
    setError("");
    const parsed = parsePlaceholders(placeholderReport);
    if (parsed.length === 0) {
      setError(
        "No image briefs found. Paste the QA image-brief list (page → section → slide → brief)."
      );
      setPlaceholderRows([]);
      return;
    }
    setPlaceholderRows(
      parsed.map((item, index) => ({
        id: `ph-${index}-${Date.now()}`,
        label: item.label,
        description: item.description,
        status: "idle",
        error: null,
        result: null,
      }))
    );
  };

  const runGenerateForRow = async (row) =>
    generateOneImage({
      prompt: row.description,
      size: imageSize,
      styleContext: imageryContext,
    });

  const handleGenerateOne = async (rowId) => {
    const row = placeholderRows.find((r) => r.id === rowId);
    if (!row || batchRunning || singleRunningId != null) return;

    setError("");
    setSingleRunningId(rowId);
    updatePlaceholderRow(rowId, { status: "running", error: null });

    try {
      const result = await runGenerateForRow(row);
      updatePlaceholderRow(rowId, { status: "done", result, error: null });
    } catch (err) {
      updatePlaceholderRow(rowId, {
        status: "failed",
        error: err?.message || "Generation failed",
      });
    } finally {
      setSingleRunningId(null);
    }
  };

  const handleGenerateAll = async () => {
    if (batchRunning || singleRunningId != null || placeholderRows.length === 0) {
      return;
    }

    setError("");
    setBatchRunning(true);
    setBatchStep(0);
    setBatchLabel("");

    const rows = placeholderRows.slice();
    for (let step = 0; step < rows.length; step += 1) {
      const row = rows[step];
      setBatchStep(step + 1);
      setBatchLabel(row.label);
      updatePlaceholderRow(row.id, { status: "running", error: null });

      try {
        const result = await runGenerateForRow(row);
        updatePlaceholderRow(row.id, { status: "done", result, error: null });
      } catch (err) {
        updatePlaceholderRow(row.id, {
          status: "failed",
          error: err?.message || "Generation failed",
        });
      }
    }

    setBatchRunning(false);
    setBatchLabel("");
  };

  const handleDownload = async (row) => {
    if (!row?.result) return;
    try {
      await downloadGeneratedImage(row.label, row.result);
    } catch (err) {
      console.error("Download failed:", err);
      setError(err?.message || "Failed to download image");
    }
  };

  const batchProgressPct =
    placeholderRows.length > 0 && batchStep > 0
      ? Math.round((batchStep / placeholderRows.length) * 100)
      : 0;
  const generationBusy = batchRunning || singleRunningId != null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xs text-foreground mb-1">Implement content in Cursor</h1>
        <p className="text-sm text-muted-foreground">
          Paste this prompt into Cursor, then paste ChatGPT&apos;s full response
          below it.
        </p>
      </div>

      <PromptBlock label="Cursor prompt" text={CURSOR_IMPLEMENT_PROMPT} />

      <LengthCheck />

      <section className="space-y-4">
        <div>
          <h2 className="text-xs text-foreground">Image briefs</h2>
          <p className="text-sm text-muted-foreground">
            Paste the QA section from ChatGPT&apos;s response. Each image brief
            (page → section → slide → brief) can be generated and downloaded,
            then saved under site/src/assets/.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="space-y-2">
          <Label htmlFor="placeholder-report">QA image-brief list</Label>
          <Textarea
            id="placeholder-report"
            value={placeholderReport}
            onChange={(e) => setPlaceholderReport(e.target.value)}
            className="min-h-[140px] font-mono text-xs"
            placeholder={
              "=== QA ===\n4. Image briefs\nhome → hero → slide 1 → A person at a desk, framed for a 4:5 vertical crop..."
            }
            disabled={generationBusy}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2 w-full sm:w-[200px]">
            <Label htmlFor="image-size">Size (all images)</Label>
            <Select
              value={imageSize}
              onValueChange={setImageSize}
              disabled={generationBusy}
            >
              <SelectTrigger id="image-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleParsePlaceholders}
            disabled={generationBusy || !placeholderReport.trim()}
          >
            Parse image briefs
          </Button>
          <Button
            type="button"
            onClick={handleGenerateAll}
            disabled={generationBusy || placeholderRows.length === 0}
          >
            {batchRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate All"
            )}
          </Button>
        </div>

        {batchRunning && (
          <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                Generating {batchStep} of {placeholderRows.length}
                {batchLabel ? `: ${batchLabel}` : ""}
              </span>
            </div>
            <Progress value={batchProgressPct} className="h-1.5" />
          </div>
        )}

        {placeholderRows.length > 0 && (
          <ul className="space-y-3">
            {placeholderRows.map((row) => {
              const src = imageSrcFromResult(row.result);
              const isRowBusy =
                row.status === "running" ||
                (generationBusy && singleRunningId === row.id);
              return (
                <li
                  key={row.id}
                  className="rounded-lg border border-border p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {row.label}
                      </p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {row.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Status:{" "}
                        {row.status === "idle" && "Ready"}
                        {row.status === "running" && "Generating…"}
                        {row.status === "done" && "Done"}
                        {row.status === "failed" && "Failed"}
                      </p>
                      {row.error ? (
                        <p className="text-xs text-destructive">{row.error}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {row.status === "done" ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(row)}
                            disabled={generationBusy}
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleGenerateOne(row.id)}
                            disabled={generationBusy}
                          >
                            Regenerate
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleGenerateOne(row.id)}
                          disabled={generationBusy}
                        >
                          {isRowBusy ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Generating…
                            </>
                          ) : row.status === "failed" ? (
                            "Retry"
                          ) : (
                            "Generate"
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                  {src ? (
                    <img
                      src={src}
                      alt={row.label}
                      className="max-h-64 w-auto rounded-md border border-border"
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
