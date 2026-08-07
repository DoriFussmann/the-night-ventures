function companySlug(name) {
  return (
    String(name || "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company"
  );
}

function formatFilenameDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toIsoDate(date = new Date()) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function articleUpdatesFilename(companyName, date = new Date()) {
  return `${companySlug(companyName)}-article-updates-${formatFilenameDate(date)}.json`;
}

/**
 * Build the structured download payload for approved article updates.
 * Shape: [{ slug, newParagraph, newUpdatedDate, newSources: [{ title, url }] }]
 */
export function buildApprovedUpdatesPayload(entries, date = new Date()) {
  const newUpdatedDate = toIsoDate(date);

  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    slug: String(entry.slug || "").trim(),
    newParagraph: String(
      entry.newParagraph || entry.proposedParagraph || ""
    ).trim(),
    newUpdatedDate,
    newSources: Array.isArray(entry.newSources)
      ? entry.newSources
          .map((source) => ({
            title: String(source?.title || "").trim(),
            url: String(source?.url || "").trim(),
          }))
          .filter((source) => source.title || source.url)
      : [],
  }));
}

export function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
