/**
 * Design contract v3: the shape of the ```tokens fence in DESIGN_GUIDE.md.
 * The guide prints this spec verbatim so Cursor can write the site validator.
 */

export const CONTRACT_VERSION = 3;

export const GUIDE_FILENAME = "DESIGN_GUIDE.md";

export const COLOR_KEYS = [
  ["bg", "Page background"],
  ["surface", "Cards, raised surfaces, form fields"],
  ["surfaceAlt", "Alternate sections and filled cards"],
  ["fg", "Body and heading text"],
  ["muted", "Secondary text"],
  ["border", "Hairlines and line cards"],
  ["accent", "Fills: primary buttons, active dots, badges, outline-button borders"],
  ["accentHover", "Primary button hover fill"],
  ["accentFg", "Text on an accent fill"],
  ["accentInk", "Accent used as TEXT: links, eyebrows, wordmark accent, hover text"],
  ["highlight", "Decorative marks; eyebrows on band surfaces"],
  ["band", "Band surfaces: stats row, closing CTA, band hero"],
  ["bandFg", "Text on band"],
  ["bandMuted", "Secondary text on band"],
  ["headerBg", "Header background"],
  ["headerFg", "Header text"],
  ["footerBg", "Footer background"],
  ["footerFg", "Footer text"],
  ["onImage", "Text placed over photographs (photo hero)"],
  ["focus", "Focus ring"],
];

export const ENUMS = {
  template: ["alpine", "heritage", "pristine", "kinetic", "tactile", "nocturne"],
  mode: ["light", "dark"],
  "type.headingCase": ["none", "uppercase"],
  "type.eyebrow": ["uppercase", "sentence"],
  "shape.button": ["solid", "outline", "pill"],
  "layout.density": ["compact", "regular", "airy"],
  "variants.header": ["solid", "blur", "band"],
  "variants.hero": ["plain", "band", "glow", "framed", "photo"],
  "variants.heroOverlay": ["none", "dark", "fade", "vignette"],
  "variants.card": ["line", "filled", "elevated"],
  "variants.rhythm": ["alternate", "flat", "bands"],
  "variants.texture": ["none", "grid", "dots", "scanline"],
  "variants.hover": ["zoom", "lift", "jelly", "glitch", "brighten"],
  "variants.portrait": ["rounded", "circle", "square", "blob"],
  "variants.eyebrowMark": ["none", "dot", "rule", "slashes"],
  "motion.style": ["none", "fade", "rise", "blur", "spring"],
};

/** Foreground/background pairs that must reach 4.5:1. */
export const CONTRAST_PAIRS = [
  ["fg", "bg"],
  ["fg", "surface"],
  ["fg", "surfaceAlt"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surfaceAlt"],
  ["accentInk", "bg"],
  ["accentInk", "surface"],
  ["accentFg", "accent"],
  ["bandFg", "band"],
  ["bandMuted", "band"],
  ["headerFg", "headerBg"],
  ["footerFg", "footerBg"],
];

/** Weight ceiling applied by Force no bold. */
export const NO_BOLD_MAX = 500;
