import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Download, Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  exportPromptRuns,
  finishPromptTest,
  loadPromptTests,
  previewPromptTest,
  savePromptTestSettings,
  startPromptTest,
  stepPromptTest,
} from "./promptTestsApi";
import PromptTestsSummary, { formatDuration } from "./PromptTestsSummary";

const STEP_SIZE = 10;
const STAGES = ["Learn", "Problem", "Buy"];
const TYPES = ["Question", "Comparison", "Recommendation"];
const LABEL_TONE = {
  Named: "bg-emerald-100 text-emerald-900",
  "Cited, not named": "bg-sky-100 text-sky-900",
  "Retrieved, not cited": "bg-amber-100 text-amber-900",
  Absent: "bg-muted text-muted-foreground",
  "No search": "bg-muted text-muted-foreground",
  Failed: "bg-red-100 text-red-900",
};
const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/** A rate with its base. Below 20 prompts, counts only. */
function Rate({ n, base }) {
  if (!base) return <span className="text-muted-foreground">no prompts</span>;
  return (
    <span className="tabular-nums">
      {n} of {base}
      {base >= 20 ? ` (${Math.round((n / base) * 100)}%)` : ""}
    </span>
  );
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;

function EngineSummary({ id, s }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {s.label}
          {s.method === "api" ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">API, not app</span> : null}
        </h3>
        <p className="text-xs text-muted-foreground">
          {s.tested} prompts tested{s.model ? ` · model ${s.model}` : ""}
          {s.lastRun ? ` · ${new Date(s.lastRun).toLocaleDateString()}` : ""}
          {s.failedCalls ? ` · ${s.failedCalls} failed calls excluded` : ""}
        </p>
      </div>
      <div className="mt-2 grid gap-3 text-xs md:grid-cols-3">
        <div>
          <p className="font-medium text-foreground">Searched the web</p>
          <p>All: <Rate {...s.search.all} /></p>
          {STAGES.map((k) => (<p key={k}>{k}: <Rate {...s.search.byStage[k]} /></p>))}
          {TYPES.map((k) => (<p key={k}>{k}: <Rate {...s.search.byType[k]} /></p>))}
        </div>
        <div>
          <p className="font-medium text-foreground">Brands (prompts retrieved / cited / named)</p>
          {s.brands.map((b) => (
            <p key={b.id} className={b.own ? "font-medium text-foreground" : ""}>
              {b.name}: <span className="tabular-nums">{b.retrieved} / {b.cited} / {b.named}</span> of {s.tested}
            </p>
          ))}
        </div>
        <div>
          <p className="font-medium text-foreground">Top cited sites (all / Buy prompts of {s.buyBase})</p>
          {s.topDomains.slice(0, 8).map((d) => (<p key={d.name}>{d.name}: <span className="tabular-nums">{d.n} / {d.buy}</span></p>))}
          {!s.topDomains.length && <p className="text-muted-foreground">No sources cited.</p>}
        </div>
      </div>
      {(s.ownUrls.length > 0 || s.queryNames.length > 0) && (
        <div className="mt-2 grid gap-3 text-xs md:grid-cols-2">
          {s.ownUrls.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Own pages cited (runs)</p>
              {s.ownUrls.map((u) => (<p key={u.name} className="truncate">{u.n} · {u.name}</p>))}
            </div>
          )}
          {s.queryNames.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Names inside its searches ({s.fanOutQueries} queries)</p>
              <p>{s.queryNames.map((q) => `${q.name} ${q.n}`).join(" · ")}</p>
            </div>
          )}
        </div>
      )}
      <p className="sr-only">{id}</p>
    </div>
  );
}

