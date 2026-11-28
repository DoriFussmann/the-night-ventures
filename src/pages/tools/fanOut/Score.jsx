import React, { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, EyeOff, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIRECTIONS, FORM_LABELS, TYPE_ORDER } from "../../../../lib/fan-out/core.js";
import { MENTION_LABELS, brandKey } from "../../../../lib/fan-out/score.js";

const inputClass = "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const LABEL_TONE = {
  recommended: "border-emerald-300 bg-emerald-50 text-emerald-800",
  listed: "border-border bg-muted text-muted-foreground",
  qualified: "border-amber-300 bg-amber-50 text-amber-800",
};
const SIGNAL_TONE = { Strong: "border-emerald-300 bg-emerald-50 text-emerald-800", Occasional: "border-sky-300 bg-sky-50 text-sky-800", Noise: "border-border bg-muted text-muted-foreground" };

/** "Baseline", "Run 3", or "Earlier runs" for captures made before Runs existed. */
export function runName(run) {
  if (run.legacy) return "Earlier runs";
  return run.baseline ? "Baseline" : `Run ${run.seq}`;
}

/** One card of the summary: a title, one line under it, and the content. */
export function SummaryCard({ title, hint, right, children }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {hint && <p className="min-w-0 flex-1 text-xs text-muted-foreground">{hint}</p>}
        {right}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** A collapsed panel: the heading (and its key figure) in the title, the detail inside. */
export function Fold({ title, figure, children, startOpen = false, tone = "" }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className={`rounded-md border ${tone || "border-border"}`}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="font-medium text-foreground">{title}</span>
        {figure && <span className="min-w-0 flex-1 truncate text-muted-foreground">{figure}</span>}
      </button>
      {open && <div className="space-y-2 border-t border-border px-3 py-2.5 text-xs">{children}</div>}
    </div>
  );
}

/**
 * A share as a thin bar on a 0 to 100% track. The lighter band around the end is the margin:
 * a later Run has to land outside it to count as a real move.
 */
function Meter({ value, strong = false, band = true }) {
  const lo = Math.max(0, value.pct - value.margin);
  const hi = Math.min(100, value.pct + value.margin);
  return (
    <div className="relative h-2 w-full rounded-full bg-muted" role="img" aria-label={`${value.pct} percent, margin ${value.margin} points`}>
      {band && <div className={`absolute inset-y-0 rounded-full ${strong ? "bg-emerald-600/25" : "bg-foreground/15"}`} style={{ left: `${lo}%`, width: `${Math.max(0, hi - lo)}%` }} />}
      <div className={`absolute inset-y-0 left-0 rounded-full ${strong ? "bg-emerald-600" : "bg-foreground/45"}`} style={{ width: `${value.pct}%` }} />
    </div>
  );
}

function Tile({ label, hint, value }) {
  return (
    <div className="rounded-md border border-border px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-medium tabular-nums leading-none text-foreground">
        {value.pct}<span className="text-lg">%</span> <span className="text-xs font-normal text-muted-foreground">±{value.margin}</span>
      </p>
      <div className="mt-2.5"><Meter value={value} strong /></div>
      <p className="mt-2 text-xs text-muted-foreground">{value.x} of {value.n} runs · {hint}</p>
    </div>
  );
}

/** Brands side by side on one scale: name, bar, figure. The company's own row is marked in words and in weight, not by colour alone. */
function BrandBars({ brands }) {
  return (
    <ul className="space-y-1.5">
      {brands.map((b) => (
        <li key={b.id} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-xs" title={`${b.name}: named in ${b.mentioned.x} of ${b.mentioned.n} runs, first in ${b.first.x}, recommended in ${b.recommended.x}`}>
          <span className={`truncate ${b.own ? "font-medium text-foreground" : "text-foreground"}`}>{b.name}{b.own ? " (you)" : ""}</span>
          <Meter value={b.mentioned} strong={b.own} band={false} />
          <span className={`w-24 text-right tabular-nums ${b.own ? "font-medium text-foreground" : "text-muted-foreground"}`}>{b.mentioned.pct}% <span className="font-normal">· {b.mentioned.x} of {b.mentioned.n}</span></span>
        </li>
      ))}
    </ul>
  );
}

const pct = (v) => (v ? `${v.pct}%` : "–");

/**
 * The first card of the summary: where the brand stands. Numbers and bars up front; everything
 * that needs sentences is in a collapsed panel with its heading and key figure in the title.
 * Counted by the app from the stored answers. Only "Recommended" rests on an AI label.
 */
