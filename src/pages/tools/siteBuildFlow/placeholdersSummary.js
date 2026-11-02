// Pure helpers for the Placeholders stage (no Supabase import, so node tests can load it).

import BUNDLED from "../../../../lib/placeholders/blueprint.json" with { type: "json" };

const BUNDLED_GUIDES = Object.fromEntries((BUNDLED.checks || []).map((c) => [c.id, c]));

/**
 * The how-to for one result. Scans made with a seo-core manifest older than
 * 1.3.1 (and scans saved before it) have only a one-line help: use the guide
 * bundled with TNV for the same check id instead.
 */
export function guideFor(result, repoName = "") {
  const own = result?.steps?.length ? result : BUNDLED_GUIDES[result?.id] || result || {};
  const fill = (text) => (repoName && text ? String(text).replaceAll("[owner/repo]", repoName) : text);
  return {
    help: fill(own.help ?? result?.help),
    steps: (own.steps || []).map(fill),
    prompt: fill(own.prompt),
  };
}

/** Work statuses a person can set on an item, in menu order. */
export const WORK_STATUSES = ["todo", "wip", "blocked", "done"];

/**
 * The status a person set on an item, or null. Stored in the `signoffs` column
 * as { status, at, by }; an entry from before statuses existed (no `status`)
 * was a sign-off, so it reads as "done".
 */
export function manualStatus(entry) {
  if (!entry) return null;
  return WORK_STATUSES.includes(entry.status) ? entry.status : "done";
}

/**
 * Turn a report + statuses into what the page shows.
 * - A "review" or "can't check" item counts as done once a person marks it Done.
 * - "Done" is ignored while the scan still finds the placeholder (`doneConflict`).
 * - To do / WIP / Blocked keep a replaced item from counting as done.
 * `status` is what the menu shows: the person's choice, else what the scan implies.
 */
export function summarize(report, signoffs = {}, repoName = "") {
  const results = Array.isArray(report?.results) ? report.results : [];
  const items = results.map((r) => {
    const manual = manualStatus(signoffs?.[r.id]);
    const signed = manual === "done";
    let state = r.status;
    if ((r.status === "review" || r.status === "unknown") && signed) state = "confirmed";
    const scanDone = state === "replaced" || state === "confirmed";
    const isDone = scanDone && (manual === null || manual === "done");
    const status = manual || (scanDone ? "done" : "todo");
    return {
      ...r,
      ...guideFor(r, repoName),
      signed,
      state,
      status,
      isDone,
      doneConflict: signed && r.status === "placeholder",
    };
  });
  const required = items.filter((i) => i.level === "required");
  const count = (s) => required.filter((i) => i.status === s && !i.isDone).length;
  return {
    items,
    requiredTotal: required.length,
    requiredDone: required.filter((i) => i.isDone).length,
    openSignoffs: required.filter((i) => i.state === "review" && i.status !== "wip" && i.status !== "blocked").length,
    wip: count("wip"),
    blocked: count("blocked"),
    complete: required.length > 0 && required.every((i) => i.isDone),
  };
}
