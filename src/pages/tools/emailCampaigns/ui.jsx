import React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export function Section({ title, description, actions, children, id }) {
  return (
    <section id={id} className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorLine({ children }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{children}</span>
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  const toneClass =
    tone === "bad" ? "text-destructive" : tone === "good" ? "text-emerald-700" : "text-foreground";
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value ?? "—"}</p>
      {sub && <p className="text-xs text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const pct = (a, b) => (num(b) > 0 ? `${((num(a) / num(b)) * 100).toFixed(1)}%` : "—");

export function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function statusBadgeClass(status) {
  const v = String(status || "").toUpperCase();
  if (v === "START" || v === "ACTIVE" || v === "INPROGRESS")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (v === "PAUSED") return "bg-orange-50 text-orange-700 border-orange-200";
  if (v === "STOPPED") return "bg-red-50 text-red-700 border-red-200";
  if (v === "COMPLETED") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-muted text-muted-foreground border-border";
}
