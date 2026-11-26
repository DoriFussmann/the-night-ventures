import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, Play, Plus, RefreshCw, Send, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTIONS,
  DIRECTIONS,
  FORM_LABELS,
  LIST_TYPES,
  PROMPT_MAX,
  PUSHABLE,
  STEPS,
  STEP_LABELS,
  isWeak,
  listsToGetOn,
  planRuns,
  promptIssues,
  staleAfter,
} from "../../../lib/fan-out/core.js";
import {
  buildPersona,
  buildTopics,
  createSituation,
  deletePrompt,
  deleteSituation,
  listSituations,
  loadContentMap,
  loadRunDetail,
  loadSituation,
  pushTopics,
  runStep,
  savePrompt,
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

export default function FanOut() {
  const { companyId } = useParams();
  const [params, setParams] = useSearchParams();
  const currentId = params.get("s") || "";
  const [situations, setSituations] = useState([]);
  const [map, setMap] = useState({ pillars: [], groups: [], ownNames: [], brands: [] });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState("");
  const [desc, setDesc] = useState("");
  const [personaEdit, setPersonaEdit] = useState({});
  const [promptEdit, setPromptEdit] = useState({});
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

  const open = useCallback(async (id) => {
    if (!id) return setData(null);
    const loaded = await loadSituation(id);
    if (!loaded.situation) return setData(null);
    setData(loaded);
    setDesc(loaded.situation.description);
    setPersonaEdit(loaded.situation.persona || {});
    setPromptEdit(Object.fromEntries(loaded.prompts.map((p) => [p.form, p.prompt])));
  }, []);

  useEffect(() => {
    setPushNotes([]);
    open(currentId).catch((err) => setError(err?.message || "Could not load the situation"));
  }, [currentId, open]);

  const situation = data?.situation || null;
  const prompts = useMemo(() => [...(data?.prompts || [])].sort((a, b) => ["medium", "short", "long"].indexOf(a.form) - ["medium", "short", "long"].indexOf(b.form)), [data]);
  const runs = useMemo(() => data?.runs || [], [data]);
  const topics = useMemo(() => data?.topics || [], [data]);
  const okRuns = runs.filter((r) => r.status === "ok").length;
  const has = useMemo(() => ({ persona: Boolean(situation?.persona?.who), prompts: prompts.length > 0, run: runs.length > 0, topics: topics.length > 0, push: topics.length > 0 }), [situation, prompts, runs, topics]);

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

  const create = () => guard("create", async () => {
    if (draft.trim().length < 20) throw new Error("Describe the situation in a sentence or two first.");
    const row = await createSituation(companyId, draft, situations);
    setDraft("");
    await reloadList();
    setParams({ s: row.id });
  });

  const saveDescription = () => guard("describe", async () => {
    if (desc.trim() === situation.description) return;
    await patchSituation({ description: desc.trim(), stale_from: staleAfter("describe", { ...has, persona: has.persona }) });
    await reloadList();
  });

  const doPersona = () => guard("persona", async () => {
    if (desc.trim() !== situation.description) await patchSituation({ description: desc.trim() });
    const out = await buildPersona(companyId, situation.id);
    setData((d) => ({ ...d, situation: out.situation }));
    setPersonaEdit(out.situation.persona || {});
    await reloadList();
  });

  const savePersonaField = (key) => guard("persona-edit", async () => {
    const value = String(personaEdit[key] || "").trim();
    if (value === String(situation.persona?.[key] || "")) return;
    const persona = { ...situation.persona, [key]: value, ...(key === "location" ? { location_assumed: false } : {}) };
    await patchSituation({ persona, stale_from: staleAfter("persona", has) || situation.stale_from });
  });

  const changeDirection = (direction) => guard("prompt-edit", async () => {
    // The prompts on the page were written for the old direction: mark them, and everything after, out of date.
    await patchSituation({ direction, stale_from: has.prompts ? "prompts" : situation.stale_from });
  });

  const doPrompts = () => guard("prompts", async () => {
    const out = await writePrompts(companyId, situation.id);
    const long = prompts.filter((p) => p.form === "long");
    setData((d) => ({ ...d, situation: out.situation, prompts: [...out.prompts, ...long] }));
    setPromptEdit((e) => ({ ...e, ...Object.fromEntries(out.prompts.map((p) => [p.form, p.prompt])) }));
  });

  const savePromptText = (form) => guard("prompt-edit", async () => {
    const text = String(promptEdit[form] || "").trim();
    const existing = prompts.find((p) => p.form === form);
    if (!text || text === existing?.prompt) return;
    if (text.length > PROMPT_MAX) throw new Error(`The ${form} prompt is ${text.length} characters; the engine takes ${PROMPT_MAX} at most.`);
    const row = await savePrompt(situation, form, text);
    const next = await updateSituation(situation.id, { stale_from: staleAfter("prompts", has) || situation.stale_from });
    setData((d) => ({ ...d, situation: next, prompts: [...d.prompts.filter((p) => p.form !== form), row] }));
  });

  const removeLong = () => guard("prompt-edit", async () => {
    const row = prompts.find((p) => p.form === "long");
    if (row) await deletePrompt(row.id);
    setPromptEdit((e) => ({ ...e, long: undefined }));
    await open(situation.id);
  });

  const issues = useMemo(() => Object.fromEntries(prompts.map((p) => [p.form, promptIssues(promptEdit[p.form] ?? p.prompt, map.ownNames)])), [prompts, promptEdit, map.ownNames]);
  const blocked = prompts.some((p) => issues[p.form]?.block.length);
  const unsaved = prompts.some((p) => (promptEdit[p.form] ?? p.prompt).trim() !== p.prompt);
  const plan = useMemo(() => planRuns(prompts, situation?.runs || 5, runs), [prompts, situation, runs]);
  const callsLeft = plan.reduce((a, s) => a + s.length, 0);

  const doRun = (again = false) => guard("run", async () => {
    stopRef.current = false;
    const steps = again ? planRuns(prompts, situation.runs, []) : plan;
    const total = steps.reduce((a, s) => a + s.length, 0);
    let done = 0;
    for (const calls of steps) {
      if (stopRef.current) break;
      setProgress(`Run ${calls[0].runNo} of ${situation.runs}: asking ChatGPT (${done} of ${total} captures done). A capture takes 15 to 100 seconds. Keep this tab open.`);
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
    if (topics.some((t) => t.status === "pushed")) throw new Error("This situation has pushed topics. Its briefs stay in AEO Generation; the situation is kept as their record.");
    if (!window.confirm(`Delete situation ${situation.code} with its prompts, runs and topics?`)) return;
    await deleteSituation(situation.id);
    setParams({});
    await reloadList();
  });

  const byForm = (form) => runs.filter((r) => r.prompt_id === prompts.find((p) => p.form === form)?.id);
  const spent = runs.reduce((a, r) => a + Number(r.cost || 0), 0);
  const working = Boolean(busy);

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
          Describe one person&apos;s situation. The engine writes what they would ask ChatGPT, runs it on real ChatGPT, reads the web searches ChatGPT
          makes while answering (its fan-out), and turns them into topics you can push to AEO Generation.
        </p>
      </div>

      {error && <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="fo-pick">Situation</label>
              <select id="fo-pick" className={`${inputClass} w-full min-w-0 sm:w-auto sm:flex-1`} value={currentId} onChange={(e) => setParams(e.target.value ? { s: e.target.value } : {})}>
                <option value="">New situation…</option>
                {situations.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.title || s.description.slice(0, 70)}</option>)}
              </select>
              {situation && <Button type="button" size="sm" variant="ghost" disabled={working} onClick={remove}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>}
            </div>
            {!situation && (
              <div className="space-y-2">
                <Textarea className="min-h-[110px]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Describe one person at one moment, in your own words. For example: a founder and CEO of a bootstrapped one-person SaaS, two years in, barely breaking even, exhausted, starting to think about raising money." />
                <Button type="button" size="sm" disabled={working} onClick={create}><Plus className="mr-1.5 h-3.5 w-3.5" />Start this situation</Button>
              </div>
            )}
          </section>

          {situation && (
            <>
              <Tracker states={states} onOpen={openStep} />

              <Panel {...panel("describe")} summary={situation.description} did={`${situation.code}: the situation in your words. Everything below is built from it.`}>
                <Textarea className="min-h-[90px]" value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={saveDescription} disabled={working} />
              </Panel>

              <Panel {...panel("persona")} summary={has.persona ? [situation.title, situation.persona.location, situation.situation_id && `buyer situation ${situation.situation_id}`].filter(Boolean).join(" · ") : ""} details={situation.details?.persona} did={has.persona ? "Claude built this person from your description and the company's ICP." : "Claude will read your description with the company's ICP and build the person."}>
                {has.persona && (
                  <>
                    <p className="text-sm font-medium text-foreground">{situation.title}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {PERSONA_FIELDS.map(([key, label]) => (
                        <div key={key}>
                          <label className="text-xs font-medium text-foreground">{label}{key === "location" && situation.persona.location_assumed ? " (assumed: your description names no place)" : ""}</label>
                          <Textarea className="mt-1 min-h-[64px]" value={personaEdit[key] || ""} disabled={working} onChange={(e) => setPersonaEdit((p) => ({ ...p, [key]: e.target.value }))} onBlur={() => savePersonaField(key)} />
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {situation.situation_id ? <Chip>Buyer situation {situation.situation_id}</Chip> : <Chip>No buyer situation matched</Chip>}
                      {situation.fit_note && <span className="text-muted-foreground">{situation.fit_note}</span>}
                    </div>
                    {situation.persona.has_icp === false && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">This company has no ICP on file, so the person was built from your description alone.</p>}
                    {situation.persona.outside_icp && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Outside the ICP: this is not a buyer the ICP describes. You can go on.</p>}
                    {situation.persona.duplicate_of && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Close to situation {situation.persona.duplicate_of}, which you already ran. You can go on.</p>}
                  </>
                )}
                <Button type="button" size="sm" variant={has.persona ? "outline" : "default"} disabled={working} onClick={doPersona}>
                  {busy === "persona" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{has.persona ? "Build again" : "Build the persona"}
                </Button>
              </Panel>

              <Panel {...panel("prompts")} summary={[(DIRECTIONS[situation.direction] || DIRECTIONS.recommend).label, ...prompts.map((p) => `${FORM_LABELS[p.form]} ${p.prompt.length.toLocaleString("en-US")} characters`)].join(" · ")} details={situation.details?.prompts} did={has.prompts ? "What this person would type to ChatGPT. Edit freely; nothing has been sent yet." : "Claude will write a medium and a short prompt in this person's voice, ending in the ask you choose."}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="font-medium text-foreground" htmlFor="fo-direction">Direction</label>
                  <select id="fo-direction" className={inputClass} value={situation.direction || "recommend"} disabled={working} onChange={(e) => changeDirection(e.target.value)}>
                    {Object.entries(DIRECTIONS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
                  </select>
                  <span className="min-w-0 basis-full text-muted-foreground sm:flex-1 sm:basis-0">{(DIRECTIONS[situation.direction] || DIRECTIONS.recommend).hint}</span>
                </div>
                {prompts.map((p) => {
                  const text = promptEdit[p.form] ?? p.prompt;
                  const over = text.length > PROMPT_MAX;
                  return (
                    <div key={p.id}>
                      <div className="flex items-baseline gap-2">
                        <label className="text-xs font-medium text-foreground">{FORM_LABELS[p.form]}</label>
                        <span className={`text-xs tabular-nums ${over ? "font-medium text-destructive" : "text-muted-foreground"}`}>{text.length.toLocaleString("en-US")} of {PROMPT_MAX.toLocaleString("en-US")} characters</span>
                        {p.form === "long" && <button type="button" className="ml-auto text-xs text-muted-foreground underline underline-offset-2" onClick={removeLong}>Remove the long prompt</button>}
                      </div>
                      <Textarea className={`mt-1 ${p.form === "short" ? "min-h-[56px]" : "min-h-[150px]"}`} value={text} disabled={working} onChange={(e) => setPromptEdit((s) => ({ ...s, [p.form]: e.target.value }))} onBlur={() => savePromptText(p.form)} />
                      {issues[p.form]?.block.map((m) => <p key={m} className="mt-1 text-xs text-destructive">{m}</p>)}
                      {issues[p.form]?.warn.map((m) => <p key={m} className="mt-1 text-xs text-amber-800">{m}</p>)}
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant={has.prompts ? "outline" : "default"} disabled={working || !has.persona} onClick={doPrompts}>
                    {busy === "prompts" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{has.prompts ? "Write again" : "Write the prompts"}
                  </Button>
                  {has.prompts && !prompts.some((p) => p.form === "long") && (
                    <Button type="button" size="sm" variant="ghost" disabled={working} onClick={() => guard("prompt-edit", async () => { await savePrompt(situation, "long", prompts.find((p) => p.form === "medium").prompt); await open(situation.id); })}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />Add a long prompt
                    </Button>
                  )}
                </div>
              </Panel>

              <Panel {...panel("run")} summary={okRuns ? `${okRuns} of ${runs.length} captures returned · ${runs.reduce((a, r) => a + (r.fan_out || []).length, 0)} searches · $${spent.toFixed(3)}` : ""} did={okRuns ? `${okRuns} of ${runs.length} captures returned · $${spent.toFixed(3)} spent on this situation.` : "Each prompt is asked on real ChatGPT several times. What repeats across runs is signal."}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="text-muted-foreground" htmlFor="fo-runs">Runs per prompt</label>
                  <input id="fo-runs" type="number" min={1} max={10} className={`${inputClass} w-16`} value={situation.runs} disabled={working} onChange={(e) => patchSituation({ runs: Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))) }).catch((err) => setError(err.message))} />
                  <span className="text-muted-foreground">{prompts.length} prompts × {situation.runs} runs = {prompts.length * situation.runs} captures, about ${(prompts.length * situation.runs * 0.004).toFixed(2)}. Failed captures are not charged.</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {busy === "run" ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => { stopRef.current = true; setProgress("Stopping after this step…"); }}><Square className="mr-1.5 h-3.5 w-3.5" />Stop</Button>
                  ) : (
                    <>
                      <Button type="button" size="sm" disabled={working || !has.prompts || blocked || unsaved || callsLeft === 0} onClick={() => doRun(false)}>
                        <Play className="mr-1.5 h-3.5 w-3.5" />{runs.length ? `Run the ${callsLeft} missing` : "Run on ChatGPT"}
                      </Button>
                      {runs.length > 0 && <Button type="button" size="sm" variant="outline" disabled={working || blocked || unsaved} onClick={() => doRun(true)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Run everything again</Button>}
                    </>
                  )}
                  {blocked && <span className="text-xs text-destructive">A prompt cannot run yet; see the note under it.</span>}
                </div>
                {progress && <p className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progress}</p>}
                {prompts.map((p) => byForm(p.form).length > 0 && (
                  <div key={p.id}>
                    <p className="text-xs font-medium text-foreground">{FORM_LABELS[p.form]} prompt</p>
                    <ul className="mt-1 space-y-1.5">{byForm(p.form).map((r) => <RunRow key={r.id} run={r} brands={map.brands || []} />)}</ul>
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
