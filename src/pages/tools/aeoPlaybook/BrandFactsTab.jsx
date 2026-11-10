import React, { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BRAND_SECTIONS, FIT_FIELDS, savePlaybook } from "./api";

const linesToList = (text) =>
  String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

function Section({ title, helper, children, badge }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {helper ? <p className="mt-0.5 text-xs text-muted-foreground">{helper}</p> : null}
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

export default function BrandFactsTab({ companyId, playbook, onSaved }) {
  const [facts, setFacts] = useState(playbook.brand_facts);
  const [claims, setClaims] = useState({ approved: "", never: "", out: "", open: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setFacts(playbook.brand_facts);
    setClaims({
      approved: (playbook.brand_facts.approved_claims || []).join("\n"),
      never: (playbook.brand_facts.never_claims || []).join("\n"),
      out: (playbook.brand_facts.out_of_scope || []).join("\n"),
      open: (playbook.brand_facts.open_items || []).join("\n"),
    });
  }, [playbook]);

  const set = (key, value) => setFacts((prev) => ({ ...prev, [key]: value }));
  const setListRow = (key, index, patch) =>
    setFacts((prev) => ({
      ...prev,
      [key]: prev[key].map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  const addListRow = (key, row) => setFacts((prev) => ({ ...prev, [key]: [...(prev[key] || []), row] }));
  const removeListRow = (key, index) =>
    setFacts((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await savePlaybook(companyId, {
        brand_facts: {
          ...facts,
          approved_claims: linesToList(claims.approved),
          never_claims: linesToList(claims.never),
          out_of_scope: linesToList(claims.out),
          open_items: linesToList(claims.open),
        },
      });
      setMessage("Saved.");
      onSaved?.();
    } catch (err) {
      setMessage(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <Section
        title="Live wording (frozen)"
        helper="The exact descriptions the live site shows today. A record, not an editor for the site: change a row only when the site itself changes."
        badge={<span className="text-[10px] uppercase tracking-wider text-amber-700">Frozen on the site</span>}
      >
        <div className="space-y-2">
          {(facts.live_wording || []).map((row, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
              <Input value={row.where || ""} placeholder="Where it appears" onChange={(e) => setListRow("live_wording", i, { where: e.target.value })} />
              <Textarea rows={2} value={row.text || ""} placeholder="Exact wording" onChange={(e) => setListRow("live_wording", i, { text: e.target.value })} />
              <Button type="button" variant="ghost" size="sm" aria-label="Remove row" onClick={() => removeListRow("live_wording", i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => addListRow("live_wording", { where: "", text: "" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add live wording
          </Button>
        </div>
      </Section>

      {BRAND_SECTIONS.map((s) => (
        <Section key={s.key} title={s.label} helper={s.helper}>
          {s.key === "conversion" ? (
            <div className="mb-2 grid gap-2 md:grid-cols-[1fr_2fr]">
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Call to action</p>
                <Input
                  value={facts.conversion_action || ""}
                  placeholder="Book a call."
                  onChange={(e) => set("conversion_action", e.target.value)}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Conversion page URL (every article links here once)</p>
                <Input
                  value={facts.conversion_url || ""}
                  placeholder="https://www.example.com/book-call/"
                  onChange={(e) => set("conversion_url", e.target.value)}
                />
              </div>
            </div>
          ) : null}
          <Textarea rows={6} value={facts[s.key] || ""} onChange={(e) => set(s.key, e.target.value)} />
        </Section>
      ))}

      <Section
        title="Customer fit and timing"
        helper="Who qualifies as a customer and when they buy. The ICP and personas are built from these."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {FIT_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-xs font-medium text-foreground">{f.label}</span>
              <Textarea rows={3} value={facts[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
              <span className="mt-1 block text-xs text-muted-foreground">{f.hint}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Claims and scope" helper="One per line. Writers use the approved list as written, never use the second, and never write about the third.">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Approved (use as written)</p>
            <Textarea rows={8} value={claims.approved} onChange={(e) => setClaims((c) => ({ ...c, approved: e.target.value }))} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Never claim</p>
            <Textarea rows={8} value={claims.never} onChange={(e) => setClaims((c) => ({ ...c, never: e.target.value }))} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">Out of scope topics</p>
            <Textarea rows={8} value={claims.out} onChange={(e) => setClaims((c) => ({ ...c, out: e.target.value }))} />
          </div>
        </div>
      </Section>

      <Section title="Competitors" helper="What each is, how it charges, and which category it competes in.">
        <div className="space-y-2">
          {(facts.competitors || []).map((row, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-border p-2 md:grid-cols-[160px_1fr_1fr_auto]">
              <div className="space-y-2">
                <Input value={row.name || ""} placeholder="Name" onChange={(e) => setListRow("competitors", i, { name: e.target.value })} />
                <Input value={row.url || ""} placeholder="URL" onChange={(e) => setListRow("competitors", i, { url: e.target.value })} />
              </div>
              <Textarea rows={3} value={row.what || ""} placeholder="What it is" onChange={(e) => setListRow("competitors", i, { what: e.target.value })} />
              <div className="space-y-2">
                <Input value={row.charges || ""} placeholder="How it charges" onChange={(e) => setListRow("competitors", i, { charges: e.target.value })} />
                <Input value={row.category || ""} placeholder="Category vs us" onChange={(e) => setListRow("competitors", i, { category: e.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label="Remove competitor" onClick={() => removeListRow("competitors", i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => addListRow("competitors", { name: "", url: "", what: "", charges: "", category: "" })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add competitor
          </Button>
        </div>
      </Section>

      <Section title="Open items" helper="One per line: facts still to confirm.">
        <Textarea rows={4} value={claims.open} onChange={(e) => setClaims((c) => ({ ...c, open: e.target.value }))} />
      </Section>

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-background py-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save Brand Facts
        </Button>
        {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
      </div>
    </div>
  );
}
