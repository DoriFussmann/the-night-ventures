import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Lock,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  emptySocialLinkEntry,
  emptyTeamEntry,
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
import ConnectionsPanel, {
  ANALYTICS_TOOLS_FIELD,
  connectionsHaveContent,
  formatConnectionsMarkdown,
} from "./ConnectionsPanel";
import { parseCompanyMarkdown } from "./companyData/parseCompanyMarkdown";
import {
  getCompanyDataPoints,
  mergeParsedCompanyFields,
} from "./companyData/dataPoints";
import IntelligenceBrief from "./companyData/IntelligenceBrief";
import PublishDestinationGuide from "./companyData/PublishDestinationGuide";
import PublishDestinationCheck from "./companyData/PublishDestinationCheck";
import {
  ownerRepoIssue,
  tokenEnvName,
  tokenKeyIssue,
} from "../../../lib/publish-destination/tokenKey.js";
import { getKeywordTree, keywordAction } from "./seoAdvisor/api";
import {
  MAX_CORE_KEYWORDS,
  MAX_SUPPORTING_PER_CORE,
  slugifyKeyword,
} from "../../../lib/seo-advisor/pillars.js";
import ArticleSpecDialog from "./seoAdvisor/ArticleSpecDialog";
import {
  EMPTY_INTELLIGENCE_TEXT,
  allBriefPoints,
  applyCustomFieldFallbacks,
  briefProgress,
} from "./companyData/intelligenceFields";
import {
  SEO_AUTHORITY_COLUMN,
  SEO_CONTROL_FIELDS,
  SEO_NEW_TEXT_COLUMNS,
  buildSeoBriefMarkdown,
  isSeoBriefMarkdown,
  parseSeoBriefMarkdown,
  seoBriefImportPreview,
} from "../../../lib/seo-advisor/seoControls.js";

