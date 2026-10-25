import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Pencil, Settings, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("companies")
      .select("id, name, created_at")
      .order("created_at", { ascending: true });

    if (fetchError) {
      console.error("Failed to load companies:", fetchError);
      setError(fetchError.message || "Failed to load companies");
      setCompanies([]);
    } else {
      setCompanies(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const handleAddCompany = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError("");
    const { error: insertError } = await supabase
      .from("companies")
      .insert({ name: trimmed });

    if (insertError) {
      console.error("Failed to add company:", insertError);
      setError(insertError.message || "Failed to add company");
      setSaving(false);
      return;
    }

    setName("");
    setShowForm(false);
    setSaving(false);
    await loadCompanies();
  };

  const startRename = (company) => {
    setEditingId(company.id);
    setEditName(company.name || "");
    setError("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleRename = async (e) => {
    e.preventDefault();
    const trimmed = editName.trim();
    const current = companies.find((company) => company.id === editingId);
    if (!current || renaming) return;
    if (!trimmed) {
      setError("A company name can't be empty.");
      return;
    }
    if (trimmed === current.name) {
      cancelRename();
      return;
    }

    setRenaming(true);
    setError("");
    const { error: updateError } = await supabase
      .from("companies")
      .update({ name: trimmed })
      .eq("id", editingId);

    if (updateError) {
      console.error("Failed to rename company:", updateError);
      setError(updateError.message || "Failed to rename company");
      setRenaming(false);
      return;
    }

    setCompanies((prev) =>
      prev.map((company) =>
        company.id === editingId ? { ...company, name: trimmed } : company
      )
    );
    window.dispatchEvent(new Event("company-renamed"));
    setRenaming(false);
    cancelRename();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xs text-foreground mb-1">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Choose a company to continue, or add a new one.
          </p>
        </div>
        <Button
          type="button"
          variant={showForm ? "outline" : "default"}
          onClick={() => setShowForm((open) => !open)}
        >
          {showForm ? "Cancel" : "Add Company"}
        </Button>
      </div>

      <Link
        to="/admin"
        className="mb-6 flex items-center gap-2.5 rounded-lg border border-border p-4 transition-colors hover:bg-muted/50"
      >
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="text-sm font-medium text-foreground">
          Workspace Admin
        </div>
      </Link>

      {showForm && (
        <form
          onSubmit={handleAddCompany}
          className="mb-6 space-y-3 rounded-lg border border-border p-4"
        >
          <div className="space-y-2">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              autoFocus
              required
            />
          </div>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Saving..." : "Create company"}
          </Button>
        </form>
      )}

      {error && (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading companies...</p>
      ) : companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No companies yet. Add one to get started.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {companies.map((company) => (
            <li key={company.id}>
              {editingId === company.id ? (
                <form onSubmit={handleRename} className="flex items-center gap-1.5">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelRename();
                    }}
                    aria-label={`New name for ${company.name}`}
                    className="h-9"
                    autoFocus
                    disabled={renaming}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="shrink-0"
                    disabled={renaming || !editName.trim()}
                    aria-label="Save name"
                  >
                    {renaming ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={cancelRename}
                    disabled={renaming}
                    aria-label="Cancel rename"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </form>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Link
                    to={`/company/${company.id}/company-data`}
                    className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-muted/50"
                  >
                    <span className="truncate">{company.name}</span>
                  </Link>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => startRename(company)}
                    disabled={editingId !== null}
                    aria-label={`Rename ${company.name}`}
                    title="Rename"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
