export function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "untitled";
}

export function buildHeroFilename(pillarSlug, supportingSlug) {
  const pillar = slugify(pillarSlug);
  if (!supportingSlug) {
    return `${pillar}--pillar-hero.png`;
  }
  return `${pillar}--${slugify(supportingSlug)}-hero.png`;
}
