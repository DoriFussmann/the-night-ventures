import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, Loader2, Lock, Play, Plus, RefreshCw, Sparkles, Square, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DIRECTIONS,
  FORM_LABELS,
  KNOWLEDGE_LEVELS,
  PROMPT_MAX,
  STAGES,
  STEPS,
  STEP_LABELS,
  TYPE_ORDER,
  isPersona,
  missingFields,
  planRuns,
  promptIssues,
  promptLabel,
  renameForFields,
  scenarioName,
  scenarioNumber,
  staleAfter,
} from "../../../lib/fan-out/core.js";
import {
  addPrompt,
  buildPersona,
  checkSituation,
  createSituation,
  deleteSituation,
  finishRun,
  groupRun,
  ignoreBrand,
  labelRun,
  lastRuns,
  loadEngineSettings,
  loadScore,
  listSituations,
  loadContentMap,
  loadInsights,
  loadRunDetail,
  loadSituation,
  pushCard,
  removePrompt,
  restoreBrand,
  runStep,
  savePromptText,
  situationRow,
  startRun,
  trackBrand,
  updateCard,
  structureText,
  syncScenario,
  updateSituation,
  writeCard,
  writePrompts,
  writeTakeaway,
} from "./fanOut/api";
import ScoreBlock, { DiscoveredCard, runName } from "./fanOut/Score";
import GroupsBlock, { InsightsBlock } from "./fanOut/Groups";
import CompareBlock from "./fanOut/Compare";
import { dueForRerun } from "../../../lib/fan-out/compare.js";
import { buildReport, reportFileName } from "../../../lib/fan-out/report.js";
import { CARD_ACTIONS, PUSHED_ACTIONS } from "../../../lib/fan-out/groups.js";

const inputClass = "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const PERSONA_FIELDS = [
  ["who", "Who they are"],
  ["where_they_stand", "Where they stand"],
  ["inside", "What is going on inside"],
  ["location", "Where they are"],
];
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

