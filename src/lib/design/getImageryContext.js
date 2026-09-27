import { normalizeHex } from "./contrast.js";

const FENCE = /```tokens\s*\n([\s\S]*?)\n```/;

/** Parse the single tokens fence. Returns null when missing or invalid. */
export function parseDesignTokens(markdown) {
  const text = String(markdown ?? "");
  if (!text.trim()) return null;
  const match = text.match(FENCE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Plain-text imagery brief from a Design Guide.
 * Empty when the guide is missing or the fence cannot be parsed.
 */
export function getImageryContext(designGuideRaw) {
  const tokens = parseDesignTokens(designGuideRaw);
  const imagery = tokens?.imagery;
  if (!imagery || typeof imagery !== "object") return "";

  const direction = String(imagery.direction ?? "").trim();
  const treatment = String(imagery.treatment ?? "").trim();
  const avoid = String(imagery.avoid ?? "").trim();
  if (!direction && !treatment && !avoid) return "";

  const colors = tokens.colors || {};
  const lines = [];
  if (treatment) lines.push(`Treatment: ${treatment}`);
  if (direction) lines.push(`Direction: ${direction}`);
  if (avoid) lines.push(`Avoid: ${avoid}`);
  lines.push(
    `Palette: fg ${colors.fg || ""}, bg ${colors.bg || ""}, accent ${colors.accent || ""}, highlight ${colors.highlight || ""}`
  );
  return lines.join("\n");
}

/** fg, bg, accent, highlight from the guide, or null when they are not all hex. */
export function getImageryPalette(designGuideRaw) {
  const tokens = parseDesignTokens(designGuideRaw);
  const colors = tokens?.colors;
  if (!colors) return null;
  const fg = normalizeHex(colors.fg);
  const bg = normalizeHex(colors.bg);
  const accent = normalizeHex(colors.accent);
  const highlight = normalizeHex(colors.highlight);
  if (!fg || !bg || !accent || !highlight) return null;
  return { fg, bg, accent, highlight };
}
