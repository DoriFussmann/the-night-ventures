import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Pencil, Plus, Trash2, X } from "lucide-react";
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

const STATUS_SUGGESTIONS = ["Not started", "In progress", "Done"];

const TASK_TYPES = {
  site: {
    label: "Site",
    table: "website_build_tasks",
  },
  biz_dev: {
    label: "Biz Dev",
    table: "business_dev_initiatives",
  },
};

const EMPTY_FORM = {
  type: "site",
  item: "",
  comments: "",
  owner: "",
  status: "",
};

function rowKey(row) {
  return `${row.type}:${row.id}`;
}

export default function Tasks() {
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, siteResult, bizResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from(TASK_TYPES.site.table)
        .select("id, company_id, item, comments, owner, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true }),
      supabase
        .from(TASK_TYPES.biz_dev.table)
        .select("id, company_id, item, comments, owner, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true }),
    ]);

    if (companyResult.error) {
      console.error(companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
    } else {
      setCompanyName(companyResult.data?.name || "");
    }

    if (siteResult.error || bizResult.error) {
      const loadError = siteResult.error || bizResult.error;
      console.error(loadError);
      setError(loadError.message || "Failed to load tasks");
      setRows([]);
    } else {
      const combined = [
        ...(siteResult.data || []).map((row) => ({ ...row, type: "site" })),
        ...(bizResult.data || []).map((row) => ({ ...row, type: "biz_dev" })),
      ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      setRows(combined);
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openAdd = () => {
    setEditingKey(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setEditingKey(rowKey(row));
    setForm({
      type: row.type,
      item: row.item || "",
      comments: row.comments || "",
      owner: row.owner || "",
      status: row.status || "",
    });
    setFormOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!companyId || saving) return;

    const item = form.item.trim();
    if (!item) {
      setError("Item is required");
      return;
    }

    if (!TASK_TYPES[form.type]) {
      setError("Type is required");
      return;
    }

    setSaving(true);
    setError("");

    const table = TASK_TYPES[form.type].table;
    const payload = {
      company_id: companyId,
      item,
      comments: form.comments.trim() || null,
      owner: form.owner.trim() || null,
      status: form.status.trim() || null,
    };

    const editingRow = editingKey
      ? rows.find((row) => rowKey(row) === editingKey)
      : null;

    let result;
    if (editingRow) {
      // Type change: delete from old table, insert into new.
      if (editingRow.type !== form.type) {
        const { error: deleteError } = await supabase
          .from(TASK_TYPES[editingRow.type].table)
          .delete()
          .eq("id", editingRow.id)
          .eq("company_id", companyId);

        if (deleteError) {
          console.error(deleteError);
          setError(deleteError.message || "Failed to move task");
          setSaving(false);
          return;
        }

        result = await supabase.from(table).insert(payload).select().single();
      } else {
        result = await supabase
          .from(table)
          .update(payload)
          .eq("id", editingRow.id)
          .eq("company_id", companyId)
          .select()
          .single();
      }
    } else {
      result = await supabase.from(table).insert(payload).select().single();
    }

    if (result.error) {
      console.error(result.error);
      setError(result.error.message || "Failed to save item");
      setSaving(false);
      return;
    }

    const saved = { ...result.data, type: form.type };

    if (editingKey) {
      setRows((prev) => {
        const next = prev.map((row) => (rowKey(row) === editingKey ? saved : row));
        return next.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      });
    } else {
      setRows((prev) => [...prev, saved]);
    }

    setSaving(false);
    setFormOpen(false);
    setEditingKey(null);
    setForm(EMPTY_FORM);
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete "${row.item}"?`)) return;

    const { error: deleteError } = await supabase
      .from(TASK_TYPES[row.type].table)
      .delete()
      .eq("id", row.id)
      .eq("company_id", companyId);

    if (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || "Failed to delete item");
      return;
    }

    setRows((prev) => prev.filter((item) => rowKey(item) !== rowKey(row)));
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading tasks...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xs text-foreground mb-1">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {companyName
              ? `Track site and biz dev tasks for ${companyName}.`
              : "Track site and biz dev tasks for this company."}
          </p>
        </div>
        <Button type="button" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          Add item
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Item</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Comments</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Owner</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground w-[100px]">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={rowKey(row)} className="hover:bg-accent/40">
                  <td className="px-4 py-3 align-top text-foreground/80">
                    {TASK_TYPES[row.type]?.label || row.type}
                  </td>
                  <td className="px-4 py-3 align-top font-medium text-foreground">{row.item}</td>
                  <td className="px-4 py-3 align-top text-muted-foreground whitespace-pre-wrap">
                    {row.comments || "—"}
                  </td>
                  <td className="px-4 py-3 align-top text-foreground/80">{row.owner || "—"}</td>
                  <td className="px-4 py-3 align-top text-foreground/80">{row.status || "—"}</td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingKey ? "Edit item" : "Add item"}</DialogTitle>
            <DialogDescription>
              {editingKey ? "Update this task." : "Add a new task."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-type">Type</Label>
              <select
                id="task-type"
                value={form.type}
                onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                required
              >
                {Object.entries(TASK_TYPES).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-item">Item</Label>
              <Input
                id="task-item"
                value={form.item}
                onChange={(e) => setForm((prev) => ({ ...prev, item: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-comments">Comments</Label>
              <Textarea
                id="task-comments"
                value={form.comments}
                onChange={(e) => setForm((prev) => ({ ...prev, comments: e.target.value }))}
                className="min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-owner">Owner</Label>
              <Input
                id="task-owner"
                value={form.owner}
                onChange={(e) => setForm((prev) => ({ ...prev, owner: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-status">Status</Label>
              <Input
                id="task-status"
                list="task-status-suggestions"
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                placeholder="Not started, In progress, Done..."
              />
              <datalist id="task-status-suggestions">
                {STATUS_SUGGESTIONS.map((status) => (
                  <option key={status} value={status} />
                ))}
              </datalist>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                <X className="w-4 h-4" />
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingKey ? "Save changes" : "Add item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
