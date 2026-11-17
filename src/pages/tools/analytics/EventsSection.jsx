import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { Loader2, Pencil, Plus, RotateCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorLine, Loading, Section } from "@/components/SectionBlocks";
import { analyzeEvents, deleteAnalyticsEvent, getAnalyticsEvents, saveAnalyticsEvent, saveAnnotation } from "./api";
import { fmtDay, fmtNum } from "./format";
import { DataTable, Pill, Segmented } from "./parts";

const GROUPS = [
  { id: "search", label: "Search" },
  { id: "ai", label: "AI" },
  { id: "traffic", label: "Traffic" },
];

const VERDICT = {
  explained: { label: "Explained", tone: "good" },
  partly: { label: "Partly explained", tone: "warn" },
  unexplained: { label: "Unexplained", tone: "muted" },
};

const VERDICT_OPTIONS = Object.entries(VERDICT).map(([value, v]) => ({ value, label: v.label }));

const TYPE_LABEL = {
  publish: "Publish",
  deploy: "Site deploy",
  email: "Email",
  tracking: "Tracking",
  social: "Social post",
  pr: "PR or listing",
  algorithm: "Search update",
  site: "Site change",
  other: "Other",
};

const LOG_PAGE = 25;

/** Monday (UTC) of the week containing an ISO date. */
function weekOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

function weekRange(a) {
  return a.week_start === a.through_week
    ? `Week of ${fmtDay(a.week_start)}`
    : `Weeks of ${fmtDay(a.week_start)} to ${fmtDay(a.through_week)}`;
}

function MarkerLabel({ viewBox, n }) {
  if (!viewBox) return null;
  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y + viewBox.height / 2 - 16;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} className="fill-foreground" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="fill-background text-[10px] font-medium">
        {n}
      </text>
    </g>
  );
}

function MovesChart({ data, metric, annotations, events }) {
  const unit = metric?.unit || "";
  const fmt = (v) => (v == null ? "—" : `${fmtNum(v)}${unit}`);
  const config = { value: { label: metric?.label || "Value", color: "hsl(var(--chart-1))" } };
  const weeks = new Set(data.map((p) => p.week));
  const eventWeeks = [...new Set(events.map((e) => weekOf(e.date)))].filter((w) => weeks.has(w));
  const eventsIn = (week) => events.filter((e) => weekOf(e.date) === week);

  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <LineChart data={data} margin={{ top: 32, right: 24, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="week" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={(v) => `${fmtNum(v)}${unit}`} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => `Week of ${fmtDay(payload?.[0]?.payload?.week)}`}
              formatter={(value, _name, item) => {
                const list = eventsIn(item?.payload?.week);
                return (
                  <div className="w-full space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-muted-foreground">{metric?.label}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">{fmt(value)}</span>
                    </div>
                    {list.slice(0, 4).map((e) => (
                      <p key={e.id} className="max-w-[16rem] truncate text-[11px] text-muted-foreground">
                        {fmtDay(e.date)} · {e.title}
                      </p>
                    ))}
                    {list.length > 4 ? <p className="text-[11px] text-muted-foreground">and {list.length - 4} more events</p> : null}
                  </div>
                );
              }}
            />
          }
        />
        {eventWeeks.map((week) => (
          <ReferenceLine key={`e-${week}`} x={week} stroke="hsl(var(--chart-4))" strokeDasharray="2 4" strokeOpacity={0.6} />
        ))}
        {annotations
          .filter((a) => a.week_start !== a.through_week && weeks.has(a.week_start) && weeks.has(a.through_week))
          .map((a) => (
            <ReferenceArea key={`a-${a.id}`} x1={a.week_start} x2={a.through_week} fill="hsl(var(--chart-1))" fillOpacity={0.06} />
          ))}
        <Line dataKey="value" type="linear" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />
        {annotations.map((a) => {
          const week = weeks.has(a.week_start) ? a.week_start : data[0]?.week;
          const point = data.find((p) => p.week === week);
          if (!point || point.value == null) return null;
          return (
            <ReferenceDot
              key={a.id}
              x={week}
              y={point.value}
              r={4}
              fill="hsl(var(--foreground))"
              stroke="hsl(var(--background))"
              label={<MarkerLabel n={a.n} />}
            />
          );
        })}
      </LineChart>
    </ChartContainer>
  );
}

