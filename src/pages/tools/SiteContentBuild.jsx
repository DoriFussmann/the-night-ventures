import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Copy, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  normalizeServices,
  normalizeTeamMembers,
} from "./templateToPrompt/customFieldKeys";
import { buildSiteContentPrompt } from "./siteContentBuild/buildSiteContentPrompt";

const PAGE_OPTIONS = [
  {
    key: "homepage",
    label: "Homepage refinement",
    description:
      "Expand hero/steps into a fuller homepage with additional sections",
    defaultChecked: true,
  },
  {
    key: "about",
    label: "About",
    description: "Company story and positioning page",
    defaultChecked: true,
  },
  {
    key: "services",
    label: "Services",
    description:
      "Wire the existing services content collection to a real /services/ route",
    defaultChecked: true,
  },
  {
    key: "contact",
    label: "Contact",
    description:
      "Contact page (form or details, based on what contact info exists in Company Data)",
    defaultChecked: true,
  },
  {
    key: "faq",
    label: "FAQ",
    description: "Only enable if you have real common questions to seed",
    defaultChecked: false,
  },
  {
    key: "testimonials",
    label: "Testimonials",
    description: null,
    warning:
      "No real client testimonials are available yet. Building this page now would require placeholder text. Recommend enabling only once real client quotes exist — never generate fabricated testimonials.",
    defaultChecked: false,
  },
  {
    key: "legal",
    label: "Privacy Policy / Terms",
    description: null,
    note: "Legal content — recommend sourcing from counsel or a legal template service, not AI-generated. Enabling this will only scaffold a placeholder page structure, not real legal text.",
    defaultChecked: false,
  },
];

