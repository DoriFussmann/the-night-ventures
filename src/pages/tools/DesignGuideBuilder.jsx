import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyBrand, defaultWordmark } from "@/lib/design/applyBrand";
import { buildDesignGuide } from "@/lib/design/buildDesignGuide";
import { normalizeHex } from "@/lib/design/contrast";
import { TEMPLATES, getTemplate } from "@/lib/design/templates";
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

export default function DesignGuideBuilder() {
  const { companyId } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [productName, setProductName] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [accentDraft, setAccentDraft] = useState("");
  const [wordmarkPrimary, setWordmarkPrimary] = useState("");
  const [wordmarkAccent, setWordmarkAccent] = useState("");
  const [legacyGuide, setLegacyGuide] = useState(false);
  const [viewport, setViewport] = useState("desktop");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");

    const [companyResult, profileResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "id, product_name, design_template, brand_accent, wordmark_primary, wordmark_accent, design_guide_raw"
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

    setCompanyName(name);
    setProductName(product);
    setProfileId(profile?.id || null);
    setTemplateId(storedTemplate);
    setAccentDraft(storedAccent);
    setLegacyGuide(!storedTemplate && Boolean(String(profile?.design_guide_raw || "").trim()));

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
  const displayedAccent = accentOverridden
    ? normalizedAccent
    : template?.colors.accent || "#000000";

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
    });
  }, [templateId, accentDraft, wordmarkPrimary, wordmarkAccent]);

  const brandName = productName.trim() || companyName.trim() || "Brand";

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

  const guideMarkdown = brand
    ? buildDesignGuide(brand.tokens, { brandName })
    : "";

  const handleSave = async () => {
    if (!companyId || saving) return;
    if (!template || !brand) {
      setError("Pick a template before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setSavedMessage("");

    const payload = {
      company_id: companyId,
      design_template: template.template,
      brand_accent: accentOverridden ? displayedAccent : null,
      wordmark_primary: wordmarkPrimary.trim(),
      wordmark_accent: wordmarkAccent.trim(),
      design_guide_raw: guideMarkdown,
      updated_at: new Date().toISOString(),
    };
    if (profileId) payload.id = profileId;

    const { data, error: upsertError } = await supabase
      .from("company_profiles")
      .upsert(payload, { onConflict: "company_id" })
      .select("id")
      .single();

    if (upsertError) {
      setError(upsertError.message || "Failed to save design");
      setSaving(false);
      return;
    }

    setProfileId(data?.id || profileId);
    setLegacyGuide(false);
    setSaving(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleDownload = () => {
    if (!guideMarkdown) {
      setError("Pick a template before downloading.");
      return;
    }
    downloadMarkdown("Design Guide.md", guideMarkdown);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading design...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium text-foreground">Design</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {companyName
            ? `Pick a template for ${companyName}. The preview uses the same tokens as the guide.`
            : "Pick a template. The preview uses the same tokens as the guide."}
        </p>
      </div>

      {legacyGuide && !templateId && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          Legacy guide — pick a template to replace it
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
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
                  <div className="mt-2 flex gap-1.5" aria-hidden="true">
                    {[item.colors.bg, item.colors.fg, item.colors.accent, item.colors.highlight].map(
                      (hex) => (
                        <span
                          key={hex}
                          className="h-4 w-4 rounded-full border border-black/10"
                          style={{ background: hex }}
                        />
                      )
                    )}
                  </div>
                </button>
              );
            })}
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
                Reset to template
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

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={handleSave} disabled={saving || !template}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={handleDownload} disabled={!template}>
              Download Design Guide.md
            </Button>
            {savedMessage && <span className="text-sm text-muted-foreground">{savedMessage}</span>}
          </div>
          <p className="text-sm text-muted-foreground">
            Place it at <code className="font-mono text-xs">site/Design Guide.md</code> in your repo, replacing the placeholder.
          </p>
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
          <div className={viewport === "mobile" ? "mx-auto w-[390px] max-w-full overflow-hidden rounded-lg border border-border" : "overflow-hidden rounded-lg border border-border"}>
            <DesignPreview tokens={brand?.tokens || null} viewport={viewport} />
          </div>
        </div>
      </div>
    </div>
  );
}
