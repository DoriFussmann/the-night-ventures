import React, { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TIERS, deleteRow, nextCode, updateRow, upsertRow } from "./api";

const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

function PromptRow({ row, personas, groups, onSaved, onError }) {
  const [prompt, setPrompt] = useState(row.prompt);
  const [keyword, setKeyword] = useState(row.keyword);

  const patch = async (values) => {
    try {
      await updateRow("aeo_prompts", row.id, values);
      onSaved?.();
    } catch (err) {
      onError?.(err?.message || "Save failed");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete prompt ${row.code}?`)) return;
    try {
      await deleteRow("aeo_prompts", row.id);
      onSaved?.();
    } catch (err) {
      onError?.(err?.message || "Delete failed");
    }
  };

  return (
    <tr className="border-t border-border align-top">
      <td className="px-2 py-1.5 text-[11px] tabular-nums text-muted-foreground">{row.code}</td>
      <td className="px-2 py-1.5 min-w-[280px]">
        <textarea
          className="w-full resize-y rounded-md border border-transparent bg-transparent p-1 text-sm hover:border-input focus:border-input focus:outline-none"
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => prompt !== row.prompt && patch({ prompt })}
        />
      </td>
      <td className="px-2 py-1.5 min-w-[170px]">
        <input
          className="h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-xs hover:border-input focus:border-input focus:outline-none"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onBlur={() => keyword !== row.keyword && patch({ keyword })}
        />
      </td>
      <td className="px-2 py-1.5 min-w-[150px]">
        <select className={selectClass} value={row.persona_id || ""} onChange={(e) => patch({ persona_id: e.target.value || null })}>
          <option value="">—</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 w-[96px]">
        <select className={selectClass} value={row.intent_tier} onChange={(e) => patch({ intent_tier: e.target.value })}>
          {TIERS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums">{row.search_volume ?? "—"}</td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums">{row.keyword_difficulty ?? "—"}</td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums">{row.gsc_impressions ?? "—"}</td>
      <td className="px-2 py-1.5 text-right text-xs tabular-nums">{row.gsc_best_position ?? "—"}</td>
      <td className="px-2 py-1.5 w-[64px]">
        <select className={selectClass} value={row.business_value ?? ""} onChange={(e) => patch({ business_value: e.target.value ? Number(e.target.value) : null })}>
          <option value="">—</option>
          {[3, 2, 1].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 min-w-[220px]">
        <select className={selectClass} value={row.group_id || ""} onChange={(e) => patch({ group_id: e.target.value || null })}>
          <option value="">— Unassigned</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.code} · {g.name}</option>
          ))}
        </select>
      </td>
      <td className="px-1 py-1.5">
        <Button type="button" variant="ghost" size="sm" aria-label={`Delete prompt ${row.code}`} onClick={remove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

export default function PromptsTab({ companyId, data, onChanged }) {
  const { personas, groups, pillars, prompts } = data;
  const [q, setQ] = useState("");
  const [persona, setPersona] = useState("");
  const [tier, setTier] = useState("");
  const [pillar, setPillar] = useState("");
  const [group, setGroup] = useState("");
  const [error, setError] = useState("");

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return prompts.filter((p) => {
      if (persona && p.persona_id !== persona) return false;
      if (tier && p.intent_tier !== tier) return false;
      if (group === "none" && p.group_id) return false;
      if (group && group !== "none" && p.group_id !== group) return false;
      if (pillar && groupById.get(p.group_id)?.pillar_id !== pillar) return false;
      if (needle && !`${p.prompt} ${p.keyword}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [prompts, q, persona, tier, pillar, group, groupById]);

  const addPrompt = async () => {
    setError("");
    try {
      await upsertRow("aeo_prompts", {
        company_id: companyId,
        code: nextCode(prompts, "R"),
        prompt: "New prompt: the full question a buyer asks",
        intent_tier: tier || "Problem",
        persona_id: persona || null,
        group_id: group && group !== "none" ? group : null,
      });
      onChanged?.();
    } catch (err) {
      setError(err?.message || "Could not add a prompt");
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search prompts and keywords…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={`${selectClass} h-9 w-auto`} value={persona} onChange={(e) => setPersona(e.target.value)}>
          <option value="">All personas</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
          ))}
        </select>
        <select className={`${selectClass} h-9 w-auto`} value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">All tiers</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className={`${selectClass} h-9 w-auto`} value={pillar} onChange={(e) => setPillar(e.target.value)}>
          <option value="">All pillars</option>
          {pillars.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className={`${selectClass} h-9 w-auto max-w-[260px]`} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          <option value="none">Unassigned</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.code} · {g.name}</option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={addPrompt}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add prompt
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {rows.length} of {prompts.length} prompts. Edits save when you leave a field. Volume and difficulty arrive from keyword data later.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left">
          <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">ID</th>
              <th className="px-2 py-2 font-medium">Prompt</th>
              <th className="px-2 py-2 font-medium">Keyword</th>
              <th className="px-2 py-2 font-medium">Persona</th>
              <th className="px-2 py-2 font-medium">Tier</th>
              <th className="px-2 py-2 text-right font-medium">Volume</th>
              <th className="px-2 py-2 text-right font-medium">KD</th>
              <th className="px-2 py-2 text-right font-medium">Google impr.</th>
              <th className="px-2 py-2 text-right font-medium">Best pos.</th>
              <th className="px-2 py-2 font-medium">Value</th>
              <th className="px-2 py-2 font-medium">Prompt group</th>
              <th className="px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PromptRow key={`${row.id}-${row.updated_at}`} row={row} personas={personas} groups={groups} onSaved={onChanged} onError={setError} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
