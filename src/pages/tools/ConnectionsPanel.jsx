import React, { useCallback, useEffect, useState } from "react";
import { Copy, Download, Plus, Trash2, Pencil, X } from "lucide-react";
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

/** Reserved key in company_profiles.custom_fields — preserved by Company Data saves. */
export const ANALYTICS_TOOLS_FIELD = "_analytics_tools";

const STATUS_OPTIONS = ["Not Connected", "WIP", "Wired"];

const STATUS_META = {
  Wired: { dot: "bg-emerald-500", label: "Wired" },
  WIP: { dot: "bg-orange-500", label: "WIP" },
  "Not Connected": { dot: "bg-slate-400", label: "Not Connected" },
};

const EMPTY_FORM = {
  name: "",
  url: "",
  status: "Not Connected",
  access_details: "",
  comments: "",
};

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
  return { ...EMPTY_FORM };
}

function normalizeStatus(value) {
  const status = String(value || "").trim();
  return STATUS_OPTIONS.includes(status) ? status : "Not Connected";
}

export function normalizeConnections(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return emptyTool();
    return {
      name: item.name == null ? "" : String(item.name),
      url: item.url == null ? "" : String(item.url),
      status: normalizeStatus(item.status),
      access_details:
        item.access_details == null ? "" : String(item.access_details),
      comments: item.comments == null ? "" : String(item.comments),
    };
  });
}

export function connectionsHaveContent(value) {
  return normalizeConnections(value).some((tool) => {
    if (normalizeStatus(tool.status) !== "Not Connected") return true;
    if (tool.access_details.trim()) return true;
    if (tool.comments.trim()) return true;
    return false;
  });
}

function isLooseHttpUrl(value) {
  const url = String(value || "").trim();
  if (!url) return true;
  return /^https?:\/\//i.test(url);
}

