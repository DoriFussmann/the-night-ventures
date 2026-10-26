import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_SETTINGS,
  MAX_ATTEMPTS,
  OPEN_SCHEDULE_STATUSES,
  addDays,
  formatDay,
  itemLabel,
  normalizeSettings,
  openItems,
  planDates,
  summarize,
  takenDays,
  todayIn,
} from "../../../../lib/publish-schedule/plan.js";
import { browserTimezone } from "./publishSchedule";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground";

const LABEL_STYLES = {
  Live: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Due: "border-foreground/30 bg-accent text-foreground",
  Next: "border-foreground/30 bg-accent text-foreground",
  Scheduled: "border-border bg-muted/50 text-muted-foreground",
  Publishing: "border-border bg-muted/50 text-muted-foreground",
  "Needs approval": "border-amber-300 bg-amber-50 text-amber-800",
  Writing: "border-border bg-muted/50 text-muted-foreground",
  "Not written": "border-amber-300 bg-amber-50 text-amber-800",
  Failed: "border-destructive/30 bg-destructive/5 text-destructive",
  Skipped: "border-border bg-transparent text-muted-foreground line-through",
};

function settingsLine(settings) {
  const s = normalizeSettings(settings);
  const every = s.intervalDays === 1 ? "Every day" : `Every ${s.intervalDays} days`;
  return [
    every,
    s.weekends === "skip" ? "no weekends" : null,
    s.approval === "approve" ? "hold each for approval" : "auto-publish",
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Pick the keywords and the rhythm, see the dates, then write & schedule.
 * mode: "new" | "append"
 */
export function ScheduleDialog({ open, mode = "new", pillar, candidates, schedules, schedule, onClose, onConfirm }) {
  const tz = schedule?.settings?.timezone || browserTimezone();
  const today = todayIn(tz);
  const [order, setOrder] = useState([]);
  const [checked, setChecked] = useState({});
  const [start, setStart] = useState(today);
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, timezone: tz });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const key = `${open}:${pillar?.keyword}:${(candidates || []).map((c) => c.clusterKeyword).join("|")}`;
  useEffect(() => {
    if (!open) return;
    const list = (candidates || []).map((c) => c.clusterKeyword);
    setOrder(list);
    setChecked(Object.fromEntries(list.map((k) => [k, true])));
    setStart(today);
    setSettings(schedule ? normalizeSettings(schedule.settings) : { ...DEFAULT_SETTINGS, timezone: tz });
    setError("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const picked = order.filter((k) => checked[k]);
  const taken = useMemo(() => {
    const others = (schedules || []).filter(
      (s) => s.id !== schedule?.id && OPEN_SCHEDULE_STATUSES.has(s.status)
    );
    const own = schedule ? openItems(schedule.items).map((i) => i.publish_on) : [];
    return [...takenDays(others.flatMap((s) => s.items)), ...own];
  }, [schedules, schedule]);

  const effectiveStart = useMemo(() => {
    if (mode !== "append" || !schedule) return start < today ? today : start;
    const last = openItems(schedule.items).at(-1)?.publish_on;
    const s = normalizeSettings(schedule.settings);
    const next = last ? addDays(last, s.intervalDays) : today;
    return next < today ? today : next;
  }, [mode, schedule, start, today]);

  const dates = useMemo(
    () => planDates({ count: picked.length, start: effectiveStart, settings, taken }),
    [picked.length, effectiveStart, settings, taken]
  );

  const move = (index, delta) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const byKeyword = new Map((candidates || []).map((c) => [c.clusterKeyword, c]));
      await onConfirm({
        keywords: picked.map((k) => ({ keyword: k, slug: byKeyword.get(k)?.clusterSlug || "" })),
        settings: normalizeSettings(settings),
        start: effectiveStart,
      });
      onClose();
    } catch (err) {
      setError(err?.message || "Could not create the schedule");
    } finally {
      setBusy(false);
    }
  }

  const set = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[min(96vw,640px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 pr-12 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {mode === "append" ? "Add to schedule" : "Generate & schedule"}
          </p>
          <DialogTitle>{pillar?.keyword}</DialogTitle>
          <DialogDescription>
            Writes every article now, in this tab, then publishes them one at a time on the dates
            below. Publishing runs on the server, so nothing needs to be open on the day.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {mode === "new" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">First article</label>
                <Input type="date" value={start} min={today} onChange={(e) => setStart(e.target.value || today)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Then</label>
                <select
                  className={selectClass}
                  value={settings.intervalDays}
                  onChange={(e) => set({ intervalDays: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "One every day" : `One every ${n} days`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Weekends</label>
                <select
                  className={selectClass}
                  value={settings.weekends}
                  onChange={(e) => set({ weekends: e.target.value })}
                >
                  <option value="allow">Publish on weekends too</option>
                  <option value="skip">Skip weekends</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Before going live</label>
                <select
                  className={selectClass}
                  value={settings.approval}
                  onChange={(e) => set({ approval: e.target.value })}
                >
                  <option value="auto">Publish automatically</option>
                  <option value="approve">Hold each for my approval</option>
                </select>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Added after the last article, with the schedule’s rhythm: {settingsLine(schedule?.settings)}.
            </p>
          )}

          <div>
            <p className="mb-1.5 text-sm font-medium">
              Articles ({picked.length} of {order.length})
            </p>
            {order.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No keywords ready. A keyword needs an approved spec with 3–5 key messages and no
                article yet.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {order.map((keyword, index) => {
                  const pos = picked.indexOf(keyword);
                  return (
                    <li key={keyword} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(checked[keyword])}
                        onChange={(e) => setChecked((prev) => ({ ...prev, [keyword]: e.target.checked }))}
                        aria-label={`Include ${keyword}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{keyword}</span>
                      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {pos >= 0 ? formatDay(dates[pos]) : "—"}
                      </span>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={`Move ${keyword} up`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-30"
                        disabled={index === order.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={`Move ${keyword} down`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              At most one article per site per day, across all pillars; a day another schedule
              uses moves to the next free day. Article dates are the day each one goes live.
            </p>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={busy || picked.length === 0}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            Write &amp; schedule {picked.length} article{picked.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nextLine(schedule, summary) {
  if (schedule.status === "paused") return "Paused";
  if (schedule.status === "cancelled") return "Cancelled — drafts kept in Articles";
  if (summary.done) return "All published";
  if (summary.nextReason === "failed") return "A publish failed — retry or skip it";
  const next = summary.next;
  if (!next) return "";
  if (summary.nextReason === "not_written") return `Next: “${next.keyword}” is not written yet`;
  if (summary.nextReason === "needs_approval") return `Next: ${formatDay(next.publish_on)}, waiting for your approval`;
  return `Next: ${formatDay(next.publish_on)}`;
}

function ItemRow({ item, schedule, today, companyId, writing, busy, onAction, isNext }) {
  const [moving, setMoving] = useState(false);
  const [day, setDay] = useState(item.publish_on || today);
  const isWriting = writing?.itemId === item.id;
  const base = isWriting ? "Writing" : itemLabel(item, schedule, today);
  const label = isNext && base === "Scheduled" ? "Next" : base;
  const open = schedule.status !== "cancelled";
  const slug = item.draft?.slug;
  const act = (name, extra) => onAction(name, schedule, item, extra);
  const linkClass = "text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50";
  const notes = Array.isArray(item.notes) ? item.notes : [];
  const retrying = item.status === "scheduled" && item.attempts > 0 && item.last_error;

  return (
    <li className="px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 font-medium">{item.draft?.title || item.keyword}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${LABEL_STYLES[label] || LABEL_STYLES.Scheduled}`}>
          {isWriting || label === "Publishing" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {label}
        </span>
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatDay(item.publish_on)}
        </span>
      </div>
      {isWriting && writing.message ? (
        <p className="mt-1 text-xs text-muted-foreground">{writing.message}</p>
      ) : null}
      {item.status === "to_write" && item.last_error && !isWriting ? (
        <p className="mt-1 text-xs text-destructive">{item.last_error}</p>
      ) : null}
      {item.status === "failed" ? (
        <p className="mt-1 text-xs text-destructive">
          Failed after {item.attempts} attempt{item.attempts === 1 ? "" : "s"}: {item.last_error}
        </p>
      ) : null}
      {retrying ? (
        <p className="mt-1 text-xs text-amber-800">
          Attempt {item.attempts} of {MAX_ATTEMPTS} failed: {item.last_error} It retries on the next daily run.
        </p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {notes.map((note, i) => (
            <li key={i} className="text-xs text-amber-800">
              Review: {note.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {item.status === "published" && item.published_url ? (
          <a href={item.published_url} target="_blank" rel="noreferrer" className={linkClass}>
            View live
          </a>
        ) : null}
        {slug && item.status !== "published" ? (
          <Link to={`/company/${companyId}/articles?slug=${encodeURIComponent(slug)}`} className={linkClass}>
            Review draft
          </Link>
        ) : null}
        {open && (item.status === "scheduled" || item.status === "failed") ? (
          <button type="button" className={linkClass} disabled={busy} onClick={() => act("publish_now")}>
            {item.status === "failed" ? "Retry now" : "Publish now"}
          </button>
        ) : null}
        {open && item.status === "scheduled" && normalizeSettings(schedule.settings).approval === "approve" && !item.approved_at ? (
          <button type="button" className={linkClass} disabled={busy} onClick={() => act("approve")}>
            Approve
          </button>
        ) : null}
        {open && (item.status === "scheduled" || item.status === "to_write") ? (
          moving ? (
            <span className="inline-flex items-center gap-1.5">
              <Input type="date" className="h-7 w-36 text-xs" min={today} value={day} onChange={(e) => setDay(e.target.value)} />
              <button
                type="button"
                className={linkClass}
                disabled={busy || !day}
                onClick={() => {
                  setMoving(false);
                  act("move", { day });
                }}
              >
                Save
              </button>
              <button type="button" className={linkClass} onClick={() => setMoving(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className={linkClass} disabled={busy} onClick={() => setMoving(true)}>
              Move
            </button>
          )
        ) : null}
        {open && item.status !== "published" && item.status !== "skipped" && item.status !== "publishing" && !isWriting ? (
          <button type="button" className={linkClass} disabled={busy} onClick={() => act("skip")}>
            Skip
          </button>
        ) : null}
        {open && item.status === "skipped" ? (
          <button type="button" className={linkClass} disabled={busy} onClick={() => act("unskip")}>
            Put back
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ScheduleCard({ schedule, companyId, writing, busy, onAction, onResumeWriting, onAdd }) {
  const today = todayIn(normalizeSettings(schedule.settings).timezone);
  const summary = summarize(schedule, schedule.items, today);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const pct = summary.total ? Math.round((summary.published / summary.total) * 100) : 0;
  const isOpen = OPEN_SCHEDULE_STATUSES.has(schedule.status);
  const writingHere = writing?.scheduleId === schedule.id;
  const next = summary.next;
  const canPublishNext =
    isOpen && next && next.status === "scheduled" && Boolean(next.generated_article_id) && summary.nextReason !== "failed";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{schedule.pillar_keyword}</p>
          <p className="text-xs text-muted-foreground">{settingsLine(schedule.settings)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium tabular-nums">
            {summary.published} of {summary.total} published
          </p>
          <p className="text-xs text-muted-foreground">
            {writingHere ? `Writing ${writing.index} of ${writing.total}…` : nextLine(schedule, summary)}
          </p>
        </div>
      </div>
      <Progress value={pct} className="h-1.5" />

      {isOpen ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || !canPublishNext}
            onClick={() => onAction("publish_now", schedule, next)}
          >
            Publish next now
          </Button>
          {schedule.status === "paused" ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction("resume", schedule)}>
              Resume
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction("pause", schedule)}>
              Pause
            </Button>
          )}
          {summary.toWrite > 0 && !writingHere ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onResumeWriting(schedule)}>
              Resume writing ({summary.toWrite})
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAdd(schedule)}>
            Add keywords
          </Button>
          {confirmCancel ? (
            <span className="inline-flex items-center gap-2 text-xs">
              Stop everything still to come? Drafts are kept.
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setConfirmCancel(false);
                  onAction("cancel", schedule);
                }}
              >
                Cancel schedule
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>
              Cancel schedule
            </Button>
          )}
        </div>
      ) : null}

      {writingHere ? (
        <p className="text-xs text-muted-foreground">
          Keep this tab open until writing finishes. If it closes, Resume writing continues from the
          next unwritten article.
        </p>
      ) : null}

      <ul className="divide-y divide-border rounded-md border border-border">
        {[...schedule.items]
          .sort((a, b) => String(a.publish_on || "9").localeCompare(String(b.publish_on || "9")) || a.position - b.position)
          .map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              schedule={schedule}
              today={today}
              companyId={companyId}
              writing={writing}
              busy={busy}
              onAction={onAction}
              isNext={next?.id === item.id && OPEN_SCHEDULE_STATUSES.has(schedule.status)}
            />
          ))}
      </ul>
    </div>
  );
}

/** Every pillar with a schedule: progress, next date, and the controls. */
export function SchedulePanel({ schedules, companyId, writing, busy, error, onAction, onResumeWriting, onAdd }) {
  if (!schedules?.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-foreground">Scheduled publishing</h2>
      {error ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          companyId={companyId}
          writing={writing}
          busy={busy}
          onAction={onAction}
          onResumeWriting={onResumeWriting}
          onAdd={onAdd}
        />
      ))}
    </section>
  );
}