/** True while a Run of the Scenario is open: a Run never changes under way, so nothing it is built from can be edited. */
const scenarioRunsOpen = (data) => (data?.scenarioRuns || []).some((r) => r.status === "running");
const OPEN_RUN = "A Run of this Scenario is open. Continue it or end it in step 4 first.";

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
    // Always written the same way: number | Name in Title Case | Stage | Direction.
    const number = situations.reduce((m, s) => Math.max(m, scenarioNumber(s.code)), 0) + 1;
    setName(scenarioName({ number, name: out.name, stage: fields.stage, direction: fields.direction }));
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
  const [map, setMap] = useState({ pillars: [], groups: [], ownNames: [], allNames: [], brands: [], ignored: [] });
  const [pickedRun, setPickedRun] = useState("");
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
  const [pushNote, setPushNote] = useState(null);
  const [score, setScore] = useState(null);
  const [insights, setInsights] = useState([]);
  const [analysis, setAnalysis] = useState("");
  const [lastRun, setLastRun] = useState({}); // situation id -> when it was last run
  const [reminderDays, setReminderDays] = useState(30);
  const stopRef = useRef(false);
  const [folds, setFolds] = useState({});

  const shownRef = useRef("");
  shownRef.current = currentId;

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
      .then(() => loadInsights(companyId).then((rows) => live && setInsights(rows)).catch(() => null))
      .then(() => Promise.all([lastRuns(companyId), loadEngineSettings()]).then(([last, st]) => { if (live) { setLastRun(last); setReminderDays(st.reminder_days); } }).catch(() => null))
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
    // Data that arrives after the user moved to another Scenario is dropped.
    if (shownRef.current !== id) return;
    if (!loaded.situation) return setData(null);
    show(loaded);
  }, [show]);

  useEffect(() => {
    setPushNote(null);
    setPickedRun("");
    open(currentId).catch((err) => setError(err?.message || "Could not load the situation"));
  }, [currentId, open]);

  const refreshScore = useCallback(async (id) => {
    if (!id) return setScore(null);
    const out = await loadScore(companyId, id);
    // A score that arrives after the user moved to another Scenario is dropped.
    if (shownRef.current === id) setScore(out);
    return out;
  }, [companyId]);

  useEffect(() => {
    setScore(null);
    if (!currentId) return;
    // Opportunities whose article went live since the last visit are marked Acted on first, then everything is read.
    syncScenario(companyId, currentId)
      .then((out) => (out.marked || out.judged ? Promise.all([open(currentId), loadInsights(companyId).then(setInsights)]) : null))
      .catch(() => null)
      .then(() => refreshScore(currentId))
      .catch((err) => setError(err?.message || "Could not calculate the score"));
  }, [currentId, refreshScore, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const situation = data?.situation || null;
  const prompts = useMemo(() => data?.prompts || [], [data]);
  const scenarioRuns = useMemo(() => data?.scenarioRuns || [], [data]);
  // The Run on the page is the latest one: its captures feed the list in step 4 and the topics in step 5.
  const latestRun = scenarioRuns[scenarioRuns.length - 1] || null;
  const openRun = latestRun?.status === "running" ? latestRun : null;
  const runs = useMemo(() => (latestRun ? (data?.runs || []).filter((r) => r.scenario_run_id === latestRun.id) : []), [data, latestRun]);
  const cards = useMemo(() => data?.cards || [], [data]);
  const scoredRun = score?.runs?.length ? score.runs[score.runs.length - 1] : null;
  const grouped = (scoredRun?.groups?.all?.length || 0) > 0;
  const okRuns = runs.filter((r) => r.status === "ok").length;
  const persona = situation?.persona || {};
  const newPersona = isPersona(persona);
  const oldPersona = !newPersona && Boolean(persona.who);
  const gaps = situation ? missingFields(situation) : [];
  const frozen = Boolean(situation?.prompts_confirmed_at);
  const runOpen = scenarioRunsOpen(data);
  const has = useMemo(() => ({ persona: newPersona || oldPersona, prompts: prompts.length > 0, run: runs.length > 0, topics: cards.length > 0, push: cards.length > 0 }), [newPersona, oldPersona, prompts, runs, cards]);

  const states = useMemo(() => {
    const done = {
      describe: Boolean(situation),
      persona: has.persona,
      prompts: has.prompts,
      run: okRuns > 0,
      topics: grouped || cards.length > 0,
      push: cards.some((c) => ["pushed", "acted_on", "done"].includes(c.status)),
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
  }, [situation, has, okRuns, cards, grouped]);

  // Open by default: the step to act on. That is the first out-of-date step, or else the last finished
  // step (to read its result) and the one after it. Everything the user has moved past is folded.
  const openByDefault = useMemo(() => {
    const firstStale = STEPS.find((s) => states[s] === "stale");
    const todo = new Set();
    if (gaps.length) todo.add("describe"); // saved before the fields existed: they are the thing to fill
    if (newPersona && !situation?.persona_confirmed_at) todo.add("persona"); // written, waiting for approval
    if (firstStale) return todo.add(firstStale);
    const out = new Set([...todo, ...STEPS.filter((s) => states[s] === "current")]);
    const done = STEPS.filter((s) => states[s] === "done");
    if (done.length) out.add(done[done.length - 1]);
    return out;
  }, [states, gaps.length, newPersona, situation?.persona_confirmed_at]);
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
    if (runOpen) throw new Error(OPEN_RUN);
    if (fieldGaps.length) throw new Error(`Still to fill: ${fieldGaps.join(", ")}.`);
    const before = fieldsOf(situation);
    const onlyDirection = sameFields({ ...fields, direction: before.direction }, before);
    const changed = !sameFields(fields, before);
    // A changed Situation makes the persona out of date; a changed Direction only the prompts.
    const stale = !changed ? situation.stale_from : onlyDirection ? (has.prompts ? "prompts" : situation.stale_from) : staleAfter("describe", has);
    const saved = await patchSituation({
      ...situationRow(fields),
      // A name in the standard form follows the Stage and Direction it carries.
      title: renameForFields(title.trim(), fields.stage, fields.direction).slice(0, 160),
      version: 2,
      // The user's own words from before the fields existed are kept.
      ...(Number(situation.version) < 2 && !situation.details?.original_description ? { details: { ...(situation.details || {}), original_description: situation.description } } : {}),
      stale_from: stale,
      ...(changed ? { prompts_confirmed_at: null, baseline_run_id: null } : {}),
      ...(changed && !onlyDirection ? { persona_confirmed_at: null } : {}),
    });
    setTitle(saved.title || "");
    await reloadList();
  });

  // Runs stay stored when what produced them changes, but they stop counting: say so before it happens.
  const okToReset = (what) => scenarioRuns.length === 0 || window.confirm(`${what} The runs you already have stay stored, but they no longer count: the next Run is a new Baseline. Go on?`);

  /* Step 2: the Persona */
  const doPersona = () => guard("persona", async () => {
    if (runOpen) throw new Error(OPEN_RUN);
    if (has.prompts && !okToReset("Writing the persona again makes the prompts out of date.")) return;
    const out = await buildPersona(companyId, situation.id);
    show({ ...data, situation: out.situation });
  });

  const personaDirty = newPersona && (personaEdit.knowledge_level !== persona.knowledge_level || lines(personaEdit.what_matters, 3).join("|") !== (persona.what_matters || []).join("|") || lines(personaEdit.vocabulary, 5).join("|") !== (persona.vocabulary || []).join("|"));

  const savePersona = (approve) => guard("persona-edit", async () => {
    if (runOpen && personaDirty) throw new Error(OPEN_RUN);
    const next = { ...persona, knowledge_level: personaEdit.knowledge_level, what_matters: lines(personaEdit.what_matters, 3), vocabulary: lines(personaEdit.vocabulary, 5) };
    const named = [...next.what_matters, ...next.vocabulary].filter((x) => promptIssues(x, map.allNames).block.length);
    if (named.length) throw new Error(`The persona is brand-blind: it does not know any company exists. Remove: ${named.join(", ")}.`);
    if (personaDirty && has.prompts && !okToReset("Changing the persona makes the prompts out of date.")) return;
    await patchSituation({
      persona: next,
      persona_confirmed_at: approve ? new Date().toISOString() : situation.persona_confirmed_at,
      // Prompts written from the old persona are out of date.
      ...(personaDirty ? { stale_from: staleAfter("persona", has) || situation.stale_from, prompts_confirmed_at: null, baseline_run_id: null } : situation.stale_from === "persona" ? { stale_from: staleAfter("persona", has) } : {}),
    });
  });

  /* Step 3: the prompts */
  const textOf = (p) => promptEdit[p.id] ?? p.prompt;
  const issues = useMemo(() => Object.fromEntries(prompts.map((p) => [p.id, promptIssues(promptEdit[p.id] ?? p.prompt, map.allNames)])), [prompts, promptEdit, map.allNames]);
  const blocked = prompts.some((p) => issues[p.id]?.block.length);
  const unsaved = prompts.some((p) => textOf(p).trim() !== p.prompt);
  const promptsHaveRuns = scenarioRuns.length > 0;
  const locked = frozen || runOpen; // v1 Scenarios are never frozen, but an open Run locks their prompts too

  const doPrompts = () => guard("prompts", async () => {
    if (!okToReset("Writing the prompts again replaces them.")) return;
    await writePrompts(companyId, situation.id);
    await open(situation.id);
  });

  const hasRunsOf = (p) => runs.some((r) => r.prompt_id === p.id) || scenarioRuns.some((r) => (r.prompt_ids || []).includes(p.id));
  const okToReplace = (p, what) => !hasRunsOf(p) || window.confirm(`${promptLabel(p, prompts)} already has runs. ${what} Its runs stay stored, but they no longer count for this Scenario. Go on?`);

  const redoPrompt = (p) => guard(`prompt-${p.id}`, async () => {
    if (!okToReplace(p, "Regenerating replaces it.")) return;
    await writePrompts(companyId, situation.id, p.id);
    await open(situation.id);
  });

  const savePromptEdit = (p) => guard("prompt-edit", async () => {
    const text = textOf(p).trim();
    const revert = () => setPromptEdit((s) => ({ ...s, [p.id]: undefined }));
    if (!text) return revert(); // an emptied box goes back to the saved prompt; Delete removes one
    if (text === p.prompt) return;
    if (!okToReplace(p, "A new wording replaces it.")) return revert();
    if (text.length > PROMPT_MAX) throw new Error(`${promptLabel(p, prompts)} is ${text.length.toLocaleString("en-US")} characters; the engine takes ${PROMPT_MAX.toLocaleString("en-US")} at most.`);
    await savePromptText(p, text);
    await updateSituation(situation.id, { stale_from: staleAfter("prompts", has) || situation.stale_from, baseline_run_id: null });
    await open(situation.id);
  });

  const dropPrompt = (p) => guard("prompt-edit", async () => {
    if (!okToReplace(p, "Deleting takes it out of the Scenario.")) return;
    await removePrompt(p);
    await updateSituation(situation.id, { stale_from: staleAfter("prompts", has) || situation.stale_from, baseline_run_id: null });
    await open(situation.id);
  });

  const saveOwnPrompt = () => guard("prompt-edit", async () => {
    const text = String(adding?.text || "").trim();
    const found = promptIssues(text, map.allNames);
    if (found.block.length) throw new Error(found.block[0]);
    const same = prompts.filter((p) => p.form === adding.form);
    await addPrompt(situation, adding.form, text, same.reduce((m, p) => Math.max(m, (p.sort || 0) + 1), 0));
    await updateSituation(situation.id, { stale_from: staleAfter("prompts", has) || situation.stale_from, baseline_run_id: null });
    await open(situation.id);
  });

  const confirmPrompts = () => guard("prompt-edit", async () => {
    await patchSituation({ prompts_confirmed_at: new Date().toISOString(), stale_from: situation.stale_from === "prompts" ? staleAfter("prompts", has) : situation.stale_from });
  });

  const unlockPrompts = () => guard("prompt-edit", async () => {
    if (runOpen) throw new Error(OPEN_RUN);
    if (promptsHaveRuns && !window.confirm("The prompts are frozen so that every Run asks the same thing. If you edit them, the comparison resets and the next Run is a new Baseline. Unlock?")) return;
    await patchSituation({ prompts_confirmed_at: null, baseline_run_id: null });
  });

  /* Step 4: the Run */
  const needsConfirm = Number(situation?.version) >= 2 && !frozen;
  const hasBaseline = Boolean(situation?.baseline_run_id) && scenarioRuns.some((r) => r.id === situation.baseline_run_id);
  // An open Run asks the prompts it was started with.
  const runPrompts = useMemo(() => (openRun ? (openRun.prompt_ids || []).map((id) => ({ id })) : prompts), [openRun, prompts]);
  const perPrompt = openRun ? openRun.runs_per_prompt : situation?.runs || 7;
  const plan = useMemo(() => planRuns(runPrompts, perPrompt, openRun ? runs : []), [runPrompts, perPrompt, openRun, runs]);
  const callsLeft = plan.reduce((a, s) => a + s.length, 0);

  const endRun = async (run, stopped) => {
    setProgress("Closing the Run and recording its cost…");
    const out = await finishRun(companyId, run.id, stopped);
    await open(situation.id);
    if (out.removed) {
      setScore(null);
      await refreshScore(situation.id);
      throw new Error("Nothing came back from ChatGPT in this Run, so it was removed. Nothing was charged. Try again in a few minutes.");
    }
    // Labeling is its own step: if it is slow or fails, the Run is still closed and scored, and "Label them" finishes the job.
    setProgress("Labeling how each brand is named (Recommended, Listed or Qualified)…");
    await labelRun(companyId, run.id).catch(() => null);
    await refreshScore(situation.id);
    setProgress("");
    // Step 5 follows on its own: the searches are grouped and the top ones analyzed.
    await analyze(run.id);
  };

  const doRun = () => guard("run", async () => {
    stopRef.current = false;
    let run = openRun;
    let steps = plan;
    if (!run) {
      const started = await startRun(companyId, situation.id);
      if (started.capReached) throw new Error(`This Run is estimated at $${Number(started.estCost).toFixed(2)}, which would pass the monthly cap: $${Number(started.monthSpent).toFixed(2)} of $${Number(started.cap).toFixed(2)} is spent. Raise the cap in AEO Playbook › Prompt Tests.`);
      run = started.run;
      steps = planRuns(prompts, run.runs_per_prompt, []);
      setData((d) => ({ ...d, situation: started.situation, scenarioRuns: [...d.scenarioRuns, run] }));
    }
    const total = steps.reduce((a, s) => a + s.length, 0);
    let done = 0;
    for (const calls of steps) {
      if (stopRef.current) break;
      setProgress(`Asking ChatGPT: ${done} of ${total} captures done (run ${calls[0].runNo} of ${run.runs_per_prompt} for each prompt). A capture takes 35 to 60 seconds and ${calls.length} run at a time. Keep this tab open.`);
      const out = await runStep(companyId, run.id, calls);
      if (out.capReached) throw new Error(`The monthly cap is reached: $${Number(out.monthSpent).toFixed(2)} of $${Number(out.cap).toFixed(2)} spent. Raise it in AEO Playbook › Prompt Tests, then continue this Run.`);
      done += calls.length;
      setData(await loadSituation(situation.id));
    }
    // Stopped by hand: the Run stays open, to continue or to end as it is.
    if (stopRef.current) return open(situation.id);
    // Captures that failed are tried once more by "Continue"; the Run closes only when the user ends it or nothing is missing.
    const fresh = await loadSituation(situation.id);
    const missing = planRuns((run.prompt_ids || []).map((id) => ({ id })), run.runs_per_prompt, fresh.runs.filter((r) => r.scenario_run_id === run.id));
    if (missing.length) {
      setData(fresh);
      await refreshScore(situation.id);
      return;
    }
    await endRun(run, false);
  }).finally(() => setProgress(""));

  const closeRun = () => guard("run", async () => {
    const planned = (openRun.prompt_ids || []).length * openRun.runs_per_prompt;
    if (!window.confirm(okRuns ? `End this Run with ${okRuns} of ${planned} captures? It will be scored on the runs it has. A smaller Run has a wider margin.` : "Nothing has come back in this Run. Remove it?")) return;
    await endRun(openRun, true);
  }).finally(() => setProgress(""));

  const doLabel = (scenarioRunId) => guard("label", async () => {
    const out = await labelRun(companyId, scenarioRunId);
    await refreshScore(situation.id);
    if (out.labels?.left) throw new Error(`${out.labels.left} mentions could not be labeled. Try again.`);
  });

  // One click each. Tracking a brand scores it in every Run; its mentions are labeled right away so Recommended is complete.
  const doTrack = (name) => guard("track", async () => {
    await trackBrand(companyId, name, map.brands);
    setMap(await loadContentMap(companyId));
    const shown = score?.runs?.find((r) => r.id === pickedRun) || scoredRun;
    await refreshScore(situation.id);
    if (shown && shown.status !== "running") {
      await labelRun(companyId, shown.id).catch(() => null);
      await refreshScore(situation.id);
    }
  });

  const doIgnore = (name) => guard("track", async () => {
    await ignoreBrand(companyId, name);
    setMap(await loadContentMap(companyId));
  });

  const doRestore = (name) => guard("track", async () => {
    await restoreBrand(companyId, name);
    setMap(await loadContentMap(companyId));
  });

  // Mentions the AI left without a label are asked again when the summary is opened, once per Run per visit.
  // The "Label them" notice is then only seen when that retry did not finish the job.
  const retriedRef = useRef(new Set());
  const [labeling, setLabeling] = useState("");
  const shownRun = score?.runs?.find((r) => r.id === pickedRun) || scoredRun;
  useEffect(() => {
    if (!shownRun || !situation || score?.situationId !== situation.id) return;
    if (!shownRun.unlabeled || shownRun.status === "running" || busy || retriedRef.current.has(shownRun.id)) return;
    retriedRef.current.add(shownRun.id);
    const id = situation.id;
    setLabeling(shownRun.id);
    labelRun(companyId, shownRun.id)
      .catch(() => null)
      .then(() => refreshScore(id))
      .catch(() => null)
      .finally(() => setLabeling(""));
  }, [shownRun, situation, score, busy, companyId, refreshScore]);

  /** Steps 1 to 5 of this Scenario, for the Run on the page, as a Markdown file. Nothing is recalculated: it is what the page shows. */
  const downloadReport = () => {
    const run = shownRun;
    if (!run) return;
    const company = map.brands.find((b) => b.is_own)?.name || "";
    const text = buildReport({ company, situation, prompts, run, allRuns: score.runs, scenarioRuns, cards, ignored: map.ignored || [], limits: score.limits, signal: score.signal, cutoff: score.cutoff });
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = reportFileName(situation, run, situation.baseline_run_id);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  /* Step 5: the summary. The app measures; the AI groups the searches, reads the cited pages and writes the cards. */
  const analyze = async (runId, { again = false } = {}) => {
    try {
      setAnalysis("Grouping the searches ChatGPT ran…");
      await groupRun(companyId, runId);
      const fresh = await refreshScore(situation.id);
      const run = fresh?.runs?.find((r) => r.id === runId);
      if (run) {
        const have = new Set((await loadSituation(situation.id)).cards.filter((c) => c.scenario_run_id === runId && (!again || c.status !== "open")).map((c) => c.group_id));
        const todo = [...run.groups.opportunities.slice(0, fresh.limits.opportunities), ...run.groups.wins.slice(0, fresh.limits.wins)].filter((g) => !have.has(g.id));
        let n = 0;
        for (const g of todo) {
          n += 1;
          setAnalysis(`Reading the pages ChatGPT cited for “${g.label}” (${n} of ${todo.length})…`);
          // One card that fails does not stop the others; it can be analyzed again from its own button.
          await writeCard(companyId, runId, g.id).catch(() => null);
        }
        setAnalysis("Writing the takeaway…");
        await writeTakeaway(companyId, runId);
      }
    } finally {
      setAnalysis("");
    }
    await syncScenario(companyId, situation.id).catch(() => null);
    await open(situation.id);
    await refreshScore(situation.id);
    setInsights(await loadInsights(companyId).catch(() => insights));
    setLastRun(await lastRuns(companyId).catch(() => lastRun));
  };

  const doAnalyze = () => guard("analyze", async () => {
    const again = grouped && scoredRun.ungrouped === 0;
    const open_ = cards.filter((c) => c.scenario_run_id === scoredRun.id && c.status === "open").length;
    if (again && open_ && !window.confirm(`This writes the ${open_} open ${open_ === 1 ? "card" : "cards"} again, from the pages as they are now. Your edits to What to cover and Action on those cards are replaced. Cards already sent or done are not touched. Go on?`)) return;
    await analyze(scoredRun.id, { again });
  });

  const doCard = (groupId) => guard("analyze", async () => {
    if (cards.some((c) => c.group_id === groupId && c.scenario_run_id === scoredRun.id) && !window.confirm("This writes the card again, from the pages as they are now. Your edits to What to cover and Action are replaced. Go on?")) return;
    try {
      setAnalysis("Reading the pages ChatGPT cited…");
      await writeCard(companyId, scoredRun.id, groupId);
    } finally {
      setAnalysis("");
    }
    await open(situation.id);
    setInsights(await loadInsights(companyId).catch(() => insights));
  });

  const changeCard = (id, patch) => guard("card-edit", async () => {
    const row = await updateCard(id, patch);
    setData((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? row : c)) }));
  });

  /* Step 6: "Write this" turns one Opportunity into a brief in AEO Generation. */
  const doPush = (card, g, mergeId) => guard("push", async () => {
    const also = mergeId ? cards.filter((c) => c.id === mergeId && c.status === "open") : [];
    const out = await pushCard({ companyId, situation, card, stats: g, prompts, also });
    setPushNote({ ok: out.ok, text: `${g.label}: ${out.message}` });
    setMap(await loadContentMap(companyId));
    await open(situation.id);
    await patchSituation({ step: "push" });
  });

  const remove = () => guard("delete", async () => {
    if (cards.some((c) => c.brief_id)) throw new Error("This Scenario has Opportunities that were sent to AEO Generation. Its briefs stay there; the Scenario is kept as their record.");
    if (!window.confirm(`Delete ${situation.code} with its prompts, Runs and cards?`)) return;
    await deleteSituation(situation.id);
    setParams({});
    await reloadList();
  });

  const spent = runs.reduce((a, r) => a + Number(r.cost || 0), 0);
  const working = Boolean(busy);
  const todoCards = cards.filter((c) => c.kind === "opportunity" && c.action && !PUSHED_ACTIONS.has(c.action));
  const captures = prompts.length * (situation?.runs || 0);
  // Captures run four at a time, one run number after another: 9 prompts are 3 steps per run number.
  const minutes = (seconds) => Math.max(1, Math.round(((situation?.runs || 0) * Math.ceil(prompts.length / 4) * seconds) / 60));
  const variantOf = situation?.variant_of ? situations.find((s) => s.id === situation.variant_of) : null;
  const nameOf = (s) => `${s.code} · ${s.title || s.description.slice(0, 70)}`;
  // The monthly reminder, shown in the tool only. Runs are always started by hand.
  const due = situations.filter((s) => dueForRerun(lastRun[s.id], reminderDays));

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
              <select id="fo-pick" className={`${inputClass} w-full min-w-0 sm:w-auto sm:flex-1`} value={currentId} disabled={working} onChange={(e) => setParams(e.target.value ? { s: e.target.value } : {})}>
                <option value="">New Scenario…</option>
                {situations.map((s) => <option key={s.id} value={s.id}>{nameOf(s)}{due.includes(s) ? " · due for a re-run" : ""}</option>)}
              </select>
              {situation && <Button type="button" size="sm" variant="ghost" disabled={working} onClick={remove}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>}
            </div>
            {due.length > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Due for a re-run (last run more than {reminderDays} days ago):{" "}
                {due.map((s, i) => <React.Fragment key={s.id}>{i > 0 && " · "}<button type="button" className="underline underline-offset-2" disabled={working} onClick={() => setParams({ s: s.id })}>{nameOf(s)}</button></React.Fragment>)}
              </p>
            )}
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
                {situation.details?.original_description && (
                  <details className="rounded-md border border-border bg-muted/30 text-xs">
                    <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground">The original description, as first written</summary>
                    <p className="whitespace-pre-wrap border-t border-border p-3 text-foreground">{situation.details.original_description}</p>
                  </details>
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
                    <Lock className="h-3.5 w-3.5" /> Frozen on {day(situation.prompts_confirmed_at)}. Every Run of this Scenario asks exactly these prompts.{runOpen ? " A Run is open: end it before unlocking." : ""}
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
                        {!locked && <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => setAdding({ form, text: "" })}>Add your own</button>}
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
                              {!locked && (
                                <span className="ml-auto flex gap-3 text-xs text-muted-foreground">
                                  {p.origin !== "user" && <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => redoPrompt(p)}>{busy === `prompt-${p.id}` ? "Writing…" : "Regenerate"}</button>}
                                  <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={working} onClick={() => dropPrompt(p)}>Delete</button>
                                </span>
                              )}
                            </div>
                            <Textarea id={`fo-p-${p.id}`} className={`mt-1 ${form === "short" ? "min-h-[56px]" : form === "medium" ? "min-h-[96px]" : "min-h-[130px]"}`} value={text} disabled={working || locked} onChange={(e) => setPromptEdit((s) => ({ ...s, [p.id]: e.target.value }))} onBlur={() => savePromptEdit(p)} />
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
                  {has.prompts && !locked && (
                    <Button type="button" size="sm" disabled={working || blocked || unsaved} onClick={confirmPrompts}><Lock className="mr-1.5 h-3.5 w-3.5" />Confirm and freeze the prompts</Button>
                  )}
                  {!locked && (
                    <Button type="button" size="sm" variant={has.prompts ? "outline" : "default"} disabled={working || !newPersona || gaps.length > 0} onClick={doPrompts}>
                      {busy === "prompts" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{has.prompts ? "Write all again" : "Write the prompts"}
                    </Button>
                  )}
                  {!newPersona && <span className="text-xs text-muted-foreground">Write the persona first.</span>}
                  {newPersona && !situation.persona_confirmed_at && !has.prompts && <span className="text-xs text-amber-800">The persona is not approved yet. You can still go on.</span>}
                  {blocked && <span className="text-xs text-destructive">A prompt cannot be confirmed yet; see the note under it.</span>}
                </div>
              </Panel>

              <Panel {...panel("run")} summary={latestRun ? `${scenarioRuns.length} ${scenarioRuns.length === 1 ? "Run" : "Runs"} · latest: ${okRuns} of ${runs.length} captures returned · $${spent.toFixed(2)}` : ""} did="Each prompt is asked on real ChatGPT several times, in a fresh session with no memory. Web search is not forced, so a Run shows whether the prompt triggers a search on its own.">
                {scenarioRuns.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {scenarioRuns.map((r) => {
                      const scored = score?.runs?.find((x) => x.id === r.id)?.score;
                      const isLatest = r.id === latestRun?.id;
                      const good = isLatest ? okRuns : scored ? scored.runs : null;
                      const cost = r.status === "running" ? spent : Number(r.cost);
                      const name = runName({ ...r, baseline: r.id === situation.baseline_run_id });
                      return (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5">
                          <span className="font-medium text-foreground">{name}</span>
                          {r.id === situation.baseline_run_id && r.seq > 1 && <span className="text-muted-foreground">(Run {r.seq})</span>}
                          <span className="tabular-nums text-muted-foreground">{day(r.started_at)}{good == null ? "" : ` · ${good} ${r.legacy ? "" : `of ${(r.prompt_ids || []).length * r.runs_per_prompt} `}captures returned`} · ${cost.toFixed(2)} actual{r.legacy ? "" : ` (estimated $${Number(r.est_cost).toFixed(2)})`}</span>
                          {r.status === "running" && <Chip tone="border-sky-300 bg-sky-50 text-sky-800">Open</Chip>}
                          {r.status === "stopped" && <Chip>Ended early</Chip>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!openRun && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="text-muted-foreground" htmlFor="fo-runs">Runs per prompt</label>
                    <input id="fo-runs" type="number" min={1} max={10} className={`${inputClass} w-16`} value={situation.runs} disabled={working} onChange={(e) => patchSituation({ runs: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))) }).catch((err) => setError(err.message))} />
                    <span className="text-muted-foreground">{prompts.length} prompts × {situation.runs} runs = {captures} captures. Estimated: ${(captures * 0.004).toFixed(2)} for the captures, {minutes(35)} to {minutes(60)} minutes. Failed captures are not charged.</span>
                  </div>
                )}
                {hasBaseline && !openRun && situation.runs !== scenarioRuns.find((r) => r.id === situation.baseline_run_id)?.runs_per_prompt && <p className="text-xs text-amber-800">The Baseline used {scenarioRuns.find((r) => r.id === situation.baseline_run_id)?.runs_per_prompt} runs per prompt. A different number still compares, with a different margin.</p>}
                <div className="flex flex-wrap items-center gap-2">
                  {busy === "run" ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => { stopRef.current = true; setProgress("Stopping after the captures that are under way…"); }}><Square className="mr-1.5 h-3.5 w-3.5" />Stop</Button>
                  ) : openRun ? (
                    <>
                      <Button type="button" size="sm" disabled={working || callsLeft === 0} onClick={doRun}><Play className="mr-1.5 h-3.5 w-3.5" />Continue: {callsLeft} {callsLeft === 1 ? "capture" : "captures"} missing</Button>
                      <Button type="button" size="sm" variant="outline" disabled={working} onClick={closeRun}>{okRuns ? "End the Run here" : "Remove this Run"}</Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" disabled={working || !has.prompts || needsConfirm || blocked || unsaved} onClick={doRun}>
                      <Play className="mr-1.5 h-3.5 w-3.5" />{hasBaseline ? "Run again, to compare with the Baseline" : "Run the Baseline"}
                    </Button>
                  )}
                  {has.prompts && needsConfirm && <span className="text-xs text-muted-foreground">Confirm the prompts in step 3 first: a Run uses frozen prompts.</span>}
                  {blocked && <span className="text-xs text-destructive">A prompt cannot run yet; see the note under it.</span>}
                  {!openRun && !hasBaseline && scenarioRuns.length > 0 && !needsConfirm && <span className="text-xs text-muted-foreground">The Scenario changed since its last Run (or its runs are from before Baselines), so the next Run is a new Baseline.</span>}
                </div>
                {progress && <p className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progress}</p>}
                {runs.length > 0 && (
                  <details className="rounded-md border border-border text-xs">
                    <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground">The {runs.length} captures of the latest Run: searches, citations and answers</summary>
                    <div className="space-y-3 border-t border-border p-3">
                      {[...new Set(runs.map((r) => r.prompt_id))].map((pid) => {
                        const p = prompts.find((x) => x.id === pid);
                        const mine = runs.filter((r) => r.prompt_id === pid);
                        return (
                          <div key={pid}>
                            <p className="text-xs font-medium text-foreground">{p ? promptLabel(p, prompts) : "A prompt replaced since"} {p && <span className="font-normal text-muted-foreground">· {p.prompt.length > 110 ? `${p.prompt.slice(0, 110)}…` : p.prompt}</span>}</p>
                            <ul className="mt-1 space-y-1.5">{mine.map((r) => <RunRow key={r.id} run={r} brands={map.brands || []} />)}</ul>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </Panel>

              <Panel {...panel("topics")} summary={scoredRun?.score.own ? `Mentioned ${scoredRun.score.own.mentioned.pct}% ±${scoredRun.score.own.mentioned.margin}${grouped ? ` · ${scoredRun.groups.opportunities.length} opportunities · ${scoredRun.groups.wins.length} wins` : ""}` : ""} did="Two halves that never mix: the measurement is counted by the app with fixed rules, the interpretation is written by the AI and never touches a number.">
                {scenarioRuns.length === 0 && <p className="text-xs text-muted-foreground">The summary appears after the first Run.</p>}
                {shownRun && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Button type="button" size="sm" variant="outline" disabled={working || Boolean(analysis)} onClick={downloadReport}><Download className="mr-1.5 h-3.5 w-3.5" />Download report (.md)</Button>
                    <span className="text-muted-foreground">Steps 1 to 5 of this Scenario in one Markdown file: Situation, Persona, Prompts, Run and this summary.</span>
                  </div>
                )}
                {scenarioRuns.length > 0 && <ScoreBlock data={score} baselineId={situation.baseline_run_id} takeaway={scoredRun?.takeaway} pick={pickedRun} onPick={setPickedRun} working={working} busy={busy} labeling={labeling} onLabel={doLabel} />}
                {scoredRun && <DiscoveredCard run={score.runs.find((r) => r.id === pickedRun) || scoredRun} ignored={map.ignored || []} working={working} onTrack={doTrack} onIgnore={doIgnore} onRestore={doRestore} />}
                {scoredRun && scoredRun.status !== "running" && (
                  <>
                    <GroupsBlock run={scoredRun} cards={cards} pillars={map.pillars} limits={score.limits} signal={score.signal} cutoff={score.cutoff} companyId={companyId} working={working} busy={busy} progress={analysis} onAnalyze={doAnalyze} onWrite={doCard} onChange={changeCard} onPush={doPush} />
                    {pushNote && <p className={`rounded-md px-3 py-2 text-xs ${pushNote.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>{pushNote.text}</p>}
                  </>
                )}
                {scenarioRuns.length > 1 && <CompareBlock data={score} baselineId={situation.baseline_run_id} cards={cards} />}
                <InsightsBlock insights={insights} />
              </Panel>

              <Panel {...panel("push")} summary={cards.some((c) => c.brief_id) ? `${new Set(cards.filter((c) => c.brief_id).map((c) => c.brief_id)).size} sent to AEO Generation` : ""} did="What was sent to AEO Generation, and what is left to do by hand. Only new articles and comparison articles are sent, and only when you click Write this on an Opportunity.">
                {cards.filter((c) => c.brief_id && !c.merged_into).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing has been sent yet. Click Write this on an Opportunity in step 5.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {cards.filter((c) => c.brief_id && !c.merged_into).map((c) => (
                      <li key={c.id} className="rounded-md border border-border px-3 py-1.5">
                        <span className="font-medium text-foreground">{c.stats?.label}</span>{" "}
                        <span className="text-muted-foreground">· {map.groups.find((g) => g.id === c.aeo_group_id)?.code || "topic"} · sent {day(c.pushed_at)} · {c.status === "acted_on" ? `live${c.acted_url ? `: ${c.acted_url}` : ""}` : "not live yet"}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {cards.some((c) => c.brief_id) && (
                  <p className="text-xs text-foreground">
                    Open <Link className="underline underline-offset-2" to={`/company/${companyId}/aeo-generation`}>AEO Generation</Link>: the briefs are in the batch &quot;Fan-Out {situation.code}&quot;. Add your view with &quot;Connect my hot takes&quot; on each brief.
                  </p>
                )}
                {todoCards.length > 0 && (
                  <div className="text-xs">
                    <p className="font-medium text-foreground">To do by hand <span className="font-normal text-muted-foreground">· these are not sent to AEO Generation: it writes articles only</span></p>
                    <ul className="mt-1 space-y-1">
                      {todoCards.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5">
                          <Chip>{CARD_ACTIONS[c.action] || c.action}</Chip>
                          <span className="min-w-0 flex-1 basis-60 text-foreground">{c.stats?.label}: <span className="text-muted-foreground">{c.action_line}</span></span>
                          {c.status === "open" ? (
                            <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => changeCard(c.id, { status: "done", acted_on_at: new Date().toISOString() })}><Check className="mr-1.5 h-3.5 w-3.5" />Done</Button>
                          ) : (
                            <span className="text-emerald-800">Done {day(c.acted_on_at)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
