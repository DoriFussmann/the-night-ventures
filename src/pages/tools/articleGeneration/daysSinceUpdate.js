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

export const STALENESS_BUCKETS = ["0-14", "15-30", "30-60", "60-90", "90+"];
export const UNKNOWN_BUCKET = "unknown";
export const DEFAULT_CHECK_THRESHOLD = 30;
export const CHECK_THRESHOLD_OPTIONS = [15, 30, 60, 90];

/** Lower bound of each labeled bucket, used only to decide which buckets get Check. */
export const BUCKET_MIN_DAYS = {
  "0-14": 0,
  "15-30": 15,
  "30-60": 30,
  "60-90": 60,
  "90+": 90,
};

export function stalenessBucket(days) {
  if (days == null || !Number.isFinite(days)) return UNKNOWN_BUCKET;
  if (days <= 14) return "0-14";
  if (days <= 30) return "15-30";
  if (days <= 60) return "30-60";
  if (days <= 90) return "60-90";
  return "90+";
}

export function bucketNeedsUpdateCheck(
  bucket,
  thresholdDays = DEFAULT_CHECK_THRESHOLD
) {
  const min = BUCKET_MIN_DAYS[bucket];
  if (min == null) return false;
  const threshold = Number(thresholdDays);
  if (!Number.isFinite(threshold)) return false;
  return min >= threshold;
}

export const STALE_CHECK_BUCKETS = STALENESS_BUCKETS.filter((id) =>
  bucketNeedsUpdateCheck(id, DEFAULT_CHECK_THRESHOLD)
);

/** green 0–14, orange 15–30, red 31+ */
export function daysSinceUpdateTone(days) {
  if (days == null || !Number.isFinite(days)) return "muted";
  if (days <= 14) return "green";
  if (days <= 30) return "orange";
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

export function formatLastCheckedLabel(dateValue, now = new Date()) {
  const days = daysSinceUpdate(dateValue, now);
  if (days == null) return "Last checked: never";
  if (days === 0) return "Last checked: today";
  if (days === 1) return "Last checked: 1 day ago";
  return `Last checked: ${days} days ago`;
}

export function lastCheckedIsRecent(dateValue, now = new Date()) {
  const days = daysSinceUpdate(dateValue, now);
  return days != null && days < 7;
}
