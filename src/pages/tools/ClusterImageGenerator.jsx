import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { getImageryContext, getImageryPalette } from "@/lib/design/getImageryContext";
import {
  DEFAULT_STYLE_SPEC,
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  PILLAR_LEVEL_VALUE,
} from "./clusterImage/defaults";
import {
  canvasToPngBlob,
  downloadBlob,
  drawClusterImage,
} from "./clusterImage/drawClusterImage";
import { ensureFontLoaded } from "./clusterImage/ensureFont";
import { buildHeroFilename, slugify } from "./clusterImage/slugify";
import {
  readCachedStyleSpec,
  writeCachedStyleSpec,
} from "./clusterImage/styleSpecCache";

function normalizePillarsFromCoverage(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((pillar) => {
      const keyword = String(pillar?.keyword || "").trim();
      if (!keyword) return null;
      const slug = String(pillar?.slug || slugify(keyword)).trim() || slugify(keyword);
      const supporting = (Array.isArray(pillar?.supporting) ? pillar.supporting : [])
        .map((sup) => {
          const supKeyword = String(sup?.keyword || "").trim();
          if (!supKeyword) return null;
          const supSlug =
            String(sup?.slug || slugify(supKeyword)).trim() || slugify(supKeyword);
          return { slug: supSlug, keyword: supKeyword };
        })
        .filter(Boolean);
      return { slug, keyword, supporting };
    })
    .filter(Boolean);
}

function normalizePillarsFromCoreKeywords(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") {
        const keyword = item.trim();
        if (!keyword) return null;
        return { slug: slugify(keyword), keyword, supporting: [] };
      }
      const keyword = String(item?.keyword || "").trim();
      if (!keyword) return null;
      const supporting = (Array.isArray(item?.supporting) ? item.supporting : [])
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .map((supKeyword) => ({
          slug: slugify(supKeyword),
          keyword: supKeyword,
        }));
      return { slug: slugify(keyword), keyword, supporting };
    })
    .filter(Boolean);
}

