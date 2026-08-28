// Canonical slug transform. Must stay identical to the frontend slugify
// (src/pages/tools/clusterImage/slugify.js) so API-generated slugs match
// the coverage tree. Returns "" for empty input so callers can fall back.
export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
