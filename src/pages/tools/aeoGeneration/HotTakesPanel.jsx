import React, { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TAKE_KINDS, groupByTopic, parseImport } from "../../../../lib/aeo/hotTakesBank.js";
import { addHotTake, deleteHotTake, importHotTakes, updateHotTake } from "./hotTakes";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

function TakeEditor({ initial, topics, saving, onSave, onCancel }) {
  const [take, setTake] = useState(initial.take || "");
  const [topic, setTopic] = useState(initial.topic || "");
  const [kind, setKind] = useState(initial.kind || "Opinion");
  const [note, setNote] = useState(initial.note || "");
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
      <Textarea rows={4} value={take} placeholder="The take, in your words." onChange={(e) => setTake(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Input
          className="h-8 max-w-xs text-xs"
          list="hot-take-topics"
          placeholder="Topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <datalist id="hot-take-topics">
          {topics.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          {TAKE_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <Input className="h-8 min-w-[12rem] flex-1 text-xs" placeholder="Note for the writer (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || !take.trim()}
          onClick={() => onSave({ take: take.trim(), topic: topic.trim(), kind, note: note.trim() })}
        >
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The company's hot takes bank: the expert's own positions, one per row.
 * Briefs pull from it ("Find in my bank", "Draft a new take" on a brief card),
 * and the Monthly Plan uses it when it writes hot takes from a theme view.
 */
export default function HotTakesPanel({ companyId, bank, onReload, onError }) {
  const { takes, companyName, missing } = bank;
  const reload = onReload;
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [query, setQuery] = useState("");
  const [showDropped, setShowDropped] = useState(false);
  const [editing, setEditing] = useState(null); // take id, or "new"
  const [showOriginal, setShowOriginal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef(null);

  const run = async (fn) => {
    setSaving(true);
    try {
      await fn();
      await reload();
      setEditing(null);
      return true;
    } catch (err) {
      onError?.(err?.message || "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { rows, otherCompany, incomplete } = parseImport(await file.text(), companyName);
      if (!rows.length) throw new Error(otherCompany ? `No takes for ${companyName} in this file (${otherCompany} are for another company)` : "No takes found in this file");
      const have = new Set((takes || []).map((t) => t.code));
      const replaced = rows.filter((r) => have.has(r.code)).length;
      const question = `Import ${rows.length} takes into ${companyName || "this company"}'s bank?` + (replaced ? ` ${replaced} already in the bank will be replaced.` : "");
      if (!window.confirm(question)) return;
      if (!(await run(() => importHotTakes(companyId, rows)))) return;
      setNote(
        `Imported ${rows.length} takes.` +
          (otherCompany ? ` Left out ${otherCompany} for another company.` : "") +
          (incomplete ? ` Left out ${incomplete} without a code or a take, or repeated.` : "")
      );
      setOpen(true);
    } catch (err) {
      onError?.(err?.message || "Import failed");
    }
  };

  const all = useMemo(() => takes || [], [takes]);
  const active = all.filter((t) => t.status === "active");
  const topics = useMemo(() => [...new Set(all.map((t) => t.topic).filter(Boolean))], [all]);
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((t) => showDropped || t.status === "active")
    .filter((t) => !topic || t.topic === topic)
    .filter((t) => !q || `${t.code} ${t.take} ${t.note}`.toLowerCase().includes(q));

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span>
            <span className="block text-sm font-medium text-foreground">Hot takes bank</span>
            <span className="block text-xs text-muted-foreground">
              {takes === null
                ? "Loading…"
                : missing || `${active.length} takes in ${new Set(active.map((t) => t.topic)).size} topics. Briefs pull from here, so every article says the same thing.`}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          <Button type="button" variant="outline" size="sm" disabled={saving || Boolean(missing)} onClick={() => fileRef.current?.click()}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
            Import .json
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving || Boolean(missing)}
            onClick={() => {
              setOpen(true);
              setEditing("new");
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a take
          </Button>
        </div>
      </div>

      {open && !missing && (
        <div className="space-y-3 border-t border-border p-4">
          {note && <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">{note}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectClass} value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
              <option value="">All topics</option>
              {topics.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <Input className="h-8 max-w-xs text-xs" placeholder="Search the bank" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={showDropped} onChange={(e) => setShowDropped(e.target.checked)} /> Show dropped
            </label>
          </div>

          {editing === "new" && (
            <TakeEditor
              initial={{ topic }}
              topics={topics}
              saving={saving}
              onCancel={() => setEditing(null)}
              onSave={(values) => run(() => addHotTake(companyId, all, companyName, { ...values, source: "Added in the bank" }))}
            />
          )}

          {shown.length === 0 && editing !== "new" && (
            <p className="text-xs text-muted-foreground">{all.length ? "No takes match." : "The bank is empty. Import a .json file or add a take."}</p>
          )}

          {groupByTopic(shown).map(({ topic: name, items }) => (
            <div key={name} className="space-y-1.5">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {name} · {items.length}
              </h3>
              {items.map((t) =>
                editing === t.id ? (
                  <TakeEditor
                    key={t.id}
                    initial={t}
                    topics={topics}
                    saving={saving}
                    onCancel={() => setEditing(null)}
                    onSave={(values) => run(() => updateHotTake(t.id, values))}
                  />
                ) : (
                  <div key={t.id} className={`rounded-md border border-border px-3 py-2 text-sm ${t.status === "dropped" ? "opacity-60" : ""}`}>
                    <p className={`whitespace-pre-wrap text-foreground ${t.status === "dropped" ? "line-through" : ""}`}>{t.take}</p>
                    {t.note && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Note: {t.note}</p>}
                    {showOriginal === t.id && (
                      <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                        {t.original || "No original kept."}
                        {t.source ? `\n\nFrom: ${t.source}` : ""}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="font-mono">{t.code}</span>
                      <span>{t.kind}</span>
                      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setEditing(t.id)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => setShowOriginal(showOriginal === t.id ? null : t.id)}
                      >
                        {showOriginal === t.id ? "Hide original" : "Original"}
                      </button>
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        disabled={saving}
                        onClick={() => run(() => updateHotTake(t.id, { status: t.status === "dropped" ? "active" : "dropped" }))}
                      >
                        {t.status === "dropped" ? "Restore" : "Drop"}
                      </button>
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-destructive"
                        disabled={saving}
                        onClick={() => {
                          if (window.confirm(`Delete ${t.code} from the bank for good? This cannot be undone. Use Drop to keep it out of articles but keep the record.`)) run(() => deleteHotTake(t.id));
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
