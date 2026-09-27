export const DENSITY_PX = {
  compact: { desktop: 64, mobile: 40 },
  regular: { desktop: 96, mobile: 56 },
  airy: { desktop: 128, mobile: 72 },
};

export function formatPx(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return `${rounded}px`;
}

/** body = base, lead = base × 1.2, headings step by scale. Mobile headings drop one step. */
export function typeScale(type = {}) {
  const base = Number.parseFloat(String(type.base ?? "16"));
  const scale = Number(type.scale) || 1;
  const at = (power) => formatPx(base * scale ** power);
  return {
    body: formatPx(base),
    lead: formatPx(base * 1.2),
    h3: at(2),
    h2: at(3),
    h1: at(4),
    h3Mobile: at(1),
    h2Mobile: at(2),
    h1Mobile: at(3),
  };
}
