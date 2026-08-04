import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
  SERVICES_CUSTOM_FIELD,
  TEAM_BIOS_CUSTOM_FIELD,
  emptyNewContentEntry,
  emptyServiceEntry,
  emptyTeamEntry,
  parseServicesField,
  parseTeamBiosField,
  serializeServices,
  serializeTeamBios,
} from "./templateToPrompt/customFieldKeys";

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

async function ensureCustomFieldDef(name) {
  const { data: existing, error: selectError } = await supabase
    .from("company_custom_fields")
    .select("id, name")
    .eq("name", name)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data, error: insertError } = await supabase
    .from("company_custom_fields")
    .insert({ name })
    .select("id, name")
    .single();

  if (insertError) {
    // Race: another client may have created it
    const { data: again, error: againError } = await supabase
      .from("company_custom_fields")
      .select("id, name")
      .eq("name", name)
      .maybeSingle();
    if (againError) throw insertError;
    if (again) return again;
    throw insertError;
  }

  return data;
}

export default function TemplateToPrompt() {
  const { companyId } = useParams();

  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingReuse, setSavingReuse] = useState(false);

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

  const [services, setServices] = useState([emptyServiceEntry()]);
  const [teamBios, setTeamBios] = useState([emptyTeamEntry()]);
  const [saveServicesToCompanyData, setSaveServicesToCompanyData] = useState(false);
  const [saveTeamToCompanyData, setSaveTeamToCompanyData] = useState(false);

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
          "domain, product_name, short_description, medium_description, custom_fields"
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

    const custom =
      profile?.custom_fields && typeof profile.custom_fields === "object"
        ? profile.custom_fields
        : {};

    const savedServices = parseServicesField(custom[SERVICES_CUSTOM_FIELD]);
    setServices(savedServices.length > 0 ? savedServices : [emptyServiceEntry()]);

    const savedTeam = parseTeamBiosField(custom[TEAM_BIOS_CUSTOM_FIELD]);
    setTeamBios(savedTeam.length > 0 ? savedTeam : [emptyTeamEntry()]);

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadCompanyData();
  }, [loadCompanyData]);

  // Sync decision rows from audit "Highest severity" section
  useEffect(() => {
    const labels = parseHighestSeverityItems(auditReport);
    setContentDecisions((prev) => {
      const byLabel = new Map(prev.map((d) => [d.label, d]));
      return labels.map((label) => {
        const existing = byLabel.get(label);
        return (
          existing || {
            label,
            action: "",
            rewriteSummary: "",
          }
        );
      });
    });
  }, [auditReport]);

  const handleHeroSourceChange = (source) => {
    setHeroSource(source);
    setHomepageHero(source === "medium" ? mediumDescription : shortDescription);
  };

  const updateService = (index, key, value) => {
    setServices((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  };

  const updateTeam = (index, key, value) => {
    setTeamBios((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
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

  const persistReuseFields = async () => {
    if (!companyId) return;
    if (!saveServicesToCompanyData && !saveTeamToCompanyData) return;

    const { data: profile, error: loadError } = await supabase
      .from("company_profiles")
      .select("id, custom_fields")
      .eq("company_id", companyId)
      .maybeSingle();

    if (loadError) throw loadError;

    const custom_fields = {
      ...(profile?.custom_fields && typeof profile.custom_fields === "object"
        ? profile.custom_fields
        : {}),
    };

    if (saveServicesToCompanyData) {
      await ensureCustomFieldDef(SERVICES_CUSTOM_FIELD);
      custom_fields[SERVICES_CUSTOM_FIELD] = serializeServices(services);
    }

    if (saveTeamToCompanyData) {
      await ensureCustomFieldDef(TEAM_BIOS_CUSTOM_FIELD);
      custom_fields[TEAM_BIOS_CUSTOM_FIELD] = serializeTeamBios(teamBios);
    }

    const payload = {
      company_id: companyId,
      custom_fields,
      updated_at: new Date().toISOString(),
    };
    if (profile?.id) payload.id = profile.id;

    const { error: upsertError } = await supabase
      .from("company_profiles")
      .upsert(payload, { onConflict: "company_id" });

    if (upsertError) throw upsertError;
  };

  const handlePersonalize = async () => {
    setError("");
    setSavingReuse(true);

    try {
      await persistReuseFields();

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
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to assemble prompt");
    } finally {
      setSavingReuse(false);
    }
  };

  const subtitle = useMemo(() => {
    if (companyName) {
      return `Turn the site template into a ${companyName}-specific fill prompt.`;
    }
    return "Turn the site template into a company-specific fill prompt.";
  }, [companyName]);

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
        <h1 className="text-[15px] text-foreground mb-1">Specific Prompt</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Tabs defaultValue="audit">
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
            <h2 className="text-[15px] text-foreground">Audit report</h2>
            <div className="space-y-2">
              <Label htmlFor="audit-report">
                Paste the audit report from Tab 1&apos;s output here.
              </Label>
              <Textarea
                id="audit-report"
                value={auditReport}
                onChange={(e) => setAuditReport(e.target.value)}
                className="min-h-[180px] font-mono text-xs"
                placeholder="Paste the structured audit report here…"
                required
              />
            </div>
          </section>

          {/* 2. Auto-filled from Company Data */}
          <section className="space-y-4">
            <div>
              <h2 className="text-[15px] text-foreground">From Company Data</h2>
              <p className="text-sm text-muted-foreground">
                Pre-filled from Company Data. Edits here only affect this prompt —
                they are not saved back to Company Data.
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
          </section>

          {/* 3. Manual fields */}
          <section className="space-y-4">
            <div>
              <h2 className="text-[15px] text-foreground">Manual fields</h2>
              <p className="text-sm text-muted-foreground">
                Not auto-filled. Leave empty and the assembled prompt will mark them
                with {NEEDS_INPUT_MARKER}.
              </p>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Services / products
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Not yet tracked in Company Data. Consider adding a Services field
                    there for future reuse.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setServices((prev) => [...prev, emptyServiceEntry()])}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </Button>
              </div>

              <div className="space-y-3">
                {services.map((row, index) => (
                  <div
                    key={`service-${index}`}
                    className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <Input
                      placeholder="Title"
                      value={row.title}
                      onChange={(e) => updateService(index, "title", e.target.value)}
                    />
                    <Input
                      placeholder="Summary"
                      value={row.summary}
                      onChange={(e) => updateService(index, "summary", e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={services.length <= 1}
                      onClick={() =>
                        setServices((prev) => prev.filter((_, i) => i !== index))
                      }
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Checkbox
                  checked={saveServicesToCompanyData}
                  onCheckedChange={(v) => setSaveServicesToCompanyData(v === true)}
                />
                Save these to Company Data
              </label>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Team / author bios
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Not yet tracked in Company Data. Consider adding a Team field
                    there for future reuse.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTeamBios((prev) => [...prev, emptyTeamEntry()])}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </Button>
              </div>

              <div className="space-y-3">
                {teamBios.map((row, index) => (
                  <div key={`team-${index}`} className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Name"
                        value={row.name}
                        onChange={(e) => updateTeam(index, "name", e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={teamBios.length <= 1}
                        onClick={() =>
                          setTeamBios((prev) => prev.filter((_, i) => i !== index))
                        }
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Bio"
                      value={row.bio}
                      onChange={(e) => updateTeam(index, "bio", e.target.value)}
                      className="min-h-[72px]"
                    />
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <Checkbox
                  checked={saveTeamToCompanyData}
                  onCheckedChange={(v) => setSaveTeamToCompanyData(v === true)}
                />
                Save these to Company Data
              </label>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Published demo / template content decisions
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Parsed from the audit report&apos;s &quot;Highest severity&quot;
                  section.
                </p>
              </div>

              {contentDecisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Paste an audit report that includes a &quot;Highest severity&quot;
                  list to populate decisions.
                </p>
              ) : (
                <div className="space-y-3">
                  {contentDecisions.map((row, index) => (
                    <div
                      key={`${row.label}-${index}`}
                      className="grid gap-2 sm:grid-cols-[1fr_180px] items-start"
                    >
                      <p className="text-sm text-foreground pt-2">{row.label}</p>
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
            <Button
              type="button"
              onClick={handlePersonalize}
              disabled={savingReuse}
            >
              {savingReuse ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Working...
                </>
              ) : (
                "Personalize Prompt"
              )}
            </Button>
          </div>

          {assembledPrompt && (
            <section className="space-y-3">
              <h2 className="text-[15px] text-foreground">Assembled prompt</h2>
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
