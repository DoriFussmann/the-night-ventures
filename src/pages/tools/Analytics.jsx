import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Reserved key in company_profiles.custom_fields — preserved by Company Data saves. */
export const ANALYTICS_TOOLS_FIELD = "_analytics_tools";

const STATUS_OPTIONS = ["Not Connected", "WIP", "Wired"];

const PANEL_DIALOG_CLASS =
  "flex h-[min(90vh,calc(min(96vw,1400px)*9/16))] w-[min(96vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:rounded-lg";

const DEFAULT_TOOLS = [
  { name: "Google Analytics", url: "https://analytics.google.com/", status: "Not Connected" },
  {
    name: "Google Search Console",
    url: "https://search.google.com/search-console",
    status: "Not Connected",
  },
  {
    name: "Bing Webmaster Tools",
    url: "https://www.bing.com/webmasters",
    status: "Not Connected",
  },
  {
    name: "Microsoft Clarity",
    url: "https://clarity.microsoft.com/",
    status: "Not Connected",
  },
  {
    name: "Google PageSpeed Insights",
    url: "https://pagespeed.web.dev/",
    status: "Not Connected",
  },
  {
    name: "Google Tag Manager",
    url: "https://tagmanager.google.com/",
    status: "Not Connected",
  },
  { name: "Semrush", url: "https://www.semrush.com/", status: "Not Connected" },
  { name: "Moz", url: "https://moz.com/", status: "Not Connected" },
  { name: "DataForSEO", url: "https://dataforseo.com/", status: "Not Connected" },
  { name: "Ahrefs", url: "https://ahrefs.com/", status: "Not Connected" },
];

function emptyTool() {
  return { name: "", url: "", status: "Not Connected", comments: "" };
}

function normalizeStatus(value) {
  const status = String(value || "").trim();
  return STATUS_OPTIONS.includes(status) ? status : "Not Connected";
}

function normalizeTools(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return emptyTool();
    return {
      name: item.name == null ? "" : String(item.name),
      url: item.url == null ? "" : String(item.url),
      status: normalizeStatus(item.status),
      comments: item.comments == null ? "" : String(item.comments),
    };
  });
}

function isLooseHttpUrl(value) {
  const url = String(value || "").trim();
  if (!url) return true;
  return /^https?:\/\//i.test(url);
}

function PanelTrigger({ title, filled = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center justify-between gap-3 rounded-md border border-border px-3 text-left transition-colors hover:bg-muted/50"
    >
      <span className="truncate text-sm font-medium leading-none">
        {title || "(unnamed)"}
      </span>
      {filled ? (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-emerald-600"
          strokeWidth={2.5}
          aria-label="Wired"
        />
      ) : null}
    </button>
  );
}

