import {
  contrastRatio,
  darkenHex,
  lightenHex,
  normalizeHex,
} from "./contrast.js";

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

function contrastWarning(label, ratio) {
  return `${label} contrast is ${ratio.toFixed(2)}:1, below 4.5:1.`;
}

/**
 * Copy a template and apply an optional accent override plus wordmark.
 * Returns `{ tokens, warnings }`. Warnings fire when accent/bg or
 * accent/surface is under 4.5:1.
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
      tokens.colors.focus = accent;
      tokens.colors.accentHover = dark
        ? lightenHex(accent, 0.12)
        : darkenHex(accent, 0.12);
      const onWhite = contrastRatio(accent, "#FFFFFF");
      const onBg = contrastRatio(accent, tokens.colors.bg);
      tokens.colors.accentFg =
        onWhite >= onBg ? "#FFFFFF" : normalizeHex(tokens.colors.bg);
    }
  }

  const primaryGiven = options.wordmarkPrimary != null;
  const accentWordGiven = options.wordmarkAccent != null;
  if (!primaryGiven && !accentWordGiven && options.productName != null) {
    const split = defaultWordmark(options.productName);
    tokens.brand.wordmarkPrimary = split.wordmarkPrimary;
    tokens.brand.wordmarkAccent = split.wordmarkAccent;
  } else if (primaryGiven || accentWordGiven) {
    if (primaryGiven) {
      tokens.brand.wordmarkPrimary = String(options.wordmarkPrimary);
    }
    if (accentWordGiven) {
      tokens.brand.wordmarkAccent = String(options.wordmarkAccent);
    }
  }

  const accent = tokens.colors?.accent;
  const onBackground = contrastRatio(accent, tokens.colors?.bg);
  const onSurface = contrastRatio(accent, tokens.colors?.surface);
  if (onBackground != null && onBackground < MIN_CONTRAST) {
    warnings.push(contrastWarning("Accent on background", onBackground));
  }
  if (onSurface != null && onSurface < MIN_CONTRAST) {
    warnings.push(contrastWarning("Accent on surface", onSurface));
  }

  return { tokens, warnings };
}
