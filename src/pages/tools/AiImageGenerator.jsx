import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IMAGE_SIZES,
  appendKeywordContext,
  buildStyleContext,
  downloadGeneratedImage,
  generateOneImage,
  imageSrcFromResult,
} from "./aiImage/generateImageClient";
import {
  deleteSavedPrompt,
  loadSavedPrompts,
  savePrompt,
} from "./aiImage/savedPrompts";
import { slugify } from "./clusterImage/slugify";

const NONE_VALUE = "__none__";

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

function promptPreview(text, max = 90) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

export default function AiImageGenerator() {
  const { companyId } = useParams();

  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const [designGuideAbstract, setDesignGuideAbstract] = useState("");
  const [prompt, setPrompt] = useState("");
  const [extraGuidelines, setExtraGuidelines] = useState("");
  const [imageSize, setImageSize] = useState("1024x1024");
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [pillars, setPillars] = useState([]);
  const [pillarSlug, setPillarSlug] = useState(NONE_VALUE);
  const [supportingValue, setSupportingValue] = useState(NONE_VALUE);

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);

  const loadCompanyData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, profileResult, coverageResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select("design_guide_abstract, core_keywords")
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
    setDesignGuideAbstract(
      String(profileResult.data?.design_guide_abstract || "").trim()
    );
    const fromCoverage = normalizePillarsFromCoverage(coverageResult.data?.pillars);
    const fromCore = normalizePillarsFromCoreKeywords(
      profileResult.data?.core_keywords
    );
    setPillars(fromCoverage.length > 0 ? fromCoverage : fromCore);
    setPillarSlug(NONE_VALUE);
    setSupportingValue(NONE_VALUE);
    setSavedPrompts(loadSavedPrompts(companyId));
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadCompanyData();
  }, [loadCompanyData]);

  const designGuideMissing = !designGuideAbstract.trim();
  const previewSrc = imageSrcFromResult(result);

  const handleSavePrompt = () => {
    const trimmed = prompt.trim();
    if (!trimmed || !companyId) return;

    try {
      const entry = savePrompt(companyId, trimmed);
      if (!entry) return;
      setSavedPrompts(loadSavedPrompts(companyId));
      setSaveMessage("Prompt saved");
      window.setTimeout(() => setSaveMessage(""), 2000);
    } catch (err) {
      console.error("Failed to save prompt:", err);
      setError(err?.message || "Failed to save prompt");
    }
  };

  const handleLoadSaved = (entry) => {
    setPrompt(entry.prompt || "");
    setError("");
    setSaveMessage("Loaded saved prompt");
    window.setTimeout(() => setSaveMessage(""), 2000);
  };

  const handleDeleteSaved = (promptId) => {
    try {
      const next = deleteSavedPrompt(companyId, promptId);
      setSavedPrompts(next);
    } catch (err) {
      console.error("Failed to delete prompt:", err);
      setError(err?.message || "Failed to delete prompt");
    }
  };

  const selectedPillar =
    pillarSlug === NONE_VALUE
      ? null
      : pillars.find((pillar) => pillar.slug === pillarSlug) || null;
  const pillarKeyword = selectedPillar?.keyword || "";
  const supportingKeyword =
    supportingValue === NONE_VALUE
      ? ""
      : selectedPillar?.supporting?.find((item) => item.slug === supportingValue)
          ?.keyword || "";

  const handlePillarChange = (value) => {
    setPillarSlug(value);
    setSupportingValue(NONE_VALUE);
  };

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || generating) return;

    setError("");
    setGenerating(true);

    try {
      const styleContext = buildStyleContext(
        designGuideAbstract,
        extraGuidelines
      );
      const data = await generateOneImage({
        prompt: appendKeywordContext(
          trimmed,
          pillarKeyword,
          supportingKeyword
        ),
        size: imageSize,
        styleContext,
      });
      setResult(data);
    } catch (err) {
      console.error("Image generation failed:", err);
      setError(err?.message || "Image generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!result) return;
    try {
      await downloadGeneratedImage(prompt.trim().slice(0, 40) || "image", result);
    } catch (err) {
      console.error("Download failed:", err);
      setError(err?.message || "Failed to download image");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading company data...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[15px] text-foreground mb-1">Image Generator</h1>
        <p className="text-sm text-muted-foreground">
          {companyName
            ? `Generate a single image for ${companyName} using Design Guidelines from Company Data.`
            : "Generate a single image using Design Guidelines from Company Data."}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {designGuideMissing && (
        <Alert variant="destructive">
          <AlertDescription>
            No Design Guidelines set — generated images will not follow brand
            direction. Set this in{" "}
            <Link
              to={`/company/${companyId}/company-data`}
              className="font-medium underline underline-offset-2"
            >
              Company Data
            </Link>{" "}
            first for on-brand results.
          </AlertDescription>
        </Alert>
      )}

      {!designGuideMissing && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Design Guidelines (from Company Data)
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap max-h-40 overflow-auto">
            {designGuideAbstract}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Pillar keyword</Label>
          <Select
            value={pillarSlug}
            onValueChange={handlePillarChange}
            disabled={generating}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>None</SelectItem>
              {pillars.map((pillar) => (
                <SelectItem key={pillar.slug} value={pillar.slug}>
                  {pillar.keyword}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Supporting keyword</Label>
          <Select
            value={supportingValue}
            onValueChange={setSupportingValue}
            disabled={generating || !selectedPillar}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>None</SelectItem>
              {(selectedPillar?.supporting || []).map((sup) => (
                <SelectItem key={sup.slug} value={sup.slug}>
                  {sup.keyword}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="image-prompt">Image prompt</Label>
        <Textarea
          id="image-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[120px]"
          placeholder="Describe the image you want…"
          disabled={generating}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="extra-guidelines">
          Additional guidelines{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="extra-guidelines"
          value={extraGuidelines}
          onChange={(e) => setExtraGuidelines(e.target.value)}
          className="min-h-[80px]"
          placeholder="e.g. soft lighting, no text in the image, crop for square avatar…"
          disabled={generating}
        />
      </div>

      <div className="space-y-2 w-full sm:w-[200px]">
        <Label htmlFor="image-size">Size</Label>
        <Select
          value={imageSize}
          onValueChange={setImageSize}
          disabled={generating}
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

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !prompt.trim()}
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            "Generate"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleSavePrompt}
          disabled={generating || !prompt.trim()}
        >
          Save prompt
        </Button>
        {result && (
          <Button
            type="button"
            variant="outline"
            onClick={handleDownload}
            disabled={generating}
          >
            <Download className="w-4 h-4" />
            Download
          </Button>
        )}
        {saveMessage && (
          <span className="text-sm text-muted-foreground">{saveMessage}</span>
        )}
      </div>

      {savedPrompts.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-[15px] text-foreground">Saved prompts</h2>
            <p className="text-sm text-muted-foreground">
              Stored in this browser for this company. Click to load.
            </p>
          </div>
          <ul className="space-y-2">
            {savedPrompts.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-border px-3 py-2 flex items-start gap-2"
              >
                <button
                  type="button"
                  onClick={() => handleLoadSaved(entry)}
                  disabled={generating}
                  className="flex-1 min-w-0 text-left text-sm text-foreground hover:text-foreground/80 disabled:opacity-50"
                >
                  {promptPreview(entry.prompt)}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteSaved(entry.id)}
                  disabled={generating}
                  aria-label="Delete saved prompt"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {previewSrc ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          <img
            src={previewSrc}
            alt="Generated"
            className="max-h-[512px] w-auto rounded-md border border-border"
          />
        </div>
      ) : null}
    </div>
  );
}
