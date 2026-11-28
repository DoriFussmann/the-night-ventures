import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_SETTINGS } from "../../../lib/fan-out/core.js";
import { REASONS } from "../../../lib/fan-out/groups.js";
import { loadAllInsights, loadEngineSettings, saveEngineSettings } from "../tools/fanOut/api";

const inputClass = "h-8 w-20 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const PROMPTS = [
  ["prompt_structure", "Sorting free text into the Situation fields", "{text}"],
  ["prompt_check", "Naming a Situation and checking the bank for overlap", "{who} {trigger} {goal} {stage} {additional_comments} {bank}"],
  ["prompt_persona", "Prompt for the persona", "{icp} {who} {trigger} {goal} {stage} {additional_comments}"],
  ["prompt_prompts", "Prompt for the prompts", "{icp} {who} {trigger} {goal} {stage} {additional_comments} {level} {what_matters} {vocabulary} {direction_rule} {n_per_type} {short_range} {medium_range} {long_range}"],
  ["prompt_labels", "Mention labels (Recommended / Listed / Qualified)", "{answers}"],
  ["prompt_groups", "Query grouping", "{person} {mode} {groups} {queries}"],
  ["prompt_card", "Cards: reasons, what to cover and the action", "{kind} {person} {group} {searches} {standing} {winner} {how} {action} {your_page} {pillars} {pages} {reasons}"],
  ["prompt_takeaway", "The three-sentence takeaway", "{facts}"],
];
const pct = (v) => Math.round(Number(v) * 100);

/** Only what differs from the defaults is saved, so a later change to a default still reaches everyone who did not edit it. */
function overrides(s) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (JSON.stringify(s[k]) !== JSON.stringify(DEFAULT_SETTINGS[k])) out[k] = s[k];
  return out;
}

