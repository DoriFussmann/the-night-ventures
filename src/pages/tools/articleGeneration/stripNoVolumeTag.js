// Removes the "(no volume data)" marker that the cluster generator can bake into
// a keyword string, so stored keywords stay clean. No-op on already-clean keywords.
export function stripNoVolumeTag(value) {
  return String(value || "")
    .replace(/\s*\(\s*no volume data\s*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