export default function Analytics() {
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [customFields, setCustomFields] = useState({});
  const [tools, setTools] = useState(() => normalizeTools(DEFAULT_TOOLS));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [openIndex, setOpenIndex] = useState(null);
  const [draft, setDraft] = useState(emptyTool());
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, profileResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("company_profiles")
        .select("id, custom_fields")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

    if (companyResult.error) {
      console.error("Failed to load company:", companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
    } else {
      setCompanyName(companyResult.data?.name || "");
    }

    if (profileResult.error) {
      console.error("Failed to load analytics tools:", profileResult.error);
      setError(profileResult.error.message || "Failed to load analytics tools");
      setProfileId(null);
      setCustomFields({});
      setTools(normalizeTools(DEFAULT_TOOLS));
    } else if (profileResult.data) {
      const fields =
        profileResult.data.custom_fields &&
        typeof profileResult.data.custom_fields === "object"
          ? { ...profileResult.data.custom_fields }
          : {};
      setProfileId(profileResult.data.id);
      setCustomFields(fields);
      if (Object.prototype.hasOwnProperty.call(fields, ANALYTICS_TOOLS_FIELD)) {
        setTools(normalizeTools(fields[ANALYTICS_TOOLS_FIELD]));
      } else {
        setTools(normalizeTools(DEFAULT_TOOLS));
      }
    } else {
      setProfileId(null);
      setCustomFields({});
      setTools(normalizeTools(DEFAULT_TOOLS));
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openTool = (index) => {
    setDraft({ ...emptyTool(), ...tools[index] });
    setOpenIndex(index);
  };

  const closeModal = () => {
    setOpenIndex(null);
    setDraft(emptyTool());
  };

  const persistTools = async (nextTools) => {
    if (!companyId) return false;

    setSaving(true);
    setError("");

    for (const tool of nextTools) {
      if (!isLooseHttpUrl(tool.url)) {
        setError("Tool URLs must start with http:// or https://");
        setSaving(false);
        return false;
      }
    }

    const nextCustomFields = {
      ...customFields,
      [ANALYTICS_TOOLS_FIELD]: nextTools,
    };

    const payload = {
      company_id: companyId,
      custom_fields: nextCustomFields,
      updated_at: new Date().toISOString(),
    };
    if (profileId) payload.id = profileId;

    const { data, error: upsertError } = await supabase
      .from("company_profiles")
      .upsert(payload, { onConflict: "company_id" })
      .select("id, custom_fields")
      .single();

    if (upsertError) {
      console.error("Failed to save analytics tools:", upsertError);
      setError(upsertError.message || "Failed to save");
      setSaving(false);
      return false;
    }

    setProfileId(data?.id || profileId);
    setCustomFields(
      data?.custom_fields && typeof data.custom_fields === "object"
        ? { ...data.custom_fields }
        : nextCustomFields
    );
    setTools(nextTools);
    setSaving(false);
    setSavedMessage("Saved");
    window.setTimeout(() => setSavedMessage(""), 2500);
    return true;
  };

  const handleSaveTool = async () => {
    if (openIndex == null || saving) return;

    const next = tools.map((tool, index) =>
      index === openIndex
        ? {
            name: draft.name.trim(),
            url: draft.url.trim(),
            status: normalizeStatus(draft.status),
            comments: draft.comments.trim(),
          }
        : tool
    );

    const ok = await persistTools(next);
    if (ok) closeModal();
  };

  const handleAddTool = async () => {
    if (saving) return;
    const next = [...tools, emptyTool()];
    const ok = await persistTools(next);
    if (ok) openTool(next.length - 1);
  };

  const handleDeleteTool = async () => {
    if (openIndex == null || saving) return;
    if (!window.confirm("Remove this analytics tool?")) return;
    const next = tools.filter((_, index) => index !== openIndex);
    const ok = await persistTools(next.length ? next : []);
    if (ok) closeModal();
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-xs text-foreground">
            {companyName || "Analytics"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Track analytics tools and connection status for this company.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedMessage ? (
            <span className="text-xs text-emerald-600">{savedMessage}</span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddTool}
            disabled={loading || saving}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>

      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
          {tools.map((tool, index) => (
            <PanelTrigger
              key={`${tool.name}-${index}`}
              title={tool.name || "(unnamed)"}
              filled={tool.status === "Wired"}
              onClick={() => openTool(index)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={openIndex != null}
        onOpenChange={(open) => {
          if (!open) closeModal();
        }}
      >
        <DialogContent className={PANEL_DIALOG_CLASS}>
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle>{draft.name.trim() || "Analytics Tool"}</DialogTitle>
            <DialogDescription>
              Name, dashboard URL, connection status, and notes.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="analytics-name">Name</Label>
              <Input
                id="analytics-name"
                value={draft.name}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Tool name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analytics-url">URL</Label>
              <Input
                id="analytics-url"
                value={draft.url}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, url: e.target.value }))
                }
                placeholder="https://"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analytics-status">Status</Label>
              <Select
                value={normalizeStatus(draft.status)}
                onValueChange={(value) =>
                  setDraft((prev) => ({ ...prev, status: value }))
                }
              >
                <SelectTrigger id="analytics-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="analytics-comments">Comments</Label>
              <Textarea
                id="analytics-comments"
                value={draft.comments}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, comments: e.target.value }))
                }
                placeholder="Notes, login details, account owner…"
                rows={5}
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4 sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteTool}
              disabled={saving}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={closeModal}>
                Close
              </Button>
              <Button type="button" onClick={handleSaveTool} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
