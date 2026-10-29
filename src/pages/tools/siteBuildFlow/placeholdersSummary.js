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

/**
 * Turn a report + sign-offs into what the page shows. A "review" item counts
 * as done only once signed off; a sign-off is ignored while the scan still
 * finds the placeholder.
 */
export function summarize(report, signoffs = {}, repoName = "") {
  const results = Array.isArray(report?.results) ? report.results : [];
  const items = results.map((r) => {
    const signed = Boolean(signoffs?.[r.id]);
    let state = r.status;
    if (r.status === "review" && signed) state = "confirmed";
    return { ...r, ...guideFor(r, repoName), signed, state };
  });
  const required = items.filter((i) => i.level === "required");
  const done = required.filter((i) => i.state === "replaced" || i.state === "confirmed").length;
  return {
    items,
    requiredTotal: required.length,
    requiredDone: done,
    openSignoffs: required.filter((i) => i.state === "review").length,
    complete: required.length > 0 && done === required.length,
  };
}
