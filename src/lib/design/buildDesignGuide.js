import { DENSITY_PX, typeScale } from "./scale.js";
import {
  COLOR_KEYS,
  CONTRACT_VERSION,
  CONTRAST_PAIRS,
  ENUMS,
  GUIDE_FILENAME,
  NO_BOLD_MAX,
} from "./contract.js";
import { getDirectionNotes } from "./templates.js";

/** What each variant value means on the site. Printed into every guide. */
export const VARIANT_SPEC = {
  header: {
    solid: "Opaque headerBg with a 1px bottom border in border.",
    blur: "Sticky. headerBg at 85% opacity, 16px backdrop blur, 1px bottom border at 50% headerFg. Transparent over a photo hero until the page scrolls 16px.",
    band: "Opaque headerBg, no border. Reads as one block with a band hero.",
  },
  hero: {
    plain: "Split hero on bg: copy left, image carousel right.",
    band: "Split hero on band; text uses bandFg and bandMuted.",
    glow: "Split hero on bg with two soft radial gradients in accent (16%) and highlight (14%).",
    framed: "Split hero on bg; the carousel sits in a radiusLg frame with a 1px border, surfaceAlt fill and 12px padding.",
    photo: "Full-bleed hero, min-height 88vh. The carousel becomes the background (absolutely positioned, inset 0, image radius 0, object-fit cover). Copy is one centered column (max 48rem) in onImage, on top of the overlay; the hero eyebrow uses highlight and the secondary button is an onImage outline. Carousel controls sit bottom-right over the image. Image placeholders without src use band as their background.",
  },
  heroOverlay: {
    none: "No overlay (non-photo heroes).",
    dark: "Linear gradient top→bottom: black 40% → black 20% → black 60%.",
    fade: "Linear gradient top→bottom: fg 30% → fg 20% → bg 100%. The photo dissolves into the page.",
    vignette: "Radial gradient: transparent at center → bg at 95% at the edges, plus a flat 25% bg layer.",
  },
  card: {
    line: "Transparent card, 1px border, radius.",
    filled: "surfaceAlt fill, no border, radius.",
    elevated: "surface fill, no border, two shadows tinted with fg: 0 1px 2px fg/10% and 0 8px 24px fg/12%.",
  },
  rhythm: {
    alternate: "Sections alternate bg and surfaceAlt.",
    flat: "Every section on bg, separated by a 1px border hairline.",
    bands: "bg everywhere except the stats row and the closing CTA, which sit on band.",
  },
  texture: {
    none: "No texture.",
    grid: "1px grid lines on a 64px grid at 8% of the current text color, masked to fade right. Hero and closing band only.",
    dots: "1.5px dots on a 24px grid at 12% of the current text color. Hero and closing band only.",
    scanline: "Repeating horizontal lines: 3px transparent, 1px accent at 6%. Over the hero, over hero media and over card images.",
  },
  hover: {
    zoom: "Images inside cards and media frames scale to 1.05 over 700ms ease-out; the card gains the elevated shadow.",
    lift: "Card moves up 4px and gains the elevated shadow over 300ms.",
    jelly: "Card scales to 1.03 and rotates -0.5° over 500ms with cubic-bezier(0.34, 1.56, 0.64, 1).",
    glitch: "Card plays a 300ms steps(2) shake (±1px, hue-rotate ±15°) once, and shows a 2px inset accent frame while hovered.",
    brighten: "Images go from brightness(0.85) to brightness(1) over 800ms. No scale.",
  },
  portrait: {
    rounded: "Team and author photos use radiusLg.",
    circle: "Team and author photos are circles.",
    square: "Team and author photos have radius 0.",
    blob: "Team and author photos use border-radius: 40% 60% 55% 45% / 55% 45% 60% 40%.",
  },
  eyebrowMark: {
    none: "Eyebrow text only.",
    dot: "A 6px accent dot, 8px before the eyebrow text.",
    rule: "A 40px × 1px accent rule, 12px before the eyebrow text.",
    slashes: "The eyebrow text is prefixed with \"// \" via CSS ::before (decorative, aria-hidden by being generated content).",
  },
  button: {
    solid: "Primary is a solid accent fill with accentFg text, radius.",
    outline: "Primary is a 1px accent border with accentInk text; hover fills accent with accentFg text.",
    pill: "Primary is a solid accent fill with accentFg text and fully rounded ends.",
  },
  motion: {
    none: "No reveal motion.",
    fade: "Reveal: opacity 0 → 1.",
    rise: "Reveal: opacity 0 → 1 and translateY 24px → 0.",
    blur: "Reveal: opacity 0 → 1 and filter blur(8px) → 0.",
    spring: "Reveal: opacity 0 → 1, translateY 24px → 0 and scale 0.97 → 1 with the overshoot easing.",
  },
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

function onOff(value) {
  return value ? "ON" : "off";
}

function fontLine(role, font) {
  return `| ${role} | ${font.family} | \`${font.package}\` | ${font.imports.map((i) => `\`${i}\``).join(", ")} | ${font.fallback} |`;
}

function contractSpec() {
  const enumLines = Object.entries(ENUMS)
    .map(([key, values]) => `- \`${key}\`: ${values.map((v) => `"${v}"`).join(" | ")}`)
    .join("\n");
  return `Top level: \`version\` (must be ${CONTRACT_VERSION}), \`template\`, \`templateName\`, \`tagline\`, \`mode\`, \`brand\`, \`colors\`, \`type\`, \`shape\`, \`layout\`, \`variants\`, \`motion\`, \`imagery\`, \`overrides\`, \`breakpoints\`.

- \`brand\`: \`wordmarkPrimary\`, \`wordmarkAccent\` (strings, may be empty).
- \`colors\`: ${COLOR_KEYS.map(([key]) => `\`${key}\``).join(", ")} — each a 6-digit hex (#RRGGBB).
- \`type.display\` and \`type.body\`: \`family\` (string), \`fallback\` (string), \`package\` (npm name), \`imports\` (non-empty string array).
- \`type\`: \`base\` (px), \`scale\` (number > 1), \`headingWeight\`, \`uiWeight\`, \`strongWeight\`, \`bodyWeight\` (numbers 100–900), \`headingTracking\` (em), \`headingLeading\` (number), \`headingCase\`, \`eyebrow\`, \`eyebrowTracking\` (em).
- \`shape\`: \`radius\`, \`radiusLg\` (px), \`button\`.
- \`layout\`: \`density\`, \`container\`, \`measure\` (rem).
- \`variants\`: \`header\`, \`hero\`, \`heroOverlay\`, \`card\`, \`rhythm\`, \`texture\`, \`hover\`, \`portrait\`, \`eyebrowMark\`.
- \`motion\`: \`style\`, \`duration\` (ms number), \`easing\` (CSS easing string), \`stagger\` (ms number), \`carouselInterval\` (ms number).
- \`imagery\`: \`treatment\`, \`cssFilter\`, \`direction\`, \`avoid\` (non-empty strings), \`radius\` (px), \`aspect\` ("W:H").
- \`overrides\`: \`forceInter\`, \`forceNoBold\` (booleans; already applied to the values above).
- \`breakpoints\`: \`sm\`, \`md\`, \`lg\`, \`xl\` (px).

Enums:
${enumLines}`;
}