/** Admin: every setting of the Fan-Out Engine, visible and editable, and the Insights counts across all companies. */
export default function FanOutSettingsCard({ cardClass = "" }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(null);
  const [insights, setInsights] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open || s) return;
    loadEngineSettings().then(setS).catch((err) => setNote(err?.message || "Could not load the settings"));
    loadAllInsights().then(setInsights).catch(() => null);
  }, [open, s]);

  const num = (key, min, max) => (
    <input type="number" min={min} max={max} className={inputClass} value={s[key]} onChange={(e) => setS({ ...s, [key]: Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))) })} />
  );
  const share = (group, key) => (
    <input type="number" min={1} max={100} className={inputClass} value={pct(s[group][key])} onChange={(e) => setS({ ...s, [group]: { ...s[group], [key]: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))) / 100 } })} />
  );
  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      if (s.signal.occasional >= s.signal.strong) throw new Error("Occasional must start below Strong.");
      if (s.cutoffs.open >= s.cutoffs.dominated) throw new Error("Open must end below Dominated.");
      for (const [key, label, fields] of PROMPTS) {
        const missing = fields.split(" ").filter((f) => !String(s[key]).includes(f));
        if (missing.length) throw new Error(`"${label}" is missing ${missing.join(", ")}. Put ${missing.length === 1 ? "it" : "them"} back, or reset the prompt.`);
      }
      setS(await saveEngineSettings(overrides(s)));
      setNote("Saved. It applies to every company from the next action on.");
    } catch (err) {
      setNote(err?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const tally = (tag) => {
    const by = {};
    for (const i of insights.filter((x) => x.tag === tag)) for (const r of i.reasons || []) by[r] = (by[r] || 0) + 1;
    return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${REASONS[r]?.label || r} ${n}`).join(" · ") || "none yet";
  };
  const row = (label, control, hint) => (
    <div className="flex flex-wrap items-center gap-2 py-1 text-xs">
      <span className="w-56 text-foreground">{label}</span>
      {control}
      {hint && <span className="text-muted-foreground">{hint}</span>}
    </div>
  );

  return (
    <section className={`${cardClass} col-span-full`}>
      <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="text-sm font-medium text-foreground">Fan-Out Engine settings</span>
        <span className="text-xs text-muted-foreground">Prompts, counts and thresholds, for every company</span>
      </button>
      {open && !s && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>}
      {open && s && (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Prompts and runs</p>
            {row("Prompts per type", num("prompts_per_type", 1, 5), "Short, Medium and Long each get this many.")}
            {row("Sentence ranges", <span className="flex gap-2">{["short", "medium", "long"].map((f) => <label key={f} className="flex items-center gap-1 text-muted-foreground">{f}<input className={inputClass} value={s.ranges[f]} onChange={(e) => setS({ ...s, ranges: { ...s.ranges, [f]: e.target.value.slice(0, 12) } })} /></label>)}</span>)}
            {row("Runs per prompt", num("runs_per_prompt", 1, 10), "For new Scenarios. Each Scenario can change its own.")}
            {row("Re-run reminder", num("reminder_days", 1, 365), "days after the last Run. Shown in the tool only.")}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Thresholds (percent of runs)</p>
            {row("Signal: Strong from", share("signal", "strong"))}
            {row("Signal: Occasional from", share("signal", "occasional"), "Below this is Noise.")}
            {row("Opportunity: searched in at least", <input className={inputClass} type="number" min={1} max={50} value={s.cutoffs.min_missed ?? 5} onChange={(e) => setS((v) => ({ ...v, cutoffs: { ...v.cutoffs, min_missed: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 5))) } }))} />, "runs where the company was not named. A count, not a percent.")}
            {row("Moved: named in at least", share("cutoffs", "opportunity"), "of the runs for that search, after being below it.")}
            {row("Difficulty: Open up to", share("cutoffs", "open"), "the most-named brand's share.")}
            {row("Difficulty: Dominated from", share("cutoffs", "dominated"))}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Summary</p>
            {row("Opportunities analyzed per Run", num("opportunities_per_run", 0, 10))}
            {row("Wins analyzed per Run", num("wins_per_run", 0, 10))}
            {row("Pages read per Query Group", num("pages_per_group", 0, 5))}
            {row("Stage to intent tier", <span className="flex flex-wrap gap-2">{[["exploring", "Exploring"], ["comparing", "Comparing"], ["ready_to_buy", "Ready to buy"]].map(([k, label]) => <label key={k} className="flex items-center gap-1 text-muted-foreground">{label} →<select className={inputClass} value={s.stage_tier[k]} onChange={(e) => setS({ ...s, stage_tier: { ...s.stage_tier, [k]: e.target.value } })}>{["Learn", "Problem", "Buy"].map((t) => <option key={t}>{t}</option>)}</select></label>)}</span>)}
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">AI prompts <span className="normal-case tracking-normal">· the words in {"{braces}"} are filled in by the app and must stay</span></p>
            {PROMPTS.map(([key, label, fields]) => (
              <details key={key} className="rounded-md border border-border">
                <summary className="cursor-pointer px-3 py-1.5 text-xs text-foreground">{label}{s[key] !== DEFAULT_SETTINGS[key] ? <span className="ml-2 text-amber-800">edited</span> : null}</summary>
                <div className="space-y-2 border-t border-border p-3">
                  <p className="text-xs text-muted-foreground">Dynamic fields: {fields}</p>
                  <Textarea className="min-h-[220px] font-mono text-xs md:text-xs" value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
                  <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setS({ ...s, [key]: DEFAULT_SETTINGS[key] })}>Reset to the default</button>
                </div>
              </details>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={save}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save settings</Button>
            {note && <span className="text-xs text-foreground">{note}</span>}
          </div>
          <div className="border-t border-border pt-3 text-xs">
            <p className="font-medium text-foreground">Insights, all companies <span className="font-normal text-muted-foreground">· {insights.length} insights from {new Set(insights.map((i) => i.company_id)).size} {new Set(insights.map((i) => i.company_id)).size === 1 ? "company" : "companies"}. Early counts are small.</span></p>
            <p className="mt-1 text-foreground">Behind own wins: <span className="text-muted-foreground">{tally("your_win")}</span></p>
            <p className="text-foreground">Behind competitors&apos; wins: <span className="text-muted-foreground">{tally("competitor_win")}</span></p>
            <p className="text-foreground">Tested by a later Run: <span className="text-muted-foreground">{insights.filter((i) => i.verdict === "confirmed").length} confirmed, {insights.filter((i) => i.verdict === "not_confirmed").length} not confirmed</span></p>
          </div>
        </div>
      )}
    </section>
  );
}
