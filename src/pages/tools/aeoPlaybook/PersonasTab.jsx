import React, { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteRow, nextCode, savePlaybook, updateRow, upsertRow } from "./api";
import BuilderDocuments from "./BuilderDocuments";

const FIELDS = [
  { key: "stage", label: "Stage", rows: 1 },
  { key: "trigger", label: "Trigger: the moment that starts the search", rows: 2 },
  { key: "need", label: "Need: the job they want done", rows: 2 },
  { key: "pains", label: "Pains and objections", rows: 3 },
  { key: "decision_criteria", label: "Decision criteria", rows: 3 },
  { key: "alternatives", label: "Alternatives they weigh", rows: 2 },
  { key: "their_words", label: "Their words (real queries)", rows: 3 },
  { key: "where_they_listen", label: "Where they listen", rows: 2 },
  { key: "main_tiers", label: "Main intent tiers", rows: 1 },
];

function PersonaCard({ persona, onSaved, onDelete }) {
  const [draft, setDraft] = useState(persona);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => setDraft(persona), [persona]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(persona);

  const save = async () => {
    setSaving(true);
    setNote("");
    try {
      const { id, company_id: _c, created_at: _a, updated_at: _b, ...patch } = draft;
      await updateRow("aeo_personas", id, patch);
      onSaved?.();
    } catch (err) {
      setNote(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-2 text-[11px] tabular-nums text-muted-foreground">{draft.code}</span>
        <div className="flex-1 space-y-2">
          <Input value={draft.name} placeholder="Persona name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Textarea rows={2} value={draft.summary} placeholder="One-line description" onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
        </div>
        <Button type="button" variant="ghost" size="sm" aria-label="Delete persona" onClick={() => onDelete(persona)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">{f.label}</span>
            {f.rows === 1 ? (
              <Input value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            ) : (
              <Textarea rows={f.rows} value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save persona
        </Button>
        {note ? <span className="text-xs text-destructive">{note}</span> : null}
      </div>
    </div>
  );
}

export default function PersonasTab({ companyId, playbook, personas, onChanged }) {
  const [icp, setIcp] = useState(playbook.icp);
  const [traits, setTraits] = useState((playbook.shared_traits || []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setIcp(playbook.icp);
    setTraits((playbook.shared_traits || []).join("\n"));
  }, [playbook]);

  const saveIcp = async () => {
    setSaving(true);
    setMessage("");
    try {
      await savePlaybook(companyId, {
        icp,
        shared_traits: traits.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      setMessage("Saved.");
      onChanged?.();
    } catch (err) {
      setMessage(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addPersona = async () => {
    try {
      await upsertRow("aeo_personas", { company_id: companyId, code: nextCode(personas, "P", 1), name: "New persona", sort: personas.length });
      onChanged?.();
    } catch (err) {
      setMessage(err?.message || "Could not add a persona");
    }
  };

  const removePersona = async (persona) => {
    if (!window.confirm(`Delete persona "${persona.name}"? Its prompts stay, without a persona.`)) return;
    try {
      await deleteRow("aeo_personas", persona.id);
      onChanged?.();
    } catch (err) {
      setMessage(err?.message || "Could not delete");
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">ICP</h2>
        <p className="mb-2 mt-0.5 text-xs text-muted-foreground">One paragraph: who the ideal customer is.</p>
        <Textarea rows={4} value={icp} onChange={(e) => setIcp(e.target.value)} />
        <h3 className="mb-1 mt-4 text-xs font-medium text-foreground">Shared by all personas (one per line)</h3>
        <Textarea rows={4} value={traits} onChange={(e) => setTraits(e.target.value)} />
        <div className="mt-3 flex items-center gap-3">
          <Button type="button" size="sm" onClick={saveIcp} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save ICP
          </Button>
          {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
        </div>
      </section>

      <BuilderDocuments playbook={playbook} />

      {personas.map((p) => (
        <PersonaCard key={p.id} persona={p} onSaved={onChanged} onDelete={removePersona} />
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addPersona}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add persona
      </Button>
    </div>
  );
}