/**
 * Deterministic DESIGN_GUIDE.md. Same tokens in → same file out.
 * The ```tokens fence is the full token object and the machine source of truth.
 */
export function buildDesignGuide(tokens, options = {}) {
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens are required");
  }

  const name = brandTitle(tokens, options.brandName);
  const notes = getDirectionNotes(tokens.template);
  const sizes = typeScale(tokens.type);
  const density = DENSITY_PX[tokens.layout?.density] || DENSITY_PX.regular;
  const colors = tokens.colors || {};
  const variants = tokens.variants || {};
  const motion = tokens.motion || {};
  const imagery = tokens.imagery || {};
  const type = tokens.type || {};
  const overrides = tokens.overrides || {};

  const paletteRows = COLOR_KEYS.map(
    ([key, use]) => `| ${key} | ${colors[key] || ""} | ${use} |`
  ).join("\n");

  const variantRows = [
    ["Header", "header", variants.header],
    ["Hero", "hero", variants.hero],
    ["Hero overlay", "heroOverlay", variants.heroOverlay],
    ["Card", "card", variants.card],
    ["Button", "button", tokens.shape?.button],
    ["Section rhythm", "rhythm", variants.rhythm],
    ["Texture", "texture", variants.texture],
    ["Hover", "hover", variants.hover],
    ["Portrait", "portrait", variants.portrait],
    ["Eyebrow mark", "eyebrowMark", variants.eyebrowMark],
    ["Reveal motion", "motion", motion.style],
  ]
    .map(([label, group, value]) => `| ${label} | ${value} | ${VARIANT_SPEC[group]?.[value] || value} |`)
    .join("\n");

  const allVariantSpec = Object.entries(VARIANT_SPEC)
    .map(
      ([group, values]) =>
        `**${group}**\n\n${Object.entries(values)
          .map(([value, text]) => `- \`${value}\` — ${text}`)
          .join("\n")}`
    )
    .join("\n\n");

  const overrideLines = [];
  if (overrides.forceInter) {
    overrideLines.push(
      "Force Inter is ON: display and body are both Inter. Do not load or reference the Direction's original fonts."
    );
  }
  if (overrides.forceNoBold) {
    overrideLines.push(
      `Force no bold is ON: no element may render above weight ${NO_BOLD_MAX}. That includes headings, eyebrows, buttons, nav, labels, card titles, stat values, strong, b, th, dt and markdown **bold** in articles. Hierarchy comes from size, tracking and color.`
    );
  }
  if (overrides.forceInter || overrides.forceNoBold) {
    overrideLines.push(
      "Overrides win: where the Direction, Signature details or Don'ts mention a typeface or a heavier weight, the override values in this file replace it."
    );
  }
  if (!overrideLines.length) {
    overrideLines.push("No overrides. Use the Direction's own fonts and weights exactly as listed.");
  }

  const signatureList = (notes?.signatures || []).map((line) => `- ${line}`).join("\n");
  const dontList = (notes?.donts || []).map((line) => `- ${line}`).join("\n");
  const examples = (notes?.examples || []).map((line) => `"${line}"`).join(", ");

  const json = JSON.stringify(tokens, null, 2);

  return `# Design Guide — ${name}

