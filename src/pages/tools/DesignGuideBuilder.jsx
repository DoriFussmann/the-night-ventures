import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  normalizeServices,
  normalizeTeamMembers,
} from "./templateToPrompt/customFieldKeys";

const PANEL_DIALOG_CLASS =
  "flex h-[min(90vh,calc(min(96vw,1400px)*9/16))] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-lg";

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

const CURRENT_GUIDE_PREFIX = "# Design Guide\n\n```tokens";
const KEPT_PREVIOUS_GUIDE =
  "Kept the previous guide — nothing was generated.";

function draftStorageKey(companyId) {
  return `tnv-design-guide-draft:${companyId}`;
}

function readGuideDraft(companyId) {
  if (!companyId) return "";
  try {
    return String(sessionStorage.getItem(draftStorageKey(companyId)) || "");
  } catch {
    return "";
  }
}

function writeGuideDraft(companyId, text) {
  if (!companyId) return;
  try {
    const next = String(text || "");
    if (!next.trim()) sessionStorage.removeItem(draftStorageKey(companyId));
    else sessionStorage.setItem(draftStorageKey(companyId), next);
  } catch {
    // ignore
  }
}

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

function textFilled(value) {
  return Boolean(String(value || "").trim());
}

function FieldTrigger({ title, filled = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center justify-between gap-3 rounded-md border border-border px-3 text-left transition-colors hover:bg-muted/50"
    >
      <span className="text-sm font-medium leading-none">{title}</span>
      {filled ? (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-emerald-600"
          strokeWidth={2.5}
          aria-label="Has content"
        />
      ) : null}
    </button>
  );
}

