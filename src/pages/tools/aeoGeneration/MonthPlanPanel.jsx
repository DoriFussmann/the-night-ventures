import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, ChevronDown, ChevronRight, Loader2, PenLine, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  buildMonthPlan,
  monthCalendar,
  monthLabel,
  nextMonthStart,
  planDueDay,
  shiftMonth,
  themesOf,
} from "../../../../lib/aeo/monthPlan.js";
import { approveMonthPlan, loadMonthPlan, loadVoice, prepareBrief, saveMonthPlan, saveVoice, suggestThemeView } from "./monthPlan";

const DONE_DRAFT = new Set(["generated", "approved", "scheduled", "published"]);
const DONE_APPROVED = new Set(["approved", "scheduled", "published"]);
const DONE_SCHEDULED = new Set(["scheduled", "published"]);
const DONE_READY = new Set(["ready", ...DONE_DRAFT]);

const chip = "inline-flex shrink-0 items-center rounded px-2 py-0.5 text-[11px] leading-4";
const CHIP = {
  input: `${chip} bg-teal-50 text-teal-900 ring-1 ring-inset ring-teal-200`,
  calc: `${chip} bg-slate-100 text-slate-700`,
  output: `${chip} bg-orange-50 text-orange-900 ring-1 ring-inset ring-orange-200`,
};

const shortDay = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const weekdayDay = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};

function Section({ title, eyebrow, summary, open, onToggle, children, right }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-start gap-2 text-left">
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            {eyebrow && <span className="block text-[11px] font-medium uppercase tracking-wider text-teal-800">{eyebrow}</span>}
            <span className="block text-sm font-medium text-foreground">{title}</span>
            {summary && <span className="block text-xs text-muted-foreground">{summary}</span>}
          </span>
        </button>
        {right}
      </div>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </section>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="min-w-[150px] flex-1 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-light tabular-nums text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Step({ n, title, note, chipText, chipKind, state }) {
  const box =
    state === "now"
      ? "border-2 border-teal-700 bg-card"
      : state === "last"
        ? "border border-slate-900 bg-slate-900 text-slate-100"
        : "border border-border bg-card";
  return (
    <div className={`flex min-h-[120px] min-w-[170px] flex-1 flex-col gap-1.5 rounded-lg p-3 ${box}`}>
      <span className={`text-xs ${state === "last" ? "text-orange-300" : "text-teal-800"}`}>
        {n} · {title}
        {state === "now" ? " · now" : ""}
      </span>
      <span className={`text-xs ${state === "last" ? "text-slate-300" : "text-muted-foreground"}`}>{note}</span>
      <span className={`mt-auto self-start ${CHIP[chipKind]}`}>{chipText}</span>
    </div>
  );
}

/**
 * Monthly Plan: next month's articles in one place. Pick (scored, by theme),
 * your view per theme, briefs prepared, drafts written, reviewed, scheduled.
 * Writing runs in this tab, like the rest of AEO Generation.
 */
