import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, Download, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  normalizeServices,
  normalizeTeamMembers,
} from "./templateToPrompt/customFieldKeys";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const TOKEN_KEYS = [
  "brand_feel",
  "brand_accent",
  "brand_band",
  "brand_positive",
  "wordmark_primary",
  "wordmark_accent",
  "brand_voice",
];

const EMPTY_TOKENS = {
  brand_feel: "",
  brand_accent: "",
  brand_band: "",
  brand_positive: "",
  wordmark_primary: "",
  wordmark_accent: "",
  brand_voice: "",
};

function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function normalizeCompetitors(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return { name: "", url: "" };
    return {
      name: item.name == null ? "" : String(item.name),
      url: item.url == null ? "" : String(item.url),
    };
  });
}

function ReadOnlyField({ label, value, multiline = false }) {
  const text = String(value || "").trim();
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {text ? (
        <p
          className={
            multiline
              ? "text-sm text-foreground whitespace-pre-wrap"
              : "text-sm text-foreground"
          }
        >
          {text}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Not set</p>
      )}
    </div>
  );
}

function ColorSwatch({ value }) {
  const hex = String(value || "").trim();
  if (!HEX_RE.test(hex)) return null;
  return (
    <span
      aria-hidden="true"
      className="h-6 w-6 shrink-0 rounded-sm border border-border"
      style={{ backgroundColor: hex }}
    />
  );
}

