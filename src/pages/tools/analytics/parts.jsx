import React from "react";
import { cn } from "@/lib/utils";
import { deltaInfo } from "./format";

const TONE = {
  good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  bad: "bg-red-500/10 text-red-700 dark:text-red-300",
  flat: "bg-muted text-muted-foreground",
};

/** Change vs previous period. */
export function Delta({ value, invert = false, absolute = false, className }) {
  const info = deltaInfo(value, { invert, absolute });
  if (!info) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-px text-[10px] font-medium tabular-nums",
        TONE[info.tone],
        className
      )}
      title="vs previous period"
    >
      {info.label}
    </span>
  );
}

/** Scorecard tile. */
export function Tile({ label, value, delta, invert, absolute, sub }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-3 py-2.5">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <p className="text-lg font-semibold tabular-nums">{value ?? "—"}</p>
        <Delta value={delta} invert={invert} absolute={absolute} />
      </div>
      {sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** Compact data table. columns: [{ key, label, align, render, className }] */
export function DataTable({ columns, rows, empty = "No data for this period.", rowKey }) {
  if (!rows?.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn("px-2 py-1.5 font-medium", c.align === "right" ? "text-right" : "text-left")}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row) : i} className="border-b border-border/60 last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-2 py-1.5 align-top",
                    c.align === "right" ? "text-right tabular-nums" : "text-left",
                    c.className
                  )}
                >
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small segmented control. */
export function Segmented({ value, onChange, options, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** External link to a page URL, shown as its path. */
export function PageLink({ url, children }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="break-all text-foreground underline-offset-2 hover:underline"
      title={url}
    >
      {children}
    </a>
  );
}

export function Pill({ children, tone = "muted" }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    bad: "bg-red-500/10 text-red-700 dark:text-red-300",
    warn: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}