export default function MonthPlanPanel({
  companyId,
  data,
  briefs,
  lookups,
  taken,
  today,
  busy,
  drafting,
  onReload,
  onError,
  onWriteDrafts,
  onSchedule,
}) {
  const [month, setMonth] = useState(() => nextMonthStart(today));
  const [row, setRow] = useState(undefined);
  const [voice, setVoice] = useState("");
  const [views, setViews] = useState({});
  const [removed, setRemoved] = useState(new Set());
  const [open, setOpen] = useState({});
  const [working, setWorking] = useState(null);
  const [suggest, setSuggest] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [draft, setDraft] = useState("");
  const stopRef = useRef(false);

  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const loadRow = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([loadMonthPlan(companyId, month), loadVoice(companyId)]);
      setRow(r);
      setVoice(v);
      setViews(r?.theme_views || {});
      setRemoved(new Set((r?.plan || []).filter((e) => e.removed).map((e) => e.group_id)));
    } catch (err) {
      setRow(null);
      onError?.(/aeo_month_plans|key_points_voice/.test(err?.message || "") ? `${err.message}. Run migration 086 first.` : err?.message);
    }
  }, [companyId, month, onError]);

  useEffect(() => {
    setRow(undefined);
    loadRow();
  }, [loadRow]);

  const approved = row?.status === "approved" || row?.status === "done";
  const calendar = useMemo(() => monthCalendar(month), [month]);
  const due = planDueDay(month);

  // Before approval the plan is computed live; after, it is what was stored.
  const live = useMemo(() => {
    if (approved || !data) return null;
    const briefed = new Set(briefs.map((b) => b.group_id));
    return buildMonthPlan({
      month,
      pillars: data.pillars,
      groups: data.groups,
      prompts: data.prompts,
      excludeGroupIds: briefed,
      removedGroupIds: removed,
      takenDays: taken,
    });
  }, [approved, data, briefs, month, removed, taken]);

  const planBriefs = useMemo(() => (row ? briefs.filter((b) => b.month_plan_id === row.id) : []), [briefs, row]);
  const briefByGroup = useMemo(() => new Map(planBriefs.map((b) => [b.group_id, b])), [planBriefs]);

  const picks = useMemo(() => {
    if (!approved) return live?.picks || [];
    return (row.plan || [])
      .filter((e) => !e.removed)
      .map((e, i) => ({
        group: lookups.groupById.get(e.group_id) || { id: e.group_id, code: "?", name: "Removed group" },
        pillar: lookups.pillarById.get(e.pillar_id) || null,
        score: e.score,
        value: e.value,
        day: e.day,
        k: i,
        why: [],
      }));
  }, [approved, live, row, lookups]);

  const themes = useMemo(() => themesOf(picks), [picks]);
  const workdays = calendar.filter((c) => c.workday).length;
  const slots = approved ? picks.length : live?.slots ?? 0;
  const shortfall = approved ? 0 : live?.shortfall ?? 0;

  const n = (set) => planBriefs.filter((b) => set.has(b.status)).length;
  const counts = {
    ready: n(DONE_READY),
    drafted: n(DONE_DRAFT),
    approved: n(DONE_APPROVED),
    scheduled: n(DONE_SCHEDULED),
    total: planBriefs.length,
  };
  const themeKeys = themes.map((t) => t.key);
  const viewsDone = themeKeys.filter((k) => String(views[k] || "").trim()).length;

  const stage = !approved
    ? 1
    : counts.ready < counts.total
      ? 2
      : counts.drafted < counts.total
        ? 3
        : counts.approved < counts.total
          ? 4
          : 5;

  const persistRemoved = async (next) => {
    setRemoved(next);
    try {
      const r = await saveMonthPlan(companyId, month, {
        status: "planning",
        working_days: workdays,
        plan: [...next].map((id) => ({ group_id: id, removed: true })),
      });
      setRow(r);
    } catch (err) {
      onError?.(err?.message);
    }
  };

  const approve = async () => {
    setWorking({ text: "Creating briefs…" });
    try {
      await approveMonthPlan({ companyId, month, plan: live, removed, data, workdays });
      await loadRow();
      await onReload();
    } catch (err) {
      onError?.(err?.message || "Could not approve the plan");
    } finally {
      setWorking(null);
    }
  };

  const saveView = async (key, text) => {
    const next = { ...views, [key]: text };
    setViews(next);
    if (!row) return;
    try {
      setRow(await saveMonthPlan(companyId, month, { theme_views: next }));
    } catch (err) {
      onError?.(err?.message);
    }
  };

  const openTheme = (key) => {
    setDraft(views[key] || "");
    setActiveKey(key);
  };
  const closeTheme = () => {
    if (activeKey && draft !== (views[activeKey] || "")) saveView(activeKey, draft);
    setActiveKey(null);
  };

  const prepare = async () => {
    const todo = picks
      .map((p) => briefByGroup.get(p.group.id))
      .filter((b) => b && b.status === "draft" && String(views[lookups.groupById.get(b.group_id)?.pillar_id || "none"] || "").trim());
    if (!todo.length) return;
    stopRef.current = false;
    const problems = [];
    let done = 0;
    for (const [i, b] of todo.entries()) {
      if (stopRef.current) break;
      const group = lookups.groupById.get(b.group_id);
      const pillar = lookups.pillarById.get(group?.pillar_id);
      setWorking({ text: `Preparing ${i + 1} of ${todo.length} · ${b.title}`, stop: true, stopping: stopRef.current });
      try {
        const res = await prepareBrief({ companyId, brief: b, group, pillar, view: views[pillar?.id || "none"] });
        if (res === "ready") done += 1;
        else problems.push(`"${b.title}" still needs something (open its card below)`);
      } catch (err) {
        problems.push(`"${b.title}": ${err?.message || "failed"}`);
      }
    }
    setWorking(null);
    await onReload();
    if (problems.length) onError?.(`Prepared ${done}. ${problems.join(" · ")}`);
  };

  const writeAll = () => {
    const ready = picks.map((p) => briefByGroup.get(p.group.id)).filter((b) => b?.status === "ready");
    if (ready.length) onWriteDrafts(ready);
  };

  const scheduleAll = () => {
    const list = picks.map((p) => briefByGroup.get(p.group.id)).filter((b) => b?.status === "approved");
    if (!list.length) return;
    const first = calendar.find((c) => c.workday)?.day || month;
    onSchedule(list, first > today ? first : "");
  };

  if (row === undefined || !data) {
    return (
      <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading the monthly plan…
      </section>
    );
  }

  const banner = (() => {
    if (shortfall > 0) {
      return {
        kind: "warn",
        title: `Not enough topics: ${slots} slots, ${slots - shortfall} open prompt groups`,
        text: `Add at least ${shortfall} prompt group${shortfall === 1 ? "" : "s"} to the Content Map, then come back. The plan runs only when every slot is filled.`,
        action: (
          <Link to={`/company/${companyId}/aeo-playbook`} className="inline-flex h-9 items-center rounded-md bg-amber-900 px-3 text-sm text-white">
            Open the Content Map →
          </Link>
        ),
      };
    }
    if (stage === 1) {
      return {
        kind: "input",
        title: `Your input needed · approve the ${monthLabel(month)} plan`,
        text: `${slots} articles across ${themes.length} themes. Remove any topic and the next best takes its slot. Plan due ${weekdayDay(due)}.`,
        action: (
          <Button type="button" size="sm" disabled={busy || !!working || !slots} onClick={approve}>
            <Check className="mr-1.5 h-3.5 w-3.5" /> Approve plan
          </Button>
        ),
      };
    }
    if (stage === 2) {
      const missing = themeKeys.length - viewsDone;
      return {
        kind: "input",
        title: missing ? `Your input needed · write your view on ${missing} of ${themeKeys.length} themes` : "Prepare the briefs",
        text: missing
          ? "One view per theme. Claude turns it into hot takes for each article in that theme, with the matching takes from your bank."
          : "Outline and hot takes for each brief, then Ready. Keep this tab open while it runs.",
        action: (
          <Button type="button" size="sm" disabled={busy || drafting || !!working || !viewsDone} onClick={prepare}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Prepare {counts.total - counts.ready} brief{counts.total - counts.ready === 1 ? "" : "s"}
          </Button>
        ),
      };
    }
    if (stage === 3) {
      return {
        kind: "calc",
        title: `Write ${counts.ready - counts.drafted} drafts`,
        text: "Written one at a time in this tab. Closing or reloading the tab stops it; nothing is lost.",
        action: (
          <Button type="button" size="sm" disabled={busy || drafting} onClick={writeAll}>
            <PenLine className="mr-1.5 h-3.5 w-3.5" /> Write drafts
          </Button>
        ),
      };
    }
    if (stage === 4) {
      return {
        kind: "input",
        title: `Your input needed · review ${counts.drafted - counts.approved} drafts`,
        text: `Approve each one on its card under "${monthLabel(month)}" below. Unapproved articles do not publish; their slots shift.`,
        action: counts.approved > counts.scheduled ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={scheduleAll}>
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Schedule {counts.approved - counts.scheduled} approved
          </Button>
        ) : null,
      };
    }
    return counts.scheduled < counts.total
      ? {
          kind: "calc",
          title: `Schedule ${counts.approved - counts.scheduled} approved articles`,
          text: "One per working day from the first working day of the month, holidays skipped.",
          action: (
            <Button type="button" size="sm" disabled={busy} onClick={scheduleAll}>
              <CalendarDays className="mr-1.5 h-3.5 w-3.5" /> Schedule
            </Button>
          ),
        }
      : { kind: "done", title: `${monthLabel(month)} is scheduled`, text: `${counts.scheduled} articles, one per working day.`, action: null };
  })();

  const bannerBox = {
    warn: "bg-amber-50 text-amber-950 ring-amber-200",
    input: "bg-teal-50 text-teal-950 ring-teal-200",
    calc: "bg-slate-50 text-slate-900 ring-slate-200",
    done: "bg-orange-50 text-orange-950 ring-orange-200",
  }[banner.kind];

  const dayOf = new Map(picks.map((p) => [p.day, p]));
  const firstDow = new Date(`${month}T00:00:00Z`).getUTCDay();
  const lead = firstDow === 0 || firstDow === 6 ? 0 : firstDow - 1;
  const weekdays = calendar.filter((c) => !c.weekend);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-teal-800">Monthly plan</p>
          <h2 className="text-xl font-light text-foreground">{monthLabel(month)} Plan</h2>
          <p className="text-xs text-muted-foreground">
            {workdays} working days › {slots} articles › one per working day · plan due {weekdayDay(due)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ‹ {monthLabel(shiftMonth(month, -1)).split(" ")[0]}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            {monthLabel(shiftMonth(month, 1)).split(" ")[0]} ›
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2">
        <Stat label="Working days · articles" value={`${workdays} / ${slots}`} note={live?.takenDays?.length ? `${live.takenDays.length} days already used` : "US holidays off"} />
        <Stat label="Themes" value={themes.length} note="Max 5 articles each" />
        <Stat label="Theme views" value={`${viewsDone} / ${themes.length}`} note={approved ? "Yours to write" : "After approval"} />
        <Stat label="Drafts" value={`${counts.drafted} / ${approved ? counts.total : slots}`} note={drafting ? "Writing now" : "Written one at a time"} />
        <Stat label="Approved" value={`${counts.approved} / ${approved ? counts.total : slots}`} note={`${counts.scheduled} scheduled`} />
      </div>

      {/* Banner */}
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ring-1 ring-inset ${bannerBox}`}>
        <div className="min-w-0">
          <p className="text-sm font-medium">{banner.title}</p>
          <p className="text-xs opacity-80">{banner.text}</p>
        </div>
        {banner.action}
      </div>
      {working && (
        <p className="flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> {working.text}
          {working.stop && (
            working.stopping ? (
              <span className="ml-auto inline-flex items-center gap-1 font-medium">
                <Check className="h-3 w-3" /> Stopping after this brief…
              </span>
            ) : (
              <button type="button" className="ml-auto inline-flex items-center gap-1 underline"
                onClick={() => {
                  stopRef.current = true;
                  setWorking((w) => (w ? { ...w, stopping: true } : w));
                }}>
                <Square className="h-3 w-3" /> Stop after this one
              </button>
            )
          )}
        </p>
      )}

      {/* Stages */}
      <div className="flex flex-wrap gap-2">
        <Step n={1} title="Plan" note={`${slots} articles · ${themes.length} themes`} state={stage === 1 ? "now" : ""}
          chipKind={approved ? "output" : "input"} chipText={approved ? `Approved · ${shortDay(String(row.approved_at).slice(0, 10))}` : "Waiting for you"} />
        <Step n={2} title="Hot takes" note="Your view per theme" state={stage === 2 ? "now" : ""}
          chipKind={stage > 2 ? "output" : "input"} chipText={`${viewsDone} of ${themes.length} views · ${counts.ready} ready`} />
        <Step n={3} title="Drafts" note="One at a time, tab open" state={stage === 3 ? "now" : ""}
          chipKind="calc" chipText={`${counts.drafted} of ${approved ? counts.total : slots}`} />
        <Step n={4} title="Review" note="You approve every draft" state={stage === 4 ? "now" : ""}
          chipKind={stage > 4 ? "output" : "calc"} chipText={`${counts.approved} approved`} />
        <Step n={5} title="Scheduled" note="Unapproved slots shift" state="last"
          chipKind="output" chipText={`${counts.scheduled} scheduled`} />
      </div>

      {/* Plan by theme */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-teal-800">Plan · by theme</p>
            <p className="text-xs text-muted-foreground">Intent × demand × business value · each extra article on a theme × 0.6 · test results join in phase 2</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const all = themes.every((t) => open[`t:${t.key}`]);
            setOpen((o) => ({ ...o, ...Object.fromEntries(themes.map((t) => [`t:${t.key}`, !all])) }));
          }}>
            {themes.every((t) => open[`t:${t.key}`]) ? "Collapse all" : "Expand all"}
          </Button>
        </div>
        {themes.map((t) => {
          const isOpen = !!open[`t:${t.key}`];
          const hasView = String(views[t.key] || "").trim();
          return (
            <div key={t.key} className="overflow-hidden rounded-lg border border-border bg-card">
              <button type="button" onClick={() => toggle(`t:${t.key}`)} aria-expanded={isOpen}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left">
                <span className="flex flex-wrap items-center gap-2">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className={CHIP.calc}>{t.pillar?.code || "—"}</span>
                  <span className="text-sm text-foreground">{t.pillar?.name || "No pillar"}</span>
                  <span className="text-xs text-muted-foreground">{t.picks.length} article{t.picks.length === 1 ? "" : "s"}</span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-foreground">{t.picks.map((p) => shortDay(p.day)).join(" · ")}</span>
                  {approved && <span className={hasView ? CHIP.calc : CHIP.input}>{hasView ? "View written" : "Needs your view"}</span>}
                  <span className="text-xs text-muted-foreground">
                    Score <span className="text-base font-light tabular-nums text-foreground">{Number(t.score).toFixed(2)}</span>
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-border">
                  {t.picks.map((p) => {
                    const b = briefByGroup.get(p.group.id);
                    return (
                      <div key={p.group.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-2 last:border-b-0">
                        <span className="w-14 shrink-0 text-xs text-muted-foreground">{shortDay(p.day)}</span>
                        <span className="min-w-[220px] flex-1 text-sm text-foreground">
                          {b?.title || p.group.name}
                          <span className="ml-2 text-xs text-muted-foreground">{p.group.code}{p.why?.length ? ` · ${p.why.join(" · ")}` : ""}</span>
                        </span>
                        <span className="flex w-28 items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                            <span className="block h-full rounded bg-teal-500" style={{ width: `${Math.min(100, Math.round((p.value / (themes[0]?.score || 1)) * 100))}%` }} />
                          </span>
                          <span className="w-8 text-[11px] tabular-nums text-muted-foreground">{Number(p.value).toFixed(2)}</span>
                        </span>
                        {b ? <span className={CHIP.calc}>{b.status}</span> : null}
                        {!approved && (
                          <button type="button" aria-label={`Remove ${p.group.name} from the plan`}
                            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() => persistRemoved(new Set([...removed, p.group.id]))}>
                            <X className="h-3 w-3" /> Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {!approved && removed.size > 0 && (
          <p className="text-xs text-muted-foreground">
            {removed.size} removed ·{" "}
            <button type="button" className="underline" onClick={() => persistRemoved(new Set())}>put them back</button>
          </p>
        )}
        {!approved && live?.capRelaxed && (
          <p className="text-xs text-amber-800">Not enough themes to keep 5 per theme; some themes carry more.</p>
        )}
      </div>

      {/* Key points */}
      <Section
        eyebrow="Hot takes · voice › theme view › article"
        title="Your view, once per theme"
        summary={approved ? `${viewsDone} of ${themes.length} views written` : "Opens after the plan is approved"}
        open={open.kp ?? stage === 2}
        onToggle={() => setOpen((o) => ({ ...o, kp: !(o.kp ?? stage === 2) }))}
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="kp-voice" className="text-xs text-teal-800">Voice · company level · set once</label>
            <textarea id="kp-voice" rows={3} value={voice} onChange={(e) => setVoice(e.target.value)}
              onBlur={() => saveVoice(companyId, voice).catch((err) => onError?.(err?.message))}
              placeholder="Write as … experienced …, practical, bottom line first, no fluff. Signature terms: …"
              className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            {themes.map((t) => {
              const written = String(views[t.key] || "").trim();
              return (
                <button key={t.key} type="button" disabled={!approved} onClick={() => openTheme(t.key)}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60 ${written ? "border-border" : "border-teal-300"}`}>
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <span className={CHIP.calc}>{t.pillar?.code || "—"}</span>
                    {t.pillar?.name || "No pillar"}
                    <span className="text-xs text-muted-foreground">{t.picks.length} article{t.picks.length === 1 ? "" : "s"}</span>
                  </span>
                  <span className={written ? CHIP.calc : CHIP.input}>{written ? "View written" : "Write your view"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Calendar */}
      <Section
        eyebrow={`Schedule · ${monthLabel(month)}`}
        title="One article per working day"
        summary={`${picks.length ? `${shortDay(picks[0].day)} to ${shortDay(picks[picks.length - 1].day)} · ` : ""}${slots} slots · themes interleaved`}
        open={!!open.cal}
        onToggle={() => toggle("cal")}
      >
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-5 gap-1.5">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
              <span key={d} className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{d}</span>
            ))}
            {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} />)}
            {weekdays.map((c) => {
              const p = dayOf.get(c.day);
              const b = p && briefByGroup.get(p.group.id);
              const otherUse = !p && taken.includes(c.day);
              return (
                <div key={c.day} className={`flex min-h-[78px] flex-col gap-1 rounded-md border p-2 ${c.holiday ? "border-transparent bg-muted" : "border-border bg-card"}`}>
                  <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                    {shortDay(c.day)}
                    {p && <span className={CHIP.calc}>{p.pillar?.code || "—"}</span>}
                  </span>
                  <span className="text-xs leading-4 text-foreground">
                    {c.holiday ? `${c.holiday} · no publish` : p ? b?.title || p.group.name : otherUse ? "Another schedule" : ""}
                  </span>
                  {b && DONE_SCHEDULED.has(b.status) && <span className={`mt-auto self-start ${CHIP.output}`}>Scheduled</span>}
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {(() => {
        const t = themes.find((x) => x.key === activeKey);
        if (!t) return null;
        const prompts = t.picks
          .flatMap((p) => (lookups.promptsByGroup?.get(p.group.id) || []).slice(0, 2))
          .map((q) => q.prompt)
          .filter(Boolean)
          .slice(0, 8);
        const sug = suggest[t.key];
        return (
          <Dialog open onOpenChange={(o) => !o && closeTheme()}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-light">{t.pillar?.name || "No pillar"}</DialogTitle>
                <DialogDescription>
                  Your view on this theme for {monthLabel(month)}. It feeds the hot takes of {t.picks.length} article{t.picks.length === 1 ? "" : "s"}.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-teal-800">Article topics</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground">
                    {t.picks.map((p) => <li key={p.group.id}>{briefByGroup.get(p.group.id)?.title || p.group.name}</li>)}
                  </ul>
                </div>
                {prompts.length > 0 && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-teal-800">Potential buyer prompts</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                      {prompts.map((q) => <li key={q}>{q}</li>)}
                    </ul>
                  </div>
                )}
                <div className="rounded-md border border-dashed border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-teal-800">Suggestions for your view</p>
                    <button type="button" disabled={sug === "…"}
                      className="inline-flex items-center gap-1 text-xs text-teal-800 underline disabled:opacity-50"
                      onClick={async () => {
                        setSuggest((m) => ({ ...m, [t.key]: "…" }));
                        try {
                          const text = await suggestThemeView({ companyId, pillarId: t.pillar?.id || "", groupIds: t.picks.map((p) => p.group.id) });
                          setSuggest((m) => ({ ...m, [t.key]: text }));
                        } catch (err) {
                          setSuggest((m) => ({ ...m, [t.key]: "" }));
                          onError?.(err?.message);
                        }
                      }}>
                      {sug === "…" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {sug && sug !== "…" ? "Suggest again" : "Suggest"}
                    </button>
                  </div>
                  {sug && sug !== "…" ? (
                    <>
                      <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{sug}</p>
                      <button type="button" className="mt-2 text-xs text-teal-800 underline"
                        onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n\n${sug}` : sug))}>
                        Copy into my view to edit
                      </button>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Angles and questions to take a position on. Prompts for your thinking, not your opinion.</p>
                  )}
                </div>
                <div>
                  <label htmlFor="kp-modal" className="text-[11px] font-medium uppercase tracking-wider text-teal-800">Your view</label>
                  <textarea id="kp-modal" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                    placeholder="Your take on this theme in 3 to 5 sentences: what most advice gets wrong, what you would do."
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" onClick={closeTheme}>Save and close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      <p className="text-[11px] text-muted-foreground">
        Phase 2 adds Prompt Tests results (gap per topic), page fixes and last month&apos;s results. Briefs of this plan appear below under &ldquo;{monthLabel(month)}&rdquo;.
      </p>
    </section>
  );
}
