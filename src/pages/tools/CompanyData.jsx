import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, Trash2, X } from "lucide-react";
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
  emptySocialLinkEntry,
  emptyTeamEntry,
  normalizeServices,
  normalizeSocialLinks,
  normalizeTeamMembers,
  trimServicesForSave,
  trimSocialLinksForSave,
  trimTeamMembersForSave,
} from "./templateToPrompt/customFieldKeys";

const DEFAULT_PILLAR_COUNT = 5;
const DEFAULT_SUPPORTING_COUNT = 5;

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

export default function CompanyData() {
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [fields, setFields] = useState(EMPTY_PROFILE);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [industries, setIndustries] = useState([]);
  const [selectedIndustryIds, setSelectedIndustryIds] = useState([]);
  const [industryFilter, setIndustryFilter] = useState("");
  const [industryPickerOpen, setIndustryPickerOpen] = useState(false);
  const [targetAudienceOpen, setTargetAudienceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");
  const [pillarsOpen, setPillarsOpen] = useState(false);
  const [openPillars, setOpenPillars] = useState({});
  const [competitorsOpen, setCompetitorsOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [contactSocialOpen, setContactSocialOpen] = useState(false);
  const [abstractOpen, setAbstractOpen] = useState(false);
  const [shortDescriptionOpen, setShortDescriptionOpen] = useState(false);
  const [mediumDescriptionOpen, setMediumDescriptionOpen] = useState(false);
  const [longDescriptionOpen, setLongDescriptionOpen] = useState(false);
  const [designGuidelinesOpen, setDesignGuidelinesOpen] = useState(false);
  const [openCustomFields, setOpenCustomFields] = useState({});
  const [designGuideOpen, setDesignGuideOpen] = useState(false);
  const [designGuideDraftRaw, setDesignGuideDraftRaw] = useState("");
  const [designGuideDraftAbstract, setDesignGuideDraftAbstract] = useState("");
  const [designGuideAbstractReady, setDesignGuideAbstractReady] = useState(false);
  const [designGuideGenerating, setDesignGuideGenerating] = useState(false);
  const [designGuideSaving, setDesignGuideSaving] = useState(false);
  const [designGuideError, setDesignGuideError] = useState("");

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
    ] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "id, domain, product_name, target_audience, abstract, short_description, medium_description, long_description, design_guide_raw, design_guide_abstract, core_keywords, competitors, services, team_members, contact_email, social_links, custom_fields"
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
      setCustomFieldDefs(customFieldsResult.data || []);
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

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const removeTeamMember = (index) => {
    setFields((prev) => ({
      ...prev,
      team_members: normalizeTeamMembers(prev.team_members).filter((_, i) => i !== index),
    }));
  };

  const addSocialLink = () => {
    setFields((prev) => ({
      ...prev,
      social_links: [
        ...normalizeSocialLinks(prev.social_links),
        emptySocialLinkEntry(),
      ],
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
      social_links: normalizeSocialLinks(prev.social_links).filter(
        (_, i) => i !== index
      ),
    }));
  };

  const addTeamSameAs = (memberIndex) => {
    setFields((prev) => {
      const next = normalizeTeamMembers(prev.team_members);
      next[memberIndex] = {
        ...next[memberIndex],
        same_as: [...next[memberIndex].same_as, ""],
      };
      return { ...prev, team_members: next };
    });
  };

  const updateTeamSameAs = (memberIndex, urlIndex, value) => {
    setFields((prev) => {
      const next = normalizeTeamMembers(prev.team_members);
      const same_as = [...next[memberIndex].same_as];
      same_as[urlIndex] = value;
      next[memberIndex] = { ...next[memberIndex], same_as };
      return { ...prev, team_members: next };
    });
  };

  const removeTeamSameAs = (memberIndex, urlIndex) => {
    setFields((prev) => {
      const next = normalizeTeamMembers(prev.team_members);
      next[memberIndex] = {
        ...next[memberIndex],
        same_as: next[memberIndex].same_as.filter((_, i) => i !== urlIndex),
      };
      return { ...prev, team_members: next };
    });
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

  const handleSave = async (e) => {
    e.preventDefault();
    if (!companyId || saving) return;

    setSaving(true);
    setSavedMessage("");
    setError("");

    const competitors = normalizeCompetitors(fields.competitors)
      .map((item) => ({
        name: item.name.trim(),
        url: item.url.trim(),
      }))
      .filter((item) => item.name || item.url);

    for (const competitor of competitors) {
      if (!isLooseHttpUrl(competitor.url)) {
        setError("Competitor URLs must start with http:// or https://");
        setSaving(false);
        return;
      }
    }

    const services = trimServicesForSave(fields.services);
    const team_members = trimTeamMembersForSave(fields.team_members);
    const social_links = trimSocialLinksForSave(fields.social_links);

    for (const member of team_members) {
      for (const url of member.same_as || []) {
        if (!isLooseHttpUrl(url)) {
          setError("Team sameAs URLs must start with http:// or https://");
          setSaving(false);
          return;
        }
      }
    }

    for (const link of social_links) {
      if (!isLooseHttpUrl(link.url)) {
        setError("Social link URLs must start with http:// or https://");
        setSaving(false);
        return;
      }
    }

    const custom_fields = {};
    for (const def of customFieldDefs) {
      custom_fields[def.name] = customValues[def.name] ?? "";
    }

    const payload = {
      company_id: companyId,
      domain: fields.domain.trim() || null,
      product_name: fields.product_name.trim() || null,
      target_audience: fields.target_audience.trim() || null,
      abstract: fields.abstract.trim() || null,
      short_description: fields.short_description.trim() || null,
      medium_description: fields.medium_description.trim() || null,
      long_description: fields.long_description.trim() || null,
      design_guide_raw: fields.design_guide_raw.trim() || null,
      design_guide_abstract: fields.design_guide_abstract.trim() || null,
      core_keywords: normalizePillarKeywords(fields.core_keywords),
      competitors,
      services,
      team_members,
      contact_email: fields.contact_email.trim() || null,
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
      return;
    }

    const { error: deleteIndustriesError } = await supabase
      .from("company_industries")
      .delete()
      .eq("company_id", companyId);

    if (deleteIndustriesError) {
      console.error("Failed to clear company categories:", deleteIndustriesError);
      setError(deleteIndustriesError.message || "Failed to save categories");
      setSaving(false);
      return;
    }

    if (selectedIndustryIds.length > 0) {
      const { error: insertIndustriesError } = await supabase
        .from("company_industries")
        .insert(
          selectedIndustryIds.map((industry_id) => ({
            company_id: companyId,
            industry_id,
          }))
        );

      if (insertIndustriesError) {
        console.error("Failed to save company categories:", insertIndustriesError);
        setError(insertIndustriesError.message || "Failed to save categories");
        setSaving(false);
        return;
      }
    }

    setProfileId(data?.id || profileId);
    setSaving(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleDownloadMarkdown = () => {
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
      .map((s) => {
        const head = `- ${s.title || "(untitled)"}: ${s.summary || ""}`.trim();
        return s.detail ? `${head}\n  ${s.detail}` : head;
      })
      .join("\n");

    const teamLines = trimTeamMembersForSave(fields.team_members)
      .map((t) => {
        const head = `- ${t.name || "(unnamed)"}${t.role ? ` (${t.role})` : ""}`;
        const parts = [head];
        if (t.bio) parts.push(`  ${t.bio}`);
        if (t.credentials) parts.push(`  Credentials: ${t.credentials}`);
        if (t.same_as?.length) parts.push(`  sameAs: ${t.same_as.join(", ")}`);
        return parts.join("\n");
      })
      .join("\n");

    const socialLines = trimSocialLinksForSave(fields.social_links)
      .map(
        (link) =>
          `- ${link.label || "(unlabeled)"}${link.url ? `: ${link.url}` : ""}`
      )
      .join("\n");

    const categoryLines = industries
      .filter((industry) => selectedIndustryIds.includes(industry.id))
      .map((industry) => `- ${industry.name}`)
      .join("\n");

    const fixedEntries = [
      ["Domain", fields.domain],
      ["Product Name", fields.product_name],
      ["Category", categoryLines],
      ["Target Description", fields.target_audience],
      ["Pillar Keywords", pillarLines],
      ["Competitors", competitorLines],
      ["Services / Products", serviceLines],
      ["Team", teamLines],
      ["Contact Email", fields.contact_email],
      ["Social Links", socialLines],
      ["Abstract", fields.abstract],
      ["Short Description", fields.short_description],
      ["Medium Description", fields.medium_description],
      ["Long Description", fields.long_description],
      ["Design Guidelines", fields.design_guide_abstract],
    ];

    const customEntries = customFieldDefs.map((def) => [
      def.name,
      customValues[def.name] || "",
    ]);

    const lines = [`# ${companyName || "Company"}`, ""];

    for (const [label, value] of [...fixedEntries, ...customEntries]) {
      const trimmed = (value || "").trim();
      if (!trimmed) continue;
      if (
        label === "Category" ||
        label === "Pillar Keywords" ||
        label === "Competitors" ||
        label === "Services / Products" ||
        label === "Team" ||
        label === "Social Links"
      ) {
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

  const handleGenerateDesignGuideAbstract = async () => {
    const raw = designGuideDraftRaw.trim();
    if (!raw || designGuideGenerating) return;

    setDesignGuideGenerating(true);
    setDesignGuideError("");
    setDesignGuideAbstractReady(false);
    setDesignGuideDraftAbstract("");

    try {
      const res = await fetch("/api/design-guide-abstract", {
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

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading company data...</p>;
  }

  const pillars = normalizePillarKeywords(fields.core_keywords);
  const pillarTotal = pillars.length;
  const competitors = normalizeCompetitors(fields.competitors);
  const services = normalizeServices(fields.services);
  const teamMembers = normalizeTeamMembers(fields.team_members);
  const socialLinks = normalizeSocialLinks(fields.social_links);
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

  return (
    <div>
      <h1 className="text-xs text-foreground mb-1">
        {companyName || "Company Data"}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Edit company profile fields and export as markdown.
      </p>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSave} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              value={fields.domain}
              onChange={(e) => updateField("domain", e.target.value)}
              placeholder="example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product_name">Product Name</Label>
            <Input
              id="product_name"
              value={fields.product_name}
              onChange={(e) => updateField("product_name", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Category</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setIndustryPickerOpen((open) => {
                    if (open) setIndustryFilter("");
                    return !open;
                  });
                }}
              >
                {industryPickerOpen ? "Done" : "+ Add"}
              </Button>
            </div>
            {selectedIndustries.length > 0 ? (
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
            ) : (
              !industryPickerOpen && (
                <p className="text-sm text-muted-foreground">None selected</p>
              )
            )}
            {industryPickerOpen && (
              <>
                <Input
                  value={industryFilter}
                  onChange={(e) => setIndustryFilter(e.target.value)}
                  placeholder="Filter industries..."
                />
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
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
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Target Description</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTargetAudienceOpen(true)}
              >
                Details
              </Button>
            </div>
          </div>
        </div>

        <Collapsible
          open={pillarsOpen}
          onOpenChange={setPillarsOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Pillar Keywords ({pillarTotal})</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  pillarsOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-3 border-t border-border p-3">
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
                        aria-label={isOpen ? "Collapse supporting keywords" : "Expand supporting keywords"}
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
                            updateSupportingKeyword(index, supportingIndex, e.target.value)
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
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={competitorsOpen}
          onOpenChange={setCompetitorsOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">
                Competitors ({competitors.length})
              </Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  competitorsOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-3 border-t border-border p-3">
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
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={servicesOpen}
          onOpenChange={setServicesOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">
                Services / Products ({services.length})
              </Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  servicesOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-3 border-t border-border p-3">
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
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={teamOpen}
          onOpenChange={setTeamOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Team ({teamMembers.length})</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  teamOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-3 border-t border-border p-3">
            {teamMembers.map((member, index) => (
              <div
                key={index}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <div className="flex items-start gap-2">
                  <Input
                    value={member.name}
                    onChange={(e) => updateTeamMember(index, "name", e.target.value)}
                    placeholder="Name"
                    className="flex-1"
                    aria-label={`Team member ${index + 1} name`}
                  />
                  <Input
                    value={member.role}
                    onChange={(e) => updateTeamMember(index, "role", e.target.value)}
                    placeholder="Role"
                    className="flex-1"
                    aria-label={`Team member ${index + 1} role`}
                  />
                  <button
                    type="button"
                    onClick={() => removeTeamMember(index)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Remove team member"
                    aria-label="Remove team member"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Textarea
                  value={member.bio}
                  onChange={(e) => updateTeamMember(index, "bio", e.target.value)}
                  placeholder="Bio"
                  className="min-h-[72px]"
                  aria-label={`Team member ${index + 1} bio`}
                />
                <Input
                  value={member.credentials}
                  onChange={(e) =>
                    updateTeamMember(index, "credentials", e.target.value)
                  }
                  placeholder="Credentials (optional)"
                  aria-label={`Team member ${index + 1} credentials`}
                />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    sameAs URLs (optional)
                  </Label>
                  {(member.same_as || []).map((url, urlIndex) => (
                    <div key={urlIndex} className="flex items-start gap-2">
                      <Input
                        value={url}
                        onChange={(e) =>
                          updateTeamSameAs(index, urlIndex, e.target.value)
                        }
                        placeholder="https://"
                        className="flex-1"
                        aria-label={`Team member ${index + 1} sameAs ${urlIndex + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeTeamSameAs(index, urlIndex)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                        title="Remove URL"
                        aria-label="Remove sameAs URL"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addTeamSameAs(index)}
                  >
                    + Add URL
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addTeamMember}>
              + Add
            </Button>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={contactSocialOpen}
          onOpenChange={setContactSocialOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Contact & Social</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  contactSocialOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-3 border-t border-border p-3">
            <p className="text-xs text-muted-foreground">
              Used by Specific Prompt to auto-fill CONTACT_EMAIL and SAME_AS /
              social links config findings.
            </p>
            <div className="space-y-2">
              <Label htmlFor="contact_email">Contact email</Label>
              <Input
                id="contact_email"
                type="email"
                value={fields.contact_email}
                onChange={(e) => updateField("contact_email", e.target.value)}
                placeholder="hello@example.com"
              />
            </div>
            <div className="space-y-3">
              <Label>Social links</Label>
              {socialLinks.map((link, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Input
                    value={link.label}
                    onChange={(e) =>
                      updateSocialLink(index, "label", e.target.value)
                    }
                    placeholder="Label"
                    className="flex-1"
                    aria-label={`Social link ${index + 1} label`}
                  />
                  <Input
                    value={link.url}
                    onChange={(e) => updateSocialLink(index, "url", e.target.value)}
                    placeholder="https://"
                    className="flex-1"
                    aria-label={`Social link ${index + 1} URL`}
                  />
                  <button
                    type="button"
                    onClick={() => removeSocialLink(index)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Remove social link"
                    aria-label="Remove social link"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addSocialLink}>
                + Add
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={abstractOpen}
          onOpenChange={setAbstractOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Abstract</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  abstractOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border p-3">
            <Textarea
              id="abstract"
              value={fields.abstract}
              onChange={(e) => updateField("abstract", e.target.value)}
              className="min-h-[80px]"
            />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={shortDescriptionOpen}
          onOpenChange={setShortDescriptionOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Short Description</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  shortDescriptionOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border p-3">
            <Textarea
              id="short_description"
              value={fields.short_description}
              onChange={(e) => updateField("short_description", e.target.value)}
              className="min-h-[80px]"
            />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={mediumDescriptionOpen}
          onOpenChange={setMediumDescriptionOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Medium Description</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  mediumDescriptionOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border p-3">
            <Textarea
              id="medium_description"
              value={fields.medium_description}
              onChange={(e) => updateField("medium_description", e.target.value)}
              className="min-h-[120px]"
            />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={longDescriptionOpen}
          onOpenChange={setLongDescriptionOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Long Description</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  longDescriptionOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border p-3">
            <Textarea
              id="long_description"
              value={fields.long_description}
              onChange={(e) => updateField("long_description", e.target.value)}
              className="min-h-[160px]"
            />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible
          open={designGuidelinesOpen}
          onOpenChange={setDesignGuidelinesOpen}
          className="rounded-md border border-border"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
            >
              <Label className="cursor-pointer">Design Guidelines</Label>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  designGuidelinesOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 border-t border-border p-3">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button type="button" variant="outline" size="sm" onClick={openDesignGuideModal}>
                {hasDesignGuide ? "Update Design Guide" : "Paste Design Guide"}
              </Button>
            </div>
            {fields.design_guide_abstract.trim() ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {fields.design_guide_abstract}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not set yet</p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {customFieldDefs.map((def) => {
          const isOpen = Boolean(openCustomFields[def.id]);
          return (
            <Collapsible
              key={def.id}
              open={isOpen}
              onOpenChange={(open) =>
                setOpenCustomFields((prev) => ({ ...prev, [def.id]: open }))
              }
              className="rounded-md border border-border"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-full items-center justify-between gap-3 px-3 text-left"
                >
                  <Label className="cursor-pointer">{def.name}</Label>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="border-t border-border p-3">
                <Input
                  id={`custom-${def.id}`}
                  value={customValues[def.name] || ""}
                  onChange={(e) => updateCustomValue(def.name, e.target.value)}
                />
              </CollapsibleContent>
            </Collapsible>
          );
        })}

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

      <Dialog open={targetAudienceOpen} onOpenChange={setTargetAudienceOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Target Description</DialogTitle>
            <DialogDescription>
              Who you serve — ICP, persona, and target audience details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="target_audience">Details</Label>
            <Textarea
              id="target_audience"
              value={fields.target_audience}
              onChange={(e) => updateField("target_audience", e.target.value)}
              placeholder="Who you serve — ICP, persona, and target audience details."
              className="min-h-[220px]"
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setTargetAudienceOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={designGuideOpen}
        onOpenChange={(open) => {
          if (designGuideGenerating || designGuideSaving) return;
          setDesignGuideOpen(open);
          if (!open) setDesignGuideError("");
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {hasDesignGuide ? "Update Design Guide" : "Paste Design Guide"}
            </DialogTitle>
            <DialogDescription>
              Paste your project&apos;s Design Guide.md, generate an abstract, then save.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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

            {designGuideError && (
              <p className="text-sm text-destructive">{designGuideError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDesignGuideOpen(false)}
              disabled={designGuideGenerating || designGuideSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSaveDesignGuide}
              disabled={
                designGuideGenerating ||
                designGuideSaving ||
                !designGuideAbstractReady ||
                !designGuideDraftAbstract.trim()
              }
            >
              {designGuideSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
