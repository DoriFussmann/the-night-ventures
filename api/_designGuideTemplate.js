/** Fixed Design Guide.md body. Brand values via {{TOKEN}} placeholders. */

export const DESIGN_GUIDE_TEMPLATE = "# Design Guide\n\nThe design layer for marketing sites built on the SEO template. Quiet, editorial, operator-grade: small type, hairline borders, no shadows, no bold. Hierarchy comes from size and color, not weight or decoration. Brand-specific values live in the token block below; everything else is fixed.\n\n---\n\n## 1. Brand tokens (fill per site)\n\n```\nBRAND_NAME        {{BRAND_NAME}}\nDOMAIN            {{DOMAIN}}\nFEEL              {{FEEL}}\nACCENT            {{ACCENT}}\nBAND              {{BAND}}\nPOSITIVE          {{POSITIVE}}\nWORDMARK          \"{{WORDMARK_PRIMARY}}\" Ink / \"{{WORDMARK_ACCENT}}\" Accent\n```\n\nOne accent only. Green is reserved for gain/included marks. Never purple or electric gradients.\n\n---\n\n## 2. Principles\n\n1. **Quiet over loud.** No filled buttons, no shadows, no gradients on cards. The BAND color is the only saturated surface.\n2. **Weightless type.** Regular weight everywhere. Size, color, and tracking replace bold.\n3. **Small type as default.** Base is 13px. 15px is a step up. Headlines go large but stay tight and light.\n4. **One motion.** Fade in while rising from below, expo-out ease, staggered siblings. Nothing else.\n5. **Hairlines, not boxes.** White planes, 1px border, generous padding. Hover is a whisper.\n\n---\n\n## 3. Color\n\n| Token | Hex | Use |\n|---|---|---|\n| Ink | `#1a1a1a` | Headlines, card titles, active nav, wordmark |\n| Muted | `#8a8a8a` | Body, eyebrows, inactive nav, button labels |\n| Faint | `#b5b5b5` | Number prefixes, placeholders, legal, challenge dots |\n| Border | `#e6e6e6` | Card borders, rules, nav underline, inputs |\n| Wash | `#fafafa` | Alternating sections, card hover |\n| Paper | `#ffffff` | Page and cards |\n| Band | {{BAND}} | Hero and closing CTA |\n| Accent | {{ACCENT}} | Links, nav underline, pillar sublines, input focus |\n| Positive | {{POSITIVE}} | Gain dots, `+` included marks |\n\nOn BAND: eyebrow `white/50`, body `white/70`, chip/button border `white/20–30`, hover fill `white/10`.\n\nLight mode only.\n\n---\n\n## 4. Typography\n\nFont: `ui-sans-serif, system-ui, sans-serif`. No webfont. Weight 400 everywhere. If a brand requires Inter, load 400 only and keep tracking tight; heavier weights break the tone.\n\n| Role | Size | Color | Extra |\n|---|---|---|---|\n| Eyebrow / label | 13px | Muted | No uppercase, no tracking |\n| Body / list / caption | 13px | Muted | `leading-relaxed` |\n| Card title / wordmark | 15px | Ink | Wordmark `tracking-tight` |\n| Lede | 15px | Muted | `leading-relaxed`, `max-w-xl` |\n| H3 | `text-2xl` | Ink | `leading-tight tracking-tight` |\n| H2 | `text-3xl` | Ink | `leading-tight tracking-tight`, `max-w-2xl` |\n| H1 inner | `text-4xl` | Ink | same |\n| H1 hero | `text-4xl md:text-5xl` | White | same, `max-w-3xl` |\n| Number prefix | 13px | Faint | `01`, not a badge |\n\nRules: never `font-semibold`/`font-bold`; never uppercase eyebrows; body measure `max-w-xl`/`max-w-2xl`, never full-bleed. Monospace only for data snippets, 13px, 400.\n\n---\n\n## 5. Layout\n\n- Canvas: white, `min-h-screen flex flex-col`. Container `max-w-[1280px]`, `px-6 md:px-8`; hero `md:px-14`.\n- Sections: `py-24` home, `py-20` inner. Bands alternate white → Wash (`border-y` Border) → white → BAND CTA.\n- Grids: `gap-4`, `md:grid-cols-3` (2 for dense/compliance pages). Cards `h-full`.\n- Nav: sticky `h-16`, `bg-white/80 backdrop-blur-xl`, bottom hairline. Wordmark left, 13px links Muted → Ink, active = Ink + 1px Accent underline growing from left. CTA is a ghost button. Mobile: hamburger, stacked links, no animation.\n- Footer: top hairline, `py-12`, wordmark + one muted sentence (`max-w-xs`), two link columns, legal row in Faint under a hairline.\n\nNo sidebars, no feature dumps, no mega-menus.\n\n---\n\n## 6. Motion (Framer Motion)\n\nEase everywhere: `[0.16, 1, 0.3, 1]` (CSS `cubic-bezier(0.16, 1, 0.3, 1)`).\n\n**Hero on mount**\n```js\ninitial={{ opacity: 0, y: 20 }}\nanimate={{ opacity: 1, y: 0 }}\ntransition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}\n```\nChips: parent `staggerChildren: 0.06, delayChildren: 0.3`; child `hidden: { opacity: 0, y: 8 }`. CTAs static.\n\n**Reveal (every section below hero, every inner page block)**\n```jsx\nfunction Reveal({ children, delay = 0, className = \"\" }) {\n  return (\n    <motion.div\n      className={className}\n      initial={{ opacity: 0, y: 24 }}\n      whileInView={{ opacity: 1, y: 0 }}\n      viewport={{ once: true, margin: \"-80px\" }}\n      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}\n    >\n      {children}\n    </motion.div>\n  );\n}\n```\nCard grids: `delay={i * 0.08}`. On route change scroll to top with `behavior: \"instant\"`.\n\n**Hover (CSS only)**\n\n| Element | Hover |\n|---|---|\n| Ghost button / chip | `transition-colors duration-200`, border + text brighten |\n| Card | `transition-colors duration-300` → Wash |\n| Rich card (solution/service) | Wash + `hover:-translate-y-1`, `transition-all duration-300` |\n| Arrow link | `group-hover:translate-x-1 duration-200` |\n| Input | border → Accent on focus, `duration-200` |\n\nRespect `prefers-reduced-motion`. No bounce, spring, parallax, counters, slide-from-side, scale-in, or fade-only.\n\n---\n\n## 7. Components\n\n**Card shell:** `rounded-xl border border-[#e6e6e6] bg-white p-6 h-full`.\n\n- **Pillar / differentiator:** `01` Faint → title 15 Ink → optional Accent subline 13 → body 13 Muted. Hover wash (pillars stay still).\n- **Rich card:** eyebrow 13 Muted → title 15 Ink → subtitle 13 Muted → \"The challenge\" (Faint dots) → \"What you get\" (Positive dots) → Accent arrow link pinned `mt-auto pt-6`. Dots `h-1 w-1 rounded-full mt-[7px]`.\n- **Icon card:** same shell, 16px Lucide icon in Muted instead of number, 2-col grid.\n- **Panel:** one wide card or header + body split by `border-t`. Included items use Positive `+`, not checkmarks.\n\n**Buttons:** ghost only. `rounded-lg border border-[#e6e6e6] px-3 py-2 text-[13px] text-[#8a8a8a] hover:bg-[#fafafa] hover:text-[#1a1a1a]` (white/30 border on BAND). No filled or pill CTAs.\n\n**Inputs:** same geometry, placeholder Faint, focus border Accent, no ring, `resize-none`.\n\n**Hero / CTA band:** BAND, `relative overflow-hidden`, white type. Backdrop = two soft radial gradients + 48×48px white grid at `opacity: 0.07`:\n```css\nbackground-image:\n  linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px),\n  linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px);\nbackground-size: 48px 48px;\nopacity: 0.07;\n```\nStructure: eyebrow → H1 `mt-6` → lede `mt-6` → chips `mt-10 gap-2` → ghost CTAs `mt-12 gap-3`. Chip: `rounded-lg border border-white/20 px-3 py-1.5 text-[13px] text-white/70 hover:border-white/50 hover:text-white`. Grid texture never appears on white pages.\n\n**Icons:** Lucide, 1.5px stroke, 16–20px, never filled, one family.\n**Imagery:** editorial, candid, desaturated, warm matte. No stock handshakes, rocket ships, group shots, illustration.\n\n---\n\n## 8. Page recipes\n\n**Home:** BAND hero (mount animation, chips) → white 3-card differentiators (`i * 0.08`) → Wash \"how it works\" (lede, 3 pillars, closing H3) → white 3 rich cards → BAND CTA (single Reveal).\n\n**Inner page:**\n```\nmax-w-[1280px] px-6 py-20 md:px-8\n<Reveal> eyebrow 13 · h1 text-4xl · lede 15 max-w-xl </Reveal>\n<grid> each card in <Reveal delay={i * 0.08}> </grid>\n<Reveal delay={0.1}> supporting panel </Reveal>\n```\n\n---\n\n## 9. Voice\n\nMeasured, precise, candid. Headlines are short declaratives, often ending in a period (\"Data.\" / \"Execution.\"). Eyebrows are plain-English labels. Use \"you\"; name specifics over superlatives.\n\nNever: exclamation marks, hype vocabulary, emoji, urgency/scarcity, \"We\" opening a hero headline, empty mission-speak, AI-forward framing when the product is human.\n\n{{VOICE}}\n\n---\n\n## 10. Never\n\nBold or display webfonts · shadows, glow, colored cards · filled or pill buttons · gradients, glassmorphism, dark mode · uppercase tracked eyebrows · second accent · competitor feature tables · testimonial carousels with circle headshots · simulated-software demos · any motion besides the rise-and-fade.\n"

