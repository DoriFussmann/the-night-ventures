// Pure helpers for the Placeholders stage (no Supabase import, so node tests can load it).

/**
 * Turn a report + sign-offs into what the page shows. A "review" item counts
 * as done only once signed off; a sign-off is ignored while the scan still
 * finds the placeholder.
 */
export function summarize(report, signoffs = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const items = results.map((r) => {
    const signed = Boolean(signoffs?.[r.id]);
    let state = r.status;
    if (r.status === "review" && signed) state = "confirmed";
    return { ...r, signed, state };
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
