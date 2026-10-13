// Display helpers for the Analytics page. Pure.

export function fmtNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function fmtPct(value, digits = 1) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtPosition(value) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(1);
}

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "2026-10-12" → "Oct 12". */
export function fmtDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return String(iso || "");
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Path (+ query) of a URL for compact tables; falls back to the raw value. */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return String(url || "");
  }
}

/**
 * Change badge data. `invert` for metrics where lower is better (position).
 * `absolute` when value is already a difference (position delta).
 * @returns {{ label: string, tone: "good" | "bad" | "flat" } | null}
 */
export function deltaInfo(value, { invert = false, absolute = false } = {}) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return null;
  if (Math.abs(n) < (absolute ? 0.05 : 0.005)) return { label: absolute ? "±0" : "0%", tone: "flat" };
  const better = invert ? n < 0 : n > 0;
  const sign = n > 0 ? "+" : "−";
  const label = absolute ? `${sign}${Math.abs(n).toFixed(1)}` : `${sign}${Math.abs(n * 100).toFixed(0)}%`;
  return { label, tone: better ? "good" : "bad" };
}
