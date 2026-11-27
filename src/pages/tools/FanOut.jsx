import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, Lock, Play, Plus, RefreshCw, Send, Sparkles, Square, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTIONS,
  DIRECTIONS,
  FORM_LABELS,
  KNOWLEDGE_LEVELS,
  LIST_TYPES,
  PROMPT_MAX,
  PUSHABLE,
  STAGES,
  STEPS,
  STEP_LABELS,
  TYPE_ORDER,
  isPersona,
  isWeak,
  listsToGetOn,
  missingFields,
  planRuns,
  promptIssues,
  promptLabel,
  staleAfter,
} from "../../../lib/fan-out/core.js";
import {
  addPrompt,
  buildPersona,
  buildTopics,
  checkSituation,
  createSituation,
  deleteSituation,
  listSituations,
  loadContentMap,
  loadRunDetail,
  loadSituation,
  pushTopics,
  removePrompt,
  runStep,
  savePromptText,
  situationRow,
  structureText,
  updateSituation,
  updateTopic,
  writePrompts,
} from "./fanOut/api";

const inputClass = "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const PERSONA_FIELDS = [
  ["who", "Who they are"],
  ["where_they_stand", "Where they stand"],
  ["inside", "What is going on inside"],
  ["location", "Where they are"],
];
const STANDING_TONE = {
  Named: "border-emerald-300 bg-emerald-50 text-emerald-800",
  "Cited, not named": "border-amber-300 bg-amber-50 text-amber-800",
  "Retrieved, not cited": "border-amber-300 bg-amber-50 text-amber-800",
  Absent: "border-border bg-muted text-muted-foreground",
  "No search": "border-border bg-muted text-muted-foreground",
};
const domainOf = (c) => c?.domain || "";