function statusBadgeClass(status) {
  const value = normalizeStatus(status);
  if (value === "Wired") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (value === "WIP") {
    return "bg-orange-50 text-orange-700 border-orange-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function statusDotClass(status) {
  return STATUS_META[normalizeStatus(status)]?.dot || "bg-slate-400";
}

async function copyText(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (err) {
    console.error("Copy failed:", err);
    return false;
  }
}

export function formatConnectionDetails(connection) {
  const lines = [`Name: ${connection.name || ""}`];
  if (connection.status) lines.push(`Status: ${connection.status}`);
  if (connection.url) lines.push(`URL: ${connection.url}`);
  if (connection.access_details) {
    lines.push(`Access Details: ${connection.access_details}`);
  }
  if (connection.comments) lines.push(`Comments: ${connection.comments}`);
  return lines.join("\n");
}

export function formatConnectionsMarkdown(connections) {
  const list = Array.isArray(connections) ? connections : [];
  return list
    .map((connection) => {
      const lines = [`- ${connection.name?.trim() || "(unnamed)"}`];
      if (connection.status?.trim()) {
        lines.push(`  - Status: ${connection.status.trim()}`);
      }
      if (connection.url?.trim()) lines.push(`  - URL: ${connection.url.trim()}`);
      if (connection.access_details?.trim()) {
        lines.push(`  - Access Details: ${connection.access_details.trim()}`);
      }
      if (connection.comments?.trim()) {
        lines.push(`  - Comments: ${connection.comments.trim()}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function slugifyFilename(name) {
  const base = String(name || "connection")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "connection";
}

function downloadConnectionDetails(connection) {
  const text = formatConnectionDetails(connection);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${slugifyFilename(connection.name)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function DetailRow({ label, value, copyable = false, mono = false }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </p>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm text-foreground break-all ${mono ? "font-mono" : ""}`}>
          {value}
        </p>
        {copyable && (
          <button
            type="button"
            onClick={() => copyText(value)}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
            title="Copy"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function ConnectionsPanel({ companyId, onConnectionsChange }) {
  const [connections, setConnections] = useState([]);
  const [profileId, setProfileId] = useState(null);
  const [customFields, setCustomFields] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [selectedIndex, setSelectedIndex] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const selected =
    selectedIndex == null ? null : connections[selectedIndex] || null;

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const profileResult = await supabase
      .from("company_profiles")
      .select("id, custom_fields")
      .eq("company_id", companyId)
      .maybeSingle();

    if (profileResult.error) {
      console.error("Failed to load connections:", profileResult.error);
      setError(profileResult.error.message || "Failed to load connections");
      setProfileId(null);
      setCustomFields({});
      const next = normalizeConnections(DEFAULT_TOOLS);
      setConnections(next);
      onConnectionsChange?.(next, { persistIntoProfile: false });
    } else if (profileResult.data) {
      const fields =
        profileResult.data.custom_fields &&
        typeof profileResult.data.custom_fields === "object"
          ? { ...profileResult.data.custom_fields }
          : {};
      setProfileId(profileResult.data.id);
      setCustomFields(fields);
      const hasSaved = Object.prototype.hasOwnProperty.call(
        fields,
        ANALYTICS_TOOLS_FIELD
      );
      const next = hasSaved
        ? normalizeConnections(fields[ANALYTICS_TOOLS_FIELD])
        : normalizeConnections(DEFAULT_TOOLS);
      setConnections(next);
      onConnectionsChange?.(next, { persistIntoProfile: hasSaved });
    } else {
      setProfileId(null);
      setCustomFields({});
      const next = normalizeConnections(DEFAULT_TOOLS);
      setConnections(next);
      onConnectionsChange?.(next, { persistIntoProfile: false });
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const persistConnections = async (nextConnections) => {
    if (!companyId) return false;

    setSaving(true);
    setError("");

    for (const tool of nextConnections) {
      if (!isLooseHttpUrl(tool.url)) {
        setError("Tool URLs must start with http:// or https://");
        setSaving(false);
        return false;
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from("company_profiles")
      .select("id, custom_fields")
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError) {
      console.error("Failed to load company profile:", existingError);
      setError(existingError.message || "Failed to save");
      setSaving(false);
      return false;
    }

    const currentFields =
      existing?.custom_fields && typeof existing.custom_fields === "object"
        ? { ...existing.custom_fields }
        : { ...customFields };
    const nextCustomFields = {
      ...currentFields,
      [ANALYTICS_TOOLS_FIELD]: nextConnections,
    };

    const payload = {
      company_id: companyId,
      custom_fields: nextCustomFields,
      updated_at: new Date().toISOString(),
    };
    if (existing?.id || profileId) payload.id = existing?.id || profileId;

    const { data, error: upsertError } = await supabase
      .from("company_profiles")
      .upsert(payload, { onConflict: "company_id" })
      .select("id, custom_fields")
      .single();

    if (upsertError) {
      console.error("Failed to save connections:", upsertError);
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
    setConnections(nextConnections);
    onConnectionsChange?.(nextConnections, { persistIntoProfile: true });
    setSaving(false);
    return true;
  };

  const openAdd = () => {
    setEditingIndex(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (index) => {
    const connection = connections[index];
    if (!connection) return;
    setEditingIndex(index);
    setForm({
      name: connection.name || "",
      url: connection.url || "",
      status: normalizeStatus(connection.status),
      access_details: connection.access_details || "",
      comments: connection.comments || "",
    });
    setSelectedIndex(null);
    setFormOpen(true);
  };

  const handleSaveConnection = async (e) => {
    e.preventDefault();
    if (!companyId || saving) return;

    const name = form.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }

    const nextRow = {
      name,
      url: form.url.trim(),
      status: normalizeStatus(form.status),
      access_details: form.access_details.trim(),
      comments: form.comments.trim(),
    };

    const nextConnections =
      editingIndex == null
        ? [...connections, nextRow]
        : connections.map((connection, index) =>
            index === editingIndex ? nextRow : connection
          );

    const ok = await persistConnections(nextConnections);
    if (!ok) return;

    setFormOpen(false);
    setEditingIndex(null);
    setForm(EMPTY_FORM);
  };

  const handleDeleteConnection = async (index) => {
    const connection = connections[index];
    if (!connection) return;
    if (!window.confirm(`Delete "${connection.name || "this connection"}"?`)) return;

    const nextConnections = connections.filter((_, itemIndex) => itemIndex !== index);
    const ok = await persistConnections(nextConnections);
    if (!ok) return;
    setSelectedIndex(null);
  };

  const flashAction = (message) => {
    setActionMessage(message);
    window.setTimeout(() => setActionMessage(""), 2000);
  };

  const handleCopyAll = async (connection) => {
    const ok = await copyText(formatConnectionDetails(connection));
    flashAction(ok ? "Copied" : "Copy failed");
  };

  const handleDownload = (connection) => {
    try {
      downloadConnectionDetails(connection);
      flashAction("Downloaded");
    } catch (err) {
      console.error("Download failed:", err);
      flashAction("Download failed");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading Connections...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Analytics, SEO, and tracking tools connected for this company.
        </p>
        <Button type="button" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          Add connection
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {connections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          No connections yet.
        </div>
      ) : (
        <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden bg-card">
          {connections.map((connection, index) => (
            <li key={`${connection.name}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  setActionMessage("");
                  setSelectedIndex(index);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-accent/60 transition-colors flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(
                      connection.status
                    )}`}
                  />
                  <span className="text-sm font-medium text-foreground truncate">
                    {connection.name || "(unnamed)"}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                    connection.status
                  )}`}
                >
                  {normalizeStatus(connection.status)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Detail modal */}
      <Dialog
        open={selected != null}
        onOpenChange={(open) => !open && setSelectedIndex(null)}
      >
        <DialogContent className="max-w-md z-[60]">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${statusDotClass(selected.status)}`}
                  />
                  {selected.name || "(unnamed)"}
                </DialogTitle>
                <DialogDescription>
                  {normalizeStatus(selected.status)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <span
                  className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                    selected.status
                  )}`}
                >
                  {normalizeStatus(selected.status)}
                </span>
                <DetailRow label="URL" value={selected.url} copyable />
                <DetailRow
                  label="Access Details"
                  value={selected.access_details}
                  copyable
                  mono
                />
                <DetailRow label="Comments" value={selected.comments} />
              </div>

              <DialogFooter className="flex-col gap-3 sm:flex-col sm:space-x-0">
                <div className="flex flex-wrap items-center gap-2 w-full">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleCopyAll(selected)}
                  >
                    <Copy className="w-4 h-4" />
                    Copy all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleDownload(selected)}
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                  {actionMessage ? (
                    <span className="text-sm text-muted-foreground">{actionMessage}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 w-full">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openEdit(selectedIndex)}
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => handleDeleteConnection(selectedIndex)}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add / Edit modal */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto z-[60]">
          <DialogHeader>
            <DialogTitle>
              {editingIndex != null ? "Edit connection" : "Add connection"}
            </DialogTitle>
            <DialogDescription>
              {editingIndex != null
                ? "Update this tool’s details."
                : "Create a new analytics or SEO connection for this company."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveConnection} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="connection-name">Name</Label>
              <Input
                id="connection-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connection-url">URL</Label>
              <Input
                id="connection-url"
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="https://"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connection-status">Status</Label>
              <select
                id="connection-status"
                value={normalizeStatus(form.status)}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, status: e.target.value }))
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="connection-access">Access Details</Label>
              <Input
                id="connection-access"
                value={form.access_details}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, access_details: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connection-comments">Comments</Label>
              <Textarea
                id="connection-comments"
                value={form.comments}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, comments: e.target.value }))
                }
                className="min-h-[80px]"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                <X className="w-4 h-4" />
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingIndex != null
                    ? "Save changes"
                    : "Add connection"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
