import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Outcomes in order, best first. Colours are checked for colour-blind separation; counts are always shown as text too. */
const OUTCOMES = [
  { label: "Named", color: "#059669", action: "You are in the answer. Protect it and check how often." },
  { label: "Cited, not named", color: "#0284c7", action: "Your page was a source. Tie the brand to the claim." },
  { label: "Retrieved, not cited", color: "#f59e0b", action: "Found, then not used. Improve that page." },
  { label: "Absent", color: "#9ca3af", action: "It searched and never found you. Write the article." },
  { label: "No search", color: "#e5e7eb", action: "Answered from memory. Deprioritise the prompt." },
];
const STAGES = ["Learn", "Problem", "Buy"];
const TYPES = ["Question", "Comparison", "Recommendation"];

const pct = (n, base) => (base ? Math.round((n / base) * 100) : 0);

/** "1h 36m", "4m 05s" or "38s". */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** One stacked bar of the five outcomes. Segments are separated by a 2px gap. */
function OutcomeBar({ counts, total, height = "h-3" }) {
  if (!total) return <div className={`${height} rounded bg-muted`} />;
  return (
    <div className={`flex ${height} gap-[2px] overflow-hidden rounded`} role="img" aria-label={OUTCOMES.map((o) => `${o.label} ${counts[o.label] || 0}`).join(", ")}>
      {OUTCOMES.filter((o) => counts[o.label]).map((o) => (
        <div key={o.label} title={`${o.label}: ${counts[o.label]} of ${total} (${pct(counts[o.label], total)}%)`}
          style={{ width: `${(counts[o.label] / total) * 100}%`, backgroundColor: o.color }} />
      ))}
    </div>
  );
}