function Chip({ children, tone = "border-border bg-muted text-muted-foreground" }) {
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${tone}`}>{children}</span>;
}

/** All six steps, always visible: done, current, upcoming, out of date. Click a done step to jump to it. */
function Tracker({ states, onOpen }) {
  return (
    <ol className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 rounded-lg border border-border bg-background/95 p-2 backdrop-blur">
      {STEPS.map((step, i) => {
        const s = states[step];
        const tone =
          s === "current" ? "border-foreground bg-foreground text-background"
          : s === "stale" ? "border-amber-400 bg-amber-50 text-amber-900"
          : s === "done" ? "border-emerald-300 bg-emerald-50 text-emerald-900"
          : "border-border text-muted-foreground opacity-60";
        return (
          <li key={step} className="flex-1 basis-24">
            <a href={`#fo-${step}`} onClick={() => onOpen(step)} className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium ${tone}`}>
              <span className="tabular-nums">{i + 1}</span>
              <span>{STEP_LABELS[step]}</span>
              {s === "done" && <Check className="ml-auto h-3 w-3" />}
              {s === "stale" && <span className="ml-auto text-[10px] font-normal">out of date</span>}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One step: what went in, what it did, what came out, and the exact request and reply behind it.
 * A step the user has moved past folds into one line with its result; a click opens it again.
 */
function Panel({ step, state, did, summary, open, onToggle, details, children }) {
  const n = STEPS.indexOf(step) + 1;
  const tone = state === "current" ? "border-foreground/40" : state === "stale" ? "border-amber-300" : "border-border";
  return (
    <section id={`fo-${step}`} className={`scroll-mt-16 rounded-lg border bg-card ${tone} ${state === "upcoming" ? "opacity-60" : ""}`}>
      <button type="button" onClick={() => onToggle(step)} aria-expanded={open} className={`flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-left ${open ? "border-b border-border" : ""}`}>
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {open ? <ChevronDown className="h-3.5 w-3.5 self-center text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 self-center text-muted-foreground" />}
          {n}. {STEP_LABELS[step]}
          {!open && state === "done" && <Check className="h-3.5 w-3.5 self-center text-emerald-700" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{open ? did : summary || did}</span>
        {state === "stale" && <span className="text-xs text-amber-800">{open ? "Out of date: an earlier step changed. Redo this step." : "Out of date"}</span>}
      </button>
      {open && (
        <div className="space-y-3 p-4">
          {children}
          {details?.request != null && (
            <details className="rounded-md border border-border bg-muted/30 text-xs">
              <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground">Show details: the exact request and reply</summary>
              <div className="space-y-2 border-t border-border p-3">
                <p className="font-medium text-foreground">Sent to Claude</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{details.request || "(nothing was sent)"}</pre>
                <p className="font-medium text-foreground">Reply</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{details.reply}</pre>
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function RunRow({ run, brands }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const named = brands.filter((b) => run.brands?.[b.id]?.named).map((b) => b.name);
  const toggle = async () => {
    setOpen((v) => !v);
    if (!detail && run.status === "ok") setDetail(await loadRunDetail(run.id).catch(() => ({ answer: "The answer could not be loaded." })));
  };
  if (run.status !== "ok") {
    return (
      <li className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs">
        <span className="font-medium text-destructive">Run {run.run_no} failed</span> after {run.attempts} {run.attempts === 1 ? "try" : "tries"}: {String(run.error || "no result").replace(/\.+$/, "")}. Not charged.
      </li>
    );
  }
  return (
    <li className="rounded-md border border-border px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">Run {run.run_no}</span>
        <span className="tabular-nums text-muted-foreground">{run.seconds}s · ${Number(run.cost).toFixed(3)}{run.attempts > 1 ? " · second try" : ""}</span>
        {!run.searched && <Chip>No search</Chip>}
        {named.length > 0 && <Chip tone="border-sky-300 bg-sky-50 text-sky-800">Named: {named.join(", ")}</Chip>}
        <button type="button" onClick={toggle} className="ml-auto text-muted-foreground underline underline-offset-2 hover:text-foreground">{open ? "Hide answer" : "Show answer"}</button>
      </div>
      {run.fan_out.length > 0 && (
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 font-mono text-[11px] text-foreground">
          {run.fan_out.map((q, i) => <li key={i}>{q}</li>)}
        </ol>
      )}
      <p className="mt-1.5 text-muted-foreground">
        Cited: {[...new Set(run.cited.map(domainOf))].join(", ") || "nothing"} · Found on {new Set(run.search_results.map(domainOf)).size} {new Set(run.search_results.map(domainOf)).size === 1 ? "site" : "sites"}
        {run.own_cited_urls.length > 0 ? ` · Own pages cited: ${run.own_cited_urls.join(", ")}` : ""}
      </p>
      {open && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px] text-foreground">{detail ? detail.answer : "Loading…"}</pre>}
    </li>
  );
}

function TopicCard({ topic, okRuns, map, busy, onChange }) {
  const [title, setTitle] = useState(topic.title);
  const [points, setPoints] = useState((topic.answer_points || []).join("\n"));
  useEffect(() => { setTitle(topic.title); setPoints((topic.answer_points || []).join("\n")); }, [topic.id, topic.title, topic.answer_points]);
  const weak = isWeak(topic, okRuns);
  const group = map.groups.find((g) => g.id === topic.group_id);
  const pushed = topic.status === "pushed";
  const removed = topic.status === "removed";
  const pushable = PUSHABLE.has(topic.action);
  const named = topic.named || [];
  const lists = (topic.winners || []).flatMap((w) => (w.pages || []).filter((p) => LIST_TYPES.has(p.type) && p.url).map((p) => ({ ...p, domain: w.domain, title: p.title || w.domain })));
  const needsTheme = topic.action === "new_article" || topic.action === "comparison_article";
  const save = (patch) => onChange(topic.id, patch);
  return (
    <div className={`space-y-2 rounded-md border px-3 py-3 text-sm ${topic.status === "approved" ? "border-emerald-300" : "border-border"} ${removed ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputClass} h-9 min-w-0 flex-1 text-sm font-medium`} value={title} disabled={pushed} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== topic.title && save({ title: title.trim() })} />
        <Chip>{topic.runs_seen} of {okRuns} runs · {topic.forms_seen} {topic.forms_seen === 1 ? "form" : "forms"}</Chip>
        {weak && <Chip tone="border-amber-300 bg-amber-50 text-amber-800">Seen once</Chip>}
        {topic.local && <Chip tone="border-amber-300 bg-amber-50 text-amber-800">Place not in the prompt</Chip>}
        <Chip tone={STANDING_TONE[topic.standing]}>{topic.standing}</Chip>
      </div>
      <div>
        <p className="text-xs font-medium text-foreground">Searches ChatGPT ran</p>
        <ul className="mt-0.5 space-y-0.5 font-mono text-[11px] text-foreground">
          {(topic.queries || []).map((q, i) => <li key={i}>{q.q} <span className="text-muted-foreground">· {q.runs}×</span></li>)}
        </ul>
      </div>
      <div className="text-xs">
        <p className="font-medium text-foreground">Who ChatGPT names</p>
        {named.length ? (
          <p className="mt-0.5 flex flex-wrap gap-1">
            {named.map((b) => (
              <Chip key={b.name} tone={b.own ? "border-emerald-300 bg-emerald-50 text-emerald-800" : b.tracked ? "border-sky-300 bg-sky-50 text-sky-800" : undefined}>
                {b.name} · {b.runs} of {topic.runs_seen}{b.own ? " · you" : b.tracked ? " · tracked" : ""}
              </Chip>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground">No company is named in these answers.</p>
        )}
      </div>
      <div className="text-xs">
        <p className="font-medium text-foreground">Who is cited today</p>
        <p className="text-muted-foreground">{(topic.winners || []).map((w) => `${w.domain} (${w.cited}${w.type && w.type !== "other" ? `, ${w.type}` : ""})`).join(" · ") || "Nobody was cited in these runs."}</p>
        {topic.owner_note && <p className="mt-0.5 text-foreground">{topic.owner_note}</p>}
      </div>
      {lists.length > 0 && (
        <div className="text-xs">
          <p className="font-medium text-foreground">Lists to get on <span className="font-normal text-muted-foreground">· pages that name several providers</span></p>
          <ul className="mt-0.5 space-y-0.5">
            {lists.map((l) => <li key={l.url}><a className="underline underline-offset-2" href={l.url} target="_blank" rel="noreferrer">{l.title}</a> <span className="text-muted-foreground">· {l.domain} · {l.type} · cited {l.cited}×</span></li>)}
          </ul>
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-foreground">What the article must answer <span className="font-normal text-muted-foreground">· one per line; your hot takes are added on the brief</span></p>
        <Textarea className="mt-1 min-h-[96px] text-xs md:text-xs" value={points} disabled={pushed} onChange={(e) => setPoints(e.target.value)} onBlur={() => save({ answer_points: points.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean) })} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="text-muted-foreground">Action</label>
        <select className={`${inputClass} max-w-full`} value={topic.action} disabled={pushed || busy} onChange={(e) => save({ action: e.target.value, action_reason: "Set by hand.", status: "proposed" })}>
          {Object.entries(ACTIONS).filter(([k]) => k !== "existing_group" || group).map(([k, label]) => <option key={k} value={k}>{label}{k === "existing_group" && group ? `: ${group.code}` : ""}</option>)}
        </select>
        {needsTheme && (
          <>
            <label className="text-muted-foreground">Theme</label>
            <select className={`${inputClass} max-w-full`} value={topic.pillar_id || ""} disabled={pushed || busy} onChange={(e) => save({ pillar_id: e.target.value || null })}>
              <option value="">Choose…</option>
              {map.pillars.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </>
        )}
        <span className="min-w-0 basis-full text-muted-foreground sm:flex-1 sm:basis-0">{topic.action_reason}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {pushed ? (
          <Chip tone="border-emerald-300 bg-emerald-50 text-emerald-800">Pushed{group ? ` to ${group.code}` : ""}</Chip>
        ) : (
          <>
            {pushable && !removed && (
              <Button type="button" size="sm" variant={topic.status === "approved" ? "default" : "outline"} disabled={busy} onClick={() => save({ status: topic.status === "approved" ? "proposed" : "approved" })}>
                <Check className="mr-1.5 h-3.5 w-3.5" />{topic.status === "approved" ? "Approved" : "Approve for push"}
              </Button>
            )}
            {!pushable && !removed && (
              <span className="text-xs text-muted-foreground">
                Not an article: nothing is pushed for this action. Handle it on the site.
                {topic.action === "commercial_page" && " Or set the action to Comparison article to push one; whether that gets you named is unproven, so try it on one topic first."}
              </span>
            )}
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => save({ status: removed ? "proposed" : "removed" })}>{removed ? "Restore" : "Remove"}</Button>
          </>
        )}
      </div>
    </div>
  );
}


const EMPTY_FIELDS = { who: "", trigger_event: "", goal: "", stage: "", direction: "recommend", comments: "" };
const fieldsOf = (s) => ({ who: s?.who || "", trigger_event: s?.trigger_event || "", goal: s?.goal || "", stage: s?.stage || "", direction: s?.direction || "recommend", comments: s?.comments || "" });
const sameFields = (a, b) => Object.keys(EMPTY_FIELDS).every((k) => String(a[k] || "").trim() === String(b[k] || "").trim());
const lines = (text, max) => [...new Set(String(text || "").split(/\n|;/).map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean))].slice(0, max);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/** The Situation fields of step 1: Who, Trigger, Goal, Stage, Direction, Additional comments. */
function SituationFields({ value, onChange, disabled, idPrefix }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const text = [
    ["who", "Who", "Role and context. For example: founder and CEO of a three-person B2B SaaS, two years in."],
    ["trigger_event", "Trigger", "What just happened, or what is forcing action now."],
    ["goal", "Goal", "What they are trying to get done."],
  ];
  const dir = DIRECTIONS[value.direction] || DIRECTIONS.recommend;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {text.map(([key, label, hint]) => (
          <div key={key}>
            <label className="text-xs font-medium text-foreground" htmlFor={`${idPrefix}-${key}`}>{label}</label>
            <Textarea id={`${idPrefix}-${key}`} className="mt-1 min-h-[84px]" value={value[key]} disabled={disabled} placeholder={hint} onChange={set(key)} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <label className="font-medium text-foreground" htmlFor={`${idPrefix}-stage`}>Stage</label>
        <select id={`${idPrefix}-stage`} className={inputClass} value={value.stage} disabled={disabled} onChange={set("stage")}>
          <option value="">Choose…</option>
          {Object.entries(STAGES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="font-medium text-foreground" htmlFor={`${idPrefix}-direction`}>Direction</label>
        <select id={`${idPrefix}-direction`} className={inputClass} value={value.direction} disabled={disabled} onChange={set("direction")}>
          {Object.entries(DIRECTIONS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
        </select>
        <span className="min-w-0 basis-full text-muted-foreground lg:flex-1 lg:basis-0">{dir.hint}</span>
      </div>
      <div>
        <label className="text-xs font-medium text-foreground" htmlFor={`${idPrefix}-comments`}>Additional comments <span className="font-normal text-muted-foreground">· optional; passed as extra context to the persona and the prompts</span></label>
        <Textarea id={`${idPrefix}-comments`} className="mt-1 min-h-[56px]" value={value.comments} disabled={disabled} onChange={set("comments")} />
      </div>
    </div>
  );
}

/**
 * Step 1 for a new Scenario: fill the fields (or paste free text and let the AI sort it), get a name
 * and the overlap check against the bank, then choose: open the existing one, save as a variant, or create new.
 */
function NewSituation({ companyId, situations, working, guard, busy, onCreated, onOpen }) {
  const [text, setText] = useState("");
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [missing, setMissing] = useState(null);
  const [checked, setChecked] = useState(null); // { name, matches, fields }: the check, and the fields it was made for
  const [name, setName] = useState("");
  const [choice, setChoice] = useState("new"); // "new", or the id of the Situation this one is a variant of
  const current = checked && sameFields(checked.fields, fields) ? checked : null;
  const gaps = missingFields(fields);

  const structure = () => guard("structure", async () => {
    const out = await structureText(companyId, text);
    setFields({ ...EMPTY_FIELDS, ...out.fields });
    setMissing(out.missing);
    setChecked(null);
  });

  const check = () => guard("check", async () => {
    const out = await checkSituation(companyId, fields);
    setChecked({ ...out, fields });
    setName(out.name);
    setChoice("new");
  });

  const save = () => guard("create", async () => {
    if (!name.trim()) throw new Error("Give the Situation a name first.");
    const row = await createSituation(companyId, { fields, title: name, variantOf: choice === "new" ? "" : choice }, situations);
    onCreated(row);
  });

  const same = current?.matches.find((m) => m.match === "same");
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed border-border p-3">
        <label className="text-xs font-medium text-foreground" htmlFor="fo-free">Describe it in your own words <span className="font-normal text-muted-foreground">· optional; the AI sorts it into the fields below and flags what is missing</span></label>
        <Textarea id="fo-free" className="mt-1 min-h-[72px]" value={text} disabled={working} onChange={(e) => setText(e.target.value)} placeholder="For example: a founder and CEO of a three-person B2B SaaS has spent three weeks on cold outreach to investors with no replies, and wants to raise a seed round. She is comparing ways to get in front of investors." />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={working || text.trim().length < 20} onClick={structure}>
            {busy === "structure" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}Fill the fields from this
          </Button>
          {missing && missing.length > 0 && <span className="text-xs text-amber-800">Your text does not say: {missing.join(", ")}. Fill {missing.length === 1 ? "it" : "them"} in below.</span>}
          {missing && missing.length === 0 && <span className="text-xs text-emerald-800">All fields filled. Review them below.</span>}
        </div>
      </div>

      <SituationFields idPrefix="fo-new" value={fields} onChange={setFields} disabled={working} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={current ? "outline" : "default"} disabled={working || gaps.length > 0} onClick={check}>
          {busy === "check" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}{current ? "Check again" : "Name it and check for overlap"}
        </Button>
        {gaps.length > 0 && <span className="text-xs text-muted-foreground">Still to fill: {gaps.join(", ")}.</span>}
        {checked && !current && <span className="text-xs text-amber-800">The fields changed since the check. Check again.</span>}
      </div>

      {current && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <label className="text-xs font-medium text-foreground" htmlFor="fo-name">Name <span className="font-normal text-muted-foreground">· suggested; edit or accept</span></label>
            <input id="fo-name" className={`${inputClass} mt-1 h-9 w-full text-sm`} value={name} disabled={working} onChange={(e) => setName(e.target.value)} />
          </div>
          {current.matches.length === 0 ? (
            <p className="text-xs text-emerald-800">Distinct: nothing in this company&apos;s Situation bank has the same goal.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">Similar Situations in the bank</p>
              {current.matches.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                  <Chip tone={m.match === "same" ? "border-amber-300 bg-amber-50 text-amber-800" : "border-sky-300 bg-sky-50 text-sky-800"}>{m.match === "same" ? "Same" : "Variant"}</Chip>
                  <span className="font-medium text-foreground">{m.code} · {m.title || "(no name)"}</span>
                  <span className="min-w-0 basis-full text-muted-foreground md:flex-1 md:basis-0">{m.why}</span>
                  <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => onOpen(m.id)}>Use this one</Button>
                </div>
              ))}
              {same && <p className="text-xs text-amber-800">{same.code} has the same trigger, goal and stage. Use it instead of creating a second one: running it again is how you check an existing Scenario.</p>}
              <fieldset className="space-y-1 text-xs">
                <legend className="font-medium text-foreground">Or save this one</legend>
                {current.matches.map((m) => (
                  <label key={m.id} className="flex items-center gap-2">
                    <input type="radio" name="fo-choice" checked={choice === m.id} disabled={working} onChange={() => setChoice(m.id)} /> As a variant of {m.code}, linked to it
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input type="radio" name="fo-choice" checked={choice === "new"} disabled={working} onChange={() => setChoice("new")} /> As a new Situation
                </label>
              </fieldset>
            </div>
          )}
          <Button type="button" size="sm" disabled={working || !name.trim()} onClick={save}>
            {busy === "create" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}{choice === "new" ? "Save to the bank" : "Save as a variant"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function FanOut() {
  const { companyId } = useParams();
  const [params, setParams] = useSearchParams();
  const currentId = params.get("s") || "";
  const [situations, setSituations] = useState([]);
  const [map, setMap] = useState({ pillars: [], groups: [], ownNames: [], allNames: [], brands: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [title, setTitle] = useState("");
  const [personaEdit, setPersonaEdit] = useState({ knowledge_level: "informed", what_matters: "", vocabulary: "" });
  const [promptEdit, setPromptEdit] = useState({});
  const [adding, setAdding] = useState(null); // { form, text }: the user's own prompt being written
  const [progress, setProgress] = useState("");
  const [pushNotes, setPushNotes] = useState([]);
  const stopRef = useRef(false);
  const [folds, setFolds] = useState({});

  const guard = useCallback(async (label, fn) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err?.message || "Something went wrong");
    } finally {
      setBusy("");
    }
  }, []);

  const reloadList = useCallback(async () => setSituations(await listSituations(companyId)), [companyId]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([listSituations(companyId), loadContentMap(companyId)])
      .then(([list, m]) => { if (live) { setSituations(list); setMap(m); } })
      .catch((err) => live && setError(err?.message || "Could not load"))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [companyId]);

  const show = useCallback((loaded) => {
    setData(loaded);
    setFields(fieldsOf(loaded.situation));
    setTitle(loaded.situation.title || "");
    const p = loaded.situation.persona || {};
    setPersonaEdit({ knowledge_level: p.knowledge_level || "informed", what_matters: (p.what_matters || []).join("\n"), vocabulary: (p.vocabulary || []).join("\n") });
    setPromptEdit({});
    setAdding(null);
  }, []);

  const open = useCallback(async (id) => {
    if (!id) return setData(null);
    const loaded = await loadSituation(id);
    if (!loaded.situation) return setData(null);
    show(loaded);
  }, [show]);

  useEffect(() => {
    setPushNotes([]);
    open(currentId).catch((err) => setError(err?.message || "Could not load the situation"));
  }, [currentId, open]);

  const situation = data?.situation || null;
  const prompts = useMemo(() => data?.prompts || [], [data]);
  const runs = useMemo(() => data?.runs || [], [data]);
  const topics = useMemo(() => data?.topics || [], [data]);
  const okRuns = runs.filter((r) => r.status === "ok").length;
  const persona = situation?.persona || {};
  const newPersona = isPersona(persona);
  const oldPersona = !newPersona && Boolean(persona.who);
  const gaps = situation ? missingFields(situation) : [];
  const frozen = Boolean(situation?.prompts_confirmed_at);
  const has = useMemo(() => ({ persona: newPersona || oldPersona, prompts: prompts.length > 0, run: runs.length > 0, topics: topics.length > 0, push: topics.length > 0 }), [newPersona, oldPersona, prompts, runs, topics]);

  const states = useMemo(() => {
    const done = {
      describe: Boolean(situation),
      persona: has.persona,
      prompts: has.prompts,
      run: okRuns > 0,
      topics: has.topics || ["topics", "push"].includes(situation?.step),
      push: topics.some((t) => t.status === "pushed"),
    };
    const staleAt = situation?.stale_from ? STEPS.indexOf(situation.stale_from) : -1;
    const out = {};
    let currentSet = false;
    STEPS.forEach((step, i) => {
      const stale = staleAt !== -1 && i >= staleAt && done[step];
      if (stale) out[step] = "stale";
      else if (done[step]) out[step] = "done";
      else if (!currentSet) { out[step] = "current"; currentSet = true; }
      else out[step] = "upcoming";
    });
    return out;
  }, [situation, has, okRuns, topics]);

  // Open by default: the step to act on. That is the first out-of-date step, or else the last finished
  // step (to read its result) and the one after it. Everything the user has moved past is folded.
  const openByDefault = useMemo(() => {
    const firstStale = STEPS.find((s) => states[s] === "stale");
    if (firstStale) return new Set([firstStale]);
    const out = new Set(STEPS.filter((s) => states[s] === "current"));
    const done = STEPS.filter((s) => states[s] === "done");
    if (done.length) out.add(done[done.length - 1]);
    return out;
  }, [states]);
  const defaultKey = `${situation?.id || ""}|${[...openByDefault].join(",")}`;
  useEffect(() => setFolds({}), [defaultKey]);
  const isOpen = (step) => folds[step] ?? openByDefault.has(step);
  const toggle = (step) => setFolds((f) => ({ ...f, [step]: !(f[step] ?? openByDefault.has(step)) }));
  const openStep = (step) => setFolds((f) => ({ ...f, [step]: true }));
  const panel = (step) => ({ step, state: states[step], open: isOpen(step), onToggle: toggle });

  const patchSituation = async (patch) => {
    const next = await updateSituation(situation.id, patch);
    setData((d) => ({ ...d, situation: next }));
    return next;
  };

  /* Step 1: the Situation */
  const fieldsDirty = Boolean(situation) && (!sameFields(fields, fieldsOf(situation)) || title.trim() !== (situation.title || ""));
  const fieldGaps = missingFields(fields);

  const fillFromDescription = () => guard("structure", async () => {
    const out = await structureText(companyId, situation.description);
    setFields({ ...EMPTY_FIELDS, ...out.fields });
  });

  const saveFields = () => guard("describe", async () => {
    if (fieldGaps.length) throw new Error(`Still to fill: ${fieldGaps.join(", ")}.`);
    const before = fieldsOf(situation);
    const onlyDirection = sameFields({ ...fields, direction: before.direction }, before);
    const changed = !sameFields(fields, before);
    // A changed Situation makes the persona out of date; a changed Direction only the prompts.
    const stale = !changed ? situation.stale_from : onlyDirection ? (has.prompts ? "prompts" : situation.stale_from) : staleAfter("describe", has);
    await patchSituation({
      ...situationRow(fields),
      title: title.trim().slice(0, 120),
      version: 2,
      stale_from: stale,
      ...(changed ? { prompts_confirmed_at: null } : {}),
      ...(changed && !onlyDirection ? { persona_confirmed_at: null } : {}),
    });
    await reloadList();
  });

  /* Step 2: the Persona */
  const doPersona = () => guard("persona", async () => {
    const out = await buildPersona(companyId, situation.id);
    show({ ...data, situation: out.situation });
  });

  const personaDirty = newPersona && (personaEdit.knowledge_level !== persona.knowledge_level || lines(personaEdit.what_matters, 3).join("|") !== (persona.what_matters || []).join("|") || lines(personaEdit.vocabulary, 5).join("|") !== (persona.vocabulary || []).join("|"));

  const savePersona = (approve) => guard("persona-edit", async () => {
    const next = { ...persona, knowledge_level: personaEdit.knowledge_level, what_matters: lines(personaEdit.what_matters, 3), vocabulary: lines(personaEdit.vocabulary, 5) };
    const named = [...next.what_matters, ...next.vocabulary].filter((x) => promptIssues(x, map.allNames).block.length);
    if (named.length) throw new Error(`The persona is brand-blind: it does not know any company exists. Remove: ${named.join(", ")}.`);
    await patchSituation({
      persona: next,
      persona_confirmed_at: approve ? new Date().toISOString() : situation.persona_confirmed_at,
      // Prompts written from the old persona are out of date.
      ...(personaDirty ? { stale_from: staleAfter("persona", has) || situation.stale_from, prompts_confirmed_at: null } : situation.stale_from === "persona" ? { stale_from: staleAfter("persona", has) } : {}),
    });
  });

  /* Step 3: the prompts */
  const textOf = (p) => promptEdit[p.id] ?? p.prompt;
  const issues = useMemo(() => Object.fromEntries(prompts.map((p) => [p.id, promptIssues(promptEdit[p.id] ?? p.prompt, map.allNames)])), [prompts, promptEdit, map.allNames]);
  const blocked = prompts.some((p) => issues[p.id]?.block.length);
  const unsaved = prompts.some((p) => textOf(p).trim() !== p.prompt);
  const promptsHaveRuns = runs.length > 0;

  const doPrompts = () => guard("prompts", async () => {
    if (promptsHaveRuns && !window.confirm("Writing the prompts again replaces them. The runs you already have stay stored, but they no longer count: the next Run is a new Baseline. Go on?")) return;
    await writePrompts(companyId, situation.id);
    await open(situation.id);
  });

  const redoPrompt = (p) => guard(`prompt-${p.id}`, async () => {
    await writePrompts(companyId, situation.id, p.id);
    await open(situation.id);
  });

  const savePromptEdit = (p) => guard("prompt-edit", async () => {
    const text = textOf(p).trim();
    if (!text || text === p.prompt) return;
    if (text.length > PROMPT_MAX) throw new Error(`${promptLabel(p, prompts)} is ${text.length.toLocaleString("en-US")} characters; the engine takes ${PROMPT_MAX.toLocaleString("en-US")} at most.`);
    await savePromptText(p, text);
    await updateSituation(situation.id, { stale_from: staleAfter("prompts", has) || situation.stale_from });
    await open(situation.id);
  });

  const dropPrompt = (p) => guard("prompt-edit", async () => {
    await removePrompt(p);
    await updateSituation(situation.id, { stale_from: staleAfter("prompts", has) || situation.stale_from });
    await open(situation.id);
  });

  const saveOwnPrompt = () => guard("prompt-edit", async () => {
    const text = String(adding?.text || "").trim();
    const found = promptIssues(text, map.allNames);
    if (found.block.length) throw new Error(found.block[0]);
    const same = prompts.filter((p) => p.form === adding.form);
    await addPrompt(situation, adding.form, text, same.reduce((m, p) => Math.max(m, (p.sort || 0) + 1), 0));
    await updateSituation(situation.id, { stale_from: staleAfter("prompts", has) || situation.stale_from });
    await open(situation.id);
  });

  const confirmPrompts = () => guard("prompt-edit", async () => {
    await patchSituation({ prompts_confirmed_at: new Date().toISOString(), stale_from: situation.stale_from === "prompts" ? staleAfter("prompts", has) : situation.stale_from });
  });

  const unlockPrompts = () => guard("prompt-edit", async () => {
    if (promptsHaveRuns && !window.confirm("The prompts are frozen so that every Run asks the same thing. If you edit them, the comparison resets and the next Run is a new Baseline. Unlock?")) return;
    await patchSituation({ prompts_confirmed_at: null });
  });

  /* Step 4: the Run */
  const needsConfirm = Number(situation?.version) >= 2 && !frozen;
  const plan = useMemo(() => planRuns(prompts, situation?.runs || 7, runs), [prompts, situation, runs]);
  const callsLeft = plan.reduce((a, s) => a + s.length, 0);

  const doRun = (again = false) => guard("run", async () => {
    stopRef.current = false;
    const steps = again ? planRuns(prompts, situation.runs, []) : plan;
    const total = steps.reduce((a, s) => a + s.length, 0);
    let done = 0;
    for (const calls of steps) {
      if (stopRef.current) break;
      setProgress(`Asking ChatGPT: ${done} of ${total} captures done (run ${calls[0].runNo} of ${situation.runs}). A capture takes 35 to 60 seconds and ${calls.length} run at a time. Keep this tab open.`);
      const out = await runStep(companyId, situation.id, calls, again);
      if (out.capReached) throw new Error(`The monthly cap is reached: $${Number(out.monthSpent).toFixed(2)} of $${Number(out.cap).toFixed(2)} spent. Raise it in AEO Playbook › Prompt Tests.`);
      done += calls.length;
      const fresh = await loadSituation(situation.id);
      setData(fresh);
    }
    setProgress("");
  }).finally(() => setProgress(""));

  const doTopics = () => guard("topics", async () => {
    const out = await buildTopics(companyId, situation.id);
    const fresh = await loadSituation(situation.id);
    setData({ ...fresh, situation: out.situation });
    await reloadList();
  });

  const changeTopic = (id, patch) => guard("topic-edit", async () => {
    const row = await updateTopic(id, patch);
    setData((d) => ({ ...d, topics: d.topics.map((t) => (t.id === id ? row : t)) }));
  });

  const approved = topics.filter((t) => t.status === "approved" && PUSHABLE.has(t.action));
  const allLists = useMemo(() => listsToGetOn(topics), [topics]);
  const doPush = () => guard("push", async () => {
    const results = await pushTopics({ companyId, situation, topics: approved, prompts });
    setPushNotes(results);
    const [fresh, m] = await Promise.all([loadSituation(situation.id), loadContentMap(companyId)]);
    setMap(m);
    setData(fresh);
    if (results.some((r) => r.ok)) await patchSituation({ step: "push" });
  });

  const remove = () => guard("delete", async () => {
    if (topics.some((t) => t.status === "pushed")) throw new Error("This Scenario has pushed topics. Its briefs stay in AEO Generation; the Scenario is kept as their record.");
    if (!window.confirm(`Delete ${situation.code} with its prompts, runs and topics?`)) return;
    await deleteSituation(situation.id);
    setParams({});
    await reloadList();
  });

  const runsOf = (p) => runs.filter((r) => r.prompt_id === p.id);
  const spent = runs.reduce((a, r) => a + Number(r.cost || 0), 0);
  const working = Boolean(busy);
  const captures = prompts.length * (situation?.runs || 0);
  const minutes = (seconds) => Math.max(1, Math.round((Math.ceil(captures / 4) * seconds) / 60));
  const variantOf = situation?.variant_of ? situations.find((s) => s.id === situation.variant_of) : null;
  const nameOf = (s) => `${s.code} · ${s.title || s.description.slice(0, 70)}`;

  return (
    <div className="space-y-5">
      <div>
        <Link to={`/company/${companyId}/aeo-playbook`} className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> AEO Playbook
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-medium text-foreground">
          Fan-Out Engine
          <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">New</span>
        </h1>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          A specific person, at a specific moment, typing into ChatGPT. The engine writes their prompts, runs them on real ChatGPT, and records whether the
          brand is named and which web searches ChatGPT runs while answering (its fan-out).
        </p>
      </div>

      {error && <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="fo-pick">Scenario</label>
              <select id="fo-pick" className={`${inputClass} w-full min-w-0 sm:w-auto sm:flex-1`} value={currentId} onChange={(e) => setParams(e.target.value ? { s: e.target.value } : {})}>
                <option value="">New Scenario…</option>
                {situations.map((s) => <option key={s.id} value={s.id}>{nameOf(s)}</option>)}
              </select>
              {situation && <Button type="button" size="sm" variant="ghost" disabled={working} onClick={remove}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>}
            </div>
            {!situation && (
              <>
                <p className="text-xs text-muted-foreground">
                  {situations.length ? "Pick a Scenario above to check it again, or define a new Situation here. One Situation per Scenario: to compare Situations, create another Scenario." : "Define the Situation: the moment that makes this person open ChatGPT."}
                </p>
                <NewSituation companyId={companyId} situations={situations} working={working} busy={busy} guard={guard} onOpen={(id) => setParams({ s: id })} onCreated={async (row) => { await reloadList(); setParams({ s: row.id }); }} />
              </>
            )}
          </section>

          {situation && (
            <>
              <Tracker states={states} onOpen={openStep} />

              <Panel {...panel("describe")} summary={[situation.title, STAGES[situation.stage], (DIRECTIONS[situation.direction] || DIRECTIONS.recommend).label].filter(Boolean).join(" · ") || situation.description} did={`${situation.code}: the moment that makes this person open ChatGPT. The persona and the prompts are built from it.`}>
                <div>
                  <label className="text-xs font-medium text-foreground" htmlFor="fo-title">Name</label>
                  <input id="fo-title" className={`${inputClass} mt-1 h-9 w-full text-sm`} value={title} disabled={working} onChange={(e) => setTitle(e.target.value)} />
                </div>
                {variantOf && <p className="text-xs text-muted-foreground"><Chip tone="border-sky-300 bg-sky-50 text-sky-800">Variant</Chip> of <button type="button" className="underline underline-offset-2" onClick={() => setParams({ s: variantOf.id })}>{nameOf(variantOf)}</button>: the same goal, with a different trigger or stage.</p>}
                {gaps.length > 0 && (
                  <div className="space-y-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>This Situation was saved as free text, before the fields below existed. Fill them in to write a persona and prompts for it. Its runs and topics are kept as they are.</p>
                    <p className="whitespace-pre-wrap text-foreground">{situation.description}</p>
                    <Button type="button" size="sm" variant="outline" disabled={working} onClick={fillFromDescription}>
                      {busy === "structure" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}Fill the fields from this text
                    </Button>
                  </div>
                )}
                <SituationFields idPrefix="fo-edit" value={fields} onChange={setFields} disabled={working} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant={fieldsDirty ? "default" : "outline"} disabled={working || !fieldsDirty || fieldGaps.length > 0} onClick={saveFields}>
                    {busy === "describe" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}Save the Situation
                  </Button>
                  {fieldsDirty && fieldGaps.length > 0 && <span className="text-xs text-muted-foreground">Still to fill: {fieldGaps.join(", ")}.</span>}
                  {fieldsDirty && fieldGaps.length === 0 && has.persona && <span className="text-xs text-amber-800">Saving a changed Situation marks the persona, and everything after it, out of date.</span>}
                </div>
              </Panel>

              <Panel {...panel("persona")} summary={newPersona ? [`Knowledge: ${persona.knowledge_level}`, (persona.vocabulary || []).slice(0, 3).join(", "), situation.persona_confirmed_at ? "approved" : "not approved yet"].filter(Boolean).join(" · ") : oldPersona ? "Written before the three-field persona" : ""} details={situation.details?.persona} did={newPersona ? "Three fields, inferred from the ICP and the Situation. Written once, then reused on every Run." : "The AI will infer three fields from the ICP and the Situation: knowledge level, what matters, vocabulary."}>
                {oldPersona && (
                  <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>This persona was written in the earlier format. Write it again to get the three fields the prompts are built from.</p>
                    {PERSONA_FIELDS.map(([key, label]) => persona[key] && <p key={key} className="text-foreground"><span className="font-medium">{label}:</span> {persona[key]}</p>)}
                  </div>
                )}
                {newPersona && (
                  <>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <label className="text-xs font-medium text-foreground" htmlFor="fo-level">Knowledge level</label>
                        <select id="fo-level" className={`${inputClass} mt-1 w-full`} value={personaEdit.knowledge_level} disabled={working} onChange={(e) => setPersonaEdit((p) => ({ ...p, knowledge_level: e.target.value }))}>
                          {KNOWLEDGE_LEVELS.map((k) => <option key={k} value={k}>{k.slice(0, 1).toUpperCase() + k.slice(1)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground" htmlFor="fo-matters">What matters <span className="font-normal text-muted-foreground">· 3 at most, one per line</span></label>
                        <Textarea id="fo-matters" className="mt-1 min-h-[84px]" value={personaEdit.what_matters} disabled={working} onChange={(e) => setPersonaEdit((p) => ({ ...p, what_matters: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground" htmlFor="fo-vocab">Vocabulary <span className="font-normal text-muted-foreground">· 5 terms at most, one per line</span></label>
                        <Textarea id="fo-vocab" className="mt-1 min-h-[84px]" value={personaEdit.vocabulary} disabled={working} onChange={(e) => setPersonaEdit((p) => ({ ...p, vocabulary: e.target.value }))} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Brand-blind: this person does not know the company exists. No company or product names here.</p>
                    {persona.has_icp === false && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">This company has no ICP on file, so the persona was inferred from the Situation alone.</p>}
                  </>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {newPersona && (
                    <Button type="button" size="sm" variant={situation.persona_confirmed_at && !personaDirty ? "outline" : "default"} disabled={working || (Boolean(situation.persona_confirmed_at) && !personaDirty)} onClick={() => savePersona(true)}>
                      <Check className="mr-1.5 h-3.5 w-3.5" />{situation.persona_confirmed_at && !personaDirty ? `Approved ${day(situation.persona_confirmed_at)}` : personaDirty ? "Save and approve" : "Approve"}
                    </Button>
                  )}
                  <Button type="button" size="sm" variant={has.persona ? "outline" : "default"} disabled={working || gaps.length > 0} onClick={doPersona}>
                    {busy === "persona" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{newPersona ? "Regenerate" : oldPersona ? "Write the persona again" : "Write the persona"}
                  </Button>
                  {gaps.length > 0 && <span className="text-xs text-muted-foreground">Fill in the Situation first: {gaps.join(", ")}.</span>}
                </div>
              </Panel>

              <Panel {...panel("prompts")} summary={has.prompts ? [`${prompts.length} prompts`, TYPE_ORDER.map((f) => `${prompts.filter((p) => p.form === f).length} ${FORM_LABELS[f].toLowerCase()}`).join(", "), frozen ? "frozen" : "not confirmed yet"].join(" · ") : ""} details={situation.details?.prompts} did={has.prompts ? "What this person would type into ChatGPT. Each prompt in a type takes a different angle on the same goal." : "The AI will write three Short, three Medium and three Long prompts in this person's words, each on a different angle."}>
                {frozen && (
                  <p className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
                    <Lock className="h-3.5 w-3.5" /> Frozen on {day(situation.prompts_confirmed_at)}. Every Run of this Scenario asks exactly these prompts.
                    <button type="button" className="ml-auto text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={working} onClick={unlockPrompts}><Unlock className="mr-1 inline h-3 w-3" />Unlock to edit</button>
                  </p>
                )}
                {TYPE_ORDER.map((form) => {
                  const mine = prompts.filter((p) => p.form === form);
                  if (!has.prompts) return null;
                  return (
                    <div key={form} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{FORM_LABELS[form]}</p>
                        {!frozen && <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => setAdding({ form, text: "" })}>Add your own</button>}
                      </div>
                      {mine.length === 0 && <p className="text-xs text-muted-foreground">No {FORM_LABELS[form].toLowerCase()} prompt.</p>}
                      {mine.map((p) => {
                        const text = textOf(p);
                        const over = text.length > PROMPT_MAX;
                        return (
                          <div key={p.id}>
                            <div className="flex flex-wrap items-baseline gap-2">
                              <label className="text-xs font-medium text-foreground" htmlFor={`fo-p-${p.id}`}>{promptLabel(p, prompts)}</label>
                              <span className="text-xs text-muted-foreground">{p.origin === "user" ? "your own" : p.angle}</span>
                              <span className={`text-xs tabular-nums ${over ? "font-medium text-destructive" : "text-muted-foreground"}`}>{text.length.toLocaleString("en-US")} characters</span>
                              {!frozen && (
                                <span className="ml-auto flex gap-3 text-xs text-muted-foreground">
                                  {p.origin !== "user" && <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => redoPrompt(p)}>{busy === `prompt-${p.id}` ? "Writing…" : "Regenerate"}</button>}
                                  <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => dropPrompt(p)}>Delete</button>
                                </span>
                              )}
                            </div>
                            <Textarea id={`fo-p-${p.id}`} className={`mt-1 ${form === "short" ? "min-h-[56px]" : form === "medium" ? "min-h-[96px]" : "min-h-[130px]"}`} value={text} disabled={working || frozen} onChange={(e) => setPromptEdit((s) => ({ ...s, [p.id]: e.target.value }))} onBlur={() => savePromptEdit(p)} />
                            {issues[p.id]?.block.map((m) => <p key={m} className="mt-1 text-xs text-destructive">{m}</p>)}
                            {issues[p.id]?.warn.map((m) => <p key={m} className="mt-1 text-xs text-amber-800">{m}</p>)}
                          </div>
                        );
                      })}
                      {adding?.form === form && (
                        <div className="rounded-md border border-dashed border-border p-2">
                          <Textarea className="min-h-[72px]" value={adding.text} disabled={working} placeholder="Your own prompt, in this person's words. No company or product names." onChange={(e) => setAdding({ form, text: e.target.value })} />
                          <div className="mt-2 flex gap-2">
                            <Button type="button" size="sm" disabled={working || !adding.text.trim()} onClick={saveOwnPrompt}>Add this prompt</Button>
                            <Button type="button" size="sm" variant="ghost" disabled={working} onClick={() => setAdding(null)}>Cancel</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  {has.prompts && !frozen && (
                    <Button type="button" size="sm" disabled={working || blocked || unsaved} onClick={confirmPrompts}><Lock className="mr-1.5 h-3.5 w-3.5" />Confirm and freeze the prompts</Button>
                  )}
                  {!frozen && (
                    <Button type="button" size="sm" variant={has.prompts ? "outline" : "default"} disabled={working || !newPersona || gaps.length > 0} onClick={doPrompts}>
                      {busy === "prompts" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{has.prompts ? "Write all again" : "Write the prompts"}
                    </Button>
                  )}
                  {!newPersona && <span className="text-xs text-muted-foreground">Write the persona first.</span>}
                  {newPersona && !situation.persona_confirmed_at && !has.prompts && <span className="text-xs text-amber-800">The persona is not approved yet. You can still go on.</span>}
                  {blocked && <span className="text-xs text-destructive">A prompt cannot be confirmed yet; see the note under it.</span>}
                </div>
              </Panel>

              <Panel {...panel("run")} summary={okRuns ? `${okRuns} of ${runs.length} captures returned · ${runs.reduce((a, r) => a + (r.fan_out || []).length, 0)} searches · $${spent.toFixed(3)}` : ""} did={okRuns ? `${okRuns} of ${runs.length} captures returned · $${spent.toFixed(3)} spent on this Scenario.` : "Each prompt is asked on real ChatGPT several times, in a fresh session each time. What repeats across runs is signal."}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="text-muted-foreground" htmlFor="fo-runs">Runs per prompt</label>
                  <input id="fo-runs" type="number" min={1} max={10} className={`${inputClass} w-16`} value={situation.runs} disabled={working} onChange={(e) => patchSituation({ runs: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))) }).catch((err) => setError(err.message))} />
                  <span className="text-muted-foreground">{prompts.length} prompts × {situation.runs} runs = {captures} captures: about ${(captures * 0.004).toFixed(2)} and {minutes(35)} to {minutes(60)} minutes. Failed captures are not charged.</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {busy === "run" ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => { stopRef.current = true; setProgress("Stopping after this step…"); }}><Square className="mr-1.5 h-3.5 w-3.5" />Stop</Button>
                  ) : (
                    <>
                      <Button type="button" size="sm" disabled={working || !has.prompts || needsConfirm || blocked || unsaved || callsLeft === 0} onClick={() => doRun(false)}>
                        <Play className="mr-1.5 h-3.5 w-3.5" />{runs.length ? `Run the ${callsLeft} missing` : "Run on ChatGPT"}
                      </Button>
                      {runs.length > 0 && <Button type="button" size="sm" variant="outline" disabled={working || needsConfirm || blocked || unsaved} onClick={() => doRun(true)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Run everything again</Button>}
                    </>
                  )}
                  {has.prompts && needsConfirm && <span className="text-xs text-muted-foreground">Confirm the prompts in step 3 first: a Run uses frozen prompts.</span>}
                  {blocked && <span className="text-xs text-destructive">A prompt cannot run yet; see the note under it.</span>}
                </div>
                {progress && <p className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progress}</p>}
                {prompts.map((p) => runsOf(p).length > 0 && (
                  <div key={p.id}>
                    <p className="text-xs font-medium text-foreground">{promptLabel(p, prompts)} <span className="font-normal text-muted-foreground">· {p.prompt.length > 110 ? `${p.prompt.slice(0, 110)}…` : p.prompt}</span></p>
                    <ul className="mt-1 space-y-1.5">{runsOf(p).map((r) => <RunRow key={r.id} run={r} brands={map.brands || []} />)}</ul>
                  </div>
                ))}
              </Panel>

              <Panel {...panel("topics")} summary={has.topics ? `${topics.length} topics · ${topics.filter((t) => t.status === "approved").length} approved · ${topics.filter((t) => t.status === "pushed").length} pushed` : ""} details={situation.details?.topics} did={has.topics ? "The searches, grouped into topics one page could answer. The action comes from a rule, shown next to it." : "Claude will group the searches into topics; rules set what to do with each."}>
                <Button type="button" size="sm" variant={has.topics ? "outline" : "default"} disabled={working || okRuns === 0} onClick={doTopics}>
                  {busy === "topics" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{has.topics ? "Group again" : "Find the topics"}
                </Button>
                {has.topics && states.topics !== "stale" && <p className="text-xs text-muted-foreground">Grouping again replaces the topics below, except the ones already pushed. Who is cited is counted per answer, not per search, so it is approximate.</p>}
                {!has.topics && situation.step === "topics" && <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">ChatGPT ran no web search in any run. It answered from memory, so no page can win these prompts through search.</p>}
                <div className="space-y-3">
                  {topics.map((t) => <TopicCard key={t.id} topic={t} okRuns={okRuns} map={map} busy={working} onChange={changeTopic} />)}
                </div>
              </Panel>

              <Panel {...panel("push")} summary={topics.some((t) => t.status === "pushed") ? `${topics.filter((t) => t.status === "pushed").length} pushed to AEO Generation as briefs` : ""} did="Approved topics become briefs in AEO Generation. Nothing is created before you click.">
                <p className="text-xs text-muted-foreground">
                  {approved.length ? `${approved.length} approved: ${approved.map((t) => t.title).join(" · ")}` : "No topic is approved yet. Approve the ones worth an article in step 5."}
                </p>
                <Button type="button" size="sm" disabled={working || approved.length === 0} onClick={doPush}>
                  {busy === "push" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Push to AEO Generation
                </Button>
                {allLists.length > 0 && (
                  <div className="rounded-md border border-border px-3 py-2 text-xs">
                    <p className="font-medium text-foreground">Lists to get on <span className="font-normal text-muted-foreground">· pages ChatGPT cited that name several providers. Getting listed there is another way to be named.</span></p>
                    <ul className="mt-1 space-y-0.5">
                      {allLists.map((l) => <li key={l.url}><a className="underline underline-offset-2" href={l.url} target="_blank" rel="noreferrer">{l.title}</a> <span className="text-muted-foreground">· {l.domain} · {l.type} · cited {l.cited}×</span></li>)}
                    </ul>
                  </div>
                )}
                {pushNotes.map((n) => <p key={n.id} className={`rounded-md px-3 py-2 text-xs ${n.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>{topics.find((t) => t.id === n.id)?.title}: {n.message}</p>)}
                {topics.some((t) => t.status === "pushed") && (
                  <p className="text-xs text-foreground">
                    Open <Link className="underline underline-offset-2" to={`/company/${companyId}/aeo-generation`}>AEO Generation</Link>: the briefs are in the batch &quot;Fan-Out {situation.code}&quot;. Add your view with &quot;Connect my hot takes&quot; on each brief.
                  </p>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