export default function DesignGuideBuilder() {
  const { companyId } = useParams();

  const [companyName, setCompanyName] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [productName, setProductName] = useState("");
  const [domain, setDomain] = useState("");
  const [abstract, setAbstract] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [mediumDescription, setMediumDescription] = useState("");
  const [longDescription, setLongDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [businessModel, setBusinessModel] = useState("");
  const [coreValueProposition, setCoreValueProposition] = useState("");
  const [scopeBoundaries, setScopeBoundaries] = useState("");
  const [services, setServices] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [competitors, setCompetitors] = useState([]);

  const [tokens, setTokens] = useState(EMPTY_TOKENS);
  const [markdown, setMarkdown] = useState("");
  const [savedMarkdown, setSavedMarkdown] = useState("");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  const loadCompanyData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, profileResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "id, domain, product_name, abstract, short_description, medium_description, long_description, target_audience, business_model, core_value_proposition, scope_boundaries, services, team_members, competitors, design_guide_raw, brand_feel, brand_accent, brand_band, brand_positive, wordmark_primary, wordmark_accent, brand_voice"
        )
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

    if (companyResult.error) {
      console.error(companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
      setLoading(false);
      return;
    }

    setCompanyName(companyResult.data?.name || "");

    if (profileResult.error) {
      console.error(profileResult.error);
      setError(profileResult.error.message || "Failed to load company profile");
      setLoading(false);
      return;
    }

    const profile = profileResult.data;
    setProfileId(profile?.id || null);
    setProductName(profile?.product_name || companyResult.data?.name || "");
    setDomain(profile?.domain || "");
    setAbstract(profile?.abstract || "");
    setShortDescription(profile?.short_description || "");
    setMediumDescription(profile?.medium_description || "");
    setLongDescription(profile?.long_description || "");
    setTargetAudience(profile?.target_audience || "");
    setBusinessModel(profile?.business_model || "");
    setCoreValueProposition(profile?.core_value_proposition || "");
    setScopeBoundaries(profile?.scope_boundaries || "");
    setServices(normalizeServices(profile?.services));
    setTeamMembers(normalizeTeamMembers(profile?.team_members));
    setCompetitors(normalizeCompetitors(profile?.competitors));
    setTokens({
      brand_feel: profile?.brand_feel || "",
      brand_accent: profile?.brand_accent || "",
      brand_band: profile?.brand_band || "",
      brand_positive: profile?.brand_positive || "",
      wordmark_primary: profile?.wordmark_primary || "",
      wordmark_accent: profile?.wordmark_accent || "",
      brand_voice: profile?.brand_voice || "",
    });

    const raw = String(profile?.design_guide_raw || "").trim();
    setMarkdown(raw);
    setSavedMarkdown(raw);

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadCompanyData();
  }, [loadCompanyData]);

  const usableServices = services.filter(
    (s) => s.title.trim() || s.summary.trim() || s.detail.trim()
  );
  const usableTeam = teamMembers.filter(
    (t) =>
      t.name.trim() ||
      t.role.trim() ||
      t.bio.trim() ||
      t.credentials.trim() ||
      (t.same_as || []).some((u) => u.trim())
  );
  const usableCompetitors = competitors.filter(
    (c) => c.name.trim() || c.url.trim()
  );

  const companyDataSparse = useMemo(() => {
    const filledCore = [
      productName,
      abstract,
      shortDescription,
      mediumDescription,
      longDescription,
    ].some((v) => String(v || "").trim());
    return !filledCore && usableServices.length === 0;
  }, [
    productName,
    abstract,
    shortDescription,
    mediumDescription,
    longDescription,
    usableServices.length,
  ]);

  const updateToken = (key, value) => {
    setTokens((prev) => ({ ...prev, [key]: value }));
  };

  const companyPayload = () => ({
    name: companyName,
    product_name: productName,
    domain,
    abstract,
    short_description: shortDescription,
    medium_description: mediumDescription,
    long_description: longDescription,
    target_audience: targetAudience,
    business_model: businessModel,
    core_value_proposition: coreValueProposition,
    scope_boundaries: scopeBoundaries,
    services: usableServices,
    team_members: usableTeam.map((t) => ({
      name: t.name,
      role: t.role,
      bio: t.bio,
    })),
    competitors: usableCompetitors,
    ...tokens,
  });

  const applyReturnedTokens = (returned, { emptyOnly }) => {
    if (!returned || typeof returned !== "object") return;
    setTokens((prev) => {
      const next = { ...prev };
      for (const key of TOKEN_KEYS) {
        if (!(key in returned)) continue;
        if (emptyOnly && String(prev[key] || "").trim()) continue;
        next[key] = String(returned[key] ?? "");
      }
      return next;
    });
  };

  const requestGenerate = async ({ suggestOnly }) => {
    const res = await fetch("/api/design-guide?action=generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: companyPayload(),
        suggestOnly: Boolean(suggestOnly),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Generate failed (${res.status})`);
    }
    return data;
  };

  const handleGenerate = async () => {
    if (generating || suggesting) return;
    if (markdown.trim()) {
      const ok = window.confirm(
        "Replace the current Design Guide with a newly generated one?"
      );
      if (!ok) return;
    }

    setGenerating(true);
    setError("");
    setSavedMessage("");

    try {
      const data = await requestGenerate({ suggestOnly: false });
      const next = String(data.markdown || "").trim();
      if (!next) {
        throw new Error("No Design Guide returned");
      }
      applyReturnedTokens(data.tokens, { emptyOnly: false });
      setMarkdown(next);
    } catch (err) {
      console.error("Design Guide generate failed:", err);
      setError(err.message || "Failed to generate Design Guide");
    } finally {
      setGenerating(false);
    }
  };

  const handleSuggestTokens = async () => {
    if (generating || suggesting) return;

    setSuggesting(true);
    setError("");
    setSavedMessage("");

    try {
      const data = await requestGenerate({ suggestOnly: true });
      if (!data.tokens || typeof data.tokens !== "object") {
        throw new Error("No tokens returned");
      }
      applyReturnedTokens(data.tokens, { emptyOnly: true });
    } catch (err) {
      console.error("Suggest tokens failed:", err);
      setError(err.message || "Failed to suggest tokens");
    } finally {
      setSuggesting(false);
    }
  };

  const generateAbstract = async (raw) => {
    const res = await fetch("/api/design-guide?action=abstract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Generate abstract failed (${res.status})`);
    }
    const next = String(data.abstract || "").trim();
    if (!next) {
      throw new Error("No abstract returned");
    }
    return next;
  };

  const handleSave = async () => {
    if (!companyId || saving) return;
    const raw = markdown.trim();
    if (!raw) {
      setError("Generate or paste a Design Guide before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setSavedMessage("");

    try {
      const rawPayload = {
        company_id: companyId,
        design_guide_raw: raw,
        brand_feel: tokens.brand_feel.trim() || null,
        brand_accent: tokens.brand_accent.trim() || null,
        brand_band: tokens.brand_band.trim() || null,
        brand_positive: tokens.brand_positive.trim() || null,
        wordmark_primary: tokens.wordmark_primary.trim() || null,
        wordmark_accent: tokens.wordmark_accent.trim() || null,
        brand_voice: tokens.brand_voice.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (profileId) {
        rawPayload.id = profileId;
      }

      const { data: savedProfile, error: rawError } = await supabase
        .from("company_profiles")
        .upsert(rawPayload, { onConflict: "company_id" })
        .select("id")
        .single();

      if (rawError) {
        throw new Error(rawError.message || "Failed to save Design Guide");
      }

      setProfileId(savedProfile?.id || profileId);
      setSavedMarkdown(raw);

      const abstractText = await generateAbstract(raw);
      const { error: abstractError } = await supabase
        .from("company_profiles")
        .update({
          design_guide_abstract: abstractText,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId);

      if (abstractError) {
        throw new Error(
          abstractError.message ||
            "Design Guide saved, but failed to save the abstract"
        );
      }

      setSavedMessage("Saved — Design Guide and abstract updated in Company Data");
      window.setTimeout(() => setSavedMessage(""), 3500);
    } catch (err) {
      console.error("Design Guide save failed:", err);
      setError(err.message || "Failed to save Design Guide");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyMessage("Copied");
      window.setTimeout(() => setCopyMessage(""), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
      setError("Failed to copy to clipboard");
    }
  };

  const handleDownload = () => {
    downloadMarkdown("Design Guide.md", markdown || "");
  };

  if (!companyId) {
    return (
      <div>
        <h1 className="text-xs text-foreground mb-1">Design Builder</h1>
        <p className="text-xs text-muted-foreground">Select a company first.</p>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading design builder...</p>;
  }

  const dirty = markdown !== savedMarkdown;
  const busy = generating || suggesting || saving;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xs text-foreground mb-1">Design Builder</h1>
        <p className="text-sm text-muted-foreground">
          {companyName
            ? `Generate a Design Guide.md for ${companyName} from Company Data.`
            : "Generate a Design Guide.md from Company Data."}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-4">
        <div>
          <h2 className="text-xs text-foreground">From Company Data</h2>
          <p className="text-sm text-muted-foreground">
            Read-only pull used to generate the Design Guide. Edit values in{" "}
            <Link
              to={`/company/${companyId}/company-data`}
              className="text-primary font-medium underline underline-offset-2"
            >
              Company Data
            </Link>
            .
          </p>
        </div>

        {companyDataSparse && (
          <Alert variant="destructive">
            <AlertDescription>
              Fill in Company Data first for best results. Product name,
              descriptions, and services are currently empty.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-border p-4">
          <ReadOnlyField label="Product name" value={productName} />
          <ReadOnlyField label="Domain" value={domain} />
          <ReadOnlyField label="Abstract" value={abstract} multiline />
          <ReadOnlyField
            label="Short description"
            value={shortDescription}
            multiline
          />
          <ReadOnlyField
            label="Medium description"
            value={mediumDescription}
            multiline
          />
          <ReadOnlyField
            label="Long description"
            value={longDescription}
            multiline
          />
          <ReadOnlyField
            label="Target audience"
            value={targetAudience}
            multiline
          />
          <ReadOnlyField
            label="Business model"
            value={businessModel}
            multiline
          />
          <ReadOnlyField
            label="Core value proposition"
            value={coreValueProposition}
            multiline
          />
          <ReadOnlyField
            label="Scope / boundaries"
            value={scopeBoundaries}
            multiline
          />
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">Services</h3>
          {usableServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None added yet — add them in Company Data.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-foreground">
              {usableServices.map((s, i) => (
                <li key={`svc-${i}`}>
                  <span className="font-medium">{s.title || "(untitled)"}</span>
                  {s.summary ? (
                    <span className="text-muted-foreground"> — {s.summary}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">Team</h3>
          {usableTeam.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None added yet — add them in Company Data.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-foreground">
              {usableTeam.map((t, i) => (
                <li key={`team-${i}`}>
                  <span className="font-medium">{t.name || "(unnamed)"}</span>
                  {t.role ? (
                    <span className="text-muted-foreground"> — {t.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">Competitors</h3>
          {usableCompetitors.length === 0 ? (
            <p className="text-sm text-muted-foreground">None listed.</p>
          ) : (
            <ul className="space-y-1 text-sm text-foreground">
              {usableCompetitors.map((c, i) => (
                <li key={`comp-${i}`}>
                  <span className="font-medium">{c.name || "(unnamed)"}</span>
                  {c.url ? (
                    <span className="text-muted-foreground"> — {c.url}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xs text-foreground">Brand tokens</h2>
          <p className="text-sm text-muted-foreground">
            Persisted on the company profile. Leave a field blank and use Suggest
            tokens to fill it from Company Data.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="brand-feel">Feel</Label>
            <Input
              id="brand-feel"
              value={tokens.brand_feel}
              onChange={(e) => updateToken("brand_feel", e.target.value)}
              placeholder="One sentence."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-accent">Accent</Label>
            <div className="flex items-center gap-2">
              <Input
                id="brand-accent"
                value={tokens.brand_accent}
                onChange={(e) => updateToken("brand_accent", e.target.value)}
                placeholder="#3A7D5E"
              />
              <ColorSwatch value={tokens.brand_accent} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-band">Band</Label>
            <div className="flex items-center gap-2">
              <Input
                id="brand-band"
                value={tokens.brand_band}
                onChange={(e) => updateToken("brand_band", e.target.value)}
                placeholder="#1A1A2E"
              />
              <ColorSwatch value={tokens.brand_band} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-positive">Positive</Label>
            <div className="flex items-center gap-2">
              <Input
                id="brand-positive"
                value={tokens.brand_positive}
                onChange={(e) => updateToken("brand_positive", e.target.value)}
                placeholder="#6a9a78"
              />
              <ColorSwatch value={tokens.brand_positive} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wordmark-primary">Wordmark (ink)</Label>
            <Input
              id="wordmark-primary"
              value={tokens.wordmark_primary}
              onChange={(e) => updateToken("wordmark_primary", e.target.value)}
              placeholder="First part"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wordmark-accent">Wordmark (accent)</Label>
            <Input
              id="wordmark-accent"
              value={tokens.wordmark_accent}
              onChange={(e) => updateToken("wordmark_accent", e.target.value)}
              placeholder="Second part — blank if the name does not split"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="brand-voice">Voice</Label>
          <Textarea
            id="brand-voice"
            value={tokens.brand_voice}
            onChange={(e) => updateToken("brand_voice", e.target.value)}
            className="min-h-[100px]"
            placeholder="Short do/don't, ≤120 words."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleSuggestTokens}
            disabled={busy}
          >
            {suggesting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Suggesting…
              </>
            ) : (
              "Suggest tokens"
            )}
          </Button>
          <Button type="button" onClick={handleGenerate} disabled={busy}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate Design Guide"
            )}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs text-foreground">Design Guide.md</h2>
        <Textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          className="min-h-[320px] font-mono text-sm"
          placeholder="Generated Design Guide will appear here. You can edit before saving."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || !markdown.trim()}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={handleCopy} disabled={!markdown}>
            <Copy className="w-4 h-4" />
            Copy
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleDownload}
            disabled={!markdown}
          >
            <Download className="w-4 h-4" />
            Download
          </Button>
          {savedMessage && (
            <span className="text-sm text-muted-foreground">{savedMessage}</span>
          )}
          {copyMessage && (
            <span className="text-sm text-muted-foreground">{copyMessage}</span>
          )}
          {dirty && !savedMessage && markdown.trim() && (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          )}
        </div>
      </section>
    </div>
  );
}
