import React, { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIRECTIONS, FORM_LABELS, TYPE_ORDER } from "../../../../lib/fan-out/core.js";
import { MENTION_LABELS } from "../../../../lib/fan-out/score.js";

const inputClass = "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const LABEL_TONE = {
  recommended: "border-emerald-300 bg-emerald-50 text-emerald-800",
  listed: "border-border bg-muted text-muted-foreground",
  qualified: "border-amber-300 bg-amber-50 text-amber-800",
};

/** "Baseline", "Run 3", or "Earlier runs" for captures made before Runs existed. */
export function runName(run) {
  if (run.legacy) return "Earlier runs";
  return run.baseline ? "Baseline" : `Run ${run.seq}`;
}

function Tile({ label, hint, value }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-medium tabular-nums text-foreground">
        {value.pct}% <span className="text-xs font-normal text-muted-foreground">±{value.margin}</span>
      </p>
      <p className="text-xs text-muted-foreground">{value.x} of {value.n} runs · {hint}</p>
    </div>
  );
}

const pct = (v) => (v ? `${v.pct}%` : "–");

/**
 * The measurement half of the summary: counted by the app with fixed rules, from the stored answers.
 * Only "Recommended" rests on an AI label, and every such label carries the phrase it quotes.
 */
export default function ScoreBlock({ data, working, busy, onLabel, onTrack }) {
  const [pick, setPick] = useState("");
  const [showAll, setShowAll] = useState(false);
  const runs = (data?.runs || []).filter((r) => r.score.runs > 0);
  if (!data) return <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating the score…</p>;
  if (!runs.length) return <p className="text-xs text-muted-foreground">No score yet: no Run has returned an answer.</p>;
  const run = runs.find((r) => r.id === pick) || runs[runs.length - 1];
  const s = run.score;
  const own = s.own;
  const dir = DIRECTIONS[data.direction] || DIRECTIONS.recommend;
  const others = s.brands.filter((b) => showAll || b.own || b.mentioned.x > 0);
  const hidden = s.brands.length - s.brands.filter((b) => b.own || b.mentioned.x > 0).length;
  const discovered = s.discovered.filter((d) => showAll || d.signal !== "Noise");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <p className="text-sm font-medium text-foreground">Where you stand</p>
        {runs.length > 1 ? (
          <select className={inputClass} value={run.id} onChange={(e) => setPick(e.target.value)} aria-label="Run">
            {runs.map((r) => <option key={r.id} value={r.id}>{runName(r)} · {day(r.started_at)}</option>)}
          </select>
        ) : (
          <span className="text-muted-foreground">{runName(run)} · {day(run.started_at)}</span>
        )}
        <span className="text-muted-foreground">{s.runs} runs{s.failed ? ` (${s.failed} failed, not counted)` : ""}{s.model ? ` · ${s.model}` : ""} · ChatGPT searched the web in {s.searched.x} of {s.searched.n}</span>
      </div>

      {run.legacy && <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">These runs were made before Baselines existed. They are scored here for reference, but they are not a Baseline: the next Run is.</p>}
      {run.status === "running" && <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">This Run is not finished. The score below covers the {s.runs} runs that have returned so far.</p>}
      {data.direction !== "recommend" && <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">Direction is {dir.label}. ChatGPT names companies almost only when asked who or what to use, so Mentioned will be low for every brand here. That is expected.</p>}

      {!own ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">This company has no own brand on the tracked list, so there is no score for it. Add it in AEO Playbook › Prompt Tests.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Tile label="Mentioned" hint="the brand is named in the answer" value={own.mentioned} />
            <Tile label="First named" hint="named before every other brand" value={own.first} />
            <Tile label="Recommended" hint="explicitly favoured" value={own.recommended} />
          </div>
          <p className="text-xs text-foreground">
            {own.mentioned.x === 0
              ? `${own.name} is not named in any of the ${s.runs} runs.`
              : `${own.name} is number ${own.rank} of ${s.brands.length} tracked brands.`}{" "}
            {s.leader && !s.leader.own && s.gap > 0 ? `${s.leader.name} leads at ${s.leader.pct}%, ${s.gap} points ahead.` : s.leader?.own ? "It leads the tracked brands." : ""}{" "}
            <span className="text-muted-foreground">
              By prompt type: {TYPE_ORDER.filter((f) => own.byType[f]).map((f) => `${FORM_LABELS[f]} ${own.byType[f].pct}% ±${own.byType[f].margin}`).join(" · ")} (directional only: few runs per type).
            </span>
          </p>
        </>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
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
            {others.map((b) => (
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
      {(hidden > 0 || s.discovered.some((d) => d.signal === "Noise")) && (
        <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Hide brands that are never or rarely named" : `Show everything${hidden ? `: ${hidden} tracked ${hidden === 1 ? "brand is" : "brands are"} never named` : ""}`}
        </button>
      )}

      {own && own.mentioned.x > 0 && (
        <div className="text-xs">
          <p className="font-medium text-foreground">
            How {own.name} is named <span className="font-normal text-muted-foreground">· one label per run where it is named, set once by the AI, with the phrase it quotes</span>
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {Object.keys(MENTION_LABELS).map((k) => <span key={k} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${LABEL_TONE[k]}`}>{MENTION_LABELS[k]} · {own.labels[k]}</span>)}
            {own.labels.unlabeled > 0 && <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">Not labeled yet · {own.labels.unlabeled}</span>}
          </p>
          {own.quotes.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
              {own.quotes.map((q, i) => <li key={i}><span className="text-foreground">{MENTION_LABELS[q.label]}:</span> “{q.quote}”</li>)}
            </ul>
          )}
        </div>
      )}
      {run.unlabeled > 0 && run.status !== "running" && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {run.unlabeled} {run.unlabeled === 1 ? "mention has" : "mentions have"} no label yet, so Recommended may read low.
          <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => onLabel(run.id)}>
            {busy === "label" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Label them
          </Button>
        </p>
      )}

      {discovered.length > 0 && (
        <div className="text-xs">
          <p className="font-medium text-foreground">
            Discovered <span className="font-normal text-muted-foreground">· brands ChatGPT named that are not on your tracked list. Track one to score it like a competitor, in this Run and every other.</span>
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {discovered.map((d) => (
              <li key={d.name} className="inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5">
                <span className="text-foreground">{d.name}</span>
                <span className="tabular-nums text-muted-foreground">{d.runs} of {s.runs} · {d.signal}</span>
                <button type="button" className="inline-flex items-center text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => onTrack(d.name)}><Plus className="h-3 w-3" />Track</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Counted by the app from the stored answers, with today&apos;s tracked list, so every Run is scored the same way. ± is the margin at this number of runs: a later change counts as a real move only if it is larger.
      </p>
    </div>
  );
}
