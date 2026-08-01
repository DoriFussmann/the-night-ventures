import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EMPTY_CORE_KEYWORDS = ["", "", "", "", ""];

const EMPTY_PROFILE = {
  domain: "",
  product_name: "",
  abstract: "",
  short_description: "",
  medium_description: "",
  long_description: "",
  core_keywords: [...EMPTY_CORE_KEYWORDS],
};

function normalizeCoreKeywords(value) {
  const source = Array.isArray(value) ? value : [];
  return EMPTY_CORE_KEYWORDS.map((_, i) =>
    typeof source[i] === "string" ? source[i] : source[i] == null ? "" : String(source[i])
  );
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

export default function CompanyData() {
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [fields, setFields] = useState(EMPTY_PROFILE);
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  const [customValues, setCustomValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, profileResult, customFieldsResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select(
          "id, domain, product_name, abstract, short_description, medium_description, long_description, core_keywords, custom_fields"
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("company_custom_fields")
        .select("id, name, created_at")
        .order("created_at", { ascending: true }),
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
        abstract: profile.abstract || "",
        short_description: profile.short_description || "",
        medium_description: profile.medium_description || "",
        long_description: profile.long_description || "",
        core_keywords: normalizeCoreKeywords(profile.core_keywords),
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

  const updateCoreKeyword = (index, value) => {
    setFields((prev) => {
      const next = normalizeCoreKeywords(prev.core_keywords);
      next[index] = value;
      return { ...prev, core_keywords: next };
    });
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

    const custom_fields = {};
    for (const def of customFieldDefs) {
      custom_fields[def.name] = customValues[def.name] ?? "";
    }

    const payload = {
      company_id: companyId,
      domain: fields.domain.trim() || null,
      product_name: fields.product_name.trim() || null,
      abstract: fields.abstract.trim() || null,
      short_description: fields.short_description.trim() || null,
      medium_description: fields.medium_description.trim() || null,
      long_description: fields.long_description.trim() || null,
      core_keywords: normalizeCoreKeywords(fields.core_keywords),
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

    setProfileId(data?.id || profileId);
    setSaving(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
  };

  const handleDownloadMarkdown = () => {
    const coreKeywordsLine = normalizeCoreKeywords(fields.core_keywords)
      .map((kw) => kw.trim())
      .filter(Boolean)
      .join(", ");

    const fixedEntries = [
      ["Domain", fields.domain],
      ["Product Name", fields.product_name],
      ["Core Keywords", coreKeywordsLine],
      ["Abstract", fields.abstract],
      ["Short Description", fields.short_description],
      ["Medium Description", fields.medium_description],
      ["Long Description", fields.long_description],
    ];

    const customEntries = customFieldDefs.map((def) => [
      def.name,
      customValues[def.name] || "",
    ]);

    const lines = [`# ${companyName || "Company"}`, ""];

    for (const [label, value] of [...fixedEntries, ...customEntries]) {
      const trimmed = (value || "").trim();
      if (!trimmed) continue;
      lines.push(`**${label}:** ${trimmed}`, "");
    }

    const slug = (companyName || "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    downloadMarkdown(`${slug || "company"}-data.md`, lines.join("\n").trim() + "\n");
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading company data...</p>;
  }

  return (
    <div>
      <h1 className="text-[15px] text-foreground mb-1">
        {companyName || "Company Data"}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Edit company profile fields and export as markdown.
      </p>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSave} className="space-y-5">
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

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Core Keywords</Label>
            <p className="text-sm text-muted-foreground">
              5 high-value SEO keywords this company wants to rank for. Long-tail article
              topics from the Topic Generator tool will be built to support these.
            </p>
          </div>
          {normalizeCoreKeywords(fields.core_keywords).map((keyword, index) => (
            <div key={index} className="space-y-2">
              <Label htmlFor={`core_keyword_${index + 1}`}>Core Keyword {index + 1}</Label>
              <Input
                id={`core_keyword_${index + 1}`}
                value={keyword}
                onChange={(e) => updateCoreKeyword(index, e.target.value)}
                placeholder={`e.g. keyword ${index + 1}`}
              />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="abstract">Abstract</Label>
          <Textarea
            id="abstract"
            value={fields.abstract}
            onChange={(e) => updateField("abstract", e.target.value)}
            className="min-h-[80px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="short_description">Short Description</Label>
          <Textarea
            id="short_description"
            value={fields.short_description}
            onChange={(e) => updateField("short_description", e.target.value)}
            className="min-h-[80px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="medium_description">Medium Description</Label>
          <Textarea
            id="medium_description"
            value={fields.medium_description}
            onChange={(e) => updateField("medium_description", e.target.value)}
            className="min-h-[120px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="long_description">Long Description</Label>
          <Textarea
            id="long_description"
            value={fields.long_description}
            onChange={(e) => updateField("long_description", e.target.value)}
            className="min-h-[160px]"
          />
        </div>

        {customFieldDefs.map((def) => (
          <div key={def.id} className="space-y-2">
            <Label htmlFor={`custom-${def.id}`}>{def.name}</Label>
            <Input
              id={`custom-${def.id}`}
              value={customValues[def.name] || ""}
              onChange={(e) => updateCustomValue(def.name, e.target.value)}
            />
          </div>
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
    </div>
  );
}
