import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronDown, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PHASE_1_AUDIT_PROMPT } from "./templateToPrompt/phase1AuditPrompt";
import {
  NEEDS_INPUT_MARKER,
  buildPhase2Prompt,
  countNeedsInputMarkers,
} from "./templateToPrompt/buildPhase2Prompt";
import { parseHighestSeverityItems } from "./templateToPrompt/parseHighestSeverity";
import {
  CONFIG_SKIP_VALUE,
  demoSeedDefaultLabel,
  emptySeverityDecision,
  expandSeverityLabels,
} from "./templateToPrompt/classifySeverityItem";
import {
  emptyNewContentEntry,
  normalizeServices,
  normalizeSocialLinks,
  normalizeTeamMembers,
} from "./templateToPrompt/customFieldKeys";

function PromptCodeBlock({ value, onCopy, copyMessage }) {
  return (
    <div className="space-y-3">
      <pre className="max-h-[480px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs font-sans whitespace-pre-wrap text-foreground">
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

function CompanyDataEmptyHint({ companyId }) {
  return (
    <p className="text-sm text-muted-foreground">
      No services/team added yet — add them in{" "}
      <Link
        to={`/company/${companyId}/company-data`}
        className="text-primary font-medium underline underline-offset-2"
      >
        Company Data
      </Link>
    </p>
  );
}

const TAB_VALUES = ["audit", "personalize"];

export default function TemplateToPrompt() {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = TAB_VALUES.includes(tabParam) ? tabParam : "audit";

  const handleTabChange = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value === "audit") {
      next.delete("tab");
    } else {
      next.set("tab", value);
    }
    setSearchParams(next, { replace: true });
  };

  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [auditCopyMessage, setAuditCopyMessage] = useState("");
  const [outputCopyMessage, setOutputCopyMessage] = useState("");

  const [auditReport, setAuditReport] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [domain, setDomain] = useState("");
  const [oneLinePositioning, setOneLinePositioning] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [mediumDescription, setMediumDescription] = useState("");
  const [heroSource, setHeroSource] = useState("short"); // short | medium
  const [homepageHero, setHomepageHero] = useState("");
  const [llmsDescription, setLlmsDescription] = useState("");

  const [services, setServices] = useState([]);
  const [teamBios, setTeamBios] = useState([]);
  const [contactEmail, setContactEmail] = useState("");
  const [socialLinks, setSocialLinks] = useState([]);

  const [contentDecisions, setContentDecisions] = useState([]);
  const [newContent, setNewContent] = useState([]);
  const [newContentOpen, setNewContentOpen] = useState(false);

  const [assembledPrompt, setAssembledPrompt] = useState("");
  const [needsInputCount, setNeedsInputCount] = useState(0);

  const loadCompanyData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, profileResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "domain, product_name, short_description, medium_description, services, team_members, contact_email, social_links"
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
    const shortDesc = profile?.short_description || "";
    const mediumDesc = profile?.medium_description || "";
    const productName = profile?.product_name || companyResult.data?.name || "";

    setBusinessName(productName);
    setDomain(profile?.domain || "");
    setOneLinePositioning(shortDesc);
    setShortDescription(shortDesc);
    setMediumDescription(mediumDesc);
    setHeroSource("short");
    setHomepageHero(shortDesc);
    setLlmsDescription(mediumDesc || shortDesc);

    setServices(normalizeServices(profile?.services));
    setTeamBios(normalizeTeamMembers(profile?.team_members));
    setContactEmail(profile?.contact_email || "");
    setSocialLinks(normalizeSocialLinks(profile?.social_links));

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadCompanyData();
  }, [loadCompanyData]);

  // Sync decision rows from audit "Highest severity" section
  useEffect(() => {
    const labels = parseHighestSeverityItems(auditReport).flatMap(
      expandSeverityLabels
    );
    const companyData = {
      domain,
      productName: businessName,
      contactEmail,
      socialLinks,
      services,
      teamMembers: teamBios,
    };
    setContentDecisions((prev) => {
      const byLabel = new Map(prev.map((d) => [d.label, d]));
      return labels.map((label) => {
        const existing = byLabel.get(label);
        if (!existing) return emptySeverityDecision(label, companyData);

        // If Company Data was filled after the row was created, backfill unset config
        if (existing.kind === "config" && existing.companyDataUnset) {
          const refreshed = emptySeverityDecision(label, companyData);
          if (!refreshed.companyDataUnset && refreshed.setToValue) {
            return {
              ...existing,
              setToValue: refreshed.setToValue,
              companyDataUnset: false,
            };
          }
        }
        return existing;
      });
    });
  }, [
    auditReport,
    domain,
    businessName,
    contactEmail,
    socialLinks,
    services,
    teamBios,
  ]);

  const handleHeroSourceChange = (source) => {
    setHeroSource(source);
    setHomepageHero(source === "medium" ? mediumDescription : shortDescription);
  };

  const updateDecision = (index, patch) => {
    setContentDecisions((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  };

  const updateNewContent = (index, key, value) => {
    setNewContent((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  };

  const copyText = async (text, setMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied");
      window.setTimeout(() => setMessage(""), 2000);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
      setError("Failed to copy to clipboard");
    }
  };

  const handlePersonalize = () => {
    setError("");

    const prompt = buildPhase2Prompt({
      businessName,
      domain,
      oneLinePositioning,
      homepageHero,
      llmsDescription,
      services,
      teamBios,
      contentDecisions,
      newContent,
      auditReport,
    });

    setAssembledPrompt(prompt);
    setNeedsInputCount(countNeedsInputMarkers(prompt));
  };

  const subtitle = useMemo(() => {
    if (companyName) {
      return `Turn the site template into a ${companyName}-specific fill prompt.`;
    }
    return "Turn the site template into a company-specific fill prompt.";
  }, [companyName]);

  const contentDecisionRows = contentDecisions
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.kind || row.kind === "content");
  const configDecisionRows = contentDecisions
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.kind === "config");
  const missingDecisionRows = contentDecisions
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.kind === "missing");

  const usableServices = services.filter(
    (s) => s.title.trim() || s.summary.trim() || s.detail.trim()
  );
  const usableTeam = teamBios.filter(
    (t) =>
      t.name.trim() ||
      t.role.trim() ||
      t.bio.trim() ||
      t.credentials.trim() ||
      (t.same_as || []).some((u) => u.trim())
  );

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
        <h1 className="text-xs text-foreground mb-1">Specific Prompt</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="audit">Audit Prompt</TabsTrigger>
          <TabsTrigger value="personalize">Personalize Prompt</TabsTrigger>
        </TabsList>

        <TabsContent value="audit" className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Run this first, in the target site&apos;s repo, before filling anything
            below.
          </p>
          <PromptCodeBlock
            value={PHASE_1_AUDIT_PROMPT}
            onCopy={() => copyText(PHASE_1_AUDIT_PROMPT, setAuditCopyMessage)}
            copyMessage={auditCopyMessage}
          />
        </TabsContent>

        <TabsContent value="personalize" className="space-y-8 pt-2">
          {/* 1. Audit report */}
          <section className="space-y-3">
            <h2 className="text-xs text-foreground">Audit report</h2>
            <div className="space-y-2">
              <Label htmlFor="audit-report">
                Paste the audit report from Tab 1&apos;s output here.
              </Label>
              <Textarea
                id="audit-report"
                value={auditReport}
                onChange={(e) => setAuditReport(e.target.value)}
                className="min-h-[180px]"
                placeholder="Paste the structured audit report here…"
                required
              />
            </div>
          </section>

          {/* 2. Auto-filled from Company Data */}
          <section className="space-y-4">
            <div>
              <h2 className="text-xs text-foreground">From Company Data</h2>
              <p className="text-sm text-muted-foreground">
                Pre-filled from Company Data. Edits to identity fields only affect
                this prompt — they are not saved back. Services and Team are read
                from Company Data.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="business-name">Business name</Label>
                <Input
                  id="business-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="one-line">One-line positioning</Label>
              <Textarea
                id="one-line"
                value={oneLinePositioning}
                onChange={(e) => setOneLinePositioning(e.target.value)}
                className="min-h-[72px]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="homepage-hero">Homepage hero paragraph</Label>
                <div className="flex items-center gap-1 text-xs">
                  <Button
                    type="button"
                    size="sm"
                    variant={heroSource === "short" ? "secondary" : "ghost"}
                    onClick={() => handleHeroSourceChange("short")}
                  >
                    short_description
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={heroSource === "medium" ? "secondary" : "ghost"}
                    onClick={() => handleHeroSourceChange("medium")}
                  >
                    medium_description
                  </Button>
                </div>
              </div>
              <Textarea
                id="homepage-hero"
                value={homepageHero}
                onChange={(e) => setHomepageHero(e.target.value)}
                className="min-h-[96px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="llms-description">LLMS.txt description</Label>
              <Textarea
                id="llms-description"
                value={llmsDescription}
                onChange={(e) => setLlmsDescription(e.target.value)}
                className="min-h-[96px]"
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium text-foreground">
                Services / products
              </h3>
              {usableServices.length === 0 ? (
                <CompanyDataEmptyHint companyId={companyId} />
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
                <CompanyDataEmptyHint companyId={companyId} />
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
                      {t.credentials ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Credentials: {t.credentials}
                        </p>
                      ) : null}
                      {(t.same_as || []).filter((u) => u.trim()).length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          sameAs:{" "}
                          {(t.same_as || [])
                            .map((u) => u.trim())
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* 3. Manual fields */}
          <section className="space-y-4">
            <div>
              <h2 className="text-xs text-foreground">Manual fields</h2>
              <p className="text-sm text-muted-foreground">
                Decisions for Highest severity audit items. Leave empty and the
                assembled prompt will mark them with {NEEDS_INPUT_MARKER}.
              </p>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Published demo / template content decisions
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Content-file findings from the audit report&apos;s &quot;Highest
                  severity&quot; section.
                </p>
              </div>

              {contentDecisionRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {contentDecisions.length === 0
                    ? 'Paste an audit report that includes a "Highest severity" list to populate decisions.'
                    : "No content-file findings in Highest severity."}
                </p>
              ) : (
                <div className="space-y-3">
                  {contentDecisionRows.map(({ row, index }) => (
                    <div
                      key={`${row.label}-${index}`}
                      className="grid gap-2 sm:grid-cols-[1fr_180px] items-start"
                    >
                      <div className="pt-2 space-y-1">
                        <p className="text-sm text-foreground">{row.label}</p>
                        {row.demoSeed ? (
                          <p className="text-xs text-muted-foreground">
                            {demoSeedDefaultLabel(row)}
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <Select
                          value={row.action || undefined}
                          onValueChange={(value) =>
                            updateDecision(index, {
                              action: value,
                              rewriteSummary:
                                value === "rewrite" ? row.rewriteSummary : "",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">draft it</SelectItem>
                            <SelectItem value="delete">delete it</SelectItem>
                            <SelectItem value="rewrite">rewrite it</SelectItem>
                          </SelectContent>
                        </Select>
                        {row.action === "rewrite" && (
                          <Input
                            placeholder="Replacement summary"
                            value={row.rewriteSummary}
                            onChange={(e) =>
                              updateDecision(index, {
                                rewriteSummary: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Config field updates
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  site.ts / env / identity config findings — set a value instead of
                  a content decision.
                </p>
              </div>

              {configDecisionRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No config-field findings in Highest severity.
                </p>
              ) : (
                <div className="space-y-3">
                  {configDecisionRows.map(({ row, index }) => {
                    const fromCompanyUnset =
                      row.companyDataUnset && !(row.setToValue || "").trim();
                    const skipDefault =
                      (row.setToValue || "").trim().toLowerCase() ===
                      CONFIG_SKIP_VALUE;

                    return (
                      <div
                        key={`config-${row.label}-${index}`}
                        className="grid gap-2 sm:grid-cols-[1fr_1fr] items-start"
                      >
                        <p className="text-sm text-foreground pt-2">
                          {row.label}
                        </p>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            set to
                          </Label>
                          {fromCompanyUnset ? (
                            <div className="space-y-2">
                              <p className="text-sm text-muted-foreground">
                                Not set in Company Data —{" "}
                                <Link
                                  to={`/company/${companyId}/company-data`}
                                  className="text-primary font-medium underline underline-offset-2"
                                >
                                  set it
                                </Link>
                              </p>
                              <Input
                                placeholder="Optional override for this run"
                                value={row.setToValue || ""}
                                onChange={(e) =>
                                  updateDecision(index, {
                                    setToValue: e.target.value,
                                    companyDataUnset: !e.target.value.trim(),
                                  })
                                }
                              />
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <Input
                                placeholder={
                                  skipDefault
                                    ? CONFIG_SKIP_VALUE
                                    : "Value to set"
                                }
                                value={row.setToValue || ""}
                                onChange={(e) =>
                                  updateDecision(index, {
                                    setToValue: e.target.value,
                                    companyDataUnset: false,
                                  })
                                }
                              />
                              {skipDefault ? (
                                <p className="text-xs text-muted-foreground">
                                  Default: skip this run (override anytime).
                                </p>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Missing surfaces
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Findings where no file/page exists yet. Defer instead of forcing
                  a content decision this run.
                </p>
              </div>

              {missingDecisionRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No missing-surface findings in Highest severity.
                </p>
              ) : (
                <div className="space-y-3">
                  {missingDecisionRows.map(({ row, index }) => (
                    <div
                      key={`missing-${row.label}-${index}`}
                      className="flex flex-wrap items-start justify-between gap-3"
                    >
                      <p className="text-sm text-foreground flex-1 min-w-[200px]">
                        {row.label}
                      </p>
                      <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                        <Checkbox
                          checked={row.defer === true}
                          onCheckedChange={(v) =>
                            updateDecision(index, { defer: v === true })
                          }
                        />
                        Defer to Full Site Content Build stage
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Collapsible open={newContentOpen} onOpenChange={setNewContentOpen}>
              <div className="rounded-lg border border-border p-4 space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div>
                      <h3 className="text-sm font-medium text-foreground">
                        New content to add this run
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Optional. Skip entirely if empty.
                      </p>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        newContentOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent className="space-y-4 pt-2">
                  {newContent.map((row, index) => (
                    <div
                      key={`new-${index}`}
                      className="space-y-2 rounded-md border border-dashed border-border p-3"
                    >
                      <div className="flex justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          Entry {index + 1}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setNewContent((prev) =>
                              prev.filter((_, i) => i !== index)
                            )
                          }
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <Input
                        placeholder="Title"
                        value={row.title}
                        onChange={(e) =>
                          updateNewContent(index, "title", e.target.value)
                        }
                      />
                      <Input
                        placeholder="Description"
                        value={row.description}
                        onChange={(e) =>
                          updateNewContent(index, "description", e.target.value)
                        }
                      />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input
                          placeholder="Author"
                          value={row.author}
                          onChange={(e) =>
                            updateNewContent(index, "author", e.target.value)
                          }
                        />
                        <Input
                          placeholder="Category"
                          value={row.category}
                          onChange={(e) =>
                            updateNewContent(index, "category", e.target.value)
                          }
                        />
                        <Input
                          placeholder="Tags"
                          value={row.tags}
                          onChange={(e) =>
                            updateNewContent(index, "tags", e.target.value)
                          }
                        />
                      </div>
                      <Input
                        placeholder="Hero image"
                        value={row.heroImage}
                        onChange={(e) =>
                          updateNewContent(index, "heroImage", e.target.value)
                        }
                      />
                      <Textarea
                        placeholder="Body"
                        value={row.body}
                        onChange={(e) =>
                          updateNewContent(index, "body", e.target.value)
                        }
                        className="min-h-[120px]"
                      />
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNewContent((prev) => [...prev, emptyNewContentEntry()])
                    }
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add content entry
                  </Button>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </section>

          <div>
            <Button type="button" onClick={handlePersonalize}>
              Personalize Prompt
            </Button>
          </div>

          {assembledPrompt && (
            <section className="space-y-3">
              <h2 className="text-xs text-foreground">Assembled prompt</h2>
              {needsInputCount > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {needsInputCount} field(s) still need input before this is ready
                    to paste into Cursor
                  </AlertDescription>
                </Alert>
              )}
              <PromptCodeBlock
                value={assembledPrompt}
                onCopy={() => copyText(assembledPrompt, setOutputCopyMessage)}
                copyMessage={outputCopyMessage}
              />
            </section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