/** Layer 2 / design-tokens.mjs key set. Do not add keys. */
export const LAYER2_TOKEN_SHAPE = {
  colors: {
    bg: '#ffffff',
    fg: '#1a1a1a',
    accent: '',
    'accent-hover': '',
    highlight: '',
    muted: '#8a8a8a',
    border: '#e6e6e6',
    surface: '#ffffff',
    focus: '',
  },
  fonts: {
    sans: 'ui-sans-serif, system-ui, sans-serif',
    serif: 'ui-sans-serif, system-ui, sans-serif',
  },
  typeScale: {
    xs: '12px',
    sm: '13px',
    base: '13px',
    lg: '15px',
    xl: '18px',
    '2xl': '24px',
    '3xl': '30px',
    '4xl': '36px',
  },
  spacingUnit: '4px',
  breakpoints: {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
  },
  maxWidth: {
    container: '1280px',
    article: '1280px',
  },
}

export function buildLayer2Tokens({ accent, band }) {
  const accentHex = String(accent || '').trim()
  const bandHex = String(band || '').trim()
  return {
    colors: {
      bg: '#ffffff',
      fg: '#1a1a1a',
      accent: accentHex,
      'accent-hover': accentHex,
      highlight: bandHex,
      muted: '#8a8a8a',
      border: '#e6e6e6',
      surface: '#ffffff',
      focus: accentHex,
    },
    fonts: { ...LAYER2_TOKEN_SHAPE.fonts },
    typeScale: { ...LAYER2_TOKEN_SHAPE.typeScale },
    spacingUnit: LAYER2_TOKEN_SHAPE.spacingUnit,
    breakpoints: { ...LAYER2_TOKEN_SHAPE.breakpoints },
    maxWidth: { ...LAYER2_TOKEN_SHAPE.maxWidth },
  }
}

