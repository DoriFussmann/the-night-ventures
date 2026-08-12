import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2, X } from "lucide-react";
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

const TASK_TABLE = "company_tasks";

const ITEM_TYPES = [
  { value: "product", label: "Product" },
  { value: "site", label: "Site" },
  { value: "digital_stores", label: "Digital Stores" },
  { value: "social_accounts", label: "Social Accounts" },
  { value: "business_development", label: "Business Development" },
];

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "wip", label: "WIP" },
  { value: "done", label: "Done" },
  { value: "rejected", label: "Rejected" },
];

const EMPTY_FORM = {
  item_type: "site",
  sub_type: "",
  item: "",
  task_details: "",
  owner: "",
  status: "open",
  additional_comments: "",
  links: "",
};

const TASK_SELECT =
  "id, company_id, item, item_type, sub_type, task_details, owner, status, additional_comments, links, sort_order, created_at";

function sortTasks(a, b) {
  const orderA = Number.isFinite(a.sort_order) ? a.sort_order : 0;
  const orderB = Number.isFinite(b.sort_order) ? b.sort_order : 0;
  if (orderA !== orderB) return orderA - orderB;
  return new Date(a.created_at) - new Date(b.created_at);
}

function nextSortOrder(rows) {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((row) => row.sort_order ?? 0)) + 1;
}

function itemTypeLabel(value) {
  return ITEM_TYPES.find((type) => type.value === value)?.label || value || "—";
}

function statusLabel(value) {
  return STATUSES.find((status) => status.value === value)?.label || value || "—";
}

