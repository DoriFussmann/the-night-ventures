import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Trash2, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  emptyServiceEntry,
  formatServiceCopyBlock,
  normalizeServices,
  normalizeSocialLinks,
  normalizeTeamMembers,
  serviceHasContent,
  trimServicesForSave,
  trimSocialLinksForSave,
  trimTeamMembersForSave,
} from "./templateToPrompt/customFieldKeys";
import SocialShopsPanel from "./SocialShopsPanel";
import { parseCompanyMarkdown } from "./companyData/parseCompanyMarkdown";
import {
  getCompanyDataPoints,
  mergeParsedCompanyFields,
} from "./companyData/dataPoints";
import { buildLlmUploadPrompt } from "./companyData/llmUploadPrompt";

const HIDDEN_CUSTOM_FIELDS = new Set([
  "founded year",
  "business model",
  "core value proposition",
  "scope / boundaries",
]);

const DEFAULT_PILLAR_COUNT = 5;
const DEFAULT_SUPPORTING_COUNT = 5;

/** Large 16:9 panel dialog — overrides the default max-w-lg DialogContent. */
const PANEL_DIALOG_CLASS =
  "flex h-[min(90vh,calc(min(96vw,1400px)*9/16))] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-lg";

async function copyTextToClipboard(value) {
  const text = String(value ?? "");
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Copy failed:", err);
    return false;
  }
}

function CopyProductButton({ service }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(formatServiceCopyBlock(service));
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      disabled={!serviceHasContent(service)}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy this product"}
    </Button>
  );
}

function PanelModalActions({
  onCopy,
  onClose,
  onSave,
  saving = false,
  showSave = true,
  closeLabel = "Close",
  saveDisabled = false,
  closeDisabled = false,
  copyDisabled = false,
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    if (copying || copyDisabled) return;
    setCopying(true);
    try {
      const ok = await onCopy?.();
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row">
      <Button
        type="button"
        variant="outline"
        onClick={handleCopy}
        disabled={copying || copyDisabled}
      >
        {copied ? "Copied" : copying ? "Copying..." : "Copy"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onClose}
        disabled={closeDisabled}
      >
        {closeLabel}
      </Button>
      {showSave ? (
        <Button
          type="button"
          onClick={onSave}
          disabled={saving || saveDisabled}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      ) : null}
    </div>
  );
}

function PanelTrigger({ title, filled = false, onClick }) {
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

function emptySupporting(count = DEFAULT_SUPPORTING_COUNT) {
  return Array.from({ length: count }, () => "");
}

function emptyPillar() {
  return { keyword: "", supporting: emptySupporting() };
}

function normalizeStringList(value, minCount) {
  const source = Array.isArray(value) ? value : [];
  const list = source.map((item) =>
    typeof item === "string" ? item : item == null ? "" : String(item)
  );
  while (list.length < minCount) list.push("");
  return list;
}

function normalizePillarKeywords(value, { minCount = 0 } = {}) {
  const source = Array.isArray(value) ? value : [];
  const items = source.map((item) => {
    if (typeof item === "string") {
      return { keyword: item, supporting: emptySupporting() };
    }
    if (item && typeof item === "object") {
      const keyword =
        typeof item.keyword === "string"
          ? item.keyword
          : item.keyword == null
            ? ""
            : String(item.keyword);
      return {
        keyword,
        supporting: normalizeStringList(item.supporting, DEFAULT_SUPPORTING_COUNT),
      };
    }
    return emptyPillar();
  });
  while (items.length < minCount) items.push(emptyPillar());
  return items;
}

function countFilled(list) {
  return list.filter((value) => String(value || "").trim()).length;
}

function supportingLeft(pillar) {
  const supporting = Array.isArray(pillar?.supporting) ? pillar.supporting : [];
  return supporting.filter((value) => !String(value || "").trim()).length;
}

function emptyCompetitor() {
  return { name: "", url: "" };
}

function normalizeCompetitors(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return emptyCompetitor();
    return {
      name: item.name == null ? "" : String(item.name),
      url: item.url == null ? "" : String(item.url),
    };
  });
}

function isLooseHttpUrl(value) {
  const url = String(value || "").trim();
  if (!url) return true;
  return /^https?:\/\//i.test(url);
}

