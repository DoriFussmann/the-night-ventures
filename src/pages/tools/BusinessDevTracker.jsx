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

const EMPTY_FORM = {
  item: "",
  comments: "",
  owner: "",
  status: "",
};

export default function BusinessDevTracker() {
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, rowsResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from("business_dev_initiatives")
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

    if (rowsResult.error) {
      console.error(rowsResult.error);
      setError(rowsResult.error.message || "Failed to load initiatives");
      setRows([]);
    } else {
      setRows(rowsResult.data || []);
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
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

    setSaving(true);
    setError("");

    const payload = {
      company_id: companyId,
      item,
      comments: form.comments.trim() || null,
      owner: form.owner.trim() || null,
      status: form.status.trim() || null,
    };

    let result;
    if (editingId) {
      result = await supabase
        .from("business_dev_initiatives")
        .update(payload)
        .eq("id", editingId)
        .eq("company_id", companyId)
        .select()
        .single();
    } else {
      result = await supabase
        .from("business_dev_initiatives")
        .insert(payload)
        .select()
        .single();
    }

    if (result.error) {
      console.error(result.error);
      setError(result.error.message || "Failed to save item");
      setSaving(false);
      return;
    }

    if (editingId) {
      setRows((prev) => prev.map((row) => (row.id === editingId ? result.data : row)));
    } else {
      setRows((prev) => [...prev, result.data]);
    }

    setSaving(false);
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete "${row.item}"?`)) return;

    const { error: deleteError } = await supabase
      .from("business_dev_initiatives")
      .delete()
      .eq("id", row.id)
      .eq("company_id", companyId);

    if (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || "Failed to delete item");
      return;
    }

    setRows((prev) => prev.filter((item) => item.id !== row.id));
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading tracker...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[15px] text-foreground mb-1">Business Development Initiatives</h1>
          <p className="text-sm text-muted-foreground">
            {companyName
              ? `Track initiatives for ${companyName}.`
              : "Track initiatives for this company."}
          </p>
        </div>
        <Button type="button" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          Add item
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          No initiatives yet. Add an item to get started.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
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
                <tr key={row.id} className="hover:bg-accent/40">
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
            <DialogTitle>{editingId ? "Edit item" : "Add item"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update this initiative."
                : "Add a new business development initiative."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bd-item">Item</Label>
              <Input
                id="bd-item"
                value={form.item}
                onChange={(e) => setForm((prev) => ({ ...prev, item: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bd-comments">Comments</Label>
              <Textarea
                id="bd-comments"
                value={form.comments}
                onChange={(e) => setForm((prev) => ({ ...prev, comments: e.target.value }))}
                className="min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bd-owner">Owner</Label>
              <Input
                id="bd-owner"
                value={form.owner}
                onChange={(e) => setForm((prev) => ({ ...prev, owner: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bd-status">Status</Label>
              <Input
                id="bd-status"
                list="bd-status-suggestions"
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                placeholder="Not started, In progress, Done..."
              />
              <datalist id="bd-status-suggestions">
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
                {saving ? "Saving..." : editingId ? "Save changes" : "Add item"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
