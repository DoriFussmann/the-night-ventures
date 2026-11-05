import React, { useMemo, useState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, isWeekend } from "../../../../lib/publish-schedule/plan.js";
import { planPublishDays } from "../../../../lib/aeo/schedule.js";
import { formatDay } from "./DraftPanel";

function firstWorkdayAfter(day) {
  let d = addDays(day, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/**
 * Pick a start workday, tick approved articles in the order they should go
 * out: each tick takes the next free workday.
 */
export default function SchedulePanel({ approved, today, taken, busy, onSchedule }) {
  const [start, setStart] = useState(() => firstWorkdayAfter(today));
  const [order, setOrder] = useState([]);

  const startProblem = !start
    ? "Pick a start day."
    : start <= today
      ? "Pick a day after today."
      : isWeekend(start)
        ? "Pick a workday (Monday to Friday)."
        : "";

  const days = useMemo(
    () => (startProblem ? [] : planPublishDays(order.length, { today, start, taken })),
    [order.length, start, startProblem, taken, today]
  );
  const dayFor = new Map(order.map((id, i) => [id, days[i]]));
  const skipped = taken.filter((d) => d >= start && days.length && d <= days[days.length - 1]);

  const toggle = (id) => setOrder((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  if (!approved.length) return null;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Schedule approved articles</h2>
          <p className="text-xs text-muted-foreground">
            Pick the first day, then tick articles in the order they should go out. One per workday.
          </p>
        </div>
        <label className="space-y-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Start on</span>
          <Input type="date" className="h-8 w-44 text-xs" value={start} min={addDays(today, 1)} onChange={(e) => setStart(e.target.value)} />
        </label>
      </div>
      {startProblem && <p className="text-xs text-destructive">{startProblem}</p>}

      <ul className="space-y-1">
        {approved.map((b) => {
          const pos = order.indexOf(b.id);
          return (
            <li key={b.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
                <input type="checkbox" checked={pos !== -1} onChange={() => toggle(b.id)} disabled={busy} />
                <span className="w-8 text-right text-xs text-muted-foreground">{pos !== -1 ? `#${pos + 1}` : ""}</span>
                <span className="min-w-0 flex-1 truncate">
                  {b.title}
                  {b.warn ? <span className="ml-2 text-[11px] text-amber-700">{b.warn}</span> : null}
                </span>
                <span className="w-28 shrink-0 text-right text-xs text-foreground">{dayFor.get(b.id) ? formatDay(dayFor.get(b.id)) : ""}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">
          {skipped.length ? `Skipping ${skipped.map(formatDay).join(", ")}: another article already publishes that day.` : ""}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={busy || !order.length || Boolean(startProblem)}
          onClick={async () => {
            await onSchedule(order.map((id) => approved.find((b) => b.id === id)).filter(Boolean), start);
            setOrder([]);
          }}
        >
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />}
          Schedule {order.length || ""} article{order.length === 1 ? "" : "s"}
        </Button>
      </div>
    </section>
  );
}