export default function ScoreBlock({ data, baselineId, takeaway, working, busy, labeling = "", onLabel, pick, onPick }) {
  // Which Run is the Baseline comes from the Scenario as it is now, not from when the score was calculated.
  const runs = (data?.runs || []).filter((r) => r.score.runs > 0).map((r) => ({ ...r, baseline: r.id === baselineId }));
  if (!data) return <SummaryCard title="Summary"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating the score…</p></SummaryCard>;
  if (!runs.length) return <SummaryCard title="Summary"><p className="text-xs text-muted-foreground">No score yet: no Run has returned an answer.</p></SummaryCard>;
  const run = runs.find((r) => r.id === pick) || runs[runs.length - 1];
  const s = run.score;
  const own = s.own;
  const dir = DIRECTIONS[data.direction] || DIRECTIONS.recommend;
  const named = s.brands.filter((b) => b.own || b.mentioned.x > 0);
  const silent = s.brands.length - named.length;
  const isLatest = run.id === runs[runs.length - 1].id;
  return (
    <SummaryCard
      title="Summary"
      hint={`${runName(run)} · ${day(run.started_at)} · ${s.runs} runs${s.failed ? ` (${s.failed} failed, not counted)` : ""}${s.model ? ` · ${s.model}` : ""}`}
      right={runs.length > 1 ? (
        <select className={inputClass} value={run.id} onChange={(e) => onPick(e.target.value)} aria-label="Run">
          {runs.map((r) => <option key={r.id} value={r.id}>{runName(r)} · {day(r.started_at)}</option>)}
        </select>
      ) : null}
    >
      {isLatest && takeaway && <p className="text-sm text-foreground">{takeaway}</p>}

      {!own ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">This company has no own brand on the tracked list, so there is no score for it. Add it in AEO Playbook › Prompt Tests.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Tile label="Mentioned" hint="named in the answer" value={own.mentioned} />
            <Tile label="First named" hint="named before any other brand" value={own.first} />
            <Tile label="Recommended" hint="explicitly favoured" value={own.recommended} />
          </div>
          <div className="rounded-md border border-border px-3 py-3">
            <p className="mb-2.5 text-xs text-foreground">
              <span className="font-medium">{own.mentioned.x === 0 ? "Not named in this Run" : `Number ${own.rank} of ${s.brands.length} tracked brands`}</span>
              <span className="text-muted-foreground">{s.leader && !s.leader.own && s.gap > 0 ? ` · ${s.leader.name} leads by ${s.gap} points` : s.leader?.own ? " · no tracked brand is named more often" : ""} · share of runs that name each brand</span>
            </p>
            <BrandBars brands={named.slice(0, 7)} />
            {(named.length > 7 || silent > 0) && <p className="mt-2 text-xs text-muted-foreground">{named.length > 7 ? `${named.length - 7} more named. ` : ""}{silent > 0 ? `${silent} tracked ${silent === 1 ? "brand is" : "brands are"} never named. ` : ""}The full table is below.</p>}
          </div>
        </>
      )}

      {run.unlabeled > 0 && labeling === run.id && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Labeling {run.unlabeled} {run.unlabeled === 1 ? "mention" : "mentions"} (Recommended, Listed or Qualified)…</p>
      )}
      {run.unlabeled > 0 && run.status !== "running" && labeling !== run.id && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {run.unlabeled} {run.unlabeled === 1 ? "mention" : "mentions"} could not be labeled, so Recommended may read slightly low.
          <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => onLabel(run.id)}>
            {busy === "label" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Try again
          </Button>
        </p>
      )}

      <div className="space-y-1.5">
        {run.legacy && <Fold title="Not a Baseline" figure="these runs were made before Baselines existed"><p className="text-foreground">They are scored here for reference, but they are not a Baseline: the next Run is.</p></Fold>}
        {run.status === "running" && <Fold title="This Run is not finished" figure={`the numbers cover the ${s.runs} runs that have returned`} tone="border-sky-300"><p className="text-foreground">Continue or end the Run in step 4. The summary is complete once it is closed.</p></Fold>}
        {data.direction !== "recommend" && <Fold title={`Direction is ${dir.label}`} figure="a low Mentioned score is expected here"><p className="text-foreground">ChatGPT names companies almost only when asked who or what to use. On {dir.label} Scenarios the Mentioned score will be low for every brand, and that is expected.</p></Fold>}
        {own && (
          <Fold title="By prompt type" figure={TYPE_ORDER.filter((f) => own.byType[f]).map((f) => `${FORM_LABELS[f]} ${own.byType[f].pct}%`).join(" · ")}>
            <ul className="space-y-1.5">
              {TYPE_ORDER.filter((f) => own.byType[f]).map((f) => (
                <li key={f} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3">
                  <span className="text-foreground">{FORM_LABELS[f]}</span>
                  <Meter value={own.byType[f]} strong />
                  <span className="w-32 text-right tabular-nums text-muted-foreground">{own.byType[f].pct}% ±{own.byType[f].margin} · {own.byType[f].x} of {own.byType[f].n}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">Directional only: with few runs per type the margin is wide.</p>
          </Fold>
        )}
        {own && own.mentioned.x > 0 && (
          <Fold title={`How ${own.name} is named`} figure={`Recommended ${own.labels.recommended} · Listed ${own.labels.listed} · Qualified ${own.labels.qualified}${own.labels.unlabeled ? ` · not labeled yet ${own.labels.unlabeled}` : ""}`}>
            <p className="text-muted-foreground">One label per run where it is named, set once by the AI. A label counts only with a phrase that is in the answer and about {own.name}.</p>
            {own.quotes.length > 0 ? (
              <ul className="space-y-1">
                {own.quotes.map((q, i) => <li key={i} className="flex gap-2"><span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${LABEL_TONE[q.label]}`}>{MENTION_LABELS[q.label]}</span><span className="text-foreground">“{q.quote.replace(/\\/g, "").replace(/\*\*/g, "")}”</span></li>)}
              </ul>
            ) : <p className="text-muted-foreground">No quoted phrases yet.</p>}
          </Fold>
        )}
        <Fold title="All tracked brands" figure={`${s.brands.length} brands · Mentioned, First named, Recommended, by prompt type`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-1.5 pr-2 font-normal">Rank</th>
                  <th className="py-1.5 pr-2 font-normal">Brand</th>
                  <th className="py-1.5 pr-2 font-normal">Mentioned</th>
                  <th className="py-1.5 pr-2 font-normal">First named</th>
                  <th className="py-1.5 pr-2 font-normal">Recommended</th>
                  {TYPE_ORDER.map((f) => <th key={f} className="py-1.5 pr-2 font-normal">{FORM_LABELS[f]}</th>)}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {s.brands.map((b) => (
                  <tr key={b.id} className={`border-b border-border/60 ${b.own ? "bg-emerald-50/60 font-medium" : ""}`}>
                    <td className="py-1.5 pr-2">{b.mentioned.x ? b.rank : "–"}</td>
                    <td className="py-1.5 pr-2">{b.name}{b.own ? " (you)" : ""}</td>
                    <td className="py-1.5 pr-2">{b.mentioned.pct}% <span className="font-normal text-muted-foreground">±{b.mentioned.margin} · {b.mentioned.x} of {b.mentioned.n}</span></td>
                    <td className="py-1.5 pr-2">{b.first.pct}%</td>
                    <td className="py-1.5 pr-2">{b.recommended.pct}%</td>
                    {TYPE_ORDER.map((f) => <td key={f} className="py-1.5 pr-2">{pct(b.byType[f])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
        <Fold title="How these numbers are counted" figure={`ChatGPT searched the web in ${s.searched.x} of ${s.searched.n} runs`}>
          <p className="text-foreground">Counted by the app from the stored answers, with today&apos;s tracked list, so every Run is scored the same way and old Runs stay comparable when the list changes.</p>
          <p className="text-foreground">± is the margin at this number of runs, shown as the lighter band on each bar. A later change counts as a real move only if it is larger than the margin.</p>
          <p className="text-foreground">Mentioned: the brand is named in the answer. First named: it is named before every other brand, tracked or not. Recommended: the answer explicitly favours it.</p>
        </Fold>
      </div>
    </SummaryCard>
  );
}

/**
 * The second card: brands ChatGPT named in the answers that are not on the tracked list. This is competition
 * the company has not listed yet. Track adds one to the list in a click; Ignore takes it off this card.
 */
export function DiscoveredCard({ run, ignored = [], working, onTrack, onIgnore, onRestore }) {
  if (!run) return null;
  const s = run.score;
  // An ignored brand stays ignored under any of its spellings.
  const hidden = new Set(ignored.map((i) => brandKey(i.name)));
  const open = s.discovered.filter((d) => !hidden.has(brandKey(d.name)));
  const main = open.filter((d) => d.signal !== "Noise");
  const rare = open.filter((d) => d.signal === "Noise");
  const shelved = s.discovered.filter((d) => hidden.has(brandKey(d.name)));
  const max = Math.max(1, ...s.discovered.map((d) => d.runs));
  const row = (d, dim) => (
    <li key={d.name} className="grid grid-cols-[minmax(7rem,14rem)_1fr_auto_auto] items-center gap-3 rounded-md border border-border px-3 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate font-medium ${dim ? "text-muted-foreground" : "text-foreground"}`}>{d.name}</span>
        {d.site ? (
          <a href={`https://${d.site}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" title={`Open ${d.site} in a new tab`} aria-label={`Open ${d.site} in a new tab`}><ExternalLink className="h-3.5 w-3.5" /></a>
        ) : (
          <a href={`https://www.google.com/search?q=${encodeURIComponent(d.name)}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" title={`No website for ${d.name} appeared in this Run. Search the web for it in a new tab`} aria-label={`Search the web for ${d.name} in a new tab`}><Search className="h-3.5 w-3.5" /></a>
        )}
      </span>
      <div className="relative hidden h-2 rounded-full bg-muted sm:block" role="img" aria-label={`named in ${d.runs} of ${s.runs} runs`}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/45" style={{ width: `${(d.runs / max) * 100}%` }} />
      </div>
      <span className="flex items-center gap-2 tabular-nums text-muted-foreground">{d.runs} of {s.runs} runs<span className={`rounded border px-1.5 py-0.5 text-[11px] ${SIGNAL_TONE[d.signal]}`}>{d.signal}</span></span>
      <span className="flex gap-1.5">
        <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => onTrack(d.name)}><Plus className="mr-1 h-3.5 w-3.5" />Track</Button>
        <Button type="button" size="sm" variant="ghost" disabled={working} onClick={() => onIgnore(d.name)}><EyeOff className="mr-1 h-3.5 w-3.5" />Ignore</Button>
      </span>
    </li>
  );
  return (
    <SummaryCard title="Discovered competition" hint={`Brands ChatGPT named in these answers that are not on your tracked list. ${main.length} worth a look${rare.length ? `, ${rare.length} rarely named` : ""}.`}>
      {main.length > 0 ? <ul className="space-y-1.5">{main.map((d) => row(d, false))}</ul> : <p className="text-xs text-muted-foreground">{open.length ? "Nothing new is named often enough to matter." : s.discovered.length ? "Everything discovered is either tracked or ignored." : "ChatGPT named no brand outside your tracked list."}</p>}
      <div className="space-y-1.5">
        {rare.length > 0 && <Fold title="Rarely named" figure={`${rare.length} ${rare.length === 1 ? "brand" : "brands"} in fewer than one run in five`}><ul className="space-y-1.5">{rare.map((d) => row(d, true))}</ul></Fold>}
        {shelved.length > 0 && (
          <Fold title="Ignored" figure={`${shelved.length} ${shelved.length === 1 ? "brand" : "brands"} you chose not to track`}>
            <ul className="flex flex-wrap gap-1.5">
              {shelved.map((d) => <li key={d.name} className="inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5"><span className="text-foreground">{d.name}</span><span className="tabular-nums text-muted-foreground">{d.runs} of {s.runs}</span><button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => onRestore(d.name)}>Restore</button></li>)}
            </ul>
          </Fold>
        )}
        <Fold title="What Track and Ignore do" figure="one click each, and both can be undone">
          <p className="text-foreground"><span className="font-medium">Track</span> adds the brand to this company&apos;s tracked list as a competitor. It is then scored like the others in every Run, old and new, appears in the comparison, and is blocked from prompts.</p>
          <p className="text-foreground">The <ExternalLink className="inline h-3 w-3" /> icon opens the brand&apos;s website, taken from the pages ChatGPT found or cited in this Run. When the Run shows no website for it, the icon is <Search className="inline h-3 w-3" /> and opens a web search for the name.</p>
          <p className="text-foreground"><span className="font-medium">Ignore</span> takes it off this card for this company. It is still counted in First named and in who wins each search: those always count every brand ChatGPT names.</p>
          <p className="text-muted-foreground">The tracked list is shared with Prompt Tests and is edited in AEO Playbook › Prompt Tests.</p>
        </Fold>
      </div>
    </SummaryCard>
  );
}
