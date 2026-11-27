import React, { useState } from "react";
import { compareRuns } from "../../../../lib/fan-out/compare.js";
import { SummaryCard, runName } from "./Score";

const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;

function Verdict({ real, good }) {
  if (!real) return <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Within noise</span>;
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${good ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-800"}`}>Real move</span>;
}

/**
 * Baseline versus the latest Run, in three parts: did the score move, did what we wrote work,
 * and what changed around us. Shown once a Scenario has a Baseline and a later Run.
 */
export default function CompareBlock({ data, baselineId, cards }) {
  const [against, setAgainst] = useState("baseline");
  const runs = (data?.runs || []).filter((r) => !r.legacy && r.status !== "running" && r.score.runs > 0).map((r) => ({ ...r, baseline: r.id === baselineId }));
  const now = runs[runs.length - 1];
  const baseline = runs.find((r) => r.baseline);
  const previous = runs[runs.length - 2];
  if (!now || !baseline || baseline.id === now.id) return null;
  const before = against === "previous" && previous ? previous : baseline;
  const c = compareRuns(before, now, { cards, cutoff: data.cutoff });
  const head = c.scores.slice(0, 3);
  return (
    <SummaryCard title="Did it move?">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{runName(now)} ({day(now.started_at)}) versus</span>
        {previous && previous.id !== baseline.id ? (
          <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={against} onChange={(e) => setAgainst(e.target.value)} aria-label="Compare with">
            <option value="baseline">the Baseline ({day(baseline.started_at)})</option>
            <option value="previous">the previous Run ({day(previous.started_at)})</option>
          </select>
        ) : (
          <span className="text-muted-foreground">the Baseline ({day(baseline.started_at)})</span>
        )}
      </div>

      {c.modelChanged && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">ChatGPT itself changed between these Runs ({c.models.before} then, {c.models.now} now). A score can move for that reason alone.</p>}
      {c.together && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Most competitors moved the same way as you. When everyone moves together, the cause is probably ChatGPT, not your content.</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2 font-normal">1. Did the score move?</th>
              <th className="py-1.5 pr-2 font-normal">{against === "previous" && previous ? "Previous" : "Baseline"}</th>
              <th className="py-1.5 pr-2 font-normal">Now</th>
              <th className="py-1.5 pr-2 font-normal">Change</th>
              <th className="py-1.5 pr-2 font-normal">Verdict</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {c.scores.map((s, i) => (
              <tr key={s.label} className={`border-b border-border/60 ${i < head.length ? "text-foreground" : "text-muted-foreground"}`}>
                <td className="py-1.5 pr-2">{s.label}</td>
                <td className="py-1.5 pr-2">{s.before.pct}% <span className="text-muted-foreground">±{s.before.margin}</span></td>
                <td className="py-1.5 pr-2">{s.now.pct}% <span className="text-muted-foreground">±{s.now.margin}</span></td>
                <td className="py-1.5 pr-2">{signed(s.change)} points</td>
                <td className="py-1.5 pr-2"><Verdict real={s.real} good={s.change > 0} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.rank && <p className="text-xs text-foreground">Rank among tracked brands: {c.rank.before ? `number ${c.rank.before}` : "not named"} then, {c.rank.now ? `number ${c.rank.now}` : "not named"} now, of {c.rank.of}. <span className="text-muted-foreground">A change is a real move only if it is larger than the margin; scores by prompt type have a wide margin and are directional only.</span></p>}

      <div className="text-xs">
        <p className="font-medium text-foreground">2. Did what we wrote work?</p>
        {c.acted.length === 0 ? (
          <p className="text-muted-foreground">Nothing was acted on before this Run. An Opportunity counts once its article is live in AEO Generation, or once a to-do is marked Done.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {c.acted.map((a) => (
              <li key={a.cardId} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5">
                <span className={`rounded border px-1.5 py-0.5 text-[11px] ${a.moved ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-border bg-muted text-muted-foreground"}`}>{a.moved ? "Moved" : "Not moved"}</span>
                <span className="min-w-0 flex-1 basis-60 text-foreground">{a.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  named in {a.before.named} of {a.before.of} then, {a.searched ? `${a.now.named} of ${a.now.of} now` : "not searched in this Run"} · {a.url ? (a.cited ? "your page is now cited" : "your page is not cited") : "no page address on file"} · acted on {day(a.actedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {c.acted.length > 0 && <p className="mt-1 text-muted-foreground">Moved means you went from being named in fewer than half of the runs for that search to half or more. The Insight behind each one is marked Confirmed or Not confirmed in the bank.</p>}
      </div>

      <div className="text-xs">
        <p className="font-medium text-foreground">3. What changed around us?</p>
        <ul className="mt-1 space-y-0.5 text-foreground">
          <li>New searches: {c.around.newGroups.length ? c.around.newGroups.map((g) => `${g.label} (${g.verdict.toLowerCase()})`).join(" · ") : <span className="text-muted-foreground">none</span>}</li>
          <li>Wins where you slipped: {c.around.slipped.length ? c.around.slipped.map((g) => `${g.label} (${g.before.named} of ${g.before.of} then, ${g.now.named} of ${g.now.of} now; an Opportunity again)`).join(" · ") : <span className="text-muted-foreground">none</span>}</li>
          <li>Competitors that rose: {c.around.rose.length ? c.around.rose.map((x) => `${x.name} ${signed(x.change)} to ${x.now}%`).join(" · ") : <span className="text-muted-foreground">none beyond the margin</span>}</li>
          <li>Competitors that fell: {c.around.fell.length ? c.around.fell.map((x) => `${x.name} ${signed(x.change)} to ${x.now}%`).join(" · ") : <span className="text-muted-foreground">none beyond the margin</span>}</li>
        </ul>
      </div>
    </SummaryCard>
  );
}
