/**
 * Font registry for design contract v3.
 *
 * Site side (goes into the tokens fence): CSS family name as the fontsource
 * package registers it, a fallback stack, the npm package and the CSS imports.
 * Preview side (TNV only, never written to the guide): the Google Fonts family
 * name and query used to render the same face inside the Design page.
 */

export const FONTS = {
  inter: {
    family: "Inter Variable",
    fallback: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    package: "@fontsource-variable/inter",
    imports: ["@fontsource-variable/inter"],
    preview: { family: "Inter", query: "Inter:wght@300..800" },
  },
  playfair: {
    family: "Playfair Display Variable",
    fallback: 'Georgia, "Times New Roman", serif',
    package: "@fontsource-variable/playfair-display",
    imports: ["@fontsource-variable/playfair-display"],
    preview: { family: "Playfair Display", query: "Playfair+Display:wght@400..900" },
  },
  youngSerif: {
    family: "Young Serif",
    fallback: 'Georgia, "Times New Roman", serif',
    package: "@fontsource/young-serif",
    imports: ["@fontsource/young-serif/400.css"],
    preview: { family: "Young Serif", query: "Young+Serif" },
  },
  montserrat: {
    family: "Montserrat Variable",
    fallback: 'system-ui, "Segoe UI", Roboto, Arial, sans-serif',
    package: "@fontsource-variable/montserrat",
    imports: ["@fontsource-variable/montserrat"],
    preview: { family: "Montserrat", query: "Montserrat:wght@300..800" },
  },
  interTight: {
    family: "Inter Tight Variable",
    fallback: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    package: "@fontsource-variable/inter-tight",
    imports: ["@fontsource-variable/inter-tight"],
    preview: { family: "Inter Tight", query: "Inter+Tight:wght@300..800" },
  },
  jetbrainsMono: {
    family: "JetBrains Mono Variable",
    fallback: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    package: "@fontsource-variable/jetbrains-mono",
    imports: ["@fontsource-variable/jetbrains-mono"],
    preview: { family: "JetBrains Mono", query: "JetBrains+Mono:wght@300..800" },
  },
  fraunces: {
    family: "Fraunces Variable",
    fallback: 'Georgia, "Times New Roman", serif',
    package: "@fontsource-variable/fraunces",
    imports: ["@fontsource-variable/fraunces"],
    preview: { family: "Fraunces", query: "Fraunces:opsz,wght@9..144,300..800" },
  },
  instrumentSerif: {
    family: "Instrument Serif",
    fallback: 'Georgia, "Times New Roman", serif',
    package: "@fontsource/instrument-serif",
    imports: ["@fontsource/instrument-serif/400.css", "@fontsource/instrument-serif/400-italic.css"],
    preview: { family: "Instrument Serif", query: "Instrument+Serif:ital@0;1" },
  },
};

/** The four keys that go into the tokens fence. */
export function fontSpec(id) {
  const font = FONTS[id];
  if (!font) throw new Error(`Unknown font: ${id}`);
  return {
    family: font.family,
    fallback: font.fallback,
    package: font.package,
    imports: [...font.imports],
  };
}

/** Preview family for a fontsource family name, e.g. "Fraunces Variable" → "Fraunces". */
export function previewFamily(family) {
  const found = Object.values(FONTS).find((font) => font.family === family);
  return found ? found.preview.family : family;
}

/** One Google Fonts stylesheet URL covering every face the preview may need. */
export function previewFontsHref() {
  const families = Object.values(FONTS)
    .map((font) => `family=${font.preview.query}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