const EMPTY_PROFILE = {
  domain: "",
  product_name: "",
  target_audience: "",
  abstract: "",
  short_description: "",
  medium_description: "",
  long_description: "",
  business_model: "",
  core_value_proposition: "",
  scope_boundaries: "",
  design_guide_raw: "",
  design_guide_abstract: "",
  core_keywords: normalizePillarKeywords([], { minCount: DEFAULT_PILLAR_COUNT }),
  competitors: [],
  services: [],
  team_members: [],
  contact_email: "",
  social_links: [],
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

function formatSocialAccountMarkdown(account) {
  const lines = [`- ${account.name?.trim() || "(unnamed)"}`];
  if (account.type) lines.push(`  - Type: ${account.type}`);
  if (account.status?.trim()) lines.push(`  - Status: ${account.status.trim()}`);
  if (account.url?.trim()) lines.push(`  - URL: ${account.url.trim()}`);
  if (account.username?.trim()) lines.push(`  - Username: ${account.username.trim()}`);
  if (account.access_details?.trim()) {
    lines.push(`  - Access Details: ${account.access_details.trim()}`);
  }
  if (account.comments?.trim()) lines.push(`  - Comments: ${account.comments.trim()}`);
  return lines.join("\n");
}

function formatSocialShopsMarkdown(accounts, notes) {
  const sections = [];
  const accountList = Array.isArray(accounts) ? accounts : [];
  const noteList = Array.isArray(notes) ? notes : [];

  if (accountList.length > 0) {
    const byType = ["Social Media", "Digital Store", "Other"].map((type) => ({
      type,
      items: accountList.filter((account) => account.type === type),
    }));
    const otherTypes = accountList.filter(
      (account) => !["Social Media", "Digital Store", "Other"].includes(account.type)
    );
    if (otherTypes.length > 0) {
      byType.push({ type: "Uncategorized", items: otherTypes });
    }

    const accountBlocks = byType
      .filter((group) => group.items.length > 0)
      .map((group) => {
        const items = group.items.map(formatSocialAccountMarkdown).join("\n");
        return `### ${group.type}\n${items}`;
      });
    if (accountBlocks.length > 0) sections.push(accountBlocks.join("\n\n"));
  }

  if (noteList.length > 0) {
    const noteLines = noteList
      .map((note) => String(note?.text || "").trim())
      .filter(Boolean)
      .map((text) => `- ${text}`)
      .join("\n");
    if (noteLines) sections.push(`### Notes\n${noteLines}`);
  }

  return sections.join("\n\n");
}

export default function CompanyData() {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [companyName, setCompanyName] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [fields, setFields] = useState(EMPTY_PROFILE);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [industries, setIndustries] = useState([]);
  const [selectedIndustryIds, setSelectedIndustryIds] = useState([]);
  const [industryFilter, setIndustryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");
  /** Active panel modal: 'target' | 'pillars' | 'competitors' | ... | `custom:${id}` */
  const [openPanel, setOpenPanel] = useState(null);
  const [openPillars, setOpenPillars] = useState({});
  const [socialShopsFilled, setSocialShopsFilled] = useState(false);
  const [designGuideOpen, setDesignGuideOpen] = useState(false);
  const [designGuideDraftRaw, setDesignGuideDraftRaw] = useState("");
  const [designGuideDraftAbstract, setDesignGuideDraftAbstract] = useState("");
  const [designGuideAbstractReady, setDesignGuideAbstractReady] = useState(false);
  const [designGuideGenerating, setDesignGuideGenerating] = useState(false);
  const [designGuideSaving, setDesignGuideSaving] = useState(false);
  const [designGuideError, setDesignGuideError] = useState("");
  const [markdownDragOver, setMarkdownDragOver] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [llmPromptOpen, setLlmPromptOpen] = useState(false);
  const markdownInputRef = useRef(null);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [
      companyResult,
      profileResult,
      customFieldsResult,
      industriesResult,
      companyIndustriesResult,
      socialAccountsResult,
    ] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "id, domain, product_name, target_audience, abstract, short_description, medium_description, long_description, business_model, core_value_proposition, scope_boundaries, design_guide_raw, design_guide_abstract, core_keywords, competitors, services, team_members, contact_email, social_links, custom_fields"
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("company_custom_fields")
        .select("id, name, created_at")
        .order("created_at", { ascending: true }),
      supabase.from("industries").select("id, name").order("name", { ascending: true }),
      supabase
        .from("company_industries")
        .select("industry_id")
        .eq("company_id", companyId),
      supabase
        .from("social_accounts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
    ]);

    if (companyResult.error) {
      console.error("Failed to load company:", companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
    } else {
      setCompanyName(companyResult.data?.name || "");
    }

    if (customFieldsResult.error) {
      console.error("Failed to load custom fields:", customFieldsResult.error);
      setError(customFieldsResult.error.message || "Failed to load custom fields");
      setCustomFieldDefs([]);
    } else {
      setCustomFieldDefs(
        (customFieldsResult.data || []).filter(
          (field) => !HIDDEN_CUSTOM_FIELDS.has(String(field.name || "").trim().toLowerCase())
        )
      );
    }

    if (industriesResult.error) {
      console.error("Failed to load industries:", industriesResult.error);
      setError(industriesResult.error.message || "Failed to load industries");
      setIndustries([]);
    } else {
      setIndustries(industriesResult.data || []);
    }

    if (companyIndustriesResult.error) {
      console.error("Failed to load company industries:", companyIndustriesResult.error);
      setError(
        companyIndustriesResult.error.message || "Failed to load company categories"
      );
      setSelectedIndustryIds([]);
    } else {
      setSelectedIndustryIds(
        (companyIndustriesResult.data || [])
          .map((row) => row.industry_id)
          .filter(Boolean)
      );
    }

    if (profileResult.error) {
      console.error("Failed to load company profile:", profileResult.error);
      setError(profileResult.error.message || "Failed to load company profile");
      setProfileId(null);
      setFields(EMPTY_PROFILE);
      setCustomValues({});
    } else if (profileResult.data) {
      const profile = profileResult.data;
      setProfileId(profile.id);
      setFields({
        domain: profile.domain || "",
        product_name: profile.product_name || "",
        target_audience: profile.target_audience || "",
        abstract: profile.abstract || "",
        short_description: profile.short_description || "",
        medium_description: profile.medium_description || "",
        long_description: profile.long_description || "",
        business_model: profile.business_model || "",
        core_value_proposition: profile.core_value_proposition || "",
        scope_boundaries: profile.scope_boundaries || "",
        design_guide_raw: profile.design_guide_raw || "",
        design_guide_abstract: profile.design_guide_abstract || "",
        core_keywords: normalizePillarKeywords(profile.core_keywords, {
          minCount: Array.isArray(profile.core_keywords) && profile.core_keywords.length > 0
            ? 0
            : DEFAULT_PILLAR_COUNT,
        }),
        competitors: normalizeCompetitors(profile.competitors),
        services: normalizeServices(profile.services),
        team_members: normalizeTeamMembers(profile.team_members),
        contact_email: profile.contact_email || "",
        social_links: normalizeSocialLinks(profile.social_links),
      });
      setCustomValues(
        profile.custom_fields && typeof profile.custom_fields === "object"
          ? { ...profile.custom_fields }
          : {}
      );
    } else {
      setProfileId(null);
      setFields(EMPTY_PROFILE);
      setCustomValues({});
    }

    if (socialAccountsResult.error) {
      console.error("Failed to load social accounts:", socialAccountsResult.error);
      setSocialShopsFilled(false);
    } else {
      setSocialShopsFilled((socialAccountsResult.count || 0) > 0);
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (searchParams.get("panel") === "social-shops") {
      setOpenPanel("social-shops");
      const next = new URLSearchParams(searchParams);
      next.delete("panel");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const updateField = (key, value) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const toggleIndustry = (industryId) => {
    setSelectedIndustryIds((prev) =>
      prev.includes(industryId)
        ? prev.filter((id) => id !== industryId)
        : [...prev, industryId]
    );
  };

  const updatePillarKeyword = (index, value) => {
    setFields((prev) => {
      const next = normalizePillarKeywords(prev.core_keywords);
      next[index] = { ...next[index], keyword: value };
      return { ...prev, core_keywords: next };
    });
  };

  const updateSupportingKeyword = (pillarIndex, supportingIndex, value) => {
    setFields((prev) => {
      const next = normalizePillarKeywords(prev.core_keywords);
      const supporting = [...next[pillarIndex].supporting];
      supporting[supportingIndex] = value;
      next[pillarIndex] = { ...next[pillarIndex], supporting };
      return { ...prev, core_keywords: next };
    });
  };

  const addCompetitor = () => {
    setFields((prev) => ({
      ...prev,
      competitors: [...normalizeCompetitors(prev.competitors), emptyCompetitor()],
    }));
  };

  const updateCompetitor = (index, key, value) => {
    setFields((prev) => {
      const next = normalizeCompetitors(prev.competitors);
      next[index] = { ...next[index], [key]: value };
      return { ...prev, competitors: next };
    });
  };

  const removeCompetitor = (index) => {
    setFields((prev) => ({
      ...prev,
      competitors: normalizeCompetitors(prev.competitors).filter((_, i) => i !== index),
    }));
  };

  const addService = () => {
    setFields((prev) => ({
      ...prev,
      services: [...normalizeServices(prev.services), emptyServiceEntry()],
    }));
  };

  const updateService = (index, key, value) => {
    setFields((prev) => {
      const next = normalizeServices(prev.services);
      next[index] = { ...next[index], [key]: value };
      return { ...prev, services: next };
    });
  };

  const removeService = (index) => {
    setFields((prev) => ({
      ...prev,
      services: normalizeServices(prev.services).filter((_, i) => i !== index),
    }));
  };

  const addPillarKeyword = () => {
    setFields((prev) => ({
      ...prev,
      core_keywords: [...normalizePillarKeywords(prev.core_keywords), emptyPillar()],
    }));
  };

  const removePillarKeyword = (index) => {
    const pillars = normalizePillarKeywords(fields.core_keywords);
    const pillar = pillars[index];
    const hasContent =
      String(pillar?.keyword || "").trim() || countFilled(pillar?.supporting || []) > 0;
    if (
      hasContent &&
      !window.confirm("Delete this pillar keyword and its supporting keywords?")
    ) {
      return;
    }

    setFields((prev) => {
      const next = normalizePillarKeywords(prev.core_keywords);
      next.splice(index, 1);
      return { ...prev, core_keywords: next };
    });
    setOpenPillars((prev) => {
      const remapped = {};
      for (const [key, open] of Object.entries(prev)) {
        const i = Number(key);
        if (Number.isNaN(i) || i === index) continue;
        remapped[i > index ? i - 1 : i] = open;
      }
      return remapped;
    });
  };

  const movePillarKeyword = (index, direction) => {
    const target = index + direction;
    const length = normalizePillarKeywords(fields.core_keywords).length;
    if (target < 0 || target >= length) return;

    setFields((prev) => {
      const next = normalizePillarKeywords(prev.core_keywords);
      if (target >= next.length) return prev;
      const swapped = [...next];
      const tmp = swapped[index];
      swapped[index] = swapped[target];
      swapped[target] = tmp;
      return { ...prev, core_keywords: swapped };
    });
    setOpenPillars((prev) => {
      const remapped = { ...prev };
      const a = prev[index];
      const b = prev[target];
      remapped[index] = b;
      remapped[target] = a;
      return remapped;
    });
  };

  const addSupportingKeyword = (pillarIndex) => {
    setFields((prev) => {
      const next = normalizePillarKeywords(prev.core_keywords);
      next[pillarIndex] = {
        ...next[pillarIndex],
        supporting: [...next[pillarIndex].supporting, ""],
      };
      return { ...prev, core_keywords: next };
    });
  };

  const setPillarOpen = (index, open) => {
    setOpenPillars((prev) => ({ ...prev, [index]: open }));
  };

  const updateCustomValue = (name, value) => {
    setCustomValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddField = async () => {
    const raw = window.prompt("New field name:");
    if (raw == null) return;

    const name = raw.trim();
    if (!name) return;

    if (HIDDEN_CUSTOM_FIELDS.has(name.toLowerCase())) {
      setError(`"${name}" is no longer used on Company Data.`);
      return;
    }

    if (customFieldDefs.some((field) => field.name.toLowerCase() === name.toLowerCase())) {
      setError(`A field named "${name}" already exists.`);
      return;
    }

    setError("");
    const { data, error: insertError } = await supabase
      .from("company_custom_fields")
      .insert({ name })
      .select("id, name, created_at")
      .single();

    if (insertError) {
      console.error("Failed to add custom field:", insertError);
      setError(insertError.message || "Failed to add field");
      return;
    }

    setCustomFieldDefs((prev) => [...prev, data]);
    setCustomValues((prev) => ({ ...prev, [name]: prev[name] || "" }));
  };

  const handleDeleteCustomField = async (def) => {
    if (!def?.id) return;
    if (
      !window.confirm(
        `Delete the custom field "${def.name}"? This removes it for all companies.`
      )
    ) {
      return;
    }

    setError("");
    const { error: deleteError } = await supabase
      .from("company_custom_fields")
      .delete()
      .eq("id", def.id);

    if (deleteError) {
      console.error("Failed to delete custom field:", deleteError);
      setError(deleteError.message || "Failed to delete field");
      return;
    }

    setCustomFieldDefs((prev) => prev.filter((field) => field.id !== def.id));
    setCustomValues((prev) => {
      const next = { ...prev };
      delete next[def.name];
      return next;
    });
    setOpenPanel(null);
  };

  const clearPanelContent = (panelId) => {
    switch (panelId) {
      case "domain":
        updateField("domain", "");
        break;
      case "product_name":
        updateField("product_name", "");
        break;
      case "category":
        setSelectedIndustryIds([]);
        setIndustryFilter("");
        break;
      case "target":
        updateField("target_audience", "");
        break;
      case "pillars":
        setFields((prev) => ({
          ...prev,
          core_keywords: normalizePillarKeywords([], {
            minCount: DEFAULT_PILLAR_COUNT,
          }),
        }));
        setOpenPillars({});
        break;
      case "competitors":
        setFields((prev) => ({ ...prev, competitors: [] }));
        break;
      case "services":
        setFields((prev) => ({ ...prev, services: [] }));
        break;
      case "abstract":
        updateField("abstract", "");
        break;
      case "short":
        updateField("short_description", "");
        break;
      case "medium":
        updateField("medium_description", "");
        break;
      case "long":
        updateField("long_description", "");
        break;
      case "business_model":
        updateField("business_model", "");
        break;
      case "core_value_proposition":
        updateField("core_value_proposition", "");
        break;
      case "scope_boundaries":
        updateField("scope_boundaries", "");
        break;
      default:
        if (typeof panelId === "string" && panelId.startsWith("custom:")) {
          const defId = panelId.slice("custom:".length);
          const def = customFieldDefs.find((field) => field.id === defId);
          if (def) updateCustomValue(def.name, "");
        }
        break;
    }
  };

  const confirmClearPanel = (panelId, label) => {
    if (!window.confirm(`Clear all content in ${label}?`)) return;
    clearPanelContent(panelId);
  };

  const getPanelCopyText = async (panelId) => {
    if (!panelId) return "";

    if (panelId === "domain") return fields.domain.trim();
    if (panelId === "product_name") return fields.product_name.trim();
    if (panelId === "target") return fields.target_audience.trim();
    if (panelId === "abstract") return fields.abstract.trim();
    if (panelId === "short") return fields.short_description.trim();
    if (panelId === "medium") return fields.medium_description.trim();
    if (panelId === "long") return fields.long_description.trim();
    if (panelId === "business_model") return fields.business_model.trim();
    if (panelId === "core_value_proposition") {
      return fields.core_value_proposition.trim();
    }
    if (panelId === "scope_boundaries") return fields.scope_boundaries.trim();

    if (panelId === "category") {
      return industries
        .filter((industry) => selectedIndustryIds.includes(industry.id))
        .map((industry) => industry.name)
        .join("\n");
    }

    if (panelId === "pillars") {
      return normalizePillarKeywords(fields.core_keywords)
        .filter(
          (pillar) => pillar.keyword.trim() || countFilled(pillar.supporting) > 0
        )
        .map((pillar) => {
          const supporting = pillar.supporting
            .map((kw) => kw.trim())
            .filter(Boolean)
            .map((kw) => `  - ${kw}`)
            .join("\n");
          const head = `- ${pillar.keyword.trim() || "(untitled)"}`;
          return supporting ? `${head}\n${supporting}` : head;
        })
        .join("\n");
    }

    if (panelId === "competitors") {
      return normalizeCompetitors(fields.competitors)
        .map((item) => ({ name: item.name.trim(), url: item.url.trim() }))
        .filter((item) => item.name || item.url)
        .map(
          (item) =>
            `- ${item.name || "(unnamed)"}${item.url ? `: ${item.url}` : ""}`
        )
        .join("\n");
    }

    if (panelId === "services") {
      return trimServicesForSave(fields.services)
        .map((s) => formatServiceCopyBlock(s))
        .join("\n\n");
    }

    if (panelId === "social-shops") {
      if (!companyId) return "";
      const [accountsResult, notesResult] = await Promise.all([
        supabase
          .from("social_accounts")
          .select(
            "name, type, url, username, access_details, status, comments, created_at"
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: true }),
        supabase
          .from("social_notes")
          .select("text, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false }),
      ]);
      if (accountsResult.error) {
        throw new Error(
          accountsResult.error.message || "Failed to load Social & Shops"
        );
      }
      if (notesResult.error) {
        throw new Error(
          notesResult.error.message || "Failed to load Social & Shops notes"
        );
      }
      return formatSocialShopsMarkdown(
        accountsResult.data || [],
        notesResult.data || []
      );
    }

    if (panelId === "design-guide") {
      const raw = (designGuideDraftRaw || fields.design_guide_raw || "").trim();
      const abstract = (
        designGuideDraftAbstract ||
        fields.design_guide_abstract ||
        ""
      ).trim();
      if (raw && abstract) return `${raw}\n\n---\n\nAbstract:\n${abstract}`;
      return raw || abstract;
    }

    if (typeof panelId === "string" && panelId.startsWith("custom:")) {
      const defId = panelId.slice("custom:".length);
      const def = customFieldDefs.find((field) => field.id === defId);
      if (!def) return "";
      return String(customValues[def.name] || "").trim();
    }

    return "";
  };

  const handleCopyPanel = async (panelId) => {
    try {
      const text = await getPanelCopyText(panelId);
      if (!String(text || "").trim()) {
        setError("Nothing to copy");
        return false;
      }
      const ok = await copyTextToClipboard(text);
      if (!ok) {
        setError("Copy failed");
        return false;
      }
      setError("");
      return true;
    } catch (err) {
      console.error(err);
      setError(err?.message || "Copy failed");
      return false;
    }
  };

  /** Persist profile to Supabase. Returns true on success. */
  const persistProfile = async (overrides = {}) => {
    if (!companyId || saving) return false;

    const currentFields = overrides.fields ?? fields;
    const currentCustomValues = overrides.customValues ?? customValues;
    const currentIndustryIds = overrides.selectedIndustryIds ?? selectedIndustryIds;

    setSaving(true);
    setSavedMessage("");
    setError("");

    const competitors = normalizeCompetitors(currentFields.competitors)
      .map((item) => ({
        name: item.name.trim(),
        url: item.url.trim(),
      }))
      .filter((item) => item.name || item.url);

    for (const competitor of competitors) {
      if (!isLooseHttpUrl(competitor.url)) {
        setError("Competitor URLs must start with http:// or https://");
        setSaving(false);
        return false;
      }
    }

    const services = trimServicesForSave(currentFields.services);
    const team_members = trimTeamMembersForSave(currentFields.team_members);
    const social_links = trimSocialLinksForSave(currentFields.social_links);

    for (const member of team_members) {
      for (const url of member.same_as || []) {
        if (!isLooseHttpUrl(url)) {
          setError("Team sameAs URLs must start with http:// or https://");
          setSaving(false);
          return false;
        }
      }
    }

    for (const link of social_links) {
      if (!isLooseHttpUrl(link.url)) {
        setError("Social link URLs must start with http:// or https://");
        setSaving(false);
        return false;
      }
    }

    const custom_fields = {};
    for (const def of customFieldDefs) {
      custom_fields[def.name] = currentCustomValues[def.name] ?? "";
    }
    // Preserve reserved keys written by other tools (e.g. Analytics `_analytics_tools`).
    for (const [key, value] of Object.entries(currentCustomValues)) {
      if (key.startsWith("_") && !(key in custom_fields)) {
        custom_fields[key] = value;
      }
    }

    const payload = {
      company_id: companyId,
      domain: currentFields.domain.trim() || null,
      product_name: currentFields.product_name.trim() || null,
      target_audience: currentFields.target_audience.trim() || null,
      abstract: currentFields.abstract.trim() || null,
      short_description: currentFields.short_description.trim() || null,
      medium_description: currentFields.medium_description.trim() || null,
      long_description: currentFields.long_description.trim() || null,
      business_model: (currentFields.business_model || "").trim() || null,
      core_value_proposition:
        (currentFields.core_value_proposition || "").trim() || null,
      scope_boundaries: (currentFields.scope_boundaries || "").trim() || null,
      design_guide_raw: currentFields.design_guide_raw.trim() || null,
      design_guide_abstract: currentFields.design_guide_abstract.trim() || null,
      core_keywords: normalizePillarKeywords(currentFields.core_keywords),
      competitors,
      services,
      team_members,
      contact_email: currentFields.contact_email.trim() || null,
      social_links,
      custom_fields,
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
      console.error("Failed to save company profile:", upsertError);
      setError(upsertError.message || "Failed to save");
      setSaving(false);
      return false;
    }

    const { error: deleteIndustriesError } = await supabase
      .from("company_industries")
      .delete()
      .eq("company_id", companyId);

    if (deleteIndustriesError) {
      console.error("Failed to clear company categories:", deleteIndustriesError);
      setError(deleteIndustriesError.message || "Failed to save categories");
      setSaving(false);
      return false;
    }

    if (currentIndustryIds.length > 0) {
      const { error: insertIndustriesError } = await supabase
        .from("company_industries")
        .insert(
          currentIndustryIds.map((industry_id) => ({
            company_id: companyId,
            industry_id,
          }))
        );

      if (insertIndustriesError) {
        console.error("Failed to save company categories:", insertIndustriesError);
        setError(insertIndustriesError.message || "Failed to save categories");
        setSaving(false);
        return false;
      }
    }

    setProfileId(data?.id || profileId);
    setSaving(false);
    if (!overrides.skipSavedMessage) {
      setSavedMessage("Saved");
      window.setTimeout(() => setSavedMessage(""), 2500);
    }
    return true;
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    await persistProfile();
  };

  const importSocialShops = async (accounts, notes) => {
    const accountRows = (accounts || [])
      .map((account) => ({
        company_id: companyId,
        name: String(account.name || "").trim(),
        type: account.type || "Other",
        status: String(account.status || "").trim() || null,
        url: String(account.url || "").trim() || null,
        username: String(account.username || "").trim() || null,
        access_details: String(account.access_details || "").trim() || null,
        comments: String(account.comments || "").trim() || null,
      }))
      .filter((row) => row.name);
    if (accountRows.length > 0) {
      const { error: accountsError } = await supabase
        .from("social_accounts")
        .insert(accountRows);
      if (accountsError) {
        throw new Error(accountsError.message || "Failed to import Social & Shops");
      }
      setSocialShopsFilled(true);
    }
    const noteRows = (notes || [])
      .map((text) => String(text || "").trim())
      .filter(Boolean)
      .map((text) => ({ company_id: companyId, text }));
    if (noteRows.length > 0) {
      const { error: notesError } = await supabase.from("social_notes").insert(noteRows);
      if (notesError) {
        throw new Error(notesError.message || "Failed to import Social & Shops notes");
      }
    }
  };

  const handleMarkdownFile = async (file) => {
    if (!file || saving) return;
    const name = String(file.name || "").toLowerCase();
    if (!name.endsWith(".md") && !name.endsWith(".markdown")) {
      setError("Please drop a .md markdown file.");
      return;
    }

    setError("");
    try {
      const text = await file.text();
      const parsed = parseCompanyMarkdown(text, {
        extraLabels: customFieldDefs.map((def) => def.name),
      });
      const merged = mergeParsedCompanyFields({
        parsed,
        fields,
        customValues,
        customFieldDefs,
        selectedIndustryIds,
        industries,
        socialShopsFilled,
      });

      if (merged.filled.length === 0) {
        setSavedMessage(
          merged.skipped.length > 0
            ? "No empty fields to fill from that file"
            : "No matching company fields found in that file"
        );
        window.setTimeout(() => setSavedMessage(""), 4000);
        return;
      }

      const nextFields = {
        ...merged.nextFields,
        core_keywords: normalizePillarKeywords(merged.nextFields.core_keywords, {
          minCount: 0,
        }),
        competitors: normalizeCompetitors(merged.nextFields.competitors),
        services: normalizeServices(merged.nextFields.services),
        team_members: normalizeTeamMembers(merged.nextFields.team_members),
        social_links: normalizeSocialLinks(merged.nextFields.social_links),
      };

      setFields(nextFields);
      setCustomValues(merged.nextCustom);
      setSelectedIndustryIds(merged.nextIndustryIds);

      const saved = await persistProfile({
        fields: nextFields,
        customValues: merged.nextCustom,
        selectedIndustryIds: merged.nextIndustryIds,
        skipSavedMessage: true,
      });
      if (!saved) return;

      if (merged.socialAccounts) {
        try {
          await importSocialShops(merged.socialAccounts, merged.socialNotes);
        } catch (err) {
          console.error("Failed to import Social & Shops:", err);
          setError(err?.message || "Failed to import Social & Shops");
        }
      }

      const count = merged.filled.length;
      setSavedMessage(
        `Filled ${count} missing field${count === 1 ? "" : "s"} from ${file.name}`
      );
      window.setTimeout(() => setSavedMessage(""), 4000);
    } catch (err) {
      console.error("Failed to import company markdown:", err);
      setError(err?.message || "Failed to import markdown");
    }
  };

  const processMarkdownFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (files.length > 1) {
      setError("Drop a single .md file.");
      return;
    }
    handleMarkdownFile(files[0]);
  };

  const saveAndClosePanel = async () => {
    const ok = await persistProfile();
    if (ok) setOpenPanel(null);
  };

  const handleDownloadMarkdown = async () => {
    const pillars = normalizePillarKeywords(fields.core_keywords);
    const pillarLines = pillars
      .filter((pillar) => pillar.keyword.trim() || countFilled(pillar.supporting) > 0)
      .map((pillar) => {
        const supporting = pillar.supporting
          .map((kw) => kw.trim())
          .filter(Boolean)
          .map((kw) => `  - ${kw}`)
          .join("\n");
        const head = `- ${pillar.keyword.trim() || "(untitled)"}`;
        return supporting ? `${head}\n${supporting}` : head;
      })
      .join("\n");

    const competitorLines = normalizeCompetitors(fields.competitors)
      .map((item) => ({ name: item.name.trim(), url: item.url.trim() }))
      .filter((item) => item.name || item.url)
      .map((item) => `- ${item.name || "(unnamed)"}${item.url ? `: ${item.url}` : ""}`)
      .join("\n");

    const serviceLines = trimServicesForSave(fields.services)
      .map((s) => formatServiceCopyBlock(s))
      .join("\n\n");

    const categoryLines = industries
      .filter((industry) => selectedIndustryIds.includes(industry.id))
      .map((industry) => `- ${industry.name}`)
      .join("\n");

    let socialShopsLines = "";
    if (companyId) {
      const [accountsResult, notesResult] = await Promise.all([
        supabase
          .from("social_accounts")
          .select(
            "name, type, url, username, access_details, status, comments, created_at"
          )
          .eq("company_id", companyId)
          .order("created_at", { ascending: true }),
        supabase
          .from("social_notes")
          .select("text, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false }),
      ]);

      if (accountsResult.error) {
        console.error("Failed to load social accounts for markdown:", accountsResult.error);
        setError(accountsResult.error.message || "Failed to load Social & Shops for download");
        return;
      }
      if (notesResult.error) {
        console.error("Failed to load social notes for markdown:", notesResult.error);
        setError(notesResult.error.message || "Failed to load Social & Shops notes for download");
        return;
      }

      socialShopsLines = formatSocialShopsMarkdown(
        accountsResult.data || [],
        notesResult.data || []
      );
    }

    const teamLines = trimTeamMembersForSave(fields.team_members)
      .map((member) => {
        const meta = [member.role, member.credentials].filter(Boolean).join(" · ");
        const head = `- ${member.name || "(unnamed)"}${meta ? `: ${meta}` : ""}`;
        const detailLines = [];
        if (member.bio) detailLines.push(`  ${member.bio}`);
        for (const url of member.same_as || []) {
          detailLines.push(`  - ${url}`);
        }
        return detailLines.length > 0 ? `${head}\n${detailLines.join("\n")}` : head;
      })
      .join("\n");

    const socialLinkLines = trimSocialLinksForSave(fields.social_links)
      .map((link) => `- ${link.label || "(label)"}${link.url ? `: ${link.url}` : ""}`)
      .join("\n");

    const fixedEntries = [
      ["Domain", fields.domain],
      ["Product Name", fields.product_name],
      ["Category", categoryLines],
      ["Target Description", fields.target_audience],
      ["Pillar Keywords", pillarLines],
      ["Competitors", competitorLines],
      ["Social & Shops", socialShopsLines],
      ["Products & Services", serviceLines],
      ["Team Members", teamLines],
      ["Contact Email", fields.contact_email],
      ["Social Links", socialLinkLines],
      ["Abstract", fields.abstract],
      ["Short Description", fields.short_description],
      ["Medium Description", fields.medium_description],
      ["Long Description", fields.long_description],
      ["Business Model", fields.business_model],
      ["Core Value Proposition", fields.core_value_proposition],
      ["Scope / Boundaries", fields.scope_boundaries],
      ["Design Guide", fields.design_guide_raw],
      ["Design Abstract", fields.design_guide_abstract],
    ];

    const customEntries = customFieldDefs.map((def) => [
      def.name,
      customValues[def.name] || "",
    ]);

    const lines = [`# ${companyName || "Company"}`, ""];

    const blockLabels = new Set([
      "Category",
      "Pillar Keywords",
      "Competitors",
      "Social & Shops",
      "Products & Services",
      "Team Members",
      "Social Links",
      "Design Guide",
    ]);

    for (const [label, value] of [...fixedEntries, ...customEntries]) {
      const trimmed = (value || "").trim();
      if (!trimmed) continue;
      if (blockLabels.has(label)) {
        lines.push(`**${label}:**`, trimmed, "");
      } else {
        lines.push(`**${label}:** ${trimmed}`, "");
      }
    }

    const slug = (companyName || "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    downloadMarkdown(`${slug || "company"}-data.md`, lines.join("\n").trim() + "\n");
  };

  const openDesignGuideModal = () => {
    setDesignGuideDraftRaw(fields.design_guide_raw || "");
    setDesignGuideDraftAbstract("");
    setDesignGuideAbstractReady(false);
    setDesignGuideError("");
    setDesignGuideOpen(true);
  };

  const openDataPoint = (id) => {
    if (id === "design-guide") {
      openDesignGuideModal();
      return;
    }
    setOpenPanel(id);
  };

  const handleGenerateDesignGuideAbstract = async () => {
    const raw = designGuideDraftRaw.trim();
    if (!raw || designGuideGenerating) return;

    setDesignGuideGenerating(true);
    setDesignGuideError("");
    setDesignGuideAbstractReady(false);
    setDesignGuideDraftAbstract("");

    try {
      const res = await fetch("/api/design-guide?action=abstract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Generate abstract failed (${res.status})`);
      }

      const abstract = String(data.abstract || "").trim();
      if (!abstract) {
        throw new Error("No abstract returned");
      }

      setDesignGuideDraftAbstract(abstract);
      setDesignGuideAbstractReady(true);
    } catch (err) {
      console.error("Failed to generate design guide abstract:", err);
      setDesignGuideError(err.message || "Failed to generate abstract");
    } finally {
      setDesignGuideGenerating(false);
    }
  };

  const handleSaveDesignGuide = async () => {
    if (!companyId || designGuideSaving || !designGuideAbstractReady) return;

    const raw = designGuideDraftRaw.trim();
    const abstract = designGuideDraftAbstract.trim();
    if (!raw || !abstract) {
      setDesignGuideError("Paste a Design Guide and generate an abstract before saving.");
      return;
    }

    setDesignGuideSaving(true);
    setDesignGuideError("");

    const payload = {
      company_id: companyId,
      design_guide_raw: raw,
      design_guide_abstract: abstract,
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
      console.error("Failed to save design guide:", upsertError);
      setDesignGuideError(upsertError.message || "Failed to save design guide");
      setDesignGuideSaving(false);
      return;
    }

    setProfileId(data?.id || profileId);
    setFields((prev) => ({
      ...prev,
      design_guide_raw: raw,
      design_guide_abstract: abstract,
    }));
    setDesignGuideSaving(false);
    setDesignGuideOpen(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleDeleteDesignGuide = async () => {
    if (!companyId || designGuideSaving || designGuideGenerating) return;
    if (!window.confirm("Delete the Design Guide and its abstract?")) return;

    setDesignGuideSaving(true);
    setDesignGuideError("");

    const payload = {
      company_id: companyId,
      design_guide_raw: null,
      design_guide_abstract: null,
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
      console.error("Failed to delete design guide:", upsertError);
      setDesignGuideError(upsertError.message || "Failed to delete design guide");
      setDesignGuideSaving(false);
      return;
    }

    setProfileId(data?.id || profileId);
    setFields((prev) => ({
      ...prev,
      design_guide_raw: "",
      design_guide_abstract: "",
    }));
    setDesignGuideDraftRaw("");
    setDesignGuideDraftAbstract("");
    setDesignGuideAbstractReady(false);
    setDesignGuideSaving(false);
    setDesignGuideOpen(false);
    setSavedMessage("Deleted");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading company data...</p>;
  }

  const pillars = normalizePillarKeywords(fields.core_keywords);
  const pillarTotal = pillars.length;
  const competitors = normalizeCompetitors(fields.competitors);
  const services = normalizeServices(fields.services);
  const hasDesignGuide = Boolean(
    String(fields.design_guide_raw || "").trim() ||
      String(fields.design_guide_abstract || "").trim()
  );
  const industryQuery = industryFilter.trim().toLowerCase();
  const filteredIndustries = industryQuery
    ? industries.filter((industry) =>
        industry.name.toLowerCase().includes(industryQuery)
      )
    : industries;
  const selectedIndustries = industries.filter((industry) =>
    selectedIndustryIds.includes(industry.id)
  );
  const dataPoints = getCompanyDataPoints({
    fields,
    selectedIndustryIds,
    socialShopsFilled,
    customFieldDefs,
    customValues,
  });
  const completedCount = dataPoints.filter((point) => point.filled).length;
  const missingPoints = dataPoints.filter((point) => !point.filled);
  const llmUploadPrompt = buildLlmUploadPrompt({
    companyName,
    customFieldNames: customFieldDefs.map((def) => def.name),
    industryNames: industries.map((industry) => industry.name),
  });

  return (
    <div>
      <h1 className="text-xs text-foreground mb-1">
        {companyName || "Company Data"}
      </h1>
      <p className="text-sm text-muted-foreground mb-4">
        Edit company profile fields and export as markdown.
      </p>

      <div
        role="button"
        tabIndex={0}
        className={`mb-2 rounded-md border border-dashed px-3 py-4 text-center transition-colors cursor-pointer ${
          markdownDragOver ? "border-foreground bg-muted/40" : "border-border"
        } ${saving ? "pointer-events-none opacity-60" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setMarkdownDragOver(true);
        }}
        onDragLeave={() => setMarkdownDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setMarkdownDragOver(false);
          processMarkdownFiles(e.dataTransfer.files);
        }}
        onClick={() => markdownInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            markdownInputRef.current?.click();
          }
        }}
      >
        <Upload className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-foreground">
          Drop a .md file to fill empty fields
        </p>
        <p className="text-xs text-muted-foreground">
          Only missing fields are completed — existing values stay as they are
        </p>
        <input
          ref={markdownInputRef}
          type="file"
          className="sr-only"
          accept=".md,.markdown,text/markdown"
          onChange={(e) => {
            processMarkdownFiles(e.target.files);
            e.target.value = "";
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="mb-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLlmPromptOpen(true)}
        >
          LLM File Upload Prompt
        </Button>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSave} className="space-y-1.5">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
          <PanelTrigger
            title="Domain"
            filled={Boolean(fields.domain.trim())}
            onClick={() => setOpenPanel("domain")}
          />
          <PanelTrigger
            title="Product Name"
            filled={Boolean(fields.product_name.trim())}
            onClick={() => setOpenPanel("product_name")}
          />
          <PanelTrigger
            title="Category"
            filled={selectedIndustries.length > 0}
            onClick={() => setOpenPanel("category")}
          />
          <PanelTrigger
            title="Target Description"
            filled={Boolean(fields.target_audience.trim())}
            onClick={() => setOpenPanel("target")}
          />
          <PanelTrigger
            title="Design Abstract"
            filled={hasDesignGuide}
            onClick={openDesignGuideModal}
          />
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
          <PanelTrigger
            title="Products & Services"
            filled={services.some(serviceHasContent)}
            onClick={() => setOpenPanel("services")}
          />
          <PanelTrigger
            title="Abstract"
            filled={Boolean(fields.abstract.trim())}
            onClick={() => setOpenPanel("abstract")}
          />
          <PanelTrigger
            title="Short Description"
            filled={Boolean(fields.short_description.trim())}
            onClick={() => setOpenPanel("short")}
          />
          <PanelTrigger
            title="Medium Description"
            filled={Boolean(fields.medium_description.trim())}
            onClick={() => setOpenPanel("medium")}
          />
          <PanelTrigger
            title="Long Description"
            filled={Boolean(fields.long_description.trim())}
            onClick={() => setOpenPanel("long")}
          />
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <PanelTrigger
            title="Business Model"
            filled={Boolean(fields.business_model.trim())}
            onClick={() => setOpenPanel("business_model")}
          />
          <PanelTrigger
            title="Core Value Proposition"
            filled={Boolean(fields.core_value_proposition.trim())}
            onClick={() => setOpenPanel("core_value_proposition")}
          />
          <PanelTrigger
            title="Scope / Boundaries"
            filled={Boolean(fields.scope_boundaries.trim())}
            onClick={() => setOpenPanel("scope_boundaries")}
          />
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <PanelTrigger
            title={`Pillar Keywords (${pillarTotal})`}
            filled={pillars.some(
              (pillar) =>
                pillar.keyword.trim() || countFilled(pillar.supporting) > 0
            )}
            onClick={() => setOpenPanel("pillars")}
          />
          <PanelTrigger
            title={`Competitors (${competitors.length})`}
            filled={competitors.some(
              (item) => item.name.trim() || item.url.trim()
            )}
            onClick={() => setOpenPanel("competitors")}
          />
          <PanelTrigger
            title="Social & Shops"
            filled={socialShopsFilled}
            onClick={() => setOpenPanel("social-shops")}
          />
        </div>

        {customFieldDefs.map((def) => (
          <PanelTrigger
            key={def.id}
            title={def.name}
            filled={Boolean((customValues[def.name] || "").trim())}
            onClick={() => setOpenPanel(`custom:${def.id}`)}
          />
        ))}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="button" variant="outline" onClick={handleAddField}>
            + Add a field
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleDownloadMarkdown}>
            Download as Markdown
          </Button>
          {savedMessage && (
            <span className="text-sm text-muted-foreground">{savedMessage}</span>
          )}
        </div>
      </form>

      <div className="mt-8 space-y-2 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          {completedCount} / {dataPoints.length} fields completed
        </p>
        {missingPoints.length > 0 ? (
          <Collapsible open={missingOpen} onOpenChange={setMissingOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md py-1 text-left text-sm font-medium text-foreground hover:text-foreground"
              >
                Missing Data Points
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    missingOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="mt-1 space-y-0.5">
                {missingPoints.map((point) => (
                  <li key={point.id}>
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => openDataPoint(point.id)}
                    >
                      {point.label}
                    </button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <p className="text-sm text-muted-foreground">All fields completed.</p>
        )}
      </div>

      <Dialog open={llmPromptOpen} onOpenChange={setLlmPromptOpen}>
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>LLM File Upload Prompt</DialogTitle>
            <DialogDescription>
              Paste this into an LLM with your company context. Save the reply as
              a .md file and drop it above to fill empty fields.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {llmUploadPrompt}
            </pre>
          </div>
          <DialogFooter className="shrink-0 border-t border-border px-6 py-4 sm:justify-end">
            <PanelModalActions
              onCopy={async () => {
                const ok = await copyTextToClipboard(llmUploadPrompt);
                if (!ok) {
                  setError("Copy failed");
                  return false;
                }
                setError("");
                return true;
              }}
              onClose={() => setLlmPromptOpen(false)}
              showSave={false}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Domain */}
      <Dialog
        open={openPanel === "domain"}
        onOpenChange={(open) => setOpenPanel(open ? "domain" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Domain</DialogTitle>
            <DialogDescription>Company website domain.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Input
              id="domain"
              value={fields.domain}
              onChange={(e) => updateField("domain", e.target.value)}
              placeholder="example.com"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("domain", "Domain")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Product Name */}
      <Dialog
        open={openPanel === "product_name"}
        onOpenChange={(open) => setOpenPanel(open ? "product_name" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Product Name</DialogTitle>
            <DialogDescription>Primary product or brand name.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Input
              id="product_name"
              value={fields.product_name}
              onChange={(e) => updateField("product_name", e.target.value)}
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("product_name", "Product Name")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category */}
      <Dialog
        open={openPanel === "category"}
        onOpenChange={(open) => {
          setOpenPanel(open ? "category" : null);
          if (!open) setIndustryFilter("");
        }}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>
              Category
              {selectedIndustries.length
                ? ` (${selectedIndustries.length})`
                : ""}
            </DialogTitle>
            <DialogDescription>
              Select industries that describe this company.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {selectedIndustries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedIndustries.map((industry) => (
                  <Badge
                    key={industry.id}
                    variant="secondary"
                    className="gap-1 pr-1 font-normal"
                  >
                    {industry.name}
                    <button
                      type="button"
                      className="inline-flex rounded-sm p-0.5 hover:bg-muted"
                      onClick={() => toggleIndustry(industry.id)}
                      aria-label={`Remove ${industry.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <Input
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              placeholder="Filter industries..."
            />
            <div className="space-y-1 rounded-md border border-border p-2">
              {filteredIndustries.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  {industries.length === 0
                    ? "No industries available. Run the industries migration."
                    : "No matches."}
                </p>
              ) : (
                filteredIndustries.map((industry) => {
                  const checked = selectedIndustryIds.includes(industry.id);
                  return (
                    <label
                      key={industry.id}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleIndustry(industry.id)}
                      />
                      <span>{industry.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("category", "Category")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Target Description */}
      <Dialog
        open={openPanel === "target"}
        onOpenChange={(open) => setOpenPanel(open ? "target" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Target Description</DialogTitle>
            <DialogDescription>
              Who you serve — ICP, persona, and target audience details.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="target_audience"
              value={fields.target_audience}
              onChange={(e) => updateField("target_audience", e.target.value)}
              placeholder="Who you serve — ICP, persona, and target audience details."
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("target", "Target Description")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pillar Keywords */}
      <Dialog
        open={openPanel === "pillars"}
        onOpenChange={(open) => setOpenPanel(open ? "pillars" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Pillar Keywords ({pillarTotal})</DialogTitle>
            <DialogDescription>
              Core pillar keywords and their supporting keywords.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {pillars.map((pillar, index) => {
              const isOpen = Boolean(openPillars[index]);
              const left = supportingLeft(pillar);
              const supportingCount = pillar.supporting.length;

              return (
                <Collapsible
                  key={index}
                  open={isOpen}
                  onOpenChange={(open) => setPillarOpen(index, open)}
                  className="rounded-md border border-border"
                >
                  <div className="flex items-center gap-2 p-2">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                        aria-label={
                          isOpen
                            ? "Collapse supporting keywords"
                            : "Expand supporting keywords"
                        }
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <Input
                      id={`pillar_keyword_${index + 1}`}
                      value={pillar.keyword}
                      onChange={(e) => updatePillarKeyword(index, e.target.value)}
                      placeholder="Pillar keyword"
                      className="flex-1"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {left} left
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => movePillarKeyword(index, -1)}
                        disabled={index === 0}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                        title="Move up"
                        aria-label="Move pillar up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePillarKeyword(index, 1)}
                        disabled={index === pillars.length - 1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                        title="Move down"
                        aria-label="Move pillar down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePillarKeyword(index)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                        title="Delete pillar"
                        aria-label="Delete pillar keyword"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <CollapsibleContent className="border-t border-border px-3 pb-3 pt-2">
                    <div className="mb-2 flex items-center justify-between">
                      <Label className="text-sm">
                        Supporting Keywords ({supportingCount})
                      </Label>
                    </div>
                    <div className="space-y-2">
                      {pillar.supporting.map((keyword, supportingIndex) => (
                        <Input
                          key={supportingIndex}
                          id={`supporting_keyword_${index + 1}_${supportingIndex + 1}`}
                          value={keyword}
                          onChange={(e) =>
                            updateSupportingKeyword(
                              index,
                              supportingIndex,
                              e.target.value
                            )
                          }
                          placeholder="Supporting keyword"
                        />
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addSupportingKeyword(index)}
                      >
                        + New
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            <Button type="button" variant="outline" size="sm" onClick={addPillarKeyword}>
              + New
            </Button>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("pillars", "Pillar Keywords")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Competitors */}
      <Dialog
        open={openPanel === "competitors"}
        onOpenChange={(open) => setOpenPanel(open ? "competitors" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Competitors ({competitors.length})</DialogTitle>
            <DialogDescription>Competitor names and website URLs.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {competitors.map((competitor, index) => (
              <div key={index} className="flex items-start gap-2">
                <Input
                  value={competitor.name}
                  onChange={(e) => updateCompetitor(index, "name", e.target.value)}
                  placeholder="Name"
                  className="flex-1"
                  aria-label={`Competitor ${index + 1} name`}
                />
                <Input
                  value={competitor.url}
                  onChange={(e) => updateCompetitor(index, "url", e.target.value)}
                  placeholder="https://"
                  className="flex-1"
                  aria-label={`Competitor ${index + 1} URL`}
                />
                <button
                  type="button"
                  onClick={() => removeCompetitor(index)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                  title="Remove competitor"
                  aria-label="Remove competitor"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addCompetitor}>
              + Add
            </Button>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("competitors", "Competitors")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Services */}
      <Dialog
        open={openPanel === "services"}
        onOpenChange={(open) => setOpenPanel(open ? "services" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Products & Services ({services.length})</DialogTitle>
            <DialogDescription>
              One card per offering — title, summary, and optional detail.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {services.map((service, index) => (
              <div
                key={index}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <div className="flex items-start gap-2">
                  <Input
                    value={service.title}
                    onChange={(e) => updateService(index, "title", e.target.value)}
                    placeholder="Title"
                    className="flex-1"
                    aria-label={`Service ${index + 1} title`}
                  />
                  <CopyProductButton service={service} />
                  <button
                    type="button"
                    onClick={() => removeService(index)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Remove service"
                    aria-label="Remove service"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Textarea
                  value={service.summary}
                  onChange={(e) => updateService(index, "summary", e.target.value)}
                  placeholder="Summary"
                  className="min-h-[72px]"
                  aria-label={`Service ${index + 1} summary`}
                />
                <Textarea
                  value={service.detail}
                  onChange={(e) => updateService(index, "detail", e.target.value)}
                  placeholder="Detail (optional)"
                  className="min-h-[72px]"
                  aria-label={`Service ${index + 1} detail`}
                />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addService}>
              + Add
            </Button>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("services", "Products & Services")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Social & Shops */}
      <Dialog
        open={openPanel === "social-shops"}
        onOpenChange={(open) => setOpenPanel(open ? "social-shops" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Social & Shops</DialogTitle>
            <DialogDescription>
              Social media, digital stores, credentials, and notes.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {openPanel === "social-shops" && companyId ? (
              <SocialShopsPanel
                companyId={companyId}
                onAccountsChange={(accounts) =>
                  setSocialShopsFilled((accounts || []).length > 0)
                }
              />
            ) : null}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
            <PanelModalActions
              onCopy={() => handleCopyPanel("social-shops")}
              onClose={() => setOpenPanel(null)}
              showSave={false}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Abstract */}
      <Dialog
        open={openPanel === "abstract"}
        onOpenChange={(open) => setOpenPanel(open ? "abstract" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Abstract</DialogTitle>
            <DialogDescription>Short company abstract.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="abstract"
              value={fields.abstract}
              onChange={(e) => updateField("abstract", e.target.value)}
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("abstract", "Abstract")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Short Description */}
      <Dialog
        open={openPanel === "short"}
        onOpenChange={(open) => setOpenPanel(open ? "short" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Short Description</DialogTitle>
            <DialogDescription>Brief company description.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="short_description"
              value={fields.short_description}
              onChange={(e) => updateField("short_description", e.target.value)}
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("short", "Short Description")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Medium Description */}
      <Dialog
        open={openPanel === "medium"}
        onOpenChange={(open) => setOpenPanel(open ? "medium" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Medium Description</DialogTitle>
            <DialogDescription>Medium-length company description.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="medium_description"
              value={fields.medium_description}
              onChange={(e) => updateField("medium_description", e.target.value)}
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("medium", "Medium Description")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Long Description */}
      <Dialog
        open={openPanel === "long"}
        onOpenChange={(open) => setOpenPanel(open ? "long" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Long Description</DialogTitle>
            <DialogDescription>Full company description.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="long_description"
              value={fields.long_description}
              onChange={(e) => updateField("long_description", e.target.value)}
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("long", "Long Description")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Business Model */}
      <Dialog
        open={openPanel === "business_model"}
        onOpenChange={(open) => setOpenPanel(open ? "business_model" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Business Model</DialogTitle>
            <DialogDescription>
              How the company makes money and delivers value.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="business_model"
              value={fields.business_model}
              onChange={(e) => updateField("business_model", e.target.value)}
              placeholder="Who pays, for what, and how — product, services, marketplace, membership, etc."
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("business_model", "Business Model")}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Core Value Proposition */}
      <Dialog
        open={openPanel === "core_value_proposition"}
        onOpenChange={(open) =>
          setOpenPanel(open ? "core_value_proposition" : null)
        }
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Core Value Proposition</DialogTitle>
            <DialogDescription>
              The primary reason customers choose this company over alternatives.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="core_value_proposition"
              value={fields.core_value_proposition}
              onChange={(e) =>
                updateField("core_value_proposition", e.target.value)
              }
              placeholder="One clear promise — why this company, not a competitor."
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                confirmClearPanel(
                  "core_value_proposition",
                  "Core Value Proposition"
                )
              }
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scope / Boundaries */}
      <Dialog
        open={openPanel === "scope_boundaries"}
        onOpenChange={(open) => setOpenPanel(open ? "scope_boundaries" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Scope / Boundaries</DialogTitle>
            <DialogDescription>
              What is in scope — and what this company explicitly does not do.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="scope_boundaries"
              value={fields.scope_boundaries}
              onChange={(e) => updateField("scope_boundaries", e.target.value)}
              placeholder="In scope vs. out of scope. Name adjacent work you turn down."
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                confirmClearPanel("scope_boundaries", "Scope / Boundaries")
              }
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom fields */}
      {customFieldDefs.map((def) => {
        const panelId = `custom:${def.id}`;
        return (
          <Dialog
            key={def.id}
            open={openPanel === panelId}
            onOpenChange={(open) => setOpenPanel(open ? panelId : null)}
          >
            <DialogContent className={PANEL_DIALOG_CLASS}>
              <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
                <DialogTitle>{def.name}</DialogTitle>
                <DialogDescription>Custom company field.</DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <Input
                  id={`custom-${def.id}`}
                  value={customValues[def.name] || ""}
                  onChange={(e) => updateCustomValue(def.name, e.target.value)}
                />
              </div>
              <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => handleDeleteCustomField(def)}
                >
                  Delete
                </Button>
                <PanelModalActions
                  onCopy={() => handleCopyPanel(panelId)}
                  onClose={() => setOpenPanel(null)}
                  onSave={saveAndClosePanel}
                  saving={saving}
                />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })}

      <Dialog
        open={designGuideOpen}
        onOpenChange={(open) => {
          if (designGuideGenerating || designGuideSaving) return;
          setDesignGuideOpen(open);
          if (!open) setDesignGuideError("");
        }}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>
              {hasDesignGuide ? "Update Design Abstract" : "Paste Design Guide"}
            </DialogTitle>
            <DialogDescription>
              Paste your project&apos;s Design Guide.md, generate an abstract, then save.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="design_guide_raw_paste">Design Guide</Label>
              <Textarea
                id="design_guide_raw_paste"
                value={designGuideDraftRaw}
                onChange={(e) => {
                  setDesignGuideDraftRaw(e.target.value);
                  setDesignGuideAbstractReady(false);
                  setDesignGuideDraftAbstract("");
                }}
                placeholder="Paste your project's Design Guide.md content here."
                className="min-h-[220px] font-mono text-sm"
              />
            </div>

            <Button
              type="button"
              onClick={handleGenerateDesignGuideAbstract}
              disabled={
                designGuideGenerating ||
                designGuideSaving ||
                !designGuideDraftRaw.trim()
              }
            >
              {designGuideGenerating ? "Generating..." : "Generate Abstract"}
            </Button>

            {designGuideAbstractReady && (
              <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                <Label htmlFor="design_guide_abstract_review">
                  Review abstract before saving
                </Label>
                <Textarea
                  id="design_guide_abstract_review"
                  value={designGuideDraftAbstract}
                  onChange={(e) => setDesignGuideDraftAbstract(e.target.value)}
                  className="min-h-[160px]"
                />
              </div>
            )}

            {hasDesignGuide && fields.design_guide_abstract.trim() && !designGuideAbstractReady && (
              <div className="space-y-2">
                <Label>Current abstract</Label>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {fields.design_guide_abstract}
                </p>
              </div>
            )}

            {designGuideError && (
              <p className="text-sm text-destructive">{designGuideError}</p>
            )}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteDesignGuide}
              disabled={designGuideGenerating || designGuideSaving || !hasDesignGuide}
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel("design-guide")}
              onClose={() => setDesignGuideOpen(false)}
              closeLabel="Cancel"
              closeDisabled={designGuideGenerating || designGuideSaving}
              copyDisabled={designGuideGenerating || designGuideSaving}
              onSave={handleSaveDesignGuide}
              saving={designGuideSaving}
              saveDisabled={
                designGuideGenerating ||
                !designGuideAbstractReady ||
                !designGuideDraftAbstract.trim()
              }
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