export default function ClusterImageGenerator() {
  const { companyId } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [productName, setProductName] = useState("");
  const [domain, setDomain] = useState("");
  const [imageryContext, setImageryContext] = useState("");
  const [palette, setPalette] = useState(null);
  const [pillars, setPillars] = useState([]);

  const [pillarSlug, setPillarSlug] = useState("");
  const [supportingValue, setSupportingValue] = useState(PILLAR_LEVEL_VALUE);
  const [impactPrompt, setImpactPrompt] = useState("");
  const [extraGuidelines, setExtraGuidelines] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [styleSpec, setStyleSpec] = useState(DEFAULT_STYLE_SPEC);
  const [specLoading, setSpecLoading] = useState(false);
  const [specError, setSpecError] = useState("");
  const [usingDefaultSpec, setUsingDefaultSpec] = useState(true);

  const [exporting, setExporting] = useState(false);
  const [recent, setRecent] = useState([]);

  const selectedPillar = useMemo(
    () => pillars.find((p) => p.slug === pillarSlug) || null,
    [pillars, pillarSlug]
  );

  const supportingKeyword =
    supportingValue === PILLAR_LEVEL_VALUE
      ? ""
      : selectedPillar?.supporting?.find((s) => s.slug === supportingValue)?.keyword ||
        "";

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, profileResult, coverageResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select("product_name, domain, design_guide_raw, core_keywords")
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("content_coverage")
        .select("pillars")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

    if (companyResult.error) {
      console.error(companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
      setLoading(false);
      return;
    }

    if (profileResult.error) {
      console.error(profileResult.error);
      setError(profileResult.error.message || "Failed to load company profile");
      setLoading(false);
      return;
    }

    if (coverageResult.error) {
      console.error(coverageResult.error);
      setError(coverageResult.error.message || "Failed to load content coverage");
      setLoading(false);
      return;
    }

    setCompanyName(companyResult.data?.name || "");
    setProductName(profileResult.data?.product_name || "");
    setDomain(profileResult.data?.domain || "");
    const guide = profileResult.data?.design_guide_raw;
    setImageryContext(getImageryContext(guide));
    setPalette(getImageryPalette(guide));

    const fromCoverage = normalizePillarsFromCoverage(coverageResult.data?.pillars);
    const fromCore = normalizePillarsFromCoreKeywords(
      profileResult.data?.core_keywords
    );
    const nextPillars = fromCoverage.length > 0 ? fromCoverage : fromCore;
    setPillars(nextPillars);

    if (nextPillars.length > 0) {
      setPillarSlug((prev) =>
        nextPillars.some((p) => p.slug === prev) ? prev : nextPillars[0].slug
      );
      setSupportingValue(PILLAR_LEVEL_VALUE);
    } else {
      setPillarSlug("");
      setSupportingValue(PILLAR_LEVEL_VALUE);
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Resolve style spec once per company + imagery brief (cached in localStorage).
  useEffect(() => {
    let cancelled = false;

    async function resolveSpec() {
      if (!companyId || loading) return;

      const imagery = imageryContext;
      if (!imagery) {
        setStyleSpec(DEFAULT_STYLE_SPEC);
        setUsingDefaultSpec(true);
        setSpecError("");
        setSpecLoading(false);
        return;
      }

      const cached = readCachedStyleSpec(companyId, imagery);
      if (cached) {
        setStyleSpec({ ...DEFAULT_STYLE_SPEC, ...cached });
        setUsingDefaultSpec(false);
        setSpecError("");
        setSpecLoading(false);
        return;
      }

      setSpecLoading(true);
      setSpecError("");

      try {
        const res = await fetch("/api/cluster-image-spec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagery, palette }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Style spec failed (${res.status})`);
        }
        if (cancelled) return;

        const spec = { ...DEFAULT_STYLE_SPEC, ...(data.spec || {}) };
        writeCachedStyleSpec(companyId, imagery, spec);
        setStyleSpec(spec);
        setUsingDefaultSpec(false);
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setStyleSpec(DEFAULT_STYLE_SPEC);
        setUsingDefaultSpec(true);
        setSpecError(err?.message || "Failed to derive style from Design Guide (Imagery)");
      } finally {
        if (!cancelled) setSpecLoading(false);
      }
    }

    resolveSpec();
    return () => {
      cancelled = true;
    };
  }, [companyId, imageryContext, palette, loading]);

  const plannedImageCount = selectedPillar ? 1 : 0;

  const handlePillarChange = (value) => {
    setPillarSlug(value);
    setSupportingValue(PILLAR_LEVEL_VALUE);
  };

  async function resolveSpecForGenerate() {
    const extra = extraGuidelines.trim();
    if (!extra || !imageryContext) return styleSpec;

    const imagery = `${imageryContext}\n\nAdditional guidelines:\n${extra}`;
    const res = await fetch("/api/cluster-image-spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagery, palette }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Style spec failed (${res.status})`);
    }
    return { ...DEFAULT_STYLE_SPEC, ...(data.spec || {}) };
  }

  const handleDownload = async () => {
    if (!selectedPillar || exporting) return;

    setConfirmOpen(false);
    setExporting(true);
    setError("");

    try {
      const spec = await resolveSpecForGenerate();
      await ensureFontLoaded(spec.fontFamily);

      const canvas = document.createElement("canvas");
      canvas.width = IMAGE_WIDTH;
      canvas.height = IMAGE_HEIGHT;
      drawClusterImage(canvas, {
        spec,
        companyName,
        productName,
        domain,
        pillarKeyword: selectedPillar.keyword,
        supportingKeyword,
        impact: impactPrompt.trim(),
      });

      const blob = await canvasToPngBlob(canvas);
      const filename = buildHeroFilename(
        selectedPillar.slug,
        supportingValue === PILLAR_LEVEL_VALUE ? "" : supportingValue
      );
      downloadBlob(blob, filename);

      const label = supportingKeyword
        ? `${selectedPillar.keyword} → ${supportingKeyword}`
        : `${selectedPillar.keyword} (pillar)`;

      setRecent((prev) => {
        const next = [
          {
            id: `${Date.now()}`,
            label,
            filename,
            blob,
            at: new Date().toISOString(),
          },
          ...prev.filter((item) => item.filename !== filename),
        ];
        return next.slice(0, 8);
      });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to export PNG");
    } finally {
      setExporting(false);
    }
  };

  const handleRedownload = (item) => {
    if (!item?.blob) return;
    downloadBlob(item.blob, item.filename);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xs text-foreground mb-1">Cluster Image Generator</h1>
        <p className="text-sm text-muted-foreground">
          Branded 16:9 topic cards ({IMAGE_WIDTH}×{IMAGE_HEIGHT}) for pillar and
          cluster hero images.
        </p>
      </div>

      {!imageryContext && (
        <div className="rounded-lg border border-dashed border-border px-4 py-4 text-sm">
          <p className="text-foreground">
            No Design Guide (Imagery) set for this company yet — add one in Design
            for on-brand results
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to={`/company/${companyId}/design-guide-builder`}>Design</Link>
          </Button>
        </div>
      )}

      {pillars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-foreground font-medium">No pillars found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add pillar keywords in{" "}
            <Link
              to={`/company/${companyId}/company-data`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Company Data
            </Link>
            , then plan coverage in{" "}
            <Link
              to={`/company/${companyId}/article-generation`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Cluster Generation
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          {!imageryContext ? null : (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Design Guide (Imagery)
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap max-h-40 overflow-auto">
                {imageryContext}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cluster-impact-prompt">Image prompt</Label>
            <Textarea
              id="cluster-impact-prompt"
              value={impactPrompt}
              onChange={(e) => setImpactPrompt(e.target.value)}
              className="min-h-[120px]"
              placeholder="Impact — optional headline or direction for this card…"
              disabled={exporting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cluster-extra-guidelines">
              Additional guidelines{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="cluster-extra-guidelines"
              value={extraGuidelines}
              onChange={(e) => setExtraGuidelines(e.target.value)}
              className="min-h-[80px]"
              placeholder="e.g. bolder type, more contrast, no extra decoration…"
              disabled={exporting}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Pillar</Label>
              <Select value={pillarSlug} onValueChange={handlePillarChange}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select pillar" />
                </SelectTrigger>
                <SelectContent>
                  {pillars.map((pillar) => (
                    <SelectItem key={pillar.slug} value={pillar.slug}>
                      {pillar.keyword}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Supporting keyword (cluster)</Label>
              <Select
                value={supportingValue}
                onValueChange={setSupportingValue}
                disabled={!selectedPillar}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select cluster" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PILLAR_LEVEL_VALUE}>
                    Pillar level (hero)
                  </SelectItem>
                  {(selectedPillar?.supporting || []).map((sup) => (
                    <SelectItem key={sup.slug} value={sup.slug}>
                      {sup.keyword}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm space-y-1">
            <p className="text-muted-foreground">
              <span className="text-foreground">Product:</span>{" "}
              {productName || companyName || "—"}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Domain:</span> {domain || "—"}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Style:</span>{" "}
              {specLoading
                ? "Deriving from Design Guide (Imagery)…"
                : usingDefaultSpec
                  ? "Neutral default"
                  : `${styleSpec.style} · ${styleSpec.fontFamily}`}
            </p>
            {specError && (
              <p className="text-destructive">
                {specError} — using neutral default palette.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!selectedPillar || exporting || specLoading}
            >
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exporting…
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Generate &amp; Download
                </>
              )}
            </Button>
          </div>

          {recent.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Recently generated</p>
              <ul className="rounded-lg border border-border divide-y divide-border">
                {recent.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground truncate">{item.label}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {item.filename}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRedownload(item)}
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate &amp; Download</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate {plannedImageCount}{" "}
              {plannedImageCount === 1 ? "image" : "images"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={exporting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!selectedPillar || exporting}
              onClick={(event) => {
                event.preventDefault();
                handleDownload();
              }}
            >
              Generate &amp; Download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