function formatServicesDetail(items) {
  return items
    .map((item) => {
      const lines = [item.title?.trim() || "(untitled)"];
      if (item.summary?.trim()) lines.push(item.summary.trim());
      if (item.detail?.trim()) lines.push(item.detail.trim());
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatTeamDetail(items) {
  return items
    .map((item) => {
      const head = [item.name?.trim() || "(unnamed)", item.role?.trim(), item.credentials?.trim()]
        .filter(Boolean)
        .join(" · ");
      const lines = [head];
      if (item.bio?.trim()) lines.push(item.bio.trim());
      for (const url of item.same_as || []) {
        if (String(url).trim()) lines.push(String(url).trim());
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatCompetitorsDetail(items) {
  return items
    .map((item) => {
      const name = item.name?.trim() || "(unnamed)";
      const url = item.url?.trim();
      return url ? `${name}\n${url}` : name;
    })
    .join("\n\n");
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
  const [saving, setSaving] = useState(false);
  const [pushingAbstract, setPushingAbstract] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [lastGeneratedAt, setLastGeneratedAt] = useState(null);
  const [openPanel, setOpenPanel] = useState(null);

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
    const draft = readGuideDraft(companyId);
    setMarkdown(draft.trim() ? draft : raw);
    setSavedMarkdown(raw);
    setLastGeneratedAt(null);

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
        if (key === "brand_feel") continue;
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
    return { res, data };
  };

  const handleGenerate = async () => {
    if (generating) return;
    if (markdown.trim()) {
      const ok = window.confirm(
        "Replace the current Design Guide with a newly generated one?"
      );
      if (!ok) {
        setError(KEPT_PREVIOUS_GUIDE);
        return;
      }
    }

    setGenerating(true);
    setError("");
    setSavedMessage("");

    try {
      const { res, data } = await requestGenerate({ suggestOnly: false });
      if (!res.ok) {
        setError(
          `${KEPT_PREVIOUS_GUIDE} (${data.error || res.status})`
        );
        return;
      }
      const next = String(data.markdown || "").trim();
      if (!next) {
        setError("Generate finished, but no Design Guide came back. Try again.");
        return;
      }
      applyReturnedTokens(data.tokens, { emptyOnly: false });
      setMarkdown(next);
      writeGuideDraft(companyId, next);
      setLastGeneratedAt(Date.now());
    } catch (err) {
      console.error("Design Guide generate failed:", err);
      setError(err.message || "Failed to generate Design Guide");
    } finally {
      setGenerating(false);
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
      writeGuideDraft(companyId, raw);

      setSavedMessage("Saved");
      window.setTimeout(() => setSavedMessage(""), 2500);
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

  const handlePushDesignAbstract = async () => {
    if (!companyId || pushingAbstract || saving) return;
    const raw = savedMarkdown.trim();
    if (!raw || markdown !== savedMarkdown) return;

    setPushingAbstract(true);
    setError("");
    setSavedMessage("");

    try {
      const abstractText = await generateAbstract(raw);
      const payload = {
        company_id: companyId,
        design_guide_abstract: abstractText,
        updated_at: new Date().toISOString(),
      };
      if (profileId) {
        payload.id = profileId;
      }

      const { data, error: upsertError } = await supabase
        .from("company_profiles")
        .upsert(payload, { onConflict: "company_id" })
        .select("id")
        .single();

      if (upsertError) {
        throw new Error(
          upsertError.message || "Failed to push Design Abstract"
        );
      }

      setProfileId(data?.id || profileId);
      setSavedMessage("Design Abstract pushed to Company Data");
      window.setTimeout(() => setSavedMessage(""), 3500);
    } catch (err) {
      console.error("Failed to push Design Abstract:", err);
      setError(err.message || "Failed to push Design Abstract");
    } finally {
      setPushingAbstract(false);
    }
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
  const busy = generating || saving || pushingAbstract;
  const guideSaved = Boolean(savedMarkdown.trim()) && !dirty;

  const companyPanels = {
    product_name: {
      title: "Product name",
      description: "Primary product or brand name from Company Data.",
      text: productName,
    },
    domain: {
      title: "Domain",
      description: "Company website domain from Company Data.",
      text: domain,
    },
    abstract: {
      title: "Abstract",
      description: "Short positioning blurb from Company Data.",
      text: abstract,
    },
    short: {
      title: "Short description",
      description: "Homepage-style description from Company Data.",
      text: shortDescription,
    },
    medium: {
      title: "Medium description",
      description: "Short paragraph from Company Data.",
      text: mediumDescription,
    },
    long: {
      title: "Long description",
      description: "Full company description from Company Data.",
      text: longDescription,
    },
    target: {
      title: "Target audience",
      description: "Who the company serves, from Company Data.",
      text: targetAudience,
    },
    business_model: {
      title: "Business model",
      description: "How the company makes money, from Company Data.",
      text: businessModel,
    },
    core_value_proposition: {
      title: "Core value proposition",
      description: "Primary reason customers choose this company.",
      text: coreValueProposition,
    },
    scope_boundaries: {
      title: "Scope / boundaries",
      description: "What the company does and does not do.",
      text: scopeBoundaries,
    },
    services: {
      title: "Services",
      description: "Products and services from Company Data.",
      text: formatServicesDetail(usableServices),
      emptyHint: "None added yet — add them in Company Data.",
    },
    team: {
      title: "Team",
      description: "Team members from Company Data.",
      text: formatTeamDetail(usableTeam),
      emptyHint: "None added yet — add them in Company Data.",
    },
    competitors: {
      title: "Competitors",
      description: "Competitors listed in Company Data.",
      text: formatCompetitorsDetail(usableCompetitors),
      emptyHint: "None listed.",
    },
  };

  const companyPanel = openPanel ? companyPanels[openPanel] : null;

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

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
          <FieldTrigger
            title="Product name"
            filled={textFilled(productName)}
            onClick={() => setOpenPanel("product_name")}
          />
          <FieldTrigger
            title="Domain"
            filled={textFilled(domain)}
            onClick={() => setOpenPanel("domain")}
          />
          <FieldTrigger
            title="Abstract"
            filled={textFilled(abstract)}
            onClick={() => setOpenPanel("abstract")}
          />
          <FieldTrigger
            title="Short description"
            filled={textFilled(shortDescription)}
            onClick={() => setOpenPanel("short")}
          />
          <FieldTrigger
            title="Medium description"
            filled={textFilled(mediumDescription)}
            onClick={() => setOpenPanel("medium")}
          />
          <FieldTrigger
            title="Long description"
            filled={textFilled(longDescription)}
            onClick={() => setOpenPanel("long")}
          />
          <FieldTrigger
            title="Target audience"
            filled={textFilled(targetAudience)}
            onClick={() => setOpenPanel("target")}
          />
          <FieldTrigger
            title="Business model"
            filled={textFilled(businessModel)}
            onClick={() => setOpenPanel("business_model")}
          />
          <FieldTrigger
            title="Core value proposition"
            filled={textFilled(coreValueProposition)}
            onClick={() => setOpenPanel("core_value_proposition")}
          />
          <FieldTrigger
            title="Scope / boundaries"
            filled={textFilled(scopeBoundaries)}
            onClick={() => setOpenPanel("scope_boundaries")}
          />
          <FieldTrigger
            title="Services"
            filled={usableServices.length > 0}
            onClick={() => setOpenPanel("services")}
          />
          <FieldTrigger
            title="Team"
            filled={usableTeam.length > 0}
            onClick={() => setOpenPanel("team")}
          />
          <FieldTrigger
            title="Competitors"
            filled={usableCompetitors.length > 0}
            onClick={() => setOpenPanel("competitors")}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xs text-foreground">Feel</h2>
          <p className="text-sm text-muted-foreground">
            One sentence for how the brand should feel. Used when generating the
            Design Guide.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="brand-feel">Feel</Label>
          <Textarea
            id="brand-feel"
            value={tokens.brand_feel}
            onChange={(e) => updateToken("brand_feel", e.target.value)}
            className="min-h-[80px]"
            placeholder="Quiet, precise, operator-grade — not loud or promotional."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
          {lastGeneratedAt ? (
            <span className="text-sm text-muted-foreground">Generated just now</span>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs text-foreground">Design Guide.md</h2>
        {markdown.trim() &&
          !markdown.trim().startsWith(CURRENT_GUIDE_PREFIX) && (
            <Alert>
              <AlertDescription>
                This saved guide predates the current template. Generate to
                replace it.
              </AlertDescription>
            </Alert>
          )}
        <Textarea
          value={markdown}
          onChange={(e) => {
            const next = e.target.value;
            setMarkdown(next);
            writeGuideDraft(companyId, next);
          }}
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
          {guideSaved ? (
            <Button
              type="button"
              variant="outline"
              onClick={handlePushDesignAbstract}
              disabled={pushingAbstract || saving}
            >
              {pushingAbstract ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pushing…
                </>
              ) : (
                "Push Design Abstract to Company Data"
              )}
            </Button>
          ) : null}
          {lastGeneratedAt ? (
            <span className="text-sm text-muted-foreground">Generated just now</span>
          ) : null}
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

      <Dialog
        open={Boolean(openPanel)}
        onOpenChange={(open) => setOpenPanel(open ? openPanel : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>{companyPanel?.title}</DialogTitle>
            {companyPanel?.description ? (
              <DialogDescription>{companyPanel.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {companyPanel ? (
              textFilled(companyPanel.text) ? (
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {companyPanel.text}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  {companyPanel.emptyHint || "Not set"}
                </p>
              )
            ) : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-border px-6 py-4 sm:justify-between">
            {companyPanel ? (
              <Button asChild variant="outline">
                <Link to={`/company/${companyId}/company-data`}>
                  Edit in Company Data
                </Link>
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="outline" onClick={() => setOpenPanel(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
