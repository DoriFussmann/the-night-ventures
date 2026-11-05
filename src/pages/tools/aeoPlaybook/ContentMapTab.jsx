import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GROUP_STATUSES, PAGE_TYPES, deleteRow, nextCode, updateRow, upsertRow } from "./api";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const TIER_ORDER = { Buy: 0, Problem: 1, Learn: 2 };

function groupStats(prompts, personasById) {
  const tiers = {};
  let impressions = 0;
  let best = null;
  const personaCodes = new Set();
  for (const p of prompts) {
    tiers[p.intent_tier] = (tiers[p.intent_tier] || 0) + 1;
    impressions += p.gsc_impressions || 0;
    if (p.gsc_best_position != null) best = best == null ? Number(p.gsc_best_position) : Math.min(best, Number(p.gsc_best_position));
    const persona = personasById.get(p.persona_id);
    if (persona) personaCodes.add(persona.code);
  }
  const dominant = Object.entries(tiers).sort((a, b) => b[1] - a[1] || TIER_ORDER[a[0]] - TIER_ORDER[b[0]])[0]?.[0] || "—";
  return { count: prompts.length, dominant, impressions, best, personas: [...personaCodes].sort().join(", ") };
}

function GroupCard({ group, stats, pillars, onChanged, onError }) {
  const [name, setName] = useState(group.name);
  const [slug, setSlug] = useState(group.live_slug);
  const patch = async (values) => {
    try {
      await updateRow("aeo_prompt_groups", group.id, values);
      onChanged?.();
    } catch (err) {
      onError?.(err?.message || "Save failed");
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete group ${group.code}? Its prompts stay, unassigned.`)) return;
    try {
      await deleteRow("aeo_prompt_groups", group.id);
      onChanged?.();
    } catch (err) {
      onError?.(err?.message || "Delete failed");
    }
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <span className="mt-2 text-[11px] tabular-nums text-muted-foreground">{group.code}</span>
        <Input className="h-8 flex-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== group.name && patch({ name })} />
        <Button type="button" variant="ghost" size="sm" aria-label={`Delete group ${group.code}`} onClick={remove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className={selectClass} value={group.page_type} onChange={(e) => patch({ page_type: e.target.value })} aria-label="Page type">
          {PAGE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className={selectClass} value={group.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
          {GROUP_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className={selectClass} value={group.pillar_id || ""} onChange={(e) => patch({ pillar_id: e.target.value || null })} aria-label="Pillar">
          <option value="">No pillar</option>
          {pillars.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          className="h-8 min-w-[180px] flex-1 rounded-md border border-input bg-background px-2 text-xs"
          placeholder="Live article slug (if covered)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          onBlur={() => slug !== group.live_slug && patch({ live_slug: slug })}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {stats.count} prompts · mostly {stats.dominant} · personas {stats.personas || "—"}
        {stats.impressions ? ` · ${stats.impressions} Google impressions` : ""}
        {stats.best != null ? ` · best position ${stats.best}` : ""}
      </p>
    </div>
  );
}

export default function ContentMapTab({ companyId, data, onChanged }) {
  const { pillars, groups, prompts, personas } = data;
  const [error, setError] = useState("");
  const personasById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
  const promptsByGroup = useMemo(() => {
    const map = new Map();
    for (const p of prompts) {
      if (!map.has(p.group_id)) map.set(p.group_id, []);
      map.get(p.group_id).push(p);
    }
    return map;
  }, [prompts]);

  const addPillar = async () => {
    try {
      await upsertRow("aeo_pillars", { company_id: companyId, code: nextCode(pillars, "X", 1), name: "New pillar", is_new: true, sort: pillars.length });
      onChanged?.();
    } catch (err) {
      setError(err?.message || "Could not add a pillar");
    }
  };

  const addGroup = async (pillar) => {
    const prefix = pillar.code.slice(0, 1);
    try {
      await upsertRow("aeo_prompt_groups", {
        company_id: companyId,
        code: nextCode(groups, prefix, 2),
        name: "New prompt group",
        pillar_id: pillar.id,
        sort: groups.length,
      });
      onChanged?.();
    } catch (err) {
      setError(err?.message || "Could not add a group");
    }
  };

  const summary = (status) => groups.filter((g) => g.status === status).length;
  const unassigned = groups.filter((g) => !g.pillar_id);

  return (
    <div className="mt-4 space-y-5">
      <p className="text-sm text-muted-foreground">
        {pillars.length} pillars · {groups.length} prompt groups ({summary("live")} live, {summary("new")} new, {summary("money")} money pages). One
        prompt group is one article.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {pillars.map((pillar) => {
        const list = groups.filter((g) => g.pillar_id === pillar.id);
        return (
          <section key={pillar.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium text-foreground">
                {pillar.name}
                {pillar.is_new ? <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-700">New pillar</span> : null}
              </h2>
              <span className="text-xs text-muted-foreground">
                {pillar.hub_path || "no hub page yet"}
                {pillar.pillar_article_slug ? ` · pillar article: ${pillar.pillar_article_slug}` : ""} · {list.length} groups
              </span>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {list.map((g) => (
                <GroupCard
                  key={`${g.id}-${g.updated_at}`}
                  group={g}
                  stats={groupStats(promptsByGroup.get(g.id) || [], personasById)}
                  pillars={pillars}
                  onChanged={onChanged}
                  onError={setError}
                />
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => addGroup(pillar)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add prompt group
            </Button>
          </section>
        );
      })}

      {unassigned.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">Groups without a pillar</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {unassigned.map((g) => (
              <GroupCard key={`${g.id}-${g.updated_at}`} group={g} stats={groupStats(promptsByGroup.get(g.id) || [], personasById)} pillars={pillars} onChanged={onChanged} onError={setError} />
            ))}
          </div>
        </section>
      ) : null}

      <Button type="button" variant="outline" size="sm" onClick={addPillar}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add pillar
      </Button>
    </div>
  );
}