function EditAnnotation({ annotation, events, saving, onSave, onCancel }) {
  const [verdict, setVerdict] = useState(annotation.verdict);
  const [summary, setSummary] = useState(annotation.summary);
  const [picked, setPicked] = useState(() => new Set(annotation.events.map((e) => e.id)));
  const candidates = events.filter((e) => e.date >= annotation.window_from && e.date <= annotation.window_to);
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <Segmented label="Verdict" value={verdict} onChange={setVerdict} options={VERDICT_OPTIONS} />
      <Textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={3}
        aria-label="Explanation"
        placeholder="What caused this change?"
      />
      <div className="space-y-1">
        <p className="text-xs font-medium">Events that caused it</p>
        {candidates.length ? (
          candidates.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
              <span>
                <span className="tabular-nums text-muted-foreground">{fmtDay(e.date)}</span> · {e.title}
              </span>
            </label>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            No events logged between {fmtDay(annotation.window_from)} and {fmtDay(annotation.window_to)}. Add one in the event log below.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || !summary.trim()}
          onClick={() => onSave({ id: annotation.id, verdict, summary: summary.trim(), eventIds: [...picked] })}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AnnotationCard({ annotation: a, metric, events, busy, editing, onEdit, onCancel, onSave, onRecheck }) {
  const unit = metric?.unit || "";
  const linked = a.events.map((l) => ({ ...l, event: events.find((e) => e.id === l.id) })).filter((l) => l.event);
  const contributors = a.evidence?.contributors || [];
  const v = VERDICT[a.verdict] || VERDICT.unexplained;
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-medium text-background">
          {a.n}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium">
          {weekRange(a)}: {a.direction === "up" ? "up" : "down"} from {fmtNum(a.baseline)}
          {unit} to {fmtNum(a.value)}
          {unit}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {a.stale ? <Pill tone="info">New event logged — re-check</Pill> : null}
          {a.edited_at ? <Pill>Edited by hand</Pill> : null}
          <Pill tone={v.tone}>{v.label}</Pill>
        </div>
      </div>

      {editing ? (
        <EditAnnotation annotation={a} events={events} saving={busy === `save-${a.id}`} onSave={onSave} onCancel={onCancel} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{a.summary}</p>
          {linked.length ? (
            <ul className="space-y-0.5 text-xs">
              {linked.map((l) => (
                <li key={l.id}>
                  <span className="tabular-nums text-muted-foreground">{fmtDay(l.event.date)}</span> · {l.event.title}{" "}
                  <span className="text-muted-foreground">({l.strength === "strong" ? "likely cause" : "possible cause"})</span>
                </li>
              ))}
            </ul>
          ) : null}
          {contributors.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">What changed most ({a.evidence?.parts || "parts"}, per week)</summary>
              <ul className="mt-1 space-y-0.5">
                {contributors.map((c) => (
                  <li key={c.key} className="flex gap-2">
                    <span className="min-w-0 flex-1 break-all">{c.key}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {fmtNum(c.baseline)} → {fmtNum(c.current)}
                      {c.share != null ? ` · ${Math.round(c.share * 100)}% of the change` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onEdit} disabled={Boolean(busy)}>
              <Pencil className="mr-1 h-3 w-3" /> Edit
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onRecheck} disabled={Boolean(busy)}>
              {busy === `recheck-${a.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1 h-3 w-3" />}
              Re-check
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Events checked from {fmtDay(a.window_from)} to {fmtDay(a.window_to)}
            </span>
          </div>
        </>
      )}
    </li>
  );
}

function EventForm({ types, initial, saving, onSave, onCancel }) {
  const [form, setForm] = useState(() => initial || { date: today(), type: "social", title: "", detail: "" });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));
  const submit = (e) => {
    e.preventDefault();
    if (form.title.trim() && form.date) onSave(form);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">Date</span>
        <Input type="date" className="h-9 w-40" value={form.date} max={today()} onChange={set("date")} required />
      </label>
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">Type</span>
        <Select value={form.type} onValueChange={set("type")}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types
              .filter((t) => t !== "publish" && t !== "deploy")
              .map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t] || t}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </label>
      <label className="min-w-[12rem] flex-1 space-y-1 text-xs">
        <span className="text-muted-foreground">What happened</span>
        <Input className="h-9" value={form.title} onChange={set("title")} placeholder="LinkedIn post about the seed-round guide" maxLength={200} required />
      </label>
      <label className="min-w-[12rem] flex-1 space-y-1 text-xs">
        <span className="text-muted-foreground">Detail (optional)</span>
        <Input className="h-9" value={form.detail} onChange={set("detail")} placeholder="Link or note" maxLength={1000} />
      </label>
      <Button type="submit" size="sm" className="h-9" disabled={saving || !form.title.trim()}>
        {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : initial ? null : <Plus className="mr-1.5 h-3.5 w-3.5" />}
        {initial ? "Save" : "Add event"}
      </Button>
      {onCancel ? (
        <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      ) : null}
    </form>
  );
}

function analyzeLabel(view, busy) {
  if (busy === "analyze") return "Analyzing…";
  if (view.pendingWeeks > 0) {
    if (!view.analyzedThrough) return "Analyze";
    return `Analyze ${view.pendingWeeks} new ${view.pendingWeeks === 1 ? "week" : "weeks"}`;
  }
  if (view.staleCount > 0) return `Re-check ${view.staleCount} ${view.staleCount === 1 ? "annotation" : "annotations"}`;
  return "Up to date";
}

/** Analytics → Events: one weekly chart, the moves on it explained, and the event log. */
export default function EventsSection({ companyId }) {
  const [metric, setMetric] = useState("");
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingAnnotation, setEditingAnnotation] = useState("");
  const [editingEvent, setEditingEvent] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [shown, setShown] = useState(LOG_PAGE);
  const [formKey, setFormKey] = useState(0);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const data = await getAnalyticsEvents(companyId, metric);
      if (id === requestId.current) setView(data);
    } catch (err) {
      if (id === requestId.current) setError(err?.message || "Failed to load events");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [companyId, metric]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(kind, fn, done) {
    setBusy(kind);
    setActionError("");
    setNotice("");
    try {
      const result = await fn();
      setNotice(typeof done === "function" ? done(result) : done);
      await load();
      return true;
    } catch (err) {
      setActionError(err?.message || "Something went wrong");
      return false;
    } finally {
      setBusy("");
    }
  }

  const current = view?.metrics?.find((m) => m.id === view.metric) || null;
  const annotations = useMemo(
    () => (view?.annotations || []).map((a, i) => ({ ...a, n: i + 1 })),
    [view]
  );
  // Weeks before the metric was first measured are left off the chart.
  const series = useMemo(() => {
    const all = view?.series || [];
    const first = all.findIndex((p) => p.value != null);
    return first > 0 ? all.slice(first) : all;
  }, [view]);
  const firstWeek = series[0]?.week || "";
  const chartEvents = useMemo(
    () => (view?.events || []).filter((e) => !firstWeek || e.date >= firstWeek),
    [view, firstWeek]
  );
  const linkedBy = useMemo(() => {
    const map = new Map();
    for (const a of annotations) for (const l of a.events) map.set(l.id, [...(map.get(l.id) || []), a.n]);
    return map;
  }, [annotations]);

  if (loading && !view) return <Loading />;
  if (error && !view) return <ErrorLine>{error}</ErrorLine>;
  if (!view) return null;

  const onAnalyze = () =>
    run(
      "analyze",
      () => analyzeEvents(companyId, view.metric),
      (r) => {
        const parts = [];
        if (r.added) parts.push(`${r.added} new ${r.added === 1 ? "move" : "moves"} explained`);
        if (r.rechecked) parts.push(`${r.rechecked} re-checked`);
        if (r.more) parts.push("more to do — click Analyze again");
        return parts.length ? `${parts.join(", ")}.` : "No new moves in these weeks.";
      }
    );

  const hasData = view.series.some((p) => p.value != null);
  const upToDate = view.pendingWeeks === 0 && view.staleCount === 0;
  const logRows = (view.events || []).filter((e) => typeFilter === "all" || e.type === typeFilter);
  const typesPresent = [...new Set((view.events || []).map((e) => e.type))];
  const lastWeek = view.series[view.series.length - 1]?.week;

  const columns = [
    { key: "date", label: "Date", className: "whitespace-nowrap tabular-nums", render: (e) => fmtDay(e.date) },
    { key: "type", label: "Type", className: "whitespace-nowrap", render: (e) => TYPE_LABEL[e.type] || e.type },
    {
      key: "title",
      label: "Event",
      render: (e) => (
        <div className="space-y-0.5">
          <p>{e.title}</p>
          {e.detail ? <p className="break-words text-[11px] text-muted-foreground">{e.detail}</p> : null}
        </div>
      ),
    },
    {
      key: "linked",
      label: "Explains",
      hint: "The numbered moves on this chart that cite this event.",
      className: "whitespace-nowrap",
      render: (e) => (linkedBy.get(e.id) || []).map((n) => `#${n}`).join(", ") || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "source",
      label: "Logged",
      className: "whitespace-nowrap",
      render: (e) =>
        e.source === "auto" ? (
          <span className="text-muted-foreground">Automatic</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            By hand
            <button
              type="button"
              aria-label={`Edit ${e.title}`}
              className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setEditingEvent(e.id)}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${e.title}`}
              className="rounded p-1 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={Boolean(busy)}
              onClick={() => {
                if (window.confirm(`Delete "${e.title}"?`)) run("event", () => deleteAnalyticsEvent(companyId, e.id), "Event deleted.");
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ),
    },
  ];

  const editing = editingEvent ? (view.events || []).find((e) => e.id === editingEvent) : null;

  return (
    <div className={loading ? "space-y-6 opacity-60 transition-opacity" : "space-y-6 transition-opacity"} aria-busy={loading}>
      {actionError ? <ErrorLine>{actionError}</ErrorLine> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {notice ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</p> : null}

      <Section
        title={current?.label || "Chart"}
        description={`${current?.note || ""} Weekly, complete weeks only${lastWeek ? `, through the week of ${fmtDay(lastWeek)}` : ""}.`}
        actions={
          <>
            <Select value={view.metric} onValueChange={setMetric}>
              <SelectTrigger className="h-8 w-64 text-xs" aria-label="Chart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => (
                  <SelectGroup key={g.id}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {view.metrics
                      .filter((m) => m.group === g.id)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" onClick={onAnalyze} disabled={Boolean(busy) || upToDate || !hasData}>
              {busy === "analyze" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              {analyzeLabel(view, busy)}
            </Button>
          </>
        }
      >
        {hasData ? (
          <div className="space-y-2">
            <MovesChart data={series} metric={current} annotations={annotations} events={chartEvents} />
            <p className="text-[11px] text-muted-foreground">
              Numbers mark weeks that moved more than half away from the average of the 4 weeks before. Dotted lines mark weeks with a logged event.{" "}
              {view.analyzedThrough
                ? `Analysed through the week of ${fmtDay(view.analyzedThrough)}.`
                : "Not analysed yet."}
              {busy === "analyze" ? " This can take a minute." : ""}
              {view.aiReady ? "" : " ANTHROPIC_API_KEY is not set, so explanations use a simple rule."}
            </p>
          </div>
        ) : (
          <p className="flex h-40 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
            No data for this chart yet — check Setup under Search, AI or Traffic.
          </p>
        )}
      </Section>

      <Section
        title="What moved and why"
        description="Saved once analysed. A person's edit is kept; a new event reopens the moves it could explain."
      >
        {annotations.length ? (
          <ul className="space-y-3">
            {annotations.map((a) => (
              <AnnotationCard
                key={a.id}
                annotation={a}
                metric={current}
                events={view.events || []}
                busy={busy}
                editing={editingAnnotation === a.id}
                onEdit={() => setEditingAnnotation(a.id)}
                onCancel={() => setEditingAnnotation("")}
                onSave={async (payload) => {
                  if (await run(`save-${a.id}`, () => saveAnnotation(companyId, payload), "Saved.")) setEditingAnnotation("");
                }}
                onRecheck={() => {
                  if (a.edited_at && !window.confirm("Re-checking replaces your edit with a new analysis. Continue?")) return;
                  run(`recheck-${a.id}`, () => analyzeEvents(companyId, view.metric, a.id), "Re-checked.");
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {view.analyzedThrough
              ? "No week on this chart moved enough to flag."
              : "Click Analyze to find the weeks that moved and match them to events."}
          </p>
        )}
      </Section>

      <Section
        title="Event log"
        description="Publishes, site deploys and sends are logged automatically. Add anything else that could move a chart: posts, listings, launches, search updates."
      >
        <div className="space-y-4">
          {editing ? (
            <EventForm
              key={editing.id}
              types={view.eventTypes}
              initial={{ id: editing.id, date: editing.date, type: editing.type, title: editing.title, detail: editing.detail || "" }}
              saving={busy === "event"}
              onCancel={() => setEditingEvent("")}
              onSave={async (form) => {
                if (await run("event", () => saveAnalyticsEvent(companyId, form), "Event saved.")) setEditingEvent("");
              }}
            />
          ) : (
            <EventForm
              key={formKey}
              types={view.eventTypes}
              saving={busy === "event"}
              onSave={async (form) => {
                if (await run("event", () => saveAnalyticsEvent(companyId, form), "Event added.")) setFormKey((k) => k + 1);
              }}
            />
          )}
          {view.collect?.deploys && !view.collect.deploys.ok ? (
            <p className="text-[11px] text-muted-foreground">Site deploys not logged: {view.collect.deploys.message}</p>
          ) : null}
          {view.collect?.error ? <ErrorLine>{view.collect.error}</ErrorLine> : null}
          {typesPresent.length > 1 ? (
            <Segmented
              label="Event type"
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v);
                setShown(LOG_PAGE);
              }}
              options={[{ value: "all", label: "All" }, ...typesPresent.map((t) => ({ value: t, label: TYPE_LABEL[t] || t }))]}
            />
          ) : null}
          <DataTable columns={columns} rows={logRows.slice(0, shown)} rowKey={(e) => e.id} empty="No events logged yet." />
          {logRows.length > shown ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShown((n) => n + 100)}>
              Show more ({logRows.length - shown} older)
            </Button>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
