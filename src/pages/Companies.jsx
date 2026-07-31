import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[15px] text-foreground mb-1">Companies</h1>
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
        <ul className="space-y-2">
          {companies.map((company) => (
            <li key={company.id}>
              <Link
                to={`/company/${company.id}/company-data`}
                className="block w-full rounded-lg border border-border px-4 py-3 text-sm text-foreground transition-colors hover:bg-accent"
              >
                {company.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
