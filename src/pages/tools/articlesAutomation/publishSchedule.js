import { supabase } from "@/lib/supabase";
import {
  OPEN_SCHEDULE_STATUSES,
  addDays,
  daysBetween,
  normalizeSettings,
  openItems,
  planDates,
  reflowOpen,
  takenDays,
  todayIn,
} from "../../../../lib/publish-schedule/plan.js";

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}

function fail(error, fallback) {
  if (error) throw new Error(error.message || fallback);
}

/**
 * Schedules for a company: every open one plus those that ended in the last
 * 30 days, each with its items and the draft's slug and title.
 */
export async function loadSchedules(companyId) {
  if (!companyId) return [];
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: schedules, error } = await supabase
    .from("publish_schedules")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  fail(error, "Failed to load schedules");
  const shown = (schedules || []).filter(
    (s) => OPEN_SCHEDULE_STATUSES.has(s.status) || String(s.updated_at || "") >= since
  );
  if (!shown.length) return [];
  const { data: items, error: itemsError } = await supabase
    .from("publish_schedule_items")
    .select("*, draft:generated_articles(id, slug, title, created_at)")
    .in(
      "schedule_id",
      shown.map((s) => s.id)
    )
    .order("position", { ascending: true });
  fail(itemsError, "Failed to load schedule items");
  return shown.map((schedule) => ({
    ...schedule,
    settings: normalizeSettings(schedule.settings),
    items: (items || []).filter((item) => item.schedule_id === schedule.id),
  }));
}

/** Days other open schedules of this company already use. */
function busyDays(schedules, exceptId) {
  return takenDays(
    schedules
      .filter((s) => s.id !== exceptId && OPEN_SCHEDULE_STATUSES.has(s.status))
      .flatMap((s) => s.items)
  );
}

/**
 * Create a schedule for one pillar with its keywords in order. Items start as
 * "to_write"; the browser writes each draft and marks it scheduled.
 */
export async function createSchedule({ companyId, pillar, keywords, settings, start, schedules }) {
  const s = normalizeSettings({ ...settings, timezone: settings?.timezone || browserTimezone() });
  const dates = planDates({
    count: keywords.length,
    start,
    settings: s,
    taken: busyDays(schedules || [], null),
  });
  const { data: schedule, error } = await supabase
    .from("publish_schedules")
    .insert({
      company_id: companyId,
      pillar_slug: pillar.slug || pillar.keyword,
      pillar_keyword: pillar.keyword,
      status: "active",
      settings: s,
    })
    .select()
    .single();
  if (error) {
    if (/publish_schedules_one_open_per_pillar|duplicate key/i.test(error.message || "")) {
      throw new Error(`“${pillar.keyword}” already has a schedule. Add keywords to it instead.`);
    }
    fail(error, "Failed to create the schedule");
  }
  const rows = keywords.map((k, i) => ({
    schedule_id: schedule.id,
    company_id: companyId,
    position: i,
    keyword: k.keyword,
    supporting_slug: k.slug || null,
    publish_on: dates[i],
    status: "to_write",
  }));
  const { error: itemsError } = await supabase.from("publish_schedule_items").insert(rows);
  if (itemsError) {
    await supabase.from("publish_schedules").delete().eq("id", schedule.id);
    fail(itemsError, "Failed to create the schedule items");
  }
  return schedule.id;
}

/** Add keywords to the end of an existing schedule. */
export async function appendKeywords({ schedule, keywords, schedules }) {
  const s = normalizeSettings(schedule.settings);
  const today = todayIn(s.timezone);
  const last = openItems(schedule.items).at(-1)?.publish_on;
  const start = last ? addDays(last, s.intervalDays) : today;
  const dates = planDates({
    count: keywords.length,
    start: start < today ? today : start,
    settings: s,
    taken: [...busyDays(schedules || [], schedule.id), ...openItems(schedule.items).map((i) => i.publish_on)],
  });
  const base = schedule.items.reduce((n, item) => Math.max(n, item.position + 1), 0);
  const rows = keywords.map((k, i) => ({
    schedule_id: schedule.id,
    company_id: schedule.company_id,
    position: base + i,
    keyword: k.keyword,
    supporting_slug: k.slug || null,
    publish_on: dates[i],
    status: "to_write",
  }));
  const { error } = await supabase.from("publish_schedule_items").insert(rows);
  fail(error, "Failed to add keywords");
  if (schedule.status === "done") await setScheduleStatus(schedule.id, "active");
}

