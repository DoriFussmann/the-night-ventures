import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GROUP_STATUSES, PAGE_TYPES, deleteRow, nextCode, updateRow, upsertRow } from "./api";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const TIER_ORDER = { Buy: 0, Problem: 1, Learn: 2 };
const TIERS = [
  { key: "Buy", color: "bg-blue-600" },
  { key: "Problem", color: "bg-orange-500" },
  { key: "Learn", color: "bg-emerald-500" },
];
const STATUS_LABELS = { new: "to write", money: "money" };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function tierCounts(prompts) {
  const counts = { Buy: 0, Problem: 0, Learn: 0 };
  for (const p of prompts) if (p.intent_tier in counts) counts[p.intent_tier] += 1;
  return counts;
}

/** "8 live · 3 scheduled · 7 to write", in the order statuses are defined, live first. */
function statusLine(list) {
  const order = ["live", ...GROUP_STATUSES.filter((s) => s !== "live" && s !== "new" && s !== "money"), "new", "money"];
  return order
    .map((status) => [status, list.filter((g) => g.status === status).length])
    .filter(([, n]) => n > 0)
    .map(([status, n]) => (status === "money" ? plural(n, "money page") : `${n} ${STATUS_LABELS[status] || status}`))
    .join(" · ");
}

function Tile({ label, value }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3.5 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-medium tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function TierBar({ counts, total, max }) {
  if (!total) return <div className="my-2 h-2.5" />;
  return (
    <div className="my-2 flex gap-0.5" style={{ width: `${Math.max(4, Math.round((total / max) * 100))}%` }}>
      {TIERS.filter((t) => counts[t.key] > 0).map((t) => (
        <span key={t.key} title={`${t.key} ${counts[t.key]}`} className={`h-2.5 rounded-sm ${t.color}`} style={{ flex: counts[t.key] }} />
      ))}
    </div>
  );
}

/** One pillar: a summary row that opens to its prompt groups. */
function PillarSection({ title, badge, list, promptsByGroup, maxPrompts, open, onToggle, children }) {
  const pillarPrompts = list.flatMap((g) => promptsByGroup.get(g.id) || []);
  const counts = tierCounts(pillarPrompts);
  const mix = TIERS.filter((t) => counts[t.key] > 0).map((t) => `${t.key} ${counts[t.key]}`).join(" · ");
  const examples = [...list]
    .map((g) => ({ name: g.name, n: (promptsByGroup.get(g.id) || []).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 2);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="border-t border-border">
      <button type="button" className="w-full py-3.5 text-left hover:bg-muted/30" aria-expanded={open} onClick={onToggle}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-[15px] font-medium text-foreground">
            <Chevron className="h-4 w-4 shrink-0 self-center text-muted-foreground" />
            {title}
            {badge}
          </h2>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {plural(list.length, "group")} · {plural(pillarPrompts.length, "prompt")}
          </span>
        </div>
        <div className="pl-[22px]">
          <TierBar counts={counts} total={pillarPrompts.length} max={maxPrompts} />
          {mix ? <p className="text-xs text-muted-foreground">{mix}</p> : null}
          {list.length ? <p className="mt-1.5 text-xs text-muted-foreground">Status: {statusLine(list)}</p> : null}
          {!open && examples.length ? (
            <p className="mt-0.5 text-xs text-muted-foreground/80">e.g. {examples.map((e) => `${e.name} (${e.n})`).join(" · ")}</p>
          ) : null}
        </div>
      </button>
      {open ? <div className="space-y-2 pb-4 pl-[22px]">{children}</div> : null}
    </section>
  );
}

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

function TopicNameInput({ pillar, onChanged, onError }) {
  const [value, setValue] = useState(pillar.topic_name || "");
  const save = async () => {
    if (value.trim() === (pillar.topic_name || "")) return;
    try {
      await updateRow("aeo_pillars", pillar.id, { topic_name: value.trim() });
      onChanged?.();
    } catch (err) {
      onError?.(err?.message || "Save failed");
    }
  };
  return (
    <Input
      className="h-7 w-52 text-xs"
      value={value}
      placeholder="Site topic name (exact)"
      title="Must match the topic name on the live site exactly, or new articles drop out of the hub page"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
    />
  );
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

  const [openIds, setOpenIds] = useState(() => new Set());
  const toggle = (id) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const summary = (status) => groups.filter((g) => g.status === status).length;
  const unassigned = groups.filter((g) => !g.pillar_id);
  const promptCount = (list) => list.reduce((n, g) => n + (promptsByGroup.get(g.id) || []).length, 0);
  const maxPrompts = Math.max(1, ...pillars.map((p) => promptCount(groups.filter((g) => g.pillar_id === p.id))), promptCount(unassigned));
  const totals = tierCounts(prompts);
  const allOpen = pillars.length > 0 && pillars.every((p) => openIds.has(p.id));

  const cards = (list) => (
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
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Personas" value={personas.length} />
        <Tile label="Prompts" value={prompts.length} />
        <Tile label="Groups (articles)" value={groups.length} />
        <Tile label="Pillars" value={pillars.length} />
      </div>
      <p className="text-sm text-muted-foreground">
        {pillars.length} pillars · {groups.length} prompt groups ({summary("live")} live, {summary("new")} new, {summary("money")} money pages). One
        prompt group is one article.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>Prompts by intent:</span>
          {TIERS.map((t) => (
            <span key={t.key} className="flex items-center gap-1">
              <span className={`h-2.5 w-2.5 rounded-sm ${t.color}`} />
              {t.key} {totals[t.key]}
            </span>
          ))}
        </div>
        {pillars.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpenIds(allOpen ? new Set() : new Set([...pillars.map((p) => p.id), "none"]))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        ) : null}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div>
        {pillars.map((pillar) => {
          const list = groups.filter((g) => g.pillar_id === pillar.id);
          return (
            <PillarSection
              key={pillar.id}
              title={pillar.name}
              badge={pillar.is_new ? <span className="ml-1 text-[10px] uppercase tracking-wider text-emerald-700">New pillar</span> : null}
              list={list}
              promptsByGroup={promptsByGroup}
              maxPrompts={maxPrompts}
              open={openIds.has(pillar.id)}
              onToggle={() => toggle(pillar.id)}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <TopicNameInput pillar={pillar} onChanged={onChanged} onError={setError} />
                {pillar.hub_path || "no hub page yet"}
                {pillar.pillar_article_slug ? ` · pillar article: ${pillar.pillar_article_slug}` : ""}
              </div>
              {cards(list)}
              <Button type="button" variant="ghost" size="sm" onClick={() => addGroup(pillar)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add prompt group
              </Button>
            </PillarSection>
          );
        })}

        {unassigned.length ? (
          <PillarSection
            title="Groups without a pillar"
            list={unassigned}
            promptsByGroup={promptsByGroup}
            maxPrompts={maxPrompts}
            open={openIds.has("none")}
            onToggle={() => toggle("none")}
          >
            {cards(unassigned)}
          </PillarSection>
        ) : null}
        <div className="border-t border-border" />
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addPillar}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add pillar
      </Button>
    </div>
  );
}