export default function PromptTestsTab({ companyId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [filters, setFilters] = useState({ persona: "", stage: "", type: "", outcome: "" });
  const [plan, setPlan] = useState(null);
  const [run, setRun] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const stopRef = useRef(false);
  const running = Boolean(run && !run.finished);

  // Tick once a second while a test runs, for the elapsed time and the estimate.
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const reload = useCallback(async () => {
    try {
      setData(await loadPromptTests(companyId));
      setError("");
    } catch (err) {
      setError(err?.message || "Could not load prompt tests");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const engineIds = useMemo(() => (data ? Object.keys(data.engines) : []), [data]);
  const personas = useMemo(() => [...new Set((data?.prompts || []).map((p) => p.persona))].filter(Boolean), [data]);
  const shownEngines = useMemo(() => engineIds.filter((e) => data.settings.engines.includes(e) || data.summary.engines[e]), [engineIds, data]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.prompts.filter((p) => {
      if (filters.persona && p.persona !== filters.persona) return false;
      if (filters.stage && p.stage !== filters.stage) return false;
      if (filters.type && p.type !== filters.type) return false;
      if (filters.outcome) {
        const o = data.outcomes[p.id] || {};
        if (filters.outcome === "Not tested") return Object.keys(o).length === 0;
        if (!Object.values(o).some((x) => x.label === filters.outcome)) return false;
      }
      return true;
    });
  }, [data, filters]);

  const approvedShown = rows.filter((p) => p.status === "Approved");
  const selectedIds = [...selected].filter((id) => data?.prompts.some((p) => p.id === id && p.status === "Approved"));

  const saveSettings = async (patch) => {
    try {
      const next = { ...data.settings, ...patch };
      setData({ ...data, settings: next });
      await savePromptTestSettings(companyId, next);
      setPlan(null);
      reload();
    } catch (err) {
      setError(err?.message || "Could not save settings");
    }
  };

  const preview = async () => {
    setError("");
    try {
      setPlan(await previewPromptTest(companyId, selectedIds));
    } catch (err) {
      setError(err?.message || "Could not prepare the test");
    }
  };

  const start = async () => {
    setError("");
    stopRef.current = false;
    let cycleId = null;
    try {
      const started = await startPromptTest(companyId, selectedIds);
      cycleId = started.cycleId;
      const calls = started.calls;
      setPlan(null);
      let done = 0;
      let failed = 0;
      let spent = 0;
      const startedAt = Date.now();
      setRun({ total: calls.length, done, failed, spent, note: "", startedAt });
      for (let i = 0; i < calls.length && !stopRef.current; i += STEP_SIZE) {
        const res = await stepPromptTest(companyId, cycleId, calls.slice(i, i + STEP_SIZE));
        if (res.capReached) {
          setRun((r) => ({ ...r, note: `Stopped: the monthly cap of ${money(res.cap)} was reached.` }));
          stopRef.current = true;
          break;
        }
        done += res.results.length;
        failed += res.results.filter((x) => x.status === "failed").length;
        spent += res.results.reduce((a, x) => a + Number(x.cost || 0), 0);
        setRun({ total: calls.length, done, failed, spent, note: "", startedAt });
      }
      await finishPromptTest(companyId, cycleId, stopRef.current);
      setRun((r) => ({ ...r, finished: true, endedAt: Date.now(), note: r.note || (stopRef.current ? "Stopped. Completed calls are saved." : "") }));
    } catch (err) {
      setError(err?.message || "The test stopped unexpectedly. Completed calls are saved.");
      if (cycleId) finishPromptTest(companyId, cycleId, true).catch(() => {});
      setRun((r) => (r ? { ...r, finished: true, endedAt: Date.now() } : null));
    }
    reload();
  };

  const exportPrompts = (format) => {
    const out = data.prompts.map((p) => {
      const row = { id: p.code, persona: p.persona, situation: p.situation, stage: p.stage, type: p.type, variables: (p.variables || []).join("; "), named_brands: (p.named_brands || []).join("; "), status: p.status, prompt: p.prompt };
      for (const e of engineIds) {
        const o = (data.outcomes[p.id] || {})[e];
        row[`${e}_runs`] = o ? o.runs : 0;
        row[`${e}_searched`] = o ? o.searched : 0;
        row[`${e}_retrieved`] = o ? o.retrieved : 0;
        row[`${e}_cited`] = o ? o.cited : 0;
        row[`${e}_named`] = o ? o.named : 0;
        row[`${e}_outcome`] = o ? o.label : "";
      }
      return row;
    });
    if (format === "json") return download("prompt-tests.json", JSON.stringify(out, null, 1), "application/json");
    const keys = Object.keys(out[0] || {});
    download("prompt-tests.csv", [keys.join(",")].concat(out.map((r) => keys.map((k) => csvCell(r[k])).join(","))).join("\n"), "text/csv");
  };

  const exportRuns = async () => {
    try {
      const res = await exportPromptRuns(companyId);
      download("prompt-test-runs.json", JSON.stringify(res.runs, null, 1), "application/json");
    } catch (err) {
      setError(err?.message || "Could not export runs");
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (!data) return <p className="text-sm text-red-600">{error}</p>;

  const busy = running;
  const elapsed = run?.startedAt ? (run.endedAt || now) - run.startedAt : 0;
  // Time left, from the pace so far. Shown once a first step is done.
  const remaining = run && !run.finished && run.done > 0 ? (elapsed / run.done) * (run.total - run.done) : null;
  const engineSummaries = Object.entries(data.summary.engines);
  const lastCycle = data.cycles[0];
  const stale = lastCycle && Date.now() - new Date(lastCycle.created_at).getTime() > 30 * 86400000;

  return (
    <div className="space-y-5">
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <PromptTestsSummary open={summaryOpen} onOpenChange={setSummaryOpen} data={data} />

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Prompt tests</h2>
        <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
          Approved prompts pushed from the Prompt Builder, run through the AI engines. Each run records whether the engine searched the web,
          which sites it cited and which brands it named.
        </p>
        {!data.dataforseo && <p className="mb-3 text-sm text-red-700">DataForSEO credentials are not configured on the server, so tests cannot run.</p>}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Monthly spending cap (USD)</span>
            <Input className="h-8 w-28" type="number" min="0" step="1" defaultValue={data.settings.monthly_cap} disabled={busy}
              onBlur={(e) => Number(e.target.value) !== data.settings.monthly_cap && saveSettings({ monthly_cap: Number(e.target.value) })} />
          </label>
          <p className="pb-1.5 tabular-nums text-foreground">
            Spent this month: {money(data.spend.month)} of {money(data.spend.cap)}
          </p>
          {engineIds.map((e) => (
            <label key={e} className="flex items-center gap-2">
              <input type="checkbox" checked={data.settings.engines.includes(e)} disabled={busy}
                onChange={(ev) => saveSettings({ engines: ev.target.checked ? [...data.settings.engines, e] : data.settings.engines.filter((x) => x !== e) })} />
              <span className="text-foreground">{data.engines[e].label}</span>
              {data.engines[e].method === "api" && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">API, not app</span>}
              <Input className="h-8 w-14" type="number" min="0" max="5" defaultValue={data.settings.runs[e]} disabled={busy} title="Runs per prompt"
                onBlur={(ev) => Number(ev.target.value) !== data.settings.runs[e] && saveSettings({ runs: { ...data.settings.runs, [e]: Number(ev.target.value) } })} />
              <span className="text-muted-foreground">runs</span>
            </label>
          ))}
        </div>
        {stale && <p className="mt-3 text-xs text-amber-700">The last test is more than 30 days old. Re-run it to see current results.</p>}
      </section>

      {engineSummaries.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">
              Latest results by engine
              <span className="ml-2 text-xs font-normal text-muted-foreground">Approved prompts only</span>
            </h2>
            <Button type="button" size="sm" onClick={() => setSummaryOpen(true)}>
              <BarChart3 className="mr-1.5 h-3.5 w-3.5" />Summary
            </Button>
          </div>
          {engineSummaries.map(([id, s]) => (<EngineSummary key={id} id={id} s={s} />))}
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectClass} value={filters.persona} onChange={(e) => setFilters({ ...filters, persona: e.target.value })} aria-label="Filter by persona">
            <option value="">All personas</option>
            {personas.map((p) => (<option key={p}>{p}</option>))}
          </select>
          <select className={selectClass} value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })} aria-label="Filter by stage">
            <option value="">All stages</option>
            {STAGES.map((p) => (<option key={p}>{p}</option>))}
          </select>
          <select className={selectClass} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} aria-label="Filter by type">
            <option value="">All types</option>
            {TYPES.map((p) => (<option key={p}>{p}</option>))}
          </select>
          <select className={selectClass} value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })} aria-label="Filter by outcome">
            <option value="">All outcomes</option>
            {["Not tested", ...Object.keys(LABEL_TONE)].map((p) => (<option key={p}>{p}</option>))}
          </select>
          <span className="text-xs text-muted-foreground">{rows.length} of {data.prompts.length} prompts</span>
          <span className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={() => exportPrompts("csv")} disabled={!data.prompts.length}><Download className="mr-1.5 h-3.5 w-3.5" />Prompts CSV</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => exportPrompts("json")} disabled={!data.prompts.length}>Prompts JSON</Button>
          <Button type="button" variant="outline" size="sm" onClick={exportRuns} disabled={!engineSummaries.length}>Runs JSON</Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy}
            onClick={() => setSelected(new Set(approvedShown.every((p) => selected.has(p.id)) ? [] : approvedShown.map((p) => p.id)))}>
            {approvedShown.length && approvedShown.every((p) => selected.has(p.id)) ? "Clear selection" : `Select ${approvedShown.length} approved shown`}
          </Button>
          <Button type="button" size="sm" disabled={busy || !selectedIds.length || !data.dataforseo} onClick={preview}>
            <Play className="mr-1.5 h-3.5 w-3.5" />Run test on {selectedIds.length} selected
          </Button>
          {busy && (
            <Button type="button" variant="outline" size="sm" onClick={() => { stopRef.current = true; }}>
              <Square className="mr-1.5 h-3.5 w-3.5" />Stop after this step
            </Button>
          )}
        </div>

        {plan && !busy && (
          <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <p className="font-medium text-foreground">Cost before it runs</p>
            {plan.perEngine.map((e) => (
              <p key={e.engine} className="tabular-nums">
                {e.label}: {plan.prompts} prompts × {e.runs} runs × {`$${e.unitCost.toFixed(3)}`} = {money(e.cost)}{e.estimated ? " (estimate; the API charges by length)" : ""}
              </p>
            ))}
            <p className="mt-1 font-medium tabular-nums text-foreground">
              Total {money(plan.estCost)} for {plan.calls.length} calls. Spent this month {money(plan.monthSpent)} of {money(plan.cap)}.
            </p>
            {plan.ok ? (
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={start}>Start test ({money(plan.estCost)})</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setPlan(null)}>Cancel</Button>
              </div>
            ) : (
              <p className="mt-2 text-red-700">This would exceed the monthly cap. Select fewer prompts, lower the runs, or raise the cap.</p>
            )}
          </div>
        )}

        {run && (
          <div className="mt-3 rounded-md border border-border p-3 text-xs" role="status">
            <div className="h-1.5 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary" style={{ width: `${run.total ? Math.round((run.done / run.total) * 100) : 0}%` }} />
            </div>
            <p className="mt-2 tabular-nums text-foreground">
              {run.finished ? "Finished" : "Running"}: {run.done} of {run.total} calls, {run.failed} failed, {money(run.spent)} spent. {run.note}
            </p>
            {run.startedAt ? (
              <p className="tabular-nums text-foreground">
                {run.finished ? `Took ${formatDuration(elapsed)}.` : `Elapsed ${formatDuration(elapsed)}`}
                {remaining != null ? ` · about ${formatDuration(remaining)} left` : ""}
              </p>
            ) : null}
            {run.finished && engineSummaries.length > 0 ? (
              <Button type="button" size="sm" className="mt-2" onClick={() => setSummaryOpen(true)}>
                <BarChart3 className="mr-1.5 h-3.5 w-3.5" />View summary
              </Button>
            ) : null}
            {!run.finished && <p className="text-muted-foreground">Keep this tab open. Each step of {STEP_SIZE} calls takes about half a minute.</p>}
          </div>
        )}

        {data.prompts.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No prompts yet. In the Prompt Builder, approve prompts and select Push to The Night Ventures.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-2 py-1.5" />
                  <th className="px-2 py-1.5">ID</th>
                  <th className="px-2 py-1.5">Prompt</th>
                  <th className="px-2 py-1.5">Persona</th>
                  <th className="px-2 py-1.5">Cell</th>
                  {shownEngines.map((e) => (<th key={e} className="whitespace-nowrap px-2 py-1.5">{data.engines[e].label}</th>))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const o = data.outcomes[p.id] || {};
                  const approved = p.status === "Approved";
                  return (
                    <tr key={p.id} className="border-b border-border align-top">
                      <td className="px-2 py-1.5">
                        <input type="checkbox" aria-label={`Select ${p.code}`} disabled={!approved || busy} checked={selected.has(p.id)}
                          onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(p.id); else next.delete(p.id); setSelected(next); setPlan(null); }} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{p.code}</td>
                      <td className="min-w-[280px] px-2 py-1.5 text-sm text-foreground">
                        {p.prompt}
                        {!approved && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{p.status}</span>}
                      </td>
                      <td className="px-2 py-1.5">{p.persona}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{p.situation} · {p.stage} · {p.type}</td>
                      {shownEngines.map((e) => (
                        <td key={e} className="whitespace-nowrap px-2 py-1.5">
                          {o[e] ? (
                            <span className={`rounded px-1.5 py-0.5 ${LABEL_TONE[o[e].label] || ""}`}>{o[e].label} · {o[e].detail}</span>
                          ) : (
                            <span className="text-muted-foreground">Not tested</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