function defaultPageSelection() {
  return Object.fromEntries(
    PAGE_OPTIONS.map((opt) => [opt.key, opt.defaultChecked])
  );
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

function PromptCodeBlock({ value, onCopy, copyMessage }) {
  return (
    <div className="space-y-3">
      <pre className="max-h-[480px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs font-mono whitespace-pre-wrap text-foreground">
        {value}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={onCopy}>
          <Copy className="w-4 h-4" />
          Copy
        </Button>
        {copyMessage && (
          <span className="text-sm text-muted-foreground">{copyMessage}</span>
        )}
      </div>
    </div>
  );
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

export default function SiteContentBuild() {
  const { companyId } = useParams();

  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [productName, setProductName] = useState("");
  const [domain, setDomain] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [mediumDescription, setMediumDescription] = useState("");
  const [services, setServices] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [designGuideAbstract, setDesignGuideAbstract] = useState("");
  const [competitors, setCompetitors] = useState([]);

  const [pages, setPages] = useState(defaultPageSelection);
  const [faqContent, setFaqContent] = useState("");

  const [assembledPrompt, setAssembledPrompt] = useState("");
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
          "domain, product_name, short_description, medium_description, services, team_members, design_guide_abstract, competitors"
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
    setProductName(profile?.product_name || companyResult.data?.name || "");
    setDomain(profile?.domain || "");
    setShortDescription(profile?.short_description || "");
    setMediumDescription(profile?.medium_description || "");
    setServices(normalizeServices(profile?.services));
    setTeamMembers(normalizeTeamMembers(profile?.team_members));
    setDesignGuideAbstract(profile?.design_guide_abstract || "");
    setCompetitors(normalizeCompetitors(profile?.competitors));

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

  const anyPageSelected = Object.values(pages).some(Boolean);
  const designGuideMissing = !designGuideAbstract.trim();

  const subtitle = useMemo(() => {
    if (companyName) {
      return `Stage 6 — build remaining ${companyName} site pages from Company Data after Make It Specific.`;
    }
    return "Stage 6 — build remaining site pages from Company Data after Make It Specific.";
  }, [companyName]);

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Copied");
      window.setTimeout(() => setCopyMessage(""), 2000);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      setError("Failed to copy to clipboard");
    }
  };

  const handleGenerate = () => {
    setError("");

    if (!anyPageSelected) {
      setError("Select at least one page to include in the prompt.");
      setAssembledPrompt("");
      return;
    }

    const prompt = buildSiteContentPrompt({
      productName,
      domain,
      shortDescription,
      mediumDescription,
      services,
      teamMembers,
      designGuideAbstract,
      pages,
      faqContent,
    });

    setAssembledPrompt(prompt);
  };

  const togglePage = (key, checked) => {
    setPages((prev) => ({ ...prev, [key]: checked === true }));
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
        <h1 className="text-[15px] text-foreground mb-1">Site Content Build</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Page selection */}
      <section className="space-y-4">
        <div>
          <h2 className="text-[15px] text-foreground">Pages to build</h2>
          <p className="text-sm text-muted-foreground">
            Only checked pages are included in the generated Cursor prompt.
          </p>
        </div>

        <ul className="space-y-3">
          {PAGE_OPTIONS.map((opt) => (
            <li
              key={opt.key}
              className="rounded-lg border border-border p-4 space-y-2"
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={pages[opt.key] === true}
                  onCheckedChange={(v) => togglePage(opt.key, v)}
                  className="mt-0.5"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-foreground">
                    {opt.label}
                  </span>
                  {opt.description ? (
                    <span className="block text-sm text-muted-foreground">
                      {opt.description}
                    </span>
                  ) : null}
                </span>
              </label>
              {opt.warning ? (
                <Alert variant="destructive">
                  <AlertDescription>{opt.warning}</AlertDescription>
                </Alert>
              ) : null}
              {opt.note ? (
                <p className="text-sm text-muted-foreground pl-7">{opt.note}</p>
              ) : null}
              {opt.key === "faq" && pages.faq ? (
                <div className="space-y-2 pl-7 pt-1">
                  <Label htmlFor="faq-content">
                    FAQ content (real Q&amp;As only — leave blank for a
                    structural placeholder)
                  </Label>
                  <Textarea
                    id="faq-content"
                    value={faqContent}
                    onChange={(e) => setFaqContent(e.target.value)}
                    className="min-h-[120px]"
                    placeholder={"Q: …\nA: …\n\nQ: …\nA: …"}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Company Data (read-only) */}
      <section className="space-y-4">
        <div>
          <h2 className="text-[15px] text-foreground">From Company Data</h2>
          <p className="text-sm text-muted-foreground">
            Read-only pull used to assemble the prompt. Edit values in{" "}
            <Link
              to={`/company/${companyId}/company-data`}
              className="text-primary font-medium underline underline-offset-2"
            >
              Company Data
            </Link>
            .
          </p>
        </div>

        {designGuideMissing && (
          <Alert variant="destructive">
            <AlertDescription>
              No Design Guidelines set — generated pages will use generic
              styling. Set this in Company Data first for on-brand results.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-border p-4">
          <ReadOnlyField label="Product name" value={productName} />
          <ReadOnlyField label="Domain" value={domain} />
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
                  {s.detail ? (
                    <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                      {s.detail}
                    </p>
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
            <ul className="space-y-3 text-sm text-foreground">
              {usableTeam.map((t, i) => (
                <li key={`team-${i}`}>
                  <span className="font-medium">{t.name || "(unnamed)"}</span>
                  {t.role ? (
                    <span className="text-muted-foreground"> — {t.role}</span>
                  ) : null}
                  {t.bio ? (
                    <p className="mt-1 text-muted-foreground whitespace-pre-wrap">
                      {t.bio}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground">
            Design guide abstract
          </h3>
          {designGuideAbstract.trim() ? (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {designGuideAbstract}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">Not set</p>
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

      <div>
        <Button type="button" onClick={handleGenerate} disabled={!anyPageSelected}>
          Generate Prompt
        </Button>
      </div>

      {assembledPrompt && (
        <section className="space-y-3">
          <h2 className="text-[15px] text-foreground">Assembled prompt</h2>
          <PromptCodeBlock
            value={assembledPrompt}
            onCopy={() => copyText(assembledPrompt)}
            copyMessage={copyMessage}
          />
        </section>
      )}
    </div>
  );
}