async function updateItem(id, patch) {
  const { error } = await supabase
    .from("publish_schedule_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  fail(error, "Failed to update the article");
}

async function applyChanges(changes) {
  for (const change of changes) await updateItem(change.id, { publish_on: change.publish_on });
}

export async function markWritten(itemId, generatedArticleId) {
  await updateItem(itemId, {
    generated_article_id: generatedArticleId,
    status: "scheduled",
    last_error: null,
  });
}

export async function markWriteFailed(itemId, message) {
  await updateItem(itemId, { last_error: `Writing failed: ${message}` });
}

export async function setScheduleStatus(id, status, extra = {}) {
  const { error } = await supabase
    .from("publish_schedules")
    .update({ status, ...extra, updated_at: new Date().toISOString() })
    .eq("id", id);
  fail(error, "Failed to update the schedule");
}

export async function pauseSchedule(schedule) {
  await setScheduleStatus(schedule.id, "paused", { paused_at: new Date().toISOString() });
}

/** Resume: every open date moves later by the length of the pause. */
export async function resumeSchedule(schedule, schedules) {
  const s = normalizeSettings(schedule.settings);
  const today = todayIn(s.timezone);
  const pausedDay = schedule.paused_at ? todayIn(s.timezone, new Date(schedule.paused_at)) : today;
  const shift = Math.max(0, daysBetween(pausedDay, today));
  const first = openItems(schedule.items)[0]?.publish_on || today;
  const shifted = addDays(first, shift);
  const changes = reflowOpen(schedule.items, {
    start: shifted < today ? today : shifted,
    settings: s,
    taken: busyDays(schedules, schedule.id),
  });
  await applyChanges(changes);
  await setScheduleStatus(schedule.id, "active", { paused_at: null });
}

/** Cancel: nothing else goes out. Drafts stay in the Articles library. */
export async function cancelSchedule(schedule) {
  await setScheduleStatus(schedule.id, "cancelled");
}

export async function skipItem(schedule, item, schedules) {
  await updateItem(item.id, { status: "skipped" });
  const s = normalizeSettings(schedule.settings);
  const today = todayIn(s.timezone);
  const rest = schedule.items.filter((i) => i.id !== item.id);
  const first = openItems(rest)[0];
  if (!first) {
    await setScheduleStatus(schedule.id, "done");
    return;
  }
  // Close the gap: the next article takes the skipped one's day.
  const start = [item.publish_on, first.publish_on, today]
    .filter(Boolean)
    .sort()
    .find((d) => d >= today) || today;
  await applyChanges(reflowOpen(rest, { start, settings: s, taken: busyDays(schedules, schedule.id) }));
}

/** Put a skipped article back at the end. */
export async function unskipItem(schedule, item) {
  const s = normalizeSettings(schedule.settings);
  const last = openItems(schedule.items).at(-1)?.publish_on || todayIn(s.timezone);
  await updateItem(item.id, {
    status: item.generated_article_id ? "scheduled" : "to_write",
    publish_on: addDays(last, s.intervalDays),
  });
  if (schedule.status === "done") await setScheduleStatus(schedule.id, "active");
}

export async function moveItem(item, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pick a date");
  await updateItem(item.id, { publish_on: day });
}

export async function approveItem(item) {
  await updateItem(item.id, { approved_at: new Date().toISOString() });
}

/** Re-space what is still to go out after an article went out early. */
export async function reflowAfterPublish(schedule, publishedItemId, schedules) {
  const s = normalizeSettings(schedule.settings);
  const today = todayIn(s.timezone);
  const rest = schedule.items.filter((i) => i.id !== publishedItemId);
  if (!openItems(rest).length) return;
  await applyChanges(
    reflowOpen(rest, {
      start: addDays(today, s.intervalDays),
      settings: s,
      taken: busyDays(schedules, schedule.id),
    })
  );
}

/** Publish one article now (server). Returns the server result; throws on HTTP errors. */
export async function publishItemNow(itemId) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/api/publish-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op: "publish_now", itemId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body?.error) throw new Error(`Publish failed (${res.status})`);
  return body;
}
