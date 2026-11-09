import { normalizeHex } from "./hex.js";
import { parseDesignTokens } from "./getImageryContext.js";

const FENCE = /```tokens\s*\n[\s\S]*?\n```/;

export const IMAGERY_COLOR_KEYS = ["fg", "bg", "accent", "highlight"];

export const IMAGERY_COLOR_LABELS = {
  fg: "Text",
  bg: "Background",
  accent: "Accent",
  highlight: "Highlight",
};

/**
 * Editable imagery style from a stored guide (company_profiles.design_guide_raw).
 * @returns {{ direction: string, treatment: string, avoid: string, colors: Record<string, string> }}
 */
export function readImageryStyle(guideRaw) {
  const tokens = parseDesignTokens(guideRaw) || {};
  const imagery = tokens.imagery && typeof tokens.imagery === "object" ? tokens.imagery : {};
  const colors = tokens.colors && typeof tokens.colors === "object" ? tokens.colors : {};
  return {
    direction: String(imagery.direction ?? ""),
    treatment: String(imagery.treatment ?? ""),
    avoid: String(imagery.avoid ?? ""),
    colors: Object.fromEntries(IMAGERY_COLOR_KEYS.map((key) => [key, String(colors[key] ?? "")])),
  };
}

/** Colour fields that are filled in but not valid hex. */
export function invalidImageryColors(style) {
  return IMAGERY_COLOR_KEYS.filter((key) => {
    const value = String(style.colors?.[key] ?? "").trim();
    return value !== "" && !normalizeHex(value);
  });
}

/**
 * Write the imagery style back into the guide, keeping every other token and
 * all text outside the tokens block. Adds a tokens block when there is none.
 * @returns {string} the new guide
 */
export function writeImageryStyle(guideRaw, style) {
  const raw = String(guideRaw ?? "");
  const tokens = parseDesignTokens(raw) || {};
  const colors = { ...(tokens.colors && typeof tokens.colors === "object" ? tokens.colors : {}) };
  for (const key of IMAGERY_COLOR_KEYS) {
    const hex = normalizeHex(String(style.colors?.[key] ?? "").trim());
    if (hex) colors[key] = hex;
    else delete colors[key];
  }
  const next = {
    ...tokens,
    colors,
    imagery: {
      ...(tokens.imagery && typeof tokens.imagery === "object" ? tokens.imagery : {}),
      direction: String(style.direction ?? "").trim(),
      treatment: String(style.treatment ?? "").trim(),
      avoid: String(style.avoid ?? "").trim(),
    },
  };
  const block = "```tokens\n" + JSON.stringify(next, null, 2) + "\n```";
  if (FENCE.test(raw)) return raw.replace(FENCE, () => block);
  return raw.trim() ? `${raw.trimEnd()}\n\n${block}\n` : `# Imagery style\n\n${block}\n`;
}