Direction: ${tokens.templateName} — ${tokens.tagline} (${tokens.mode})
Contract: v${tokens.version}
Overrides: Force Inter ${onOff(overrides.forceInter)} · Force no bold ${onOff(overrides.forceNoBold)}

This file lives at the repository root as \`${GUIDE_FILENAME}\`. It is the single source of truth for the site's visual design. The \`tokens\` block at the end is the machine-readable contract; everything above it explains how to apply those values. Never edit this file by hand — regenerate it in The Night Ventures → Build → Design.

## Direction

${notes?.summary || tokens.tagline}

## Brand identity

Wordmark: ${wordmarkLine(tokens.brand)}. The first part uses headerFg (footerFg in the footer); the second part uses accentInk. When both are empty, the site name is the fallback. The wordmark uses the display font at heading weight.

## Color palette

| Token | Hex | Use |
| --- | --- | --- |
${paletteRows}

Accent is a fill color. Any accent-colored text — links, eyebrows, wordmark accent, nav and footer hover, outline-button text, card call-to-action — uses accentInk. Text on an accent fill uses accentFg.

## Typography

${overrideLines.join("\n\n")}

| Role | Family | Package | Imports | Fallback |
| --- | --- | --- | --- | --- |
${fontLine("Display (headings, wordmark, stat values, card titles, pull quotes)", type.display)}
${fontLine("Body (everything else)", type.body)}

| Size role | Desktop | Mobile |
| --- | --- | --- |
| Body | ${sizes.body} | ${sizes.body} |
| Lead | ${sizes.lead} | ${sizes.lead} |
| H3 | ${sizes.h3} | ${sizes.h3Mobile} |
| H2 | ${sizes.h2} | ${sizes.h2Mobile} |
| H1 | ${sizes.h1} | ${sizes.h1Mobile} |

Body is the base size. Lead is base × 1.2. H3 is base × scale², H2 base × scale³, H1 base × scale⁴ at the large breakpoint; on mobile each heading drops one step. Headings scale fluidly between the two.

| Weight role | Value | Applies to |
| --- | --- | --- |
| Heading | ${type.headingWeight} | h1–h3, wordmark, stat values, card titles |
| UI | ${type.uiWeight} | eyebrows, buttons, nav links, labels, FAQ questions |
| Strong | ${type.strongWeight} | strong, b, th, dt, markdown bold |
| Body | ${type.bodyWeight} | all running text |

Headings: tracking ${type.headingTracking}, leading ${type.headingLeading}, case ${type.headingCase}. Body line-height 1.65. Eyebrow: ${type.eyebrow}, tracking ${type.eyebrowTracking}. Set \`font-synthesis-weight: none\` so the browser never fakes bold.

## Layout & spacing

Density: ${tokens.layout?.density} — ${density.desktop}px desktop / ${density.mobile}px mobile section padding.
Container: ${tokens.layout?.container}. Measure (reading width): ${tokens.layout?.measure}.
Radius: ${tokens.shape?.radius}; large radius: ${tokens.shape?.radiusLg}. Minimum interactive target 44×44px.

## Components

| Component | Value | Behavior |
| --- | --- | --- |
${variantRows}

Secondary buttons are always a 1px outline in fg (bandFg on a band, onImage on a photo hero).

## Motion

Reveal style: ${motion.style}. Duration ${motion.duration}ms, easing ${motion.easing}, stagger ${motion.stagger}ms between siblings, once per element. Carousel interval ${motion.carouselInterval}ms.
Under \`prefers-reduced-motion: reduce\`: no reveal motion, no hover transforms (zoom, lift, jelly, glitch), no carousel autoplay, no bouncing indicators.

## Imagery

Treatment: ${imagery.treatment}
CSS filter: ${imagery.cssFilter}
Radius: ${imagery.radius}
Aspect: ${imagery.aspect}
Direction: ${imagery.direction}
Avoid: ${imagery.avoid}
Key palette: fg ${colors.fg}, bg ${colors.bg}, accent ${colors.accent}, highlight ${colors.highlight}

## Signature details

These make the Direction recognisable. Implement every one with CSS and small markup additions to existing components.

${signatureList}

## Voice (reference only)

${notes?.voice || ""} Examples: ${examples}.
Never rewrite existing site copy to match this. It is guidance for future copy only.

## Don'ts

${dontList}

## Rules

- Every color, font, weight, radius, shadow and easing comes from this file. No hard-coded hex, font-family or font-weight anywhere in components or CSS.
- Accent as text always means accentInk.
- No inline style attributes for design values.
- Never bake text into images. Never invent testimonials.
- Respect prefers-reduced-motion everywhere.

## Contrast pairs

Each pair must reach 4.5:1 (foreground on background). The build must fail if one does not.

${CONTRAST_PAIRS.map(([fg, bg]) => `- ${fg} on ${bg}`).join("\n")}

## Variant reference

Every value the contract allows, so the site can support all of them:

${allVariantSpec}

## Token contract (v${CONTRACT_VERSION})

${contractSpec()}

## Token block

\`\`\`tokens
${json}
\`\`\`
`;
}
