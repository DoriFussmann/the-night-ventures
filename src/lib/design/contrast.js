/** WCAG 2.x relative luminance and contrast, matching a standard check-contrast pass. */

export function hexToRgb(hex) {
  const raw = String(hex ?? "")
    .trim()
    .replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Normalize to uppercase #RRGGBB, or null when the value is not a hex color. */
export function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (value) => value.toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`.toUpperCase();
}

function linearize(channel) {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

/** Contrast ratio in the range 1–21. Null when either color is invalid. */
export function contrastRatio(a, b) {
  const left = relativeLuminance(a);
  const right = relativeLuminance(b);
  if (left == null || right == null) return null;
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixChannel(from, to, amount) {
  return Math.max(0, Math.min(255, Math.round(from + (to - from) * amount)));
}

function rgbToHex(r, g, b) {
  const channel = (value) => value.toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Mix `hex` toward `target` by `amount` (0–1). */
export function mixHex(hex, target, amount) {
  const from = hexToRgb(hex);
  const to = hexToRgb(target);
  if (!from || !to) return null;
  return normalizeHex(
    rgbToHex(
      mixChannel(from.r, to.r, amount),
      mixChannel(from.g, to.g, amount),
      mixChannel(from.b, to.b, amount)
    )
  );
}

export function darkenHex(hex, amount = 0.12) {
  return mixHex(hex, "#000000", amount);
}

export function lightenHex(hex, amount = 0.12) {
  return mixHex(hex, "#FFFFFF", amount);
}
