/** Neutral fallback when design_guide_abstract is missing. */
export const DEFAULT_STYLE_SPEC = {
  backgroundColor: "#111827",
  accentColor: "#6b7280",
  textColor: "#f9fafb",
  fontFamily: "Georgia",
  style: "minimal",
};

/** Astro article heroes are 16:9; listing cards use aspect-video. */
export const IMAGE_WIDTH = 1280;
export const IMAGE_HEIGHT = 720;

export const PILLAR_LEVEL_VALUE = "__pillar__";

export const WEB_SAFE_FONTS = new Set([
  "arial",
  "helvetica",
  "times new roman",
  "times",
  "courier new",
  "courier",
  "verdana",
  "georgia",
  "palatino",
  "garamond",
  "bookman",
  "trebuchet ms",
  "tahoma",
  "impact",
  "comic sans ms",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
]);
