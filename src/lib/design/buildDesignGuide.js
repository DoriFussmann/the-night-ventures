import { DENSITY_PX, typeScale } from "./scale.js";

const COLOR_USE = [
  ["bg", "Page background"],
  ["surface", "Cards and raised surfaces"],
  ["surfaceAlt", "Alternate sections and filled cards"],
  ["fg", "Primary text"],
  ["muted", "Secondary text"],
  ["border", "Hairlines and borders"],
  ["accent", "Links, primary buttons, and focus"],
  ["accentHover", "Accent hover"],
  ["accentFg", "Text on accent"],
  ["highlight", "Highlight details"],
  ["band", "Band surfaces"],
  ["bandFg", "Text on band"],
  ["bandMuted", "Secondary text on band"],
  ["headerBg", "Header background"],
  ["headerFg", "Header text"],
  ["footerBg", "Footer background"],
  ["footerFg", "Footer text"],
  ["focus", "Focus ring"],
];

const HEADER_COPY = {
  solid: "Opaque header background with a 1px bottom border.",
  blur: "Sticky header. Background at 85% opacity, 16px backdrop blur, bottom border at 50% opacity.",
  band: "Opaque header with no border. Reads as one block with a band hero.",
};

const HERO_COPY = {
  plain: "Split hero on the page background. Text on the left, image carousel on the right.",
  band: "Split hero on the band color. Text uses band foreground and band muted.",
  glow: "Split hero on the page background with two soft radial gradients in accent and highlight.",
  framed:
    "Split hero on the page background. The carousel sits in a large-radius frame with a 1px border and alternate-surface padding.",
};

const CARD_COPY = {
  line: "Transparent card with a 1px border and the shape radius.",
  filled: "Filled card on the alternate surface, no border.",
  elevated: "Surface card with a tight shadow and a soft shadow, both at low foreground alpha.",
};

const BUTTON_COPY = {
  solid: "Primary button is a solid accent fill with accent foreground text.",
  outline:
    "Primary button is a 1px accent border and accent text. Hover fills with accent and accent foreground.",
  pill: "Primary button is solid accent with fully rounded ends.",
};

const TEXTURE_COPY = {
  none: "No texture.",
  grid: "1px grid lines on a 64px grid at 8% of the hero text color, fading to the right. Hero and closing band only.",
  dots: "1.5px dots on a 24px grid at 12% of the hero text color. Hero and closing band only.",
};

const RHYTHM_COPY = {
  alternate: "Content sections alternate page background and alternate surface.",
  flat: "Every section uses the page background, separated by 1px hairlines.",
  bands: "Page background everywhere, except the stats row and the closing band, which sit on the band color.",
};

function wordmarkLine(brand = {}) {
  const primary = String(brand.wordmarkPrimary ?? "");
  const accent = String(brand.wordmarkAccent ?? "");
  if (!accent) return primary || "—";
  return `${primary} / ${accent}`;
}

function brandTitle(tokens, brandName) {
  const given = String(brandName ?? "").trim();
  if (given) return given;
  const fromMark = [tokens.brand?.wordmarkPrimary, tokens.brand?.wordmarkAccent]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return fromMark || "Brand";
}

/**
 * Deterministic Design Guide.md. The tokens fence is the full token object.
 */
export function buildDesignGuide(tokens, options = {}) {
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens are required");
  }

  const name = brandTitle(tokens, options.brandName);
  const sizes = typeScale(tokens.type);
  const density = DENSITY_PX[tokens.layout?.density] || DENSITY_PX.regular;
  const colors = tokens.colors || {};
  const variants = tokens.variants || {};
  const motion = tokens.motion || {};
  const imagery = tokens.imagery || {};
  const type = tokens.type || {};

  const paletteRows = COLOR_USE.map(
    ([key, use]) => `| ${key} | ${colors[key] || ""} | ${use} |`
  ).join("\n");

  const json = JSON.stringify(tokens, null, 2);

  return `# Design Guide — ${name}

Template: ${tokens.templateName} — ${tokens.tagline} (${tokens.mode})

## Brand identity

Wordmark: ${wordmarkLine(tokens.brand)}
Character: ${tokens.tagline}

## Color palette

| Token | Hex | Use |
| --- | --- | --- |
${paletteRows}

## Typography

Inter only. Family: ${type.family}. No other typeface.

| Role | Desktop | Mobile |
| --- | --- | --- |
| Body | ${sizes.body} | ${sizes.body} |
| Lead | ${sizes.lead} | ${sizes.lead} |
| H3 | ${sizes.h3} | ${sizes.h3Mobile} |
| H2 | ${sizes.h2} | ${sizes.h2Mobile} |
| H1 | ${sizes.h1} | ${sizes.h1Mobile} |

Body is the base size. Lead is base × 1.2. H3 is base × scale². H2 is base × scale³. H1 is base × scale⁴ at the large breakpoint; on mobile each heading drops one step. Headings use weight ${type.headingWeight}, tracking ${type.headingTracking}, leading ${type.headingLeading}. Body uses weight ${type.bodyWeight} and line-height 1.65. Eyebrow: ${type.eyebrow}.

## Layout & spacing

Density: ${tokens.layout?.density} — ${density.desktop}px desktop / ${density.mobile}px mobile section padding.
Container: ${tokens.layout?.container}.
Measure: ${tokens.layout?.measure}.
Rhythm: ${variants.rhythm} — ${RHYTHM_COPY[variants.rhythm] || variants.rhythm}

## Components

Header (${variants.header}): ${HEADER_COPY[variants.header] || variants.header}
Hero (${variants.hero}): ${HERO_COPY[variants.hero] || variants.hero}
Card (${variants.card}): ${CARD_COPY[variants.card] || variants.card}
Button (${tokens.shape?.button}): ${BUTTON_COPY[tokens.shape?.button] || tokens.shape?.button} Secondary is always an outline in foreground, or band foreground on a band. Non-pill buttons use radius ${tokens.shape?.radius}. Minimum target 44×44px.
Texture (${variants.texture}): ${TEXTURE_COPY[variants.texture] || variants.texture}

## Motion

Style: ${motion.style}
Duration: ${motion.duration}ms
Easing: ${motion.easing}
Stagger: ${motion.stagger}ms
Carousel interval: ${motion.carouselInterval}ms

## Imagery

Treatment: ${imagery.treatment}
CSS filter: ${imagery.cssFilter}
Radius: ${imagery.radius}
Aspect: ${imagery.aspect}
Direction: ${imagery.direction}
Avoid: ${imagery.avoid}
Key palette: fg ${colors.fg}, bg ${colors.bg}, accent ${colors.accent}, highlight ${colors.highlight}

## Rules

- Never use a font other than Inter.
- Never hardcode colors outside this palette.
- Never use fake testimonials.
- Never bake text into images.

## Token block

\`\`\`tokens
${json}
\`\`\`
`;
}
