import {
  contrastRatio,
  darkenHex,
  lightenHex,
  normalizeHex,
} from "./contrast.js";
import { CONTRAST_PAIRS, NO_BOLD_MAX } from "./contract.js";
import { fontSpec } from "./fonts.js";

const MIN_CONTRAST = 4.5;

/** Split a product name on the first space. No space → entire name is primary. */
export function defaultWordmark(productName) {
  const name = String(productName ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const space = name.indexOf(" ");
  if (space === -1) return { wordmarkPrimary: name, wordmarkAccent: "" };
  return {
    wordmarkPrimary: name.slice(0, space),
    wordmarkAccent: name.slice(space + 1).trim(),
  };
}

const PAIR_LABEL = {
  "accentInk/bg": "Accent text on background",
  "accentInk/surface": "Accent text on surface",
  "accentFg/accent": "Button text on accent",
};

/** Pick a text-safe version of `color` for `background`, stepping darker or lighter. */
function inkFor(color, background, dark) {
  let ink = color;
  for (let step = 0; step < 20; step += 1) {
    const ratio = contrastRatio(ink, background);
    if (ratio != null && ratio >= MIN_CONTRAST) return ink;
    ink = dark ? lightenHex(ink, 0.08) : darkenHex(ink, 0.08);
  }
  return ink;
}

/** Force Inter and/or cap weights. Mutates and returns tokens. */
export function applyOverrides(tokens, overrides = {}) {
  const forceInter = Boolean(overrides.forceInter);
  const forceNoBold = Boolean(overrides.forceNoBold);
  tokens.overrides = { forceInter, forceNoBold };
  if (forceInter) {
    tokens.type.display = fontSpec("inter");
    tokens.type.body = fontSpec("inter");
  }
  if (forceNoBold) {
    for (const key of ["headingWeight", "uiWeight", "strongWeight"]) {
      tokens.type[key] = Math.min(Number(tokens.type[key]) || 400, NO_BOLD_MAX);
    }
    tokens.type.bodyWeight = Math.min(Number(tokens.type.bodyWeight) || 400, 400);
  }
  return tokens;
}

/**
 * Copy a template, apply an optional accent override, the wordmark and the two
 * overrides. Returns `{ tokens, warnings }`; warnings list every contract pair
 * under 4.5:1.
 */
export function applyBrand(template, options = {}) {
  if (!template || typeof template !== "object") {
    throw new Error("template is required");
  }

  const tokens = JSON.parse(JSON.stringify(template));
  const warnings = [];
  const accentRaw = options.accent;
  const hasAccent = accentRaw != null && String(accentRaw).trim() !== "";

  if (hasAccent) {
    const accent = normalizeHex(accentRaw);
    if (!accent) {
      warnings.push("Accent must be a 6-digit hex color.");
    } else {
      const dark = tokens.mode === "dark";
      tokens.colors.accent = accent;
      tokens.colors.accentHover = dark
        ? lightenHex(accent, 0.12)
        : darkenHex(accent, 0.12);
      const onWhite = contrastRatio(accent, "#FFFFFF");
      const onFg = contrastRatio(accent, tokens.colors.fg);
      const onBg = contrastRatio(accent, tokens.colors.bg);
      if (dark) {
        tokens.colors.accentFg = normalizeHex(tokens.colors.bg);
      } else {
        tokens.colors.accentFg =
          onWhite >= Math.max(onFg ?? 0, onBg ?? 0) ? "#FFFFFF" : normalizeHex(tokens.colors.fg);
      }
      tokens.colors.accentInk = inkFor(accent, tokens.colors.bg, dark);
      tokens.colors.focus =
        (contrastRatio(accent, tokens.colors.bg) ?? 0) >= 3 ? accent : tokens.colors.accentInk;
    }
  }

  const primaryGiven = options.wordmarkPrimary != null;
  const accentWordGiven = options.wordmarkAccent != null;
  if (!primaryGiven && !accentWordGiven && options.productName != null) {
    const split = defaultWordmark(options.productName);
    tokens.brand.wordmarkPrimary = split.wordmarkPrimary;
    tokens.brand.wordmarkAccent = split.wordmarkAccent;
  } else if (primaryGiven || accentWordGiven) {
    if (primaryGiven) tokens.brand.wordmarkPrimary = String(options.wordmarkPrimary);
    if (accentWordGiven) tokens.brand.wordmarkAccent = String(options.wordmarkAccent);
  }

  applyOverrides(tokens, {
    forceInter: options.forceInter,
    forceNoBold: options.forceNoBold,
  });

  for (const [fgKey, bgKey] of CONTRAST_PAIRS) {
    const ratio = contrastRatio(tokens.colors?.[fgKey], tokens.colors?.[bgKey]);
    if (ratio != null && ratio < MIN_CONTRAST) {
      const label = PAIR_LABEL[`${fgKey}/${bgKey}`] || `${fgKey} on ${bgKey}`;
      warnings.push(`${label} contrast is ${ratio.toFixed(2)}:1, below 4.5:1.`);
    }
  }

  return { tokens, warnings };
}
