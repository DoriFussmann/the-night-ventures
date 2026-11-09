/** Hex colour parsing and normalization. */

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