function statusBadgeClass(status) {
  if (status === "done") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (status === "wip") {
    return "bg-orange-50 text-orange-700 border-orange-200";
  }
  if (status === "rejected") {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function parseLinks(value) {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

export default function Tasks() {
  const { companyId } = useParams();
  const [companyName, setCompanyName] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [companyResult, tasksResult] = await Promise.all([
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      supabase
        .from(TASK_TABLE)
        .select(TASK_SELECT)
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (companyResult.error) {
      console.error(companyResult.error);
      setError(companyResult.error.message || "Failed to load company");
    } else {
      setCompanyName(companyResult.data?.name || "");
    }

    if (tasksResult.error) {
      console.error(tasksResult.error);
      setError(tasksResult.error.message || "Failed to load tasks");
      setRows([]);
    } else {
      setRows((tasksResult.data || []).slice().sort(sortTasks));
    }

    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesType = typeFilter === "all" || row.item_type === typeFilter;
      const matchesSearch = !query || (row.item || "").toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [rows, searchQuery, typeFilter]);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      item_type: row.item_type || "site",
      sub_type: row.sub_type || "",
      item: row.item || "",
      task_details: row.task_details || "",
      owner: row.owner || "",
      status: row.status || "open",
      additional_comments: row.additional_comments || "",
      links: row.links || "",
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

    if (!ITEM_TYPES.some((type) => type.value === form.item_type)) {
      setError("Item type is required");
      return;
    }

    if (!STATUSES.some((status) => status.value === form.status)) {
      setError("Status is required");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      company_id: companyId,
      item,
      item_type: form.item_type,
      sub_type: form.sub_type.trim() || null,
      task_details: form.task_details.trim() || null,
      owner: form.owner.trim() || null,
      status: form.status,
      additional_comments: form.additional_comments.trim() || null,
      links: form.links.trim() || null,
    };

    if (!editingId) {
      payload.sort_order = nextSortOrder(rows);
    }

    const result = editingId
      ? await supabase
          .from(TASK_TABLE)
          .update(payload)
          .eq("id", editingId)
          .eq("company_id", companyId)
          .select(TASK_SELECT)
          .single()
      : await supabase.from(TASK_TABLE).insert(payload).select(TASK_SELECT).single();

    if (result.error) {
      console.error(result.error);
      setError(result.error.message || "Failed to save item");
      setSaving(false);
      return;
    }

    const saved = result.data;

    if (editingId) {
      setRows((prev) => prev.map((row) => (row.id === editingId ? saved : row)).sort(sortTasks));
    } else {
      setRows((prev) => [...prev, saved].sort(sortTasks));
    }

    setSaving(false);
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete "${row.item}"?`)) return;

    const { error: deleteError } = await supabase
      .from(TASK_TABLE)
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

  const handleMove = async (row, direction) => {
    if (reordering) return;

    const fromIndex = filteredRows.findIndex((item) => item.id === row.id);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= filteredRows.length) return;

    const movingId = filteredRows[fromIndex].id;
    const targetId = filteredRows[toIndex].id;
    const ordered = rows.slice().sort(sortTasks);
    const fromFull = ordered.findIndex((item) => item.id === movingId);
    const toFull = ordered.findIndex((item) => item.id === targetId);
    if (fromFull < 0 || toFull < 0) return;

    const next = [...ordered];
    const [moved] = next.splice(fromFull, 1);
    next.splice(toFull, 0, moved);

    const previousOrder = new Map(ordered.map((item) => [item.id, item.sort_order]));
    const reindexed = next.map((item, index) => ({ ...item, sort_order: index }));
    const changed = reindexed.filter((item) => item.sort_order !== previousOrder.get(item.id));
    if (changed.length === 0) return;

    setReordering(true);
    setError("");

    const results = await Promise.all(
      changed.map((item) =>
        supabase
          .from(TASK_TABLE)
          .update({ sort_order: item.sort_order })
          .eq("id", item.id)
          .eq("company_id", companyId)
      )
    );

    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error(failed.error);
      setError(failed.error.message || "Failed to reorder task");
      setReordering(false);
      return;
    }

    setRows(reindexed);
    setReordering(false);
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
              ? `Track tasks for ${companyName}.`
              : "Track tasks for this company."}
          </p>
        </div>
        <Button type="button" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          Add item
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by task name…"
            className="pl-8 h-9"
            disabled={rows.length === 0}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter} disabled={rows.length === 0}>
          <SelectTrigger className="w-full sm:w-[220px] h-9">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ITEM_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet. Add an item to get started.</p>
      ) : filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks match the current search or filter.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Item Type</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Sub Type</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Item</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Task Details</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Owner</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Additional Comments</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Links</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground w-[140px]">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRows.map((row, index) => {
                  const links = parseLinks(row.links);
                  return (
                    <tr key={row.id} className="hover:bg-accent/40">
                      <td className="px-4 py-3 align-top text-foreground/80">
                        {itemTypeLabel(row.item_type)}
                      </td>
                      <td className="px-4 py-3 align-top text-foreground/80">
                        {row.sub_type || "—"}
                      </td>
                      <td className="px-4 py-3 align-top font-medium text-foreground">
                        {row.item}
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground whitespace-pre-wrap max-w-[220px]">
                        {row.task_details || "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-foreground/80">
                        {row.owner || "—"}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                            row.status
                          )}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground whitespace-pre-wrap max-w-[220px]">
                        {row.additional_comments || "—"}
                      </td>
                      <td className="px-4 py-3 align-top max-w-[200px]">
                        {links.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {links.map((link) =>
                              isHttpUrl(link) ? (
                                <a
                                  key={link}
                                  href={link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-foreground/80 underline-offset-2 hover:underline break-all"
                                >
                                  {link}
                                </a>
                              ) : (
                                <span key={link} className="text-foreground/80 break-all">
                                  {link}
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleMove(row, -1)}
                            disabled={reordering || index === 0}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                            title="Move up"
                            aria-label="Move up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMove(row, 1)}
                            disabled={reordering || index === filteredRows.length - 1}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                            title="Move down"
                            aria-label="Move down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit item" : "Add item"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update this task." : "Add a new task."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-item-type">Item Type</Label>
              <Select
                value={form.item_type}
                onValueChange={(value) => setForm((prev) => ({ ...prev, item_type: value }))}
              >
                <SelectTrigger id="task-item-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-sub-type">Sub Type</Label>
              <Input
                id="task-sub-type"
                value={form.sub_type}
                onChange={(e) => setForm((prev) => ({ ...prev, sub_type: e.target.value }))}
              />
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
              <Label htmlFor="task-details">Task Details</Label>
              <Textarea
                id="task-details"
                value={form.task_details}
                onChange={(e) => setForm((prev) => ({ ...prev, task_details: e.target.value }))}
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
              <Select
                value={form.status}
                onValueChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
              >
                <SelectTrigger id="task-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-comments">Additional Comments</Label>
              <Textarea
                id="task-comments"
                value={form.additional_comments}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, additional_comments: e.target.value }))
                }
                className="min-h-[80px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-links">Links</Label>
              <Textarea
                id="task-links"
                value={form.links}
                onChange={(e) => setForm((prev) => ({ ...prev, links: e.target.value }))}
                className="min-h-[64px]"
                placeholder="One URL per line"
              />
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
