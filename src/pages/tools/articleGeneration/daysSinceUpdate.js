/**
 * Calendar-day difference from an ISO date (YYYY-MM-DD or similar) to today.
 * Returns null when the date cannot be parsed.
 */
export function daysSinceUpdate(dateValue, now = new Date()) {
  const raw = String(dateValue || "").trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;

  const then = new Date(year, month - 1, day);
  if (Number.isNaN(then.getTime())) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - then.getTime();
  return Math.max(0, Math.round(diffMs / 86400000));
}

/** green 0–14, orange 15–29, red 30+ */
export function daysSinceUpdateTone(days) {
  if (days == null || !Number.isFinite(days)) return "muted";
  if (days <= 14) return "green";
  if (days < 30) return "orange";
  return "red";
}

const TONE_CLASSES = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  red: "bg-red-50 text-red-700 border-red-200",
  muted: "bg-muted/50 text-muted-foreground border-border",
};

export function daysSinceUpdateBadgeClass(days) {
  return TONE_CLASSES[daysSinceUpdateTone(days)] || TONE_CLASSES.muted;
}

export function formatDaysSinceUpdateLabel(days) {
  if (days == null || !Number.isFinite(days)) return "No update date";
  if (days === 0) return "Updated today";
  if (days === 1) return "1 day since update";
  return `${days} days since update`;
}