function buildTokenFence(tokens) {
  const json = JSON.stringify(
    buildLayer2Tokens({
      accent: tokens.ACCENT,
      band: tokens.BAND,
    }),
    null,
    2
  )
  return '```tokens\n' + json + '\n```'
}

function interpolate(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match
    return String(values[key] ?? '')
  })
}

/**
 * Interpolate brand tokens into the fixed Design Guide template.
 * @param {{
 *   BRAND_NAME?: string,
 *   DOMAIN?: string,
 *   FEEL?: string,
 *   ACCENT?: string,
 *   BAND?: string,
 *   POSITIVE?: string,
 *   WORDMARK_PRIMARY?: string,
 *   WORDMARK_ACCENT?: string,
 *   VOICE?: string,
 * }} tokens
 * @returns {string}
 */
export function renderDesignGuide(tokens = {}) {
  const values = {
    BRAND_NAME: tokens.BRAND_NAME ?? '',
    DOMAIN: tokens.DOMAIN ?? '',
    FEEL: tokens.FEEL ?? '',
    ACCENT: tokens.ACCENT ?? '',
    BAND: tokens.BAND ?? '',
    POSITIVE: tokens.POSITIVE ?? '',
    WORDMARK_PRIMARY: tokens.WORDMARK_PRIMARY ?? '',
    WORDMARK_ACCENT: tokens.WORDMARK_ACCENT ?? '',
    VOICE: tokens.VOICE ?? '',
  }
  const heading = '# Design Guide\n'
  if (!DESIGN_GUIDE_TEMPLATE.startsWith(heading)) {
    throw new Error('Design Guide template must start with "# Design Guide\\n"')
  }
  const wordmark = `"${values.WORDMARK_PRIMARY}" Ink / "${values.WORDMARK_ACCENT}" Accent`
  const interpolated = interpolate(DESIGN_GUIDE_TEMPLATE, {
    ...values,
    WORDMARK: wordmark,
  })
  return heading + '\n' + buildTokenFence(values) + interpolated.slice(heading.length)
}