const HIDDEN_CUSTOM_FIELDS = new Set([
  "founded year",
  "founded",
  "founded / incorporation date",
  "incorporation date",
  "legal name",
  "official address",
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

/** content_coverage tree (Core → Supporting) → the form's pillar rows. */
function pillarsFromTree(tree) {
  return (Array.isArray(tree) ? tree : []).map((pillar) => ({
    keyword: pillar.keyword || "",
    supporting: normalizeStringList(
      (pillar.supporting || []).map((item) => item.keyword || ""),
      0
    ),
  }));
}

/** Pillar rows → payload for the keyword store (empties dropped). */
function pillarsForSave(value) {
  return normalizePillarKeywords(value)
    .map((pillar) => ({
      keyword: pillar.keyword.trim(),
      supporting: pillar.supporting.map((item) => item.trim()).filter(Boolean),
    }))
    .filter((pillar) => pillar.keyword);
}

function locksFromTree(tree) {
  const cores = new Set();
  const supporting = new Set();
  for (const pillar of Array.isArray(tree) ? tree : []) {
    if (pillar.locked) cores.add(pillar.slug);
    for (const item of pillar.supporting || []) {
      if (item.locked) supporting.add(`${pillar.slug}/${item.slug}`);
    }
  }
  return { cores, supporting };
}

const NO_LOCKS = { cores: new Set(), supporting: new Set() };

function countFilled(list) {
  return list.filter((value) => String(value || "").trim()).length;
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

function coerceLooseHttpUrl(value) {
  const url = String(value || "").trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  if (/^(www\.)?[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

function missingIntelligenceColumn(message) {
  const text = String(message || "");
  if (!/schema cache|does not exist|could not find the/i.test(text)) return false;
  return Object.keys(EMPTY_INTELLIGENCE_TEXT).some((key) => text.includes(key));
}

const PROFILE_SELECT_BASE =
  "id, domain, product_name, target_audience, abstract, short_description, medium_description, long_description, business_model, core_value_proposition, scope_boundaries, brand_feel, brand_voice, core_keywords, competitors, services, team_members, contact_email, social_links, custom_fields";

const PROFILE_SELECT_INTELLIGENCE =
  "legal_name, founded_date, location_markets, company_stage, customer_problem, trigger_moment, buying_criteria, how_it_works, customer_outcome, commercial_model, differentiation, messaging_hierarchy, market_category, competitive_position, market_dynamics, brand_references, brand_boundaries, reasons_to_believe, results_proof, trust_signals, marketing_objectives, growth_priorities, customer_acquisition, learnings_constraints";

/** Added in migration 065. Loaded separately so the page works before it runs. */
const PROFILE_SELECT_SEO = [...SEO_NEW_TEXT_COLUMNS, SEO_AUTHORITY_COLUMN].join(", ");

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
  brand_feel: "",
  brand_voice: "",
  core_keywords: normalizePillarKeywords([], { minCount: DEFAULT_PILLAR_COUNT }),
  competitors: [],
  services: [],
  team_members: [],
  contact_email: "",
  social_links: [],
  ...EMPTY_INTELLIGENCE_TEXT,
  seo_authority: null,
};

function profileFromRow(profile) {
  return {
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
    brand_feel: profile.brand_feel || "",
    brand_voice: profile.brand_voice || "",
    core_keywords: normalizePillarKeywords(profile.core_keywords, {
      minCount:
        Array.isArray(profile.core_keywords) && profile.core_keywords.length > 0
          ? 0
          : DEFAULT_PILLAR_COUNT,
    }),
    competitors: normalizeCompetitors(profile.competitors),
    services: normalizeServices(profile.services),
    team_members: normalizeTeamMembers(profile.team_members),
    contact_email: profile.contact_email || "",
    social_links: normalizeSocialLinks(profile.social_links),
    ...EMPTY_INTELLIGENCE_TEXT,
    ...Object.fromEntries(
      Object.keys(EMPTY_INTELLIGENCE_TEXT).map((key) => [
        key,
        profile[key] || "",
      ])
    ),
    seo_authority:
      profile.seo_authority && typeof profile.seo_authority === "object"
        ? profile.seo_authority
        : null,
  };
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
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubTokenKey, setGithubTokenKey] = useState("");
  const ownerIssue = ownerRepoIssue("owner", githubOwner);
  const repoIssue = ownerRepoIssue("repo", githubRepo);
  const keyIssue = tokenKeyIssue(githubTokenKey);
  const destinationIssue = ownerIssue || repoIssue || keyIssue;
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailProvider, setEmailProvider] = useState("");
  const [emailCampaignId, setEmailCampaignId] = useState("");
  // Audience Build sending capacity (company_profiles.outbound_*). Loaded and
  // saved separately so the main brief save is unaffected if migration 068
  // hasn't run.
  const [outboundInboxes, setOutboundInboxes] = useState("1");
  const [outboundDailyCap, setOutboundDailyCap] = useState("30");

  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    supabase
      .from("company_profiles")
      .select("outbound_inboxes, outbound_daily_cap")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setOutboundInboxes(String(data.outbound_inboxes ?? 1));
        setOutboundDailyCap(String(data.outbound_daily_cap ?? 30));
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);
  /** Active panel modal: 'target' | 'pillars' | 'competitors' | 'publish-destination' | ... | `custom:${id}` */
  const [openPanel, setOpenPanel] = useState(null);
  const [openPillars, setOpenPillars] = useState({});
  // Pillar keywords live in content_coverage (the keyword store), not on the profile.
  const [keywordLocks, setKeywordLocks] = useState(NO_LOCKS);
  const [keywordsLoadError, setKeywordsLoadError] = useState("");
  const keywordsBaselineRef = useRef(null);
  const keywordSaveNoteRef = useRef("");
  const saveChainRef = useRef(Promise.resolve());
  const [socialShopsFilled, setSocialShopsFilled] = useState(false);
  const [connectionsFilled, setConnectionsFilled] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [importDragOver, setImportDragOver] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [openGroups, setOpenGroups] = useState({});
  const [configOpen, setConfigOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [seoImport, setSeoImport] = useState(null);
  const [savedTree, setSavedTree] = useState([]);
  const [specTarget, setSpecTarget] = useState(null);
  const importFileRef = useRef(null);

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
      keywordTreeResult,
    ] = await Promise.all([
      supabase.from("companies").select("name, github_owner, github_repo, github_token_key, email_campaigns_enabled, email_campaigns_provider, email_campaigns_campaign_id").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(`${PROFILE_SELECT_BASE}, ${PROFILE_SELECT_INTELLIGENCE}, ${PROFILE_SELECT_SEO}`)
        .eq("company_id", companyId)
        .maybeSingle()
        .then(async (result) => {
          if (result.error && /seo_|column/i.test(result.error.message || "")) {
            // SEO Controls migration (065) not run yet.
            return supabase
              .from("company_profiles")
              .select(`${PROFILE_SELECT_BASE}, ${PROFILE_SELECT_INTELLIGENCE}`)
              .eq("company_id", companyId)
              .maybeSingle();
          }
          return result;
        })
        .then(async (result) => {
          if (
            result.error &&
            /legal_name|founded_date|column/i.test(result.error.message || "")
          ) {
            return supabase
              .from("company_profiles")
              .select(PROFILE_SELECT_BASE)
              .eq("company_id", companyId)
              .maybeSingle();
          }
          return result;
        }),
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
      getKeywordTree(companyId).then(
        (data) => ({ data, error: null }),
        (err) => ({ data: null, error: err })
      ),
    ]);

    if (companyResult.error) {
      console.error("Failed to load company:", companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
      setGithubOwner("");
      setGithubRepo("");
      setGithubTokenKey("");
    } else {
      setCompanyName(companyResult.data?.name || "");
      setGithubOwner(companyResult.data?.github_owner || "");
      setGithubRepo(companyResult.data?.github_repo || "");
      setGithubTokenKey(companyResult.data?.github_token_key || "");
      setEmailEnabled(Boolean(companyResult.data?.email_campaigns_enabled));
      setEmailProvider(companyResult.data?.email_campaigns_provider || "");
      setEmailCampaignId(companyResult.data?.email_campaigns_campaign_id || "");
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
      setConnectionsFilled(false);
    } else if (profileResult.data) {
      const profile = profileResult.data;
      setProfileId(profile.id);
      const loadedCustom =
        profile.custom_fields && typeof profile.custom_fields === "object"
          ? { ...profile.custom_fields }
          : {};
      setFields(applyCustomFieldFallbacks(profileFromRow(profile), loadedCustom));
      setCustomValues(loadedCustom);
      setConnectionsFilled(
        connectionsHaveContent(
          profile.custom_fields && typeof profile.custom_fields === "object"
            ? profile.custom_fields[ANALYTICS_TOOLS_FIELD]
            : null
        )
      );
    } else {
      setProfileId(null);
      setFields(EMPTY_PROFILE);
      setCustomValues({});
      setConnectionsFilled(false);
    }

    if (keywordTreeResult.error) {
      console.error("Failed to load keyword tree:", keywordTreeResult.error);
      keywordsBaselineRef.current = null;
      setKeywordLocks(NO_LOCKS);
      setKeywordsLoadError(
        keywordTreeResult.error.message || "Failed to load pillar keywords"
      );
    } else {
      const tree = keywordTreeResult.data?.pillars || [];
      const rows = pillarsFromTree(tree);
      keywordsBaselineRef.current = JSON.stringify(pillarsForSave(rows));
      setKeywordLocks(locksFromTree(tree));
        setSavedTree(tree);
      setKeywordsLoadError("");
      setFields((prev) => ({
        ...prev,
        core_keywords: normalizePillarKeywords(rows, {
          minCount: rows.length > 0 ? 0 : DEFAULT_PILLAR_COUNT,
        }),
      }));
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
    const panel = searchParams.get("panel");
    if (searchParams.get("section") === "seo") {
      setOpenGroups((prev) => ({ ...prev, seo: true }));
      const next = new URLSearchParams(searchParams);
      next.delete("section");
      setSearchParams(next, { replace: true });
      return;
    }
    if (panel === "social-shops" || panel === "connections") {
      setOpenPanel(panel);
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

  const openPillarsPanel = () => {
    setOpenPillars((prev) => {
      const next = { ...prev };
      normalizePillarKeywords(fields.core_keywords).forEach((pillar, index) => {
        if (next[index] == null && countFilled(pillar.supporting) > 0) {
          next[index] = true;
        }
      });
      return next;
    });
    setOpenPanel("pillars");
  };

  const updateCustomValue = (name, value) => {
    setCustomValues((prev) => ({ ...prev, [name]: value }));
  };

  const addSocialLink = () => {
    setFields((prev) => ({
      ...prev,
      social_links: [...normalizeSocialLinks(prev.social_links), emptySocialLinkEntry()],
    }));
  };

  const updateSocialLink = (index, key, value) => {
    setFields((prev) => {
      const next = normalizeSocialLinks(prev.social_links);
      next[index] = { ...next[index], [key]: value };
      return { ...prev, social_links: next };
    });
  };

  const removeSocialLink = (index) => {
    setFields((prev) => ({
      ...prev,
      social_links: normalizeSocialLinks(prev.social_links).filter((_, i) => i !== index),
    }));
  };

  const addTeamMember = () => {
    setFields((prev) => ({
      ...prev,
      team_members: [...normalizeTeamMembers(prev.team_members), emptyTeamEntry()],
    }));
  };

  const updateTeamMember = (index, key, value) => {
    setFields((prev) => {
      const next = normalizeTeamMembers(prev.team_members);
      next[index] = { ...next[index], [key]: value };
      return { ...prev, team_members: next };
    });
  };

  const updateTeamSameAs = (index, sameAsIndex, value) => {
    setFields((prev) => {
      const next = normalizeTeamMembers(prev.team_members);
      const sameAs = [...(next[index].same_as || [])];
      sameAs[sameAsIndex] = value;
      next[index] = { ...next[index], same_as: sameAs };
      return { ...prev, team_members: next };
    });
  };

  const addTeamSameAs = (index) => {
    setFields((prev) => {
      const next = normalizeTeamMembers(prev.team_members);
      next[index] = {
        ...next[index],
        same_as: [...(next[index].same_as || []), ""],
      };
      return { ...prev, team_members: next };
    });
  };

  const removeTeamMember = (index) => {
    setFields((prev) => ({
      ...prev,
      team_members: normalizeTeamMembers(prev.team_members).filter((_, i) => i !== index),
    }));
  };

  const handleAddField = async () => {
    const raw = window.prompt("New field name:");
    if (raw == null) return;

    const name = raw.trim();
    if (!name) return;

    if (HIDDEN_CUSTOM_FIELDS.has(name.toLowerCase())) {
      setError(`"${name}" is no longer used on Company Intelligence.`);
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
      case "location_markets":
        updateField("location_markets", "");
        break;
      case "contact_email":
        updateField("contact_email", "");
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
      case "team":
        setFields((prev) => ({ ...prev, team_members: [] }));
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
      case "publish-destination":
        setGithubOwner("");
        setGithubRepo("");
        setGithubTokenKey("");
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
    if (panelId === "location_markets") return (fields.location_markets || "").trim();
    if (panelId === "contact_email") return (fields.contact_email || "").trim();
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
    if (panelId === "publish-destination") {
      return [
        githubOwner.trim() && `GitHub owner: ${githubOwner.trim()}`,
        githubRepo.trim() && `GitHub repo: ${githubRepo.trim()}`,
        githubTokenKey.trim() && `GitHub token key: ${githubTokenKey.trim()}`,
      ]
        .filter(Boolean)
        .join("\n");
    }

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

    if (panelId === "team") {
      return trimTeamMembersForSave(fields.team_members)
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

    if (panelId === "connections") {
      return formatConnectionsMarkdown(customValues[ANALYTICS_TOOLS_FIELD]);
    }

    if (panelId === "publish-destination") {
      const lines = [];
      if (githubOwner.trim()) lines.push(`GitHub owner: ${githubOwner.trim()}`);
      if (githubRepo.trim()) lines.push(`GitHub repo: ${githubRepo.trim()}`);
      if (githubTokenKey.trim()) {
        lines.push(`GitHub token key: ${githubTokenKey.trim()}`);
      }
      return lines.join("\n");
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

  /**
   * Persist profile to Supabase. Returns true when the brief itself was saved.
   * Saves run one at a time so an in-flight save cannot overwrite a newer one
   * or silently drop the import.
   */
  const persistProfile = (overrides = {}) => {
    const run = () => persistProfileNow(overrides);
    const task = saveChainRef.current.then(run, run);
    saveChainRef.current = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  };

  const persistProfileNow = async (overrides = {}) => {
    if (!companyId) {
      setError("Open a company before saving the brief.");
      return false;
    }

    const currentFields = overrides.fields ?? fields;
    const currentCustomValues = overrides.customValues ?? customValues;
    const currentIndustryIds = overrides.selectedIndustryIds ?? selectedIndustryIds;

    setSaving(true);
    setSavedMessage("");
    setError("");
    keywordSaveNoteRef.current = "";

    try {
      return await persistProfileBody({
        overrides,
        currentFields,
        currentCustomValues,
        currentIndustryIds,
      });
    } catch (err) {
      console.error("Failed to save company profile:", err);
      setError(err?.message || "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const persistProfileBody = async ({
    overrides,
    currentFields,
    currentCustomValues,
    currentIndustryIds,
  }) => {
    if (destinationIssue) {
      setError(`Publish Destination: ${destinationIssue}`);
      return false;
    }

    const competitors = normalizeCompetitors(currentFields.competitors)
      .map((item) => ({
        name: item.name.trim(),
        url: coerceLooseHttpUrl(item.url.trim()),
      }))
      .filter((item) => item.name || item.url);

    const services = trimServicesForSave(currentFields.services);
    const team_members = trimTeamMembersForSave(currentFields.team_members).map(
      (member) => ({
        ...member,
        same_as: (member.same_as || []).map((url) => coerceLooseHttpUrl(url)),
      })
    );
    const social_links = trimSocialLinksForSave(currentFields.social_links).map(
      (link) => ({
        ...link,
        url: coerceLooseHttpUrl(link.url),
      })
    );

    const custom_fields = {};
    for (const def of customFieldDefs) {
      custom_fields[def.name] = currentCustomValues[def.name] ?? "";
    }
    // Preserve reserved keys and leftover custom values (founded year, etc.).
    for (const [key, value] of Object.entries(currentCustomValues)) {
      if (!(key in custom_fields)) {
        custom_fields[key] = value;
      }
    }

    const intelligenceFields = Object.fromEntries(
      Object.keys(EMPTY_INTELLIGENCE_TEXT).map((key) => [
        key,
        String(currentFields[key] || "").trim() || null,
      ])
    );

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
      brand_feel: (currentFields.brand_feel || "").trim() || null,
      brand_voice: (currentFields.brand_voice || "").trim() || null,
      competitors,
      services,
      team_members,
      contact_email: currentFields.contact_email.trim() || null,
      social_links,
      custom_fields,
      ...intelligenceFields,
      updated_at: new Date().toISOString(),
    };

    if (profileId) {
      payload.id = profileId;
    }

    let { data, error: upsertError } = await supabase
      .from("company_profiles")
      .upsert(payload, { onConflict: "company_id" })
      .select("id")
      .single();

    if (upsertError && missingIntelligenceColumn(upsertError.message)) {
      const fallback = { ...payload };
      const preserved = { ...(fallback.custom_fields || {}) };
      for (const key of Object.keys(EMPTY_INTELLIGENCE_TEXT)) {
        const value = fallback[key];
        if (value) preserved[key] = value;
        delete fallback[key];
      }
      fallback.custom_fields = preserved;
      const retry = await supabase
        .from("company_profiles")
        .upsert(fallback, { onConflict: "company_id" })
        .select("id")
        .single();
      data = retry.data;
      upsertError = retry.error;
      if (!upsertError) {
        setError(
          "Saved the brief into leftover fields. Run the Company Intelligence migration so these fields have their own columns."
        );
      }
    }

    if (upsertError) {
      console.error("Failed to save company profile:", upsertError);
      setError(upsertError.message || "Failed to save");
      setSaving(false);
      return false;
    }

    // Pillar keywords → content_coverage (single source of truth).
    if (keywordsBaselineRef.current === null) {
      try {
        const data = await getKeywordTree(companyId);
        const tree = data?.pillars || [];
        const rows = pillarsFromTree(tree);
        keywordsBaselineRef.current = JSON.stringify(pillarsForSave(rows));
        setKeywordLocks(locksFromTree(tree));
        setSavedTree(tree);
        setKeywordsLoadError("");
      } catch (keywordLoadError) {
        console.error("Failed to reload keyword tree:", keywordLoadError);
        setKeywordsLoadError(
          keywordLoadError?.message || "Failed to load pillar keywords"
        );
      }
    }

    const pillarPayload = pillarsForSave(currentFields.core_keywords);
    const pillarJson = JSON.stringify(pillarPayload);
    if (keywordsBaselineRef.current !== null && pillarJson !== keywordsBaselineRef.current) {
      try {
        const result = await keywordAction(companyId, "replace_tree", {
          pillars: pillarPayload,
          expected: JSON.parse(keywordsBaselineRef.current),
        });
        const tree = result.pillars || [];
        const rows = pillarsFromTree(tree);
        keywordsBaselineRef.current = JSON.stringify(pillarsForSave(rows));
        setKeywordLocks(locksFromTree(tree));
        setSavedTree(tree);
        setFields((prev) => ({
          ...prev,
          core_keywords: normalizePillarKeywords(rows, {
            minCount: rows.length > 0 ? 0 : DEFAULT_PILLAR_COUNT,
          }),
        }));
        const kept = result.keptLocked || [];
        const skipped = result.skipped || [];
        if (kept.length > 0 || skipped.length > 0) {
          const note = [
            kept.length > 0
              ? `Kept ${kept.join(", ")} — these keywords have articles and can’t be removed.`
              : "",
            skipped.length > 0
              ? `Skipped duplicates: ${skipped.join(", ")}.`
              : "",
          ]
            .filter(Boolean)
            .join(" ");
          keywordSaveNoteRef.current = note;
          setError(note);
        }
      } catch (keywordError) {
        console.error("Failed to save pillar keywords:", keywordError);
        const note = keywordError.message || "Failed to save pillar keywords";
        keywordSaveNoteRef.current = note;
        setError(note);
      }
    } else if (keywordsBaselineRef.current === null && pillarPayload.length > 0) {
      const note = `Pillar keywords were not saved: ${keywordsLoadError || "they failed to load"}. Reload and try again.`;
      keywordSaveNoteRef.current = note;
      setError(note);
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

    const { error: companyUpdateError } = await supabase
      .from("companies")
      .update({
        ...(companyName.trim() ? { name: companyName.trim() } : {}),
        github_owner: githubOwner.trim() || null,
        github_repo: githubRepo.trim() || null,
        github_token_key: githubTokenKey.trim().toUpperCase() || null,
        email_campaigns_enabled: emailEnabled,
        email_campaigns_provider: emailEnabled ? emailProvider || null : null,
        email_campaigns_campaign_id: emailEnabled
          ? emailCampaignId.trim() || null
          : null,
      })
      .eq("id", companyId);

    const inboxesNum = Math.round(Number(outboundInboxes));
    const capNum = Math.round(Number(outboundDailyCap));
    if (inboxesNum >= 1 && inboxesNum <= 20 && capNum >= 1 && capNum <= 200) {
      const { error: capacityError } = await supabase
        .from("company_profiles")
        .update({ outbound_inboxes: inboxesNum, outbound_daily_cap: capNum })
        .eq("company_id", companyId);
      if (capacityError && !/outbound_|column/i.test(capacityError.message || "")) {
        console.error("Failed to save sending capacity:", capacityError);
      }
    }

    if (companyUpdateError) {
      console.error("Failed to save company record:", companyUpdateError);
      setError(
        companyUpdateError.message ||
          "The brief was saved, but the company name and publish destination were not."
      );
    } else {
      window.dispatchEvent(new Event("company-renamed"));
    }

    setGithubTokenKey((prev) => prev.trim().toUpperCase());
    if (!overrides.skipSavedMessage) {
      setSavedMessage(keywordSaveNoteRef.current ? "Brief saved" : "Saved");
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

  const applyAllocatedMarkdown = async (text, fileName) => {
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

    if (merged.filled.length > 0) {
      setFields(nextFields);
      setCustomValues(merged.nextCustom);
      setSelectedIndustryIds(merged.nextIndustryIds);

      const saved = await persistProfile({
        fields: nextFields,
        customValues: merged.nextCustom,
        selectedIndustryIds: merged.nextIndustryIds,
        skipSavedMessage: true,
      });
      if (!saved) return false;

      if (merged.socialAccounts) {
        try {
          await importSocialShops(merged.socialAccounts, merged.socialNotes);
        } catch (err) {
          console.error("Failed to import Social & Shops:", err);
          setError(err?.message || "Failed to import Social & Shops");
        }
      }
    }

    const afterPoints = getCompanyDataPoints({
      fields: nextFields,
      selectedIndustryIds: merged.nextIndustryIds,
      socialShopsFilled: merged.socialAccounts ? true : socialShopsFilled,
      customFieldDefs,
      customValues: merged.nextCustom,
      githubOwner,
      githubRepo,
      githubTokenKey,
    });

    setImportResult({
      fileName,
      filled: merged.filled,
      skipped: merged.skipped,
      notInFile: merged.notInFile,
      stillMissing: afterPoints.filter((point) => !point.filled).map((point) => point.label),
      keywordWarning: keywordSaveNoteRef.current,
    });
    return true;
  };

  const handleImportMarkdownFile = async (file) => {
    if (!file || importBusy || saving) return;

    const name = String(file.name || "").toLowerCase();
    const isMarkdown =
      name.endsWith(".md") ||
      name.endsWith(".markdown") ||
      file.type === "text/markdown";
    if (!isMarkdown) {
      setError("Please drop a markdown .md file");
      return;
    }

    setError("");
    setImportResult(null);
    setImportBusy(true);

    try {
      const source = await file.text();
      if (!String(source || "").trim()) {
        setError("That markdown file is empty");
        return;
      }

      if (isSeoBriefMarkdown(source)) {
        startSeoBriefImport(source, file.name || "SEO brief");
        return;
      }

      const emptyFieldLabels = getCompanyDataPoints({
        fields,
        selectedIndustryIds,
        socialShopsFilled,
        customFieldDefs,
        customValues,
        githubOwner,
        githubRepo,
        githubTokenKey,
      })
        .filter(
          (point) =>
            !point.filled &&
            point.id !== "publish-destination"
        )
        .map((point) => point.label);

      const res = await fetch("/api/company-data-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: source,
          companyName,
          customFieldNames: customFieldDefs.map((def) => def.name),
          industryNames: industries.map((industry) => industry.name),
          emptyFieldLabels,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Import failed (${res.status})`);
      }

      const allocated = String(data.markdown || "").trim();
      if (!allocated) {
        throw new Error("No allocated fields returned");
      }

      await applyAllocatedMarkdown(allocated, file.name || "markdown file");
    } catch (err) {
      console.error("Failed to import company markdown:", err);
      setError(err?.message || "Failed to import markdown");
    } finally {
      setImportBusy(false);
    }
  };

  const processImportFiles = (fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    handleImportMarkdownFile(file);
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

    const connectionsLines = formatConnectionsMarkdown(
      customValues[ANALYTICS_TOOLS_FIELD]
    );

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
      ["Company Name", companyName],
      ["Domain", fields.domain],
      ["Legal Name", fields.legal_name],
      ["Founded / Incorporation Date", fields.founded_date],
      ["Location / Markets Served", fields.location_markets],
      ["Contact Email", fields.contact_email],
      ["Social Links", socialLinkLines],
      ["What We Do", fields.short_description],
      ["Story & Mission", fields.long_description],
      ["Business Model", fields.business_model],
      ["Company Stage & Context", fields.company_stage],
      ["Ideal Customer", fields.target_audience],
      ["Customer Problem", fields.customer_problem],
      ["Trigger / Moment of Need", fields.trigger_moment],
      ["Buying Criteria", fields.buying_criteria],
      ["Products & Services", serviceLines],
      ["How It Works", fields.how_it_works],
      ["Customer Outcome", fields.customer_outcome],
      ["Commercial Model", fields.commercial_model],
      ["Core Value Proposition", fields.core_value_proposition],
      ["Differentiation", fields.differentiation],
      ["Messaging Hierarchy", fields.messaging_hierarchy],
      ["What We Are / Are Not", fields.scope_boundaries],
      ["Market & Category", fields.market_category],
      ["Competitors & Alternatives", competitorLines],
      ["Competitive Position", fields.competitive_position],
      ["Market Dynamics", fields.market_dynamics],
      ["Brand Personality", fields.brand_feel],
      ["Voice & Tone", fields.brand_voice],
      ["References", fields.brand_references],
      ["Brand Boundaries", fields.brand_boundaries],
      ["Reasons to Believe", fields.reasons_to_believe],
      ["Results & Customer Proof", fields.results_proof],
      ["Team & Founder Credibility", teamLines],
      ["Other Trust Signals", fields.trust_signals],
      ["Business & Marketing Objectives", fields.marketing_objectives],
      ["Priorities", fields.growth_priorities],
      ["Customer Acquisition & Sales", fields.customer_acquisition],
      ["Learnings & Constraints", fields.learnings_constraints],
      ...SEO_CONTROL_FIELDS.filter((field) => field.key.startsWith("seo_")).map(
        (field) => [`SEO ${field.label}`, fields[field.key]]
      ),
      ["Product Name", fields.product_name],
      ["Category", categoryLines],
      ["Abstract", fields.abstract],
      ["Medium Description", fields.medium_description],
      ["Pillar Keywords", pillarLines],
      ["Social & Shops", socialShopsLines],
      ["Connections", connectionsLines],
      [
        "Publish Destination",
        [
          githubOwner.trim() && `- GitHub owner: ${githubOwner.trim()}`,
          githubRepo.trim() && `- GitHub repo: ${githubRepo.trim()}`,
          githubTokenKey.trim() && `- GitHub token key: ${githubTokenKey.trim()}`,
        ]
          .filter(Boolean)
          .join("\n"),
      ],
    ];

    const customEntries = customFieldDefs.map((def) => [
      def.name,
      customValues[def.name] || "",
    ]);

    const lines = [`# ${companyName || "Company"}`, ""];

    const blockLabels = new Set([
      "Location / Markets Served",
      "Social Links",
      "What We Do",
      "Story & Mission",
      "Business Model",
      "Company Stage & Context",
      "Ideal Customer",
      "Customer Problem",
      "Trigger / Moment of Need",
      "Buying Criteria",
      "Products & Services",
      "How It Works",
      "Customer Outcome",
      "Commercial Model",
      "Core Value Proposition",
      "Differentiation",
      "Messaging Hierarchy",
      "What We Are / Are Not",
      "Market & Category",
      "Competitors & Alternatives",
      "Competitive Position",
      "Market Dynamics",
      "Brand Personality",
      "Voice & Tone",
      "References",
      "Brand Boundaries",
      "Reasons to Believe",
      "Results & Customer Proof",
      "Team & Founder Credibility",
      "Other Trust Signals",
      "Business & Marketing Objectives",
      "Priorities",
      "Customer Acquisition & Sales",
      "Learnings & Constraints",
      ...SEO_CONTROL_FIELDS.filter((field) => field.key.startsWith("seo_")).map(
        (field) => `SEO ${field.label}`
      ),
      "Category",
      "Pillar Keywords",
      "Social & Shops",
      "Connections",
      "Publish Destination",
    ]);

    for (const [label, value] of [...fixedEntries, ...customEntries]) {
      const trimmed = (value || "").trim();
      if (blockLabels.has(label) && trimmed) {
        lines.push(`**${label}:**`, trimmed, "");
      } else {
        lines.push(trimmed ? `**${label}:** ${trimmed}` : `**${label}:**`, "");
      }
    }

    const slug = (companyName || "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    downloadMarkdown(`${slug || "company"}-data.md`, lines.join("\n").trim() + "\n");
  };

  const companySlug = () =>
    (companyName || "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company";

  const handleDownloadSeoBrief = () => {
    const keywordTree = normalizePillarKeywords(fields.core_keywords)
      .filter((pillar) => pillar.keyword.trim())
      .map((pillar) => ({
        keyword: pillar.keyword.trim(),
        supporting: pillar.supporting
          .map((kw) => String(kw || "").trim())
          .filter(Boolean)
          .map((keyword) => ({ keyword })),
      }));
    downloadMarkdown(
      `${companySlug()}-seo-brief.md`,
      buildSeoBriefMarkdown({
        companyName,
        domain: fields.domain,
        profile: fields,
        keywordTree,
      })
    );
  };

  /** SEO brief import: parsed locally, every change previewed before saving. */
  const startSeoBriefImport = (source, fileName) => {
    const { values } = parseSeoBriefMarkdown(source);
    const rows = seoBriefImportPreview(values, fields);
    setSeoImport({
      fileName,
      rows,
      selected: Object.fromEntries(rows.map((row) => [row.key, true])),
    });
  };

  const applySeoBriefImport = async () => {
    if (!seoImport) return;
    const chosen = seoImport.rows.filter((row) => seoImport.selected[row.key]);
    if (chosen.length === 0) {
      setSeoImport(null);
      return;
    }
    const nextFields = { ...fields };
    for (const row of chosen) nextFields[row.key] = row.next;
    setFields(nextFields);
    const saved = await persistProfile({ fields: nextFields, skipSavedMessage: true });
    if (!saved) return;
    setImportResult({
      fileName: seoImport.fileName,
      filled: chosen.map((row) => row.label),
      skipped: seoImport.rows
        .filter((row) => !seoImport.selected[row.key])
        .map((row) => row.label),
      notInFile: [],
      stillMissing: [],
      keywordWarning: keywordSaveNoteRef.current,
      seoBrief: true,
    });
    setSeoImport(null);
  };

  const specAction = async (action, payload) => {
    const result = await keywordAction(companyId, action, payload);
    const tree = result.pillars || [];
    setSavedTree(tree);
    setKeywordLocks(locksFromTree(tree));
    if (action === "add_supporting") {
      // The tree changed outside the form; refresh the editor baseline and rows.
      const rows = pillarsFromTree(tree);
      keywordsBaselineRef.current = JSON.stringify(pillarsForSave(rows));
      setFields((prev) => ({
        ...prev,
        core_keywords: normalizePillarKeywords(rows, { minCount: 0 }),
      }));
    }
    return result;
  };

  const specPillar = specTarget
    ? savedTree.find((item) => item.slug === slugifyKeyword(specTarget.core))
    : null;
  const specItem =
    specTarget?.type === "supporting"
      ? (specPillar?.supporting || []).find(
          (item) => item.slug === slugifyKeyword(specTarget.keyword)
        )
      : null;
  const openSpec =
    specPillar && (specTarget.type === "core" || specItem)
      ? {
          type: specTarget.type,
          core: specPillar.keyword,
          keyword: specItem ? specItem.keyword : specPillar.keyword,
          spec: specItem ? specItem.spec : specPillar.spec,
          backlog: specPillar.backlog || [],
          supportingCount: (specPillar.supporting || []).length,
        }
      : null;

  const savedSpecFor = (coreKeyword, supportingKeyword) => {
    const core = savedTree.find((item) => item.slug === slugifyKeyword(coreKeyword));
    if (!core) return null;
    if (!supportingKeyword) return core.spec || null;
    const item = (core.supporting || []).find(
      (entry) => entry.slug === slugifyKeyword(supportingKeyword)
    );
    return item?.spec || null;
  };

  const openDataPoint = (id) => {
    const structured = {
      services: "services",
      competitors: "competitors",
      team_members: "team",
      social_links: null,
    };
    if (structured[id]) {
      setOpenPanel(structured[id]);
      return;
    }
    const point = allBriefPoints({ fields, companyName }).find((item) => item.id === id);
    if (point?.section === "basic") {
      setOpenGroups((prev) => ({ ...prev, identity: true }));
      return;
    }
    if (point?.section) {
      setOpenGroups((prev) => ({ ...prev, [point.section]: true }));
    }
    if (id === "pillars") {
      openPillarsPanel();
      return;
    }
    if (
      id === "product_name" ||
      id === "category" ||
      id === "location_markets" ||
      id === "contact_email"
    ) {
      setOpenPanel(id);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading company intelligence...</p>;
  }

  const pillars = normalizePillarKeywords(fields.core_keywords);
  const pillarTotal = pillars.length;
  const competitors = normalizeCompetitors(fields.competitors);
  const services = normalizeServices(fields.services);
  const industryQuery = industryFilter.trim().toLowerCase();
  const filteredIndustries = industryQuery
    ? industries.filter((industry) =>
        industry.name.toLowerCase().includes(industryQuery)
      )
    : industries;
  const selectedIndustries = industries.filter((industry) =>
    selectedIndustryIds.includes(industry.id)
  );
  const publishDestinationFilled = Boolean(
    githubOwner.trim() && githubRepo.trim() && githubTokenKey.trim()
  );
  const emailCampaignsFilled = Boolean(emailEnabled);
  const briefCtx = { fields, companyName };
  const brief = briefProgress(briefCtx);
  const briefPoints = allBriefPoints(briefCtx);
  const missingPoints = briefPoints.filter((point) => !point.filled);
  const completedCount = brief.filled;

  const servicesPreview = services
    .filter(serviceHasContent)
    .map((service) => {
      const title = service.title.trim() || "Untitled offering";
      const summary = service.summary.trim();
      return summary ? `${title} — ${summary}` : title;
    });
  const competitorsPreview = competitors
    .filter((item) => item.name.trim() || item.url.trim())
    .map((item) =>
      item.url.trim()
        ? `${item.name.trim() || item.url.trim()} (${item.url.trim()})`
        : item.name.trim()
    );
  const teamPreview = normalizeTeamMembers(fields.team_members)
    .filter(
      (member) =>
        member.name.trim() ||
        member.role.trim() ||
        member.bio.trim() ||
        member.credentials.trim()
    )
    .map((member) => {
      const meta = [member.role, member.credentials].filter((part) => part.trim()).join(" · ");
      const head = member.name.trim() || "Unnamed";
      return meta ? `${head} — ${meta}` : head;
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium text-foreground">
            {companyName || "Company Intelligence"}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Canonical brief of the business. SEO Controls must be complete before the SEO Advisor suggests keywords.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={openPillarsPanel}>
            Pillar keywords ({pillarTotal})
          </Button>
          <p className="text-sm text-muted-foreground">
            {completedCount} / {brief.total} brief fields
          </p>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSave} className="space-y-4">
        <IntelligenceBrief
          companyName={companyName}
          onCompanyNameChange={setCompanyName}
          fields={fields}
          onFieldChange={updateField}
          socialLinks={normalizeSocialLinks(fields.social_links)}
          onSocialChange={updateSocialLink}
          onRemoveSocial={removeSocialLink}
          servicesPreview={servicesPreview}
          competitorsPreview={competitorsPreview}
          teamPreview={teamPreview}
          onOpenStructured={(id) => setOpenPanel(id)}
          openGroups={openGroups}
          onToggleGroup={(id, open) =>
            setOpenGroups((prev) => ({ ...prev, [id]: open }))
          }
          configOpen={configOpen}
          onToggleConfig={setConfigOpen}
          seoAuthority={fields.seo_authority}
          archivedOpen={archivedOpen}
          onToggleArchived={setArchivedOpen}
          configTriggers={[
            {
              id: "product_name",
              title: "Product Name",
              filled: Boolean(fields.product_name.trim()),
              onClick: () => setOpenPanel("product_name"),
            },
            {
              id: "category",
              title: "SEO Category",
              filled: selectedIndustries.length > 0,
              onClick: () => setOpenPanel("category"),
            },
            {
              id: "pillars",
              title: `Pillar Keywords (${pillarTotal})`,
              filled: pillars.some(
                (pillar) =>
                  pillar.keyword.trim() || countFilled(pillar.supporting) > 0
              ),
              onClick: openPillarsPanel,
            },
            {
              id: "social-shops",
              title: "Social & Shops",
              filled: socialShopsFilled,
              onClick: () => setOpenPanel("social-shops"),
            },
            {
              id: "connections",
              title: "Connections",
              filled: connectionsFilled,
              onClick: () => setOpenPanel("connections"),
            },
            {
              id: "publish-destination",
              title: "Publish Destination",
              filled: publishDestinationFilled,
              onClick: () => setOpenPanel("publish-destination"),
            },
            {
              id: "email-campaigns",
              title: "Email Campaigns",
              filled: emailCampaignsFilled,
              onClick: () => setOpenPanel("email-campaigns"),
            },
            ...customFieldDefs.map((def) => ({
              id: `custom:${def.id}`,
              title: def.name,
              filled: Boolean((customValues[def.name] || "").trim()),
              onClick: () => setOpenPanel(`custom:${def.id}`),
            })),
          ]}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving || importBusy}>
            {saving ? "Saving..." : "Save brief"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleDownloadMarkdown}>
            Download as Markdown
          </Button>
          <Button type="button" variant="secondary" onClick={handleDownloadSeoBrief}>
            Download SEO brief
          </Button>
          <Button type="button" variant="outline" onClick={handleAddField}>
            + Add leftover field
          </Button>
          {savedMessage && (
            <span className="text-sm text-muted-foreground">{savedMessage}</span>
          )}
        </div>
      </form>

      <div className="mt-8 space-y-2 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          {completedCount} / {brief.total} brief fields completed
        </p>
        {missingPoints.length > 0 ? (
          <Collapsible open={missingOpen} onOpenChange={setMissingOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md py-1 text-left text-sm font-medium text-foreground hover:text-foreground"
              >
                Still open in the brief
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

      <div className="mt-6 space-y-3">
        <div
          role="button"
          tabIndex={0}
          className={`rounded-lg border border-dashed px-4 py-5 text-center transition-colors ${
            importBusy || saving
              ? "cursor-default opacity-80"
              : "cursor-pointer"
          } ${
            importDragOver ? "border-foreground bg-muted/40" : "border-border"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!importBusy && !saving) setImportDragOver(true);
          }}
          onDragLeave={() => setImportDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setImportDragOver(false);
            if (importBusy || saving) return;
            processImportFiles(e.dataTransfer.files);
          }}
          onClick={() => {
            if (importBusy || saving) return;
            importFileRef.current?.click();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (importBusy || saving) return;
              importFileRef.current?.click();
            }
          }}
        >
          {importBusy ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p>Reading markdown and allocating fields…</p>
            </div>
          ) : (
            <>
              <Upload className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-foreground">Drag & drop</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Drop a .md file to fill empty company fields
              </p>
            </>
          )}
          <input
            ref={importFileRef}
            type="file"
            className="sr-only"
            accept=".md,.markdown,text/markdown"
            disabled={importBusy || saving}
            onChange={(e) => {
              processImportFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {importResult && !importBusy && (
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">
              {importResult.seoBrief
                ? importResult.filled.length > 0
                  ? `Saved ${importResult.filled.length} field${
                      importResult.filled.length === 1 ? "" : "s"
                    } from ${importResult.fileName}`
                  : `Nothing saved from ${importResult.fileName}`
                : importResult.filled.length > 0
                ? `Filled ${importResult.filled.length} field${
                    importResult.filled.length === 1 ? "" : "s"
                  } from ${importResult.fileName}`
                : `No empty fields filled from ${importResult.fileName}`}
            </p>
            {importResult.filled.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                {importResult.filled.join(", ")}
              </p>
            )}
            {importResult.skipped.length > 0 && (
              <p className="mt-2 text-muted-foreground">
                {importResult.seoBrief ? "Not applied: " : "Already filled, left as-is: "}
                {importResult.skipped.join(", ")}
              </p>
            )}
            {importResult.notInFile.length > 0 && (
              <p className="mt-2 text-muted-foreground">
                Not found in file: {importResult.notInFile.join(", ")}
              </p>
            )}
            {importResult.seoBrief ? null : importResult.stillMissing.length > 0 ? (
              <p className="mt-2 text-muted-foreground">
                Still missing: {importResult.stillMissing.join(", ")}
              </p>
            ) : (
              <p className="mt-2 text-muted-foreground">All fields completed.</p>
            )}
            {importResult.keywordWarning ? (
              <p className="mt-2 text-destructive">{importResult.keywordWarning}</p>
            ) : null}
          </div>
        )}
      </div>

      {/* SEO brief import preview */}
      <Dialog open={Boolean(seoImport)} onOpenChange={(open) => !open && setSeoImport(null)}>
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Review SEO brief changes</DialogTitle>
            <DialogDescription>
              {seoImport?.rows.length
                ? `${seoImport.rows.length} field${seoImport.rows.length === 1 ? "" : "s"} in ${seoImport.fileName} differ from what is saved. Untick anything you don’t want. Empty answers in the file are ignored.`
                : `${seoImport?.fileName || "The file"} has no changes to apply.`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {(seoImport?.rows || []).map((row) => (
              <div key={row.key} className="rounded-lg border border-border">
                <label className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
                  <Checkbox
                    checked={Boolean(seoImport.selected[row.key])}
                    onCheckedChange={(checked) =>
                      setSeoImport((prev) => ({
                        ...prev,
                        selected: { ...prev.selected, [row.key]: Boolean(checked) },
                      }))
                    }
                  />
                  {row.label}
                  <span className="text-xs font-normal text-muted-foreground">
                    {row.change === "fill" ? "fills an empty field" : "replaces current text"}
                  </span>
                </label>
                <div className="grid grid-cols-1 gap-3 px-3 py-2.5 text-sm sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Now</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{row.current || "Empty"}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">From file</p>
                    <p className="whitespace-pre-wrap text-foreground">{row.next}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setSeoImport(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !seoImport?.rows.some((row) => seoImport.selected[row.key])}
              onClick={applySeoBriefImport}
            >
              {saving ? "Saving..." : "Save selected"}
            </Button>
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

      {/* Location / Markets Served */}
      <Dialog
        open={openPanel === "location_markets"}
        onOpenChange={(open) => setOpenPanel(open ? "location_markets" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Location / Markets Served</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Textarea
              id="location_markets"
              value={fields.location_markets || ""}
              onChange={(e) => updateField("location_markets", e.target.value)}
              className="min-h-full h-full"
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                confirmClearPanel("location_markets", "Location / Markets Served")
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

      {/* Contact Email */}
      <Dialog
        open={openPanel === "contact_email"}
        onOpenChange={(open) => setOpenPanel(open ? "contact_email" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Contact Email</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Input
              id="contact_email"
              value={fields.contact_email || ""}
              onChange={(e) => updateField("contact_email", e.target.value)}
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("contact_email", "Contact Email")}
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
              Core pillar keywords are the rows. Supporting keywords are listed under
              each pillar. Shared with the SEO Advisor and the content pipeline;
              locked keywords already have articles.
            </DialogDescription>
            {keywordsLoadError && (
              <p className="text-xs text-destructive">
                Couldn’t load the saved keywords ({keywordsLoadError}). Changes here won’t be
                saved until they load.
              </p>
            )}
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {pillars.map((pillar, index) => {
              const isOpen = Boolean(openPillars[index]);
              const supportingCount = pillar.supporting.length;
              const pillarSlug = slugifyKeyword(pillar.keyword);
              const pillarLocked =
                Boolean(pillar.keyword.trim()) && keywordLocks.cores.has(pillarSlug);

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
                      disabled={pillarLocked}
                      title={
                        pillarLocked
                          ? "Has articles or planned articles — can’t be renamed or removed"
                          : undefined
                      }
                    />
                    {pillarLocked && (
                      <Lock
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-label="Locked: has content"
                      />
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {countFilled(pillar.supporting)}/{MAX_SUPPORTING_PER_CORE}
                    </span>
                    {savedSpecFor(pillar.keyword) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 text-xs"
                        onClick={() => setSpecTarget({ type: "core", core: pillar.keyword })}
                        title="Article spec: angle, key messages, status"
                      >
                        Spec · {(savedSpecFor(pillar.keyword).keyMessages || []).length} msgs
                      </Button>
                    ) : null}
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
                        disabled={pillarLocked}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                        title={pillarLocked ? "Has content — can’t be removed" : "Delete pillar"}
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
                      {pillar.supporting.map((keyword, supportingIndex) => {
                        const supportingLocked =
                          Boolean(keyword.trim()) &&
                          keywordLocks.supporting.has(
                            `${pillarSlug}/${slugifyKeyword(keyword)}`
                          );
                        return (
                          <div key={supportingIndex} className="flex items-center gap-2">
                            <Input
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
                              disabled={supportingLocked}
                              title={
                                supportingLocked
                                  ? "Has articles or planned articles — can’t be renamed or removed"
                                  : undefined
                              }
                            />
                            {supportingLocked && (
                              <Lock
                                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                aria-label="Locked: has content"
                              />
                            )}
                            {keyword.trim() && savedSpecFor(pillar.keyword, keyword) ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 shrink-0 text-xs"
                                onClick={() =>
                                  setSpecTarget({
                                    type: "supporting",
                                    core: pillar.keyword,
                                    keyword,
                                  })
                                }
                                title="Article spec: angle, key messages, status"
                              >
                                Spec · {(savedSpecFor(pillar.keyword, keyword).keyMessages || []).length} msgs
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={supportingCount >= MAX_SUPPORTING_PER_CORE}
                        onClick={() => addSupportingKeyword(index)}
                      >
                        + New
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pillars.length >= MAX_CORE_KEYWORDS}
              onClick={addPillarKeyword}
            >
              + New
            </Button>
            <p className="text-xs text-muted-foreground">
              Up to {MAX_CORE_KEYWORDS} Core keywords and {MAX_SUPPORTING_PER_CORE} Supporting
              keywords per Core. Each keyword is one article; save first, then open its Spec
              to edit the angle and key messages.
            </p>
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

      <ArticleSpecDialog
        target={openSpec}
        onClose={() => setSpecTarget(null)}
        onSave={(spec) =>
          specAction("update_spec", {
            core: openSpec.core,
            keyword: openSpec.type === "supporting" ? openSpec.keyword : undefined,
            spec,
          })
        }
        onAddBacklog={(keyword) => specAction("add_backlog", { core: openSpec.core, keyword })}
        onRemoveBacklog={(keyword) =>
          specAction("remove_backlog", { core: openSpec.core, keyword })
        }
        onPromoteBacklog={(keyword) =>
          specAction("add_supporting", { core: openSpec.core, keyword, source: "backlog" })
        }
      />

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

      {/* Team */}
      <Dialog
        open={openPanel === "team"}
        onOpenChange={(open) => setOpenPanel(open ? "team" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Team & Founder Credibility</DialogTitle>
            <DialogDescription>
              People, roles, credentials, and background that strengthen trust.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {normalizeTeamMembers(fields.team_members).map((member, index) => (
              <div
                key={index}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <div className="flex items-start gap-2">
                  <Input
                    value={member.name}
                    onChange={(e) => updateTeamMember(index, "name", e.target.value)}
                    placeholder="Name"
                    aria-label={`Team member ${index + 1} name`}
                  />
                  <Input
                    value={member.role}
                    onChange={(e) => updateTeamMember(index, "role", e.target.value)}
                    placeholder="Role"
                    aria-label={`Team member ${index + 1} role`}
                  />
                  <button
                    type="button"
                    onClick={() => removeTeamMember(index)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label="Remove team member"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input
                  value={member.credentials}
                  onChange={(e) =>
                    updateTeamMember(index, "credentials", e.target.value)
                  }
                  placeholder="Credentials"
                  aria-label={`Team member ${index + 1} credentials`}
                />
                <Textarea
                  value={member.bio}
                  onChange={(e) => updateTeamMember(index, "bio", e.target.value)}
                  placeholder="Background and credibility notes"
                  className="min-h-[72px]"
                  aria-label={`Team member ${index + 1} bio`}
                />
                {(member.same_as || []).map((url, sameAsIndex) => (
                  <Input
                    key={sameAsIndex}
                    value={url}
                    onChange={(e) =>
                      updateTeamSameAs(index, sameAsIndex, e.target.value)
                    }
                    placeholder="https://linkedin.com/in/..."
                    aria-label={`Team member ${index + 1} profile URL ${sameAsIndex + 1}`}
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addTeamSameAs(index)}
                >
                  + Profile URL
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addTeamMember}>
              + Add person
            </Button>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmClearPanel("team", "Team & Founder Credibility")}
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

      {/* Connections */}
      <Dialog
        open={openPanel === "connections"}
        onOpenChange={(open) => setOpenPanel(open ? "connections" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Connections</DialogTitle>
            <DialogDescription>
              Analytics, SEO, and tracking tools, credentials, and notes.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {openPanel === "connections" && companyId ? (
              <ConnectionsPanel
                companyId={companyId}
                onConnectionsChange={(tools, { persistIntoProfile = true } = {}) => {
                  setConnectionsFilled(connectionsHaveContent(tools));
                  if (!persistIntoProfile) return;
                  setCustomValues((prev) => ({
                    ...prev,
                    [ANALYTICS_TOOLS_FIELD]: tools,
                  }));
                }}
              />
            ) : null}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-end">
            <PanelModalActions
              onCopy={() => handleCopyPanel("connections")}
              onClose={() => setOpenPanel(null)}
              showSave={false}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Destination */}
      <Dialog
        open={openPanel === "publish-destination"}
        onOpenChange={(open) =>
          setOpenPanel(open ? "publish-destination" : null)
        }
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Publish Destination</DialogTitle>
            <DialogDescription>
              The GitHub repo this company publishes to. The token itself lives
              in TNV&apos;s Vercel settings; this dialog only stores its label.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <PublishDestinationGuide
              defaultOpen={!githubOwner.trim() || !githubRepo.trim() || !githubTokenKey.trim()}
            />
            <div className="space-y-2">
              <Label htmlFor="github_owner">GitHub owner</Label>
              <Input
                id="github_owner"
                value={githubOwner}
                onChange={(e) => setGithubOwner(e.target.value)}
                placeholder="DoriFussmann"
                aria-invalid={Boolean(ownerIssue)}
                aria-describedby="github_owner_hint"
              />
              <p
                id="github_owner_hint"
                className={ownerIssue ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              >
                {ownerIssue || "The name between github.com/ and the repo in the repo URL."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="github_repo">GitHub repo</Label>
              <Input
                id="github_repo"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="hey-rupert"
                aria-invalid={Boolean(repoIssue)}
                aria-describedby="github_repo_hint"
              />
              <p
                id="github_repo_hint"
                className={repoIssue ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              >
                {repoIssue || "The repo name only."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="github_token_key">GitHub token key</Label>
              <Input
                id="github_token_key"
                value={githubTokenKey}
                onChange={(e) => setGithubTokenKey(e.target.value)}
                placeholder="HEYRUPERT"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(keyIssue)}
                aria-describedby="github_token_key_hint"
              />
              <p
                id="github_token_key_hint"
                className={keyIssue ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              >
                {keyIssue ||
                  (githubTokenKey.trim()
                    ? `TNV will read the token from ${tokenEnvName(githubTokenKey)} in Vercel.`
                    : "The label only, for example HEYRUPERT. Never the github_pat_… token.")}
              </p>
            </div>
            <PublishDestinationCheck
              owner={githubOwner}
              repo={githubRepo}
              tokenKey={githubTokenKey}
              disabled={Boolean(destinationIssue)}
            />
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                confirmClearPanel("publish-destination", "Publish Destination")
              }
            >
              Delete
            </Button>
            <PanelModalActions
              onCopy={() => handleCopyPanel(openPanel)}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
              saveDisabled={Boolean(destinationIssue)}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Campaigns */}
      <Dialog
        open={openPanel === "email-campaigns"}
        onOpenChange={(open) => setOpenPanel(open ? "email-campaigns" : null)}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>Email Campaigns</DialogTitle>
            <DialogDescription>
              Outreach for this company (EPIC). Turn it on, choose the provider,
              and set the campaign ID. The provider API key lives in a Vercel
              environment variable (INSTANTLY_API_KEY / SMARTLEAD_API_KEY), not
              here.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="email_campaigns_enabled">
                  Email campaigns enabled
                </Label>
                <p className="text-xs text-muted-foreground">
                  When on, this company shows the Email Campaigns page and can run
                  outreach.
                </p>
              </div>
              <Switch
                id="email_campaigns_enabled"
                checked={emailEnabled}
                onCheckedChange={setEmailEnabled}
              />
            </div>

            {emailEnabled && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email_campaigns_provider">Provider</Label>
                  <Select value={emailProvider} onValueChange={setEmailProvider}>
                    <SelectTrigger id="email_campaigns_provider">
                      <SelectValue placeholder="Choose provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="instantly">Instantly</SelectItem>
                      <SelectItem value="smartlead">SmartLead</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_campaigns_campaign_id">Campaign ID</Label>
                  <Input
                    id="email_campaigns_campaign_id"
                    value={emailCampaignId}
                    onChange={(e) => setEmailCampaignId(e.target.value)}
                    placeholder="e.g. 01H8X..."
                  />
                </div>
                <div className="space-y-2 rounded-md border border-border p-3">
                  <Label>Sending capacity</Label>
                  <p className="text-xs text-muted-foreground">
                    Single touch: every email goes to a new person, so Audience Build
                    picks inboxes × emails per inbox new leads each weekday.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="outbound_inboxes" className="text-xs">
                        Inboxes
                      </Label>
                      <Input
                        id="outbound_inboxes"
                        type="number"
                        min={1}
                        max={20}
                        className="w-24"
                        value={outboundInboxes}
                        onChange={(e) => setOutboundInboxes(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="outbound_daily_cap" className="text-xs">
                        Emails per inbox per day
                      </Label>
                      <Input
                        id="outbound_daily_cap"
                        type="number"
                        min={1}
                        max={200}
                        className="w-24"
                        value={outboundDailyCap}
                        onChange={(e) => setOutboundDailyCap(e.target.value)}
                      />
                    </div>
                    <p className="pb-2 text-sm">
                      ={" "}
                      <span className="font-medium tabular-nums">
                        {(Math.round(Number(outboundInboxes)) || 0) * (Math.round(Number(outboundDailyCap)) || 0)}
                      </span>{" "}
                      new leads per weekday
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  API key: set{" "}
                  {emailProvider === "smartlead"
                    ? "SMARTLEAD_API_KEY"
                    : "INSTANTLY_API_KEY"}{" "}
                  in Vercel → Settings → Environment Variables, then redeploy. The
                  Integrations tab shows its status.
                </p>
              </>
            )}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setEmailEnabled(false);
                setEmailProvider("");
                setEmailCampaignId("");
              }}
            >
              Clear
            </Button>
            <PanelModalActions
              onCopy={async () => {
                const text = [
                  `Email campaigns: ${emailEnabled ? "on" : "off"}`,
                  emailEnabled && emailProvider ? `Provider: ${emailProvider}` : "",
                  emailEnabled ? `Sending capacity: ${outboundInboxes} inboxes × ${outboundDailyCap}/day` : "",
                  emailEnabled && emailCampaignId.trim()
                    ? `Campaign ID: ${emailCampaignId.trim()}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n");
                try {
                  await navigator.clipboard.writeText(text);
                  return true;
                } catch {
                  return false;
                }
              }}
              onClose={() => setOpenPanel(null)}
              onSave={saveAndClosePanel}
              saving={saving}
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

    </div>
  );
}