function Breakdown({ title, keys, groups }) {
  return (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="mt-2 space-y-2">
        {keys.map((k) => {
          const g = groups[k] || { total: 0, counts: {} };
          return (
            <div key={k} className="grid grid-cols-[7.5rem_1fr_7.5rem] items-center gap-2 text-xs">
              <span className="text-foreground">{k}</span>
              <OutcomeBar counts={g.counts} total={g.total} height="h-2.5" />
              <span className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                {g.total ? `${g.counts.Named || 0} of ${g.total} named` : "no prompts"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A ranked list with a thin bar per row. The highlighted row is the company's own. */
function Ranked({ title, note, rows, max, empty, wide }) {
  return (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p> : null}
      <div className="mt-2 space-y-1.5">
        {rows.length === 0 && <p className="text-xs text-muted-foreground">{empty}</p>}
        {rows.map((r) => (
          <div key={r.name} className={`grid ${wide ? "grid-cols-[minmax(0,22rem)_1fr_2rem]" : "grid-cols-[minmax(0,10rem)_1fr_2rem]"} items-center gap-2 text-xs`} title={`${r.name}: ${r.n}`}>
            <span className={`truncate ${r.own ? "font-semibold text-foreground" : "text-foreground"}`}>{r.name}</span>
            <div className="h-2 rounded bg-muted">
              <div className={`h-2 rounded ${r.own ? "bg-primary" : "bg-foreground/30"}`} style={{ width: `${max ? (r.n / max) * 100 : 0}%` }} />
            </div>
            <span className="text-right tabular-nums text-muted-foreground">{r.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Path of a page on the company's own site; the home page reads "Home page". */
function pagePath(url) {
  const path = String(url).replace(/^https?:\/\/[^/]+/, "");
  return !path || path === "/" ? "Home page" : path;
}

function tally(prompts, outcomes, engine) {
  const blank = () => ({ total: 0, counts: {} });
  const all = blank();
  const byStage = {};
  const byType = {};
  for (const p of prompts) {
    // Approved prompts only: a rejected prompt keeps its runs but leaves the totals.
    if (p.status !== "Approved") continue;
    const o = (outcomes[p.id] || {})[engine];
    if (!o || o.label === "Failed") continue;
    for (const g of [all, (byStage[p.stage] = byStage[p.stage] || blank()), (byType[p.type] = byType[p.type] || blank())]) {
      g.total += 1;
      g.counts[o.label] = (g.counts[o.label] || 0) + 1;
    }
  }
  return { all, byStage, byType };
}

/** The summary as a Markdown document: the same figures as the dialog, for one engine. */
export function summaryMarkdown({ s, t, ownName, brands, cycle, took, setName }) {
  const total = t.all.total;
  const named = t.all.counts.Named || 0;
  const visible = named + (t.all.counts["Cited, not named"] || 0) + (t.all.counts["Retrieved, not cited"] || 0);
  const row = (k, g) => `| ${k} | ${g ? g.total : 0} | ${OUTCOMES.map((o) => (g && g.counts[o.label]) || 0).join(" | ")} |`;
  const head = `| | Prompts | ${OUTCOMES.map((o) => o.label).join(" | ")} |\n|---|---:|${OUTCOMES.map(() => "---:").join("|")}|`;
  const L = [
    `# Prompt test summary${setName ? `: ${setName}` : ""}`,
    "",
    `${total} prompts on ${s.label}${s.model ? `, model ${s.model}` : ""}${s.lastRun ? `, last run ${new Date(s.lastRun).toLocaleDateString()}` : ""}.` +
      (cycle ? ` Last test: ${cycle.planned_calls} calls in ${formatDuration(took)}, $${Number(cycle.est_cost || 0).toFixed(2)}.` : ""),
    "",
    `**${ownName} is named in ${named} of ${total} prompts (${pct(named, total)}%).** Found in some form in ${visible} (${pct(visible, total)}%). A prompt counts by its best run.`,
    "",
    "## Outcomes",
    "",
    "| Outcome | Prompts | What to do |",
    "|---|---:|---|",
    ...OUTCOMES.map((o) => `| ${o.label} | ${t.all.counts[o.label] || 0} | ${o.action} |`),
    "",
    "## By stage",
    "",
    head,
    ...STAGES.map((k) => row(k, t.byStage[k])),
    "",
    "## By prompt type",
    "",
    head,
    ...TYPES.map((k) => row(k, t.byType[k])),
    "",
    "## Web search",
    "",
    `${s.search.all.n} of ${s.search.all.base} prompts made ${s.label} search the web at least once.`,
    "",
    "## Who gets named (prompts)",
    "",
    ...(brands.length ? brands.map((b) => `- ${b.own ? `**${b.name}**` : b.name}: ${b.n}`) : ["- No tracked brands."]),
    "",
    "## Top cited sites (prompts cited / Buy-stage prompts cited)",
    "",
    ...(s.topDomains.length ? s.topDomains.map((d) => `- ${d.name}: ${d.n} / ${d.buy}`) : ["- No sources cited."]),
    "",
    "## Your pages cited (runs)",
    "",
    ...(s.ownUrls.length ? s.ownUrls.map((u) => `- ${u.name}: ${u.n}`) : ["- None."]),
    "",
    "## Brand names inside its searches (queries)",
    "",
    ...((s.queryNames || []).length ? s.queryNames.map((q) => `- ${q.name}: ${q.n}`) : ["- None."]),
    "",
  ];
  return L.join("\n");
}

function saveText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** High-level reading of the latest test, one engine at a time. */
export default function PromptTestsSummary({ open, onOpenChange, data, companyName, setName }) {
  const engineIds = Object.keys(data?.summary?.engines || {});
  const [engine, setEngine] = useState(null);
  const active = engine && engineIds.includes(engine) ? engine : engineIds[0];
  const s = active ? data.summary.engines[active] : null;
  const t = useMemo(() => (active ? tally(data.prompts, data.outcomes, active) : null), [data, active]);
  if (!s || !t) return null;

  const own = s.brands.find((b) => b.own);
  const ownName = own?.name || companyName || "Your brand";
  const total = t.all.total;
  const named = t.all.counts.Named || 0;
  const visible = named + (t.all.counts["Cited, not named"] || 0) + (t.all.counts["Retrieved, not cited"] || 0);
  const brands = [...s.brands].sort((a, b) => b.named - a.named).map((b) => ({ name: b.name, n: b.named, own: b.own }));
  const ownDomains = (data.brands || []).filter((b) => b.is_own).flatMap((b) => b.domains || []).map((d) => String(d).toLowerCase());
  const sites = s.topDomains.slice(0, 8).map((d) => ({ name: d.name, n: d.n, own: ownDomains.some((o) => d.name === o || d.name.endsWith(`.${o}`)) }));
  const cycle = (data.cycles || []).find((c) => c.finished_at) || null;
  const took = cycle ? new Date(cycle.finished_at).getTime() - new Date(cycle.created_at).getTime() : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <DialogTitle>Prompt test summary{setName ? `: ${setName}` : ""}</DialogTitle>
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              onClick={() => saveText(`prompt-test-summary${setName ? "-" + setName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : ""}-${active}.md`,
                summaryMarkdown({ s, t, ownName, brands, cycle, took, setName }))}>
              Download summary (.md)
            </button>
          </div>
          <DialogDescription>
            {total} prompts on {s.label}
            {s.model ? `, model ${s.model}` : ""}
            {s.lastRun ? ` · ${new Date(s.lastRun).toLocaleDateString()}` : ""}
            {cycle ? ` · last test: ${cycle.planned_calls} calls in ${formatDuration(took)}, $${Number(cycle.est_cost || 0).toFixed(2)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {engineIds.length > 1 && (
          <div className="flex gap-1" role="tablist" aria-label="Engine">
            {engineIds.map((e) => (
              <button key={e} type="button" role="tab" aria-selected={e === active} onClick={() => setEngine(e)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${e === active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                {data.summary.engines[e].label}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[14rem_1fr] md:items-center">
          <div>
            <p className="text-5xl font-semibold tabular-nums tracking-tight text-foreground">{pct(named, total)}%</p>
            <p className="mt-1 text-sm text-foreground">{ownName} is named in {named} of {total} prompts</p>
            <p className="text-xs text-muted-foreground">Found in some form in {visible} ({pct(visible, total)}%)</p>
          </div>
          <div>
            <OutcomeBar counts={t.all.counts} total={total} height="h-4" />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {OUTCOMES.map((o) => (
                <span key={o.label} className="flex items-center gap-1.5 text-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm border border-black/10" style={{ backgroundColor: o.color }} />
                  {o.label} <span className="tabular-nums text-muted-foreground">{t.all.counts[o.label] || 0}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-6 border-t border-border pt-4 md:grid-cols-2">
          <Breakdown title="By stage" keys={STAGES} groups={t.byStage} />
          <Breakdown title="By prompt type" keys={TYPES} groups={t.byType} />
        </div>

        <div className="grid gap-6 border-t border-border pt-4 md:grid-cols-2">
          <Ranked title="Who gets named" note="Prompts where the answer names the brand" rows={brands} max={Math.max(1, ...brands.map((b) => b.n))} empty="No tracked brands." />
          <Ranked title="Top cited sites" note="Prompts where the site is cited as a source" rows={sites} max={Math.max(1, ...sites.map((b) => b.n))} empty="No sources cited." />
        </div>

        {s.ownUrls.length > 0 && (
          <div className="border-t border-border pt-4">
            <Ranked title="Your pages doing the work" note="Runs that cited the page" max={Math.max(1, ...s.ownUrls.map((u) => u.n))} empty="" wide
              rows={s.ownUrls.slice(0, 6).map((u) => ({ name: pagePath(u.name), n: u.n }))} />
          </div>
        )}

        <div className="border-t border-border pt-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What to do</h4>
          <div className="mt-2 space-y-1.5">
            {OUTCOMES.map((o) => (
              <div key={o.label} className="grid grid-cols-[2.5rem_11rem_1fr] items-baseline gap-2 text-xs">
                <span className="text-right text-sm font-semibold tabular-nums text-foreground">{t.all.counts[o.label] || 0}</span>
                <span className="flex items-center gap-1.5 text-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm border border-black/10" style={{ backgroundColor: o.color }} />
                  {o.label}
                </span>
                <span className="text-muted-foreground">{o.action}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            A prompt counts by its best run. {s.search.all.n} of {s.search.all.base} prompts made {s.label} search the web at least once.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
