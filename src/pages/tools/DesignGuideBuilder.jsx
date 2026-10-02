import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Copy, Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyBrand, defaultWordmark } from "@/lib/design/applyBrand";
import { buildDesignGuide } from "@/lib/design/buildDesignGuide";
import { buildCursorPrompt } from "@/lib/design/buildCursorPrompt";
import { GUIDE_FILENAME } from "@/lib/design/contract";
import { normalizeHex } from "@/lib/design/contrast";
import { previewFamily } from "@/lib/design/fonts";
import { LEGACY_TEMPLATE_IDS, TEMPLATES, getTemplate } from "@/lib/design/templates";
import DesignPreview from "./DesignPreview";

function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy} disabled={!text}>
      <Copy className="h-3.5 w-3.5" />
      {copied ? "Copied" : label}
    </Button>
  );
}

function OverrideToggle({ id, checked, onChange, title, hint }) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <div>
        <Label htmlFor={id} className="cursor-pointer text-sm text-foreground">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

export default function DesignGuideBuilder() {
  const { companyId } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [productName, setProductName] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [accentDraft, setAccentDraft] = useState("");
  const [wordmarkPrimary, setWordmarkPrimary] = useState("");
  const [wordmarkAccent, setWordmarkAccent] = useState("");
  const [forceInter, setForceInter] = useState(false);
  const [forceNoBold, setForceNoBold] = useState(false);
  const [legacyGuide, setLegacyGuide] = useState(false);
  const [viewport, setViewport] = useState("desktop");
  const [generated, setGenerated] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");

    const [companyResult, profileResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "id, product_name, design_template, brand_accent, wordmark_primary, wordmark_accent, design_guide_raw, force_inter, force_no_bold"
        )
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

    if (companyResult.error) {
      setError(companyResult.error.message || "Failed to load company");
      setLoading(false);
      return;
    }
    if (profileResult.error) {
      setError(profileResult.error.message || "Failed to load design");
      setLoading(false);
      return;
    }

    const profile = profileResult.data;
    const name = companyResult.data?.name || "";
    const product = profile?.product_name || "";
    const storedTemplate = getTemplate(profile?.design_template) ? profile.design_template : null;
    const storedAccent = normalizeHex(profile?.brand_accent) || "";
    const hasLegacy =
      LEGACY_TEMPLATE_IDS.includes(profile?.design_template) ||
      (!storedTemplate && Boolean(String(profile?.design_guide_raw || "").trim()));

    setCompanyName(name);
    setProductName(product);
    setProfileId(profile?.id || null);
    setTemplateId(storedTemplate);
    setAccentDraft(storedTemplate ? storedAccent : "");
    setForceInter(Boolean(profile?.force_inter));
    setForceNoBold(Boolean(profile?.force_no_bold));
    setLegacyGuide(hasLegacy && !storedTemplate);

    if (profile?.wordmark_primary == null && profile?.wordmark_accent == null) {
      const split = defaultWordmark(product || name);
      setWordmarkPrimary(split.wordmarkPrimary);
      setWordmarkAccent(split.wordmarkAccent);
    } else {
      setWordmarkPrimary(profile?.wordmark_primary || "");
      setWordmarkAccent(profile?.wordmark_accent || "");
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const template = templateId ? getTemplate(templateId) : null;
  const normalizedAccent = normalizeHex(accentDraft);
  const accentOverridden = Boolean(
    template && normalizedAccent && normalizedAccent !== template.colors.accent
  );
  const displayedAccent = accentOverridden ? normalizedAccent : template?.colors.accent || "#000000";

  const brand = useMemo(() => {
    if (!templateId) return null;
    const current = getTemplate(templateId);
    if (!current) return null;
    const normalized = normalizeHex(accentDraft);
    const overridden = Boolean(normalized && normalized !== current.colors.accent);
    const invalid = String(accentDraft || "").trim() !== "" && !normalized;
    return applyBrand(current, {
      accent: invalid ? accentDraft : overridden ? normalized : null,
      wordmarkPrimary,
      wordmarkAccent,
      forceInter,
      forceNoBold,
    });
  }, [templateId, accentDraft, wordmarkPrimary, wordmarkAccent, forceInter, forceNoBold]);

  const brandName = productName.trim() || companyName.trim() || "Brand";

  // Any change after generating makes the outputs stale.
  useEffect(() => {
    setGenerated(null);
  }, [templateId, accentDraft, wordmarkPrimary, wordmarkAccent, forceInter, forceNoBold]);

  const selectTemplate = (id) => {
    const next = getTemplate(id);
    if (!next) return;
    const previous = template;
    setTemplateId(id);
    setAccentDraft((current) => {
      const normalized = normalizeHex(current);
      if (!normalized) return "";
      if (previous && normalized === previous.colors.accent) return "";
      return normalized;
    });
    setError("");
  };

  const handleGenerate = async () => {
    if (!companyId || saving) return;
    if (!template || !brand) {
      setError("Pick a design first.");
      return;
    }

    const guide = buildDesignGuide(brand.tokens, { brandName });
    const prompt = buildCursorPrompt(brand.tokens);

    setSaving(true);
    setError("");

    const payload = {
      company_id: companyId,
      design_template: template.template,
      brand_accent: accentOverridden ? displayedAccent : null,
      wordmark_primary: wordmarkPrimary.trim(),
      wordmark_accent: wordmarkAccent.trim(),
      force_inter: forceInter,
      force_no_bold: forceNoBold,
      design_guide_raw: guide,
      updated_at: new Date().toISOString(),
    };
    if (profileId) payload.id = profileId;

    const { data, error: upsertError } = await supabase
      .from("company_profiles")
      .upsert(payload, { onConflict: "company_id" })
      .select("id")
      .single();

    setSaving(false);
    if (upsertError) {
      setError(upsertError.message || "Failed to save design");
      return;
    }

    setProfileId(data?.id || profileId);
    setLegacyGuide(false);
    setGenerated({ guide, prompt });
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading design...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">Design</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {companyName ? `Pick a design direction for ${companyName}. ` : "Pick a design direction. "}
          Generate creates {GUIDE_FILENAME} and the Cursor prompt that applies it.
        </p>
      </div>

      {legacyGuide && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          This company has a design from the previous template set. Pick a direction and generate to replace it.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((item) => {
              const active = item.template === templateId;
              return (
                <button
                  key={item.template}
                  type="button"
                  onClick={() => selectTemplate(item.template)}
                  aria-pressed={active}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-foreground ring-2 ring-foreground"
                      : "border-border hover:border-foreground/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{item.templateName}</span>
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {item.mode}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.tagline}</p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {previewFamily(item.type.display.family)}
                    {item.type.display.family !== item.type.body.family
                      ? ` + ${previewFamily(item.type.body.family)}`
                      : ""}
                  </p>
                  <div className="mt-2 flex gap-1.5" aria-hidden="true">
                    {[item.colors.bg, item.colors.fg, item.colors.accent, item.colors.band].map((hex, index) => (
                      <span
                        key={`${hex}-${index}`}
                        className="h-4 w-4 rounded-full border border-black/10"
                        style={{ background: hex }}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <OverrideToggle
              id="force-inter"
              checked={forceInter}
              onChange={setForceInter}
              title="Force Inter"
              hint="Replace the direction's fonts with Inter everywhere."
            />
            <OverrideToggle
              id="force-no-bold"
              checked={forceNoBold}
              onChange={setForceNoBold}
              title="Force no bold"
              hint="Cap every weight at 500 — headings, buttons, labels, bold text."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-accent">Brand accent</Label>
            <div className="flex items-center gap-2">
              <input
                id="brand-accent"
                type="color"
                value={displayedAccent}
                disabled={!template}
                onChange={(event) => setAccentDraft(normalizeHex(event.target.value) || "")}
                className="h-10 w-12 cursor-pointer rounded border border-border bg-transparent p-1 disabled:cursor-not-allowed"
                aria-label="Brand accent color"
              />
              <Input
                value={accentDraft || (template ? displayedAccent : "")}
                disabled={!template}
                spellCheck={false}
                onChange={(event) => setAccentDraft(event.target.value.toUpperCase())}
                placeholder="#000000"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!template || !accentOverridden}
                onClick={() => setAccentDraft("")}
              >
                Reset
              </Button>
            </div>
            {(brand?.warnings || []).map((warning) => (
              <p key={warning} className="text-sm text-destructive">
                {warning}
              </p>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wordmark-primary">Wordmark primary</Label>
              <Input
                id="wordmark-primary"
                value={wordmarkPrimary}
                onChange={(event) => setWordmarkPrimary(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wordmark-accent">Wordmark accent</Label>
              <Input
                id="wordmark-accent"
                value={wordmarkAccent}
                onChange={(event) => setWordmarkAccent(event.target.value)}
              />
            </div>
          </div>

          <Button type="button" className="w-full" onClick={handleGenerate} disabled={saving || !template}>
            {saving ? "Generating..." : "Generate design guide"}
          </Button>

          {generated && (
            <div className="space-y-4 rounded-lg border border-border p-3">
              <div className="space-y-1.5">
                <p className="text-sm text-foreground">1. Add the guide to the site repo</p>
                <p className="text-xs text-muted-foreground">
                  Download and drag it into the repository root (next to the site/ folder). Keep the name {GUIDE_FILENAME}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => downloadMarkdown(GUIDE_FILENAME, generated.guide)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download {GUIDE_FILENAME}
                  </Button>
                  <CopyButton text={generated.guide} label="Copy contents" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-foreground">2. Paste this prompt into Cursor</p>
                  <CopyButton text={generated.prompt} />
                </div>
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words text-foreground/90">
                  {generated.prompt}
                </pre>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={viewport === "desktop" ? "default" : "outline"}
              onClick={() => setViewport("desktop")}
            >
              Desktop
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewport === "mobile" ? "default" : "outline"}
              onClick={() => setViewport("mobile")}
            >
              Mobile
            </Button>
          </div>
          <div
            className={
              viewport === "mobile"
                ? "mx-auto w-[390px] max-w-full overflow-hidden rounded-lg border border-border"
                : "overflow-hidden rounded-lg border border-border"
            }
          >
            <DesignPreview tokens={brand?.tokens || null} viewport={viewport} />
          </div>
        </div>
      </div>
    </div>
  );
}
