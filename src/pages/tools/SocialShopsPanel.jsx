import React, { useCallback, useEffect, useMemo, useState } from "react";
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

const TYPES = ["Social Media", "Digital Store", "Other"];

const TYPE_META = {
  "Social Media": { dot: "bg-orange-500", label: "Social Media" },
  "Digital Store": { dot: "bg-emerald-500", label: "Digital Store" },
  Other: { dot: "bg-slate-400", label: "Other" },
};

const STATUS_SUGGESTIONS = ["Done", "Under Review", "Not started"];

const EMPTY_FORM = {
  name: "",
  type: "Social Media",
  status: "",
  url: "",
  username: "",
  access_details: "",
  comments: "",
};

function statusBadgeClass(status) {
  const value = (status || "").toLowerCase();
  if (value === "done") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (value === "under review") {
    return "bg-orange-50 text-orange-700 border-orange-200";
  }
  if (value === "not started") {
    return "bg-slate-100 text-slate-600 border-slate-200";
  }
  return "bg-muted text-muted-foreground border-border";
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

function formatAccountDetails(account) {
  const lines = [
    `Name: ${account.name || ""}`,
    `Type: ${account.type || ""}`,
  ];
  if (account.status) lines.push(`Status: ${account.status}`);
  if (account.url) lines.push(`URL: ${account.url}`);
  if (account.username) lines.push(`Username: ${account.username}`);
  if (account.access_details) lines.push(`Access Details: ${account.access_details}`);
  if (account.comments) lines.push(`Comments: ${account.comments}`);
  return lines.join("\n");
}

function slugifyFilename(name) {
  const base = String(name || "account")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "account";
}

function downloadAccountDetails(account) {
  const text = formatAccountDetails(account);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${slugifyFilename(account.name)}.txt`;
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

export default function SocialShopsPanel({ companyId, onAccountsChange }) {
  const [accounts, setAccounts] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [accountsResult, notesResult] = await Promise.all([
      supabase
        .from("social_accounts")
        .select(
          "id, company_id, name, type, url, username, access_details, status, comments, created_at"
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: true }),
      supabase
        .from("social_notes")
        .select("id, company_id, text, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
    ]);

    if (accountsResult.error) {
      console.error(accountsResult.error);
      setError(accountsResult.error.message || "Failed to load accounts");
      setAccounts([]);
      onAccountsChange?.([]);
    } else {
      const next = accountsResult.data || [];
      setAccounts(next);
      onAccountsChange?.(next);
    }

    if (notesResult.error) {
      console.error(notesResult.error);
      setError(notesResult.error.message || "Failed to load notes");
      setNotes([]);
    } else {
      setNotes(notesResult.data || []);
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const grouped = useMemo(() => {
    return TYPES.map((type) => ({
      type,
      meta: TYPE_META[type],
      items: accounts.filter((account) => account.type === type),
    }));
  }, [accounts]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (account) => {
    setEditingId(account.id);
    setForm({
      name: account.name || "",
      type: account.type || "Other",
      status: account.status || "",
      url: account.url || "",
      username: account.username || "",
      access_details: account.access_details || "",
      comments: account.comments || "",
    });
    setSelected(null);
    setFormOpen(true);
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    if (!companyId || saving) return;

    const name = form.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      company_id: companyId,
      name,
      type: form.type || "Other",
      status: form.status.trim() || null,
      url: form.url.trim() || null,
      username: form.username.trim() || null,
      access_details: form.access_details.trim() || null,
      comments: form.comments.trim() || null,
    };

    let result;
    if (editingId) {
      result = await supabase
        .from("social_accounts")
        .update(payload)
        .eq("id", editingId)
        .eq("company_id", companyId)
        .select()
        .single();
    } else {
      result = await supabase.from("social_accounts").insert(payload).select().single();
    }

    if (result.error) {
      console.error(result.error);
      setError(result.error.message || "Failed to save account");
      setSaving(false);
      return;
    }

    let nextAccounts;
    if (editingId) {
      nextAccounts = accounts.map((account) =>
        account.id === editingId ? result.data : account
      );
    } else {
      nextAccounts = [...accounts, result.data];
    }
    setAccounts(nextAccounts);
    onAccountsChange?.(nextAccounts);

    setSaving(false);
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleDeleteAccount = async (account) => {
    if (!window.confirm(`Delete "${account.name}"?`)) return;

    const { error: deleteError } = await supabase
      .from("social_accounts")
      .delete()
      .eq("id", account.id)
      .eq("company_id", companyId);

    if (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || "Failed to delete account");
      return;
    }

    const nextAccounts = accounts.filter((item) => item.id !== account.id);
    setAccounts(nextAccounts);
    onAccountsChange?.(nextAccounts);
    setSelected(null);
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    const text = noteText.trim();
    if (!text || !companyId || savingNote) return;

    setSavingNote(true);
    setError("");

    const { data, error: insertError } = await supabase
      .from("social_notes")
      .insert({ company_id: companyId, text })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      setError(insertError.message || "Failed to add note");
      setSavingNote(false);
      return;
    }

    setNotes((prev) => [data, ...prev]);
    setNoteText("");
    setSavingNote(false);
  };

  const handleDeleteNote = async (note) => {
    const { error: deleteError } = await supabase
      .from("social_notes")
      .delete()
      .eq("id", note.id)
      .eq("company_id", companyId);

    if (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || "Failed to delete note");
      return;
    }

    setNotes((prev) => prev.filter((item) => item.id !== note.id));
  };

  const flashAction = (message) => {
    setActionMessage(message);
    window.setTimeout(() => setActionMessage(""), 2000);
  };

  const handleCopyAll = async (account) => {
    const ok = await copyText(formatAccountDetails(account));
    flashAction(ok ? "Copied" : "Copy failed");
  };

  const handleDownload = (account) => {
    try {
      downloadAccountDetails(account);
      flashAction("Downloaded");
    } catch (err) {
      console.error("Download failed:", err);
      flashAction("Download failed");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading Social & Shops...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Social media, digital stores, and access details for this company.
        </p>
        <Button type="button" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          Add account
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-6">
        {grouped.map(({ type, meta, items }) => (
          <section key={type} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {meta.label}
              </h2>
              <span className="text-xs text-muted-foreground/70">({items.length})</span>
            </div>

            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                No {meta.label.toLowerCase()} accounts yet.
              </div>
            ) : (
              <ul className="rounded-lg border border-border divide-y divide-border overflow-hidden bg-card">
                {items.map((account) => (
                  <li key={account.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMessage("");
                        setSelected(account);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-accent/60 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                        <span className="text-sm font-medium text-foreground truncate">
                          {account.name}
                        </span>
                      </div>
                      {account.status ? (
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                            account.status
                          )}`}
                        >
                          {account.status}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <section className="space-y-3 pt-2 border-t border-border">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground pt-4">
          Notes
        </h2>

        <form onSubmit={handleAddNote} className="flex gap-2">
          <Input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note..."
          />
          <Button type="submit" variant="outline" disabled={savingNote || !noteText.trim()}>
            Add
          </Button>
        </form>

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li
                key={note.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm text-foreground whitespace-pre-wrap">{note.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteNote(note)}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent"
                  title="Delete note"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Detail modal */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-md z-[60]">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      TYPE_META[selected.type]?.dot || "bg-slate-400"
                    }`}
                  />
                  {selected.name}
                </DialogTitle>
                <DialogDescription>{selected.type}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {selected.status && (
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                      selected.status
                    )}`}
                  >
                    {selected.status}
                  </span>
                )}
                <DetailRow label="URL" value={selected.url} copyable />
                <DetailRow label="Username" value={selected.username} copyable />
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
                    onClick={() => openEdit(selected)}
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => handleDeleteAccount(selected)}
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
            <DialogTitle>{editingId ? "Edit account" : "Add account"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update this account’s details."
                : "Create a new social or shop account for this company."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveAccount} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-type">Type</Label>
              <select
                id="account-type"
                value={form.type}
                onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-status">Status</Label>
              <Input
                id="account-status"
                list="status-suggestions"
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                placeholder="Done, Under Review, Not started..."
              />
              <datalist id="status-suggestions">
                {STATUS_SUGGESTIONS.map((status) => (
                  <option key={status} value={status} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-url">URL</Label>
              <Input
                id="account-url"
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="https://"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-username">Username</Label>
              <Input
                id="account-username"
                value={form.username}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, username: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-access">Access Details</Label>
              <Input
                id="account-access"
                value={form.access_details}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, access_details: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account-comments">Comments</Label>
              <Textarea
                id="account-comments"
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
                {saving ? "Saving..." : editingId ? "Save changes" : "Add account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
