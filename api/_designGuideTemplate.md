# Design Guide

The design layer for marketing sites built on the SEO template. Quiet, editorial, operator-grade: small type, hairline borders, no shadows, no bold. Hierarchy comes from size and color, not weight or decoration. Brand-specific values live in the token block below; everything else is fixed.

---

## 1. Brand tokens (fill per site)

```
BRAND_NAME        e.g. Rupert
DOMAIN            e.g. heyrupert.com
FEEL              one sentence, e.g. "A senior operator who is completely on your side."
ACCENT            one color, used for links / focus / nav underline only
BAND              one deep color for hero + closing CTA band
POSITIVE          one muted green for "gain / included" marks
WORDMARK          two-part wordmark: first part Ink, second part Accent
```

Default set (neutral):
- ACCENT `#2f5eff` · BAND `#2c4a6e` · POSITIVE `#6a9a78`

Example warm override (Rupert):
- ACCENT `#B5935A` brass · BAND `#1A1A2E` ink-navy · POSITIVE `#3A7D5E` sage · Paper may shift to `#FAF9F7`

One accent only. Green is reserved for gain/included marks. Never purple or electric gradients.

---

## 2. Principles

1. **Quiet over loud.** No filled buttons, no shadows, no gradients on cards. The BAND color is the only saturated surface.
2. **Weightless type.** Regular weight everywhere. Size, color, and tracking replace bold.
3. **Small type as default.** Base is 13px. 15px is a step up. Headlines go large but stay tight and light.
4. **One motion.** Fade in while rising from below, expo-out ease, staggered siblings. Nothing else.
5. **Hairlines, not boxes.** White planes, 1px border, generous padding. Hover is a whisper.

---

## 3. Color

| Token | Hex | Use |
|---|---|---|
| Ink | `#1a1a1a` | Headlines, card titles, active nav, wordmark |
| Muted | `#8a8a8a` | Body, eyebrows, inactive nav, button labels |
| Faint | `#b5b5b5` | Number prefixes, placeholders, legal, challenge dots |
| Border | `#e6e6e6` | Card borders, rules, nav underline, inputs |
| Wash | `#fafafa` | Alternating sections, card hover |
| Paper | `#ffffff` | Page and cards |
| Band | BAND | Hero and closing CTA |
| Accent | ACCENT | Links, nav underline, pillar sublines, input focus |
| Positive | POSITIVE | Gain dots, `+` included marks |

On BAND: eyebrow `white/50`, body `white/70`, chip/button border `white/20–30`, hover fill `white/10`.

Light mode only.

---

## 4. Typography

Font: `ui-sans-serif, system-ui, sans-serif`. No webfont. Weight 400 everywhere. If a brand requires Inter, load 400 only and keep tracking tight; heavier weights break the tone.

| Role | Size | Color | Extra |
|---|---|---|---|
| Eyebrow / label | 13px | Muted | No uppercase, no tracking |
| Body / list / caption | 13px | Muted | `leading-relaxed` |
| Card title / wordmark | 15px | Ink | Wordmark `tracking-tight` |
| Lede | 15px | Muted | `leading-relaxed`, `max-w-xl` |
| H3 | `text-2xl` | Ink | `leading-tight tracking-tight` |
| H2 | `text-3xl` | Ink | `leading-tight tracking-tight`, `max-w-2xl` |
| H1 inner | `text-4xl` | Ink | same |
| H1 hero | `text-4xl md:text-5xl` | White | same, `max-w-3xl` |
| Number prefix | 13px | Faint | `01`, not a badge |

Rules: never `font-semibold`/`font-bold`; never uppercase eyebrows; body measure `max-w-xl`/`max-w-2xl`, never full-bleed. Monospace only for data snippets, 13px, 400.

---

## 5. Layout

- Canvas: white, `min-h-screen flex flex-col`. Container `max-w-[1280px]`, `px-6 md:px-8`; hero `md:px-14`.
- Sections: `py-24` home, `py-20` inner. Bands alternate white → Wash (`border-y` Border) → white → BAND CTA.
- Grids: `gap-4`, `md:grid-cols-3` (2 for dense/compliance pages). Cards `h-full`.
- Nav: sticky `h-16`, `bg-white/80 backdrop-blur-xl`, bottom hairline. Wordmark left, 13px links Muted → Ink, active = Ink + 1px Accent underline growing from left. CTA is a ghost button. Mobile: hamburger, stacked links, no animation.
- Footer: top hairline, `py-12`, wordmark + one muted sentence (`max-w-xs`), two link columns, legal row in Faint under a hairline.

No sidebars, no feature dumps, no mega-menus.

---

## 6. Motion (Framer Motion)

Ease everywhere: `[0.16, 1, 0.3, 1]` (CSS `cubic-bezier(0.16, 1, 0.3, 1)`).

**Hero on mount**
```js
initial={{ opacity: 0, y: 20 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
```
Chips: parent `staggerChildren: 0.06, delayChildren: 0.3`; child `hidden: { opacity: 0, y: 8 }`. CTAs static.

**Reveal (every section below hero, every inner page block)**
```jsx
function Reveal({ children, delay = 0, className = "" }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
```
Card grids: `delay={i * 0.08}`. On route change scroll to top with `behavior: "instant"`.

**Hover (CSS only)**

| Element | Hover |
|---|---|
| Ghost button / chip | `transition-colors duration-200`, border + text brighten |
| Card | `transition-colors duration-300` → Wash |
| Rich card (solution/service) | Wash + `hover:-translate-y-1`, `transition-all duration-300` |
| Arrow link | `group-hover:translate-x-1 duration-200` |
| Input | border → Accent on focus, `duration-200` |

Respect `prefers-reduced-motion`. No bounce, spring, parallax, counters, slide-from-side, scale-in, or fade-only.

---

## 7. Components

**Card shell:** `rounded-xl border border-[#e6e6e6] bg-white p-6 h-full`.

- **Pillar / differentiator:** `01` Faint → title 15 Ink → optional Accent subline 13 → body 13 Muted. Hover wash (pillars stay still).
- **Rich card:** eyebrow 13 Muted → title 15 Ink → subtitle 13 Muted → "The challenge" (Faint dots) → "What you get" (Positive dots) → Accent arrow link pinned `mt-auto pt-6`. Dots `h-1 w-1 rounded-full mt-[7px]`.
- **Icon card:** same shell, 16px Lucide icon in Muted instead of number, 2-col grid.
- **Panel:** one wide card or header + body split by `border-t`. Included items use Positive `+`, not checkmarks.

**Buttons:** ghost only. `rounded-lg border border-[#e6e6e6] px-3 py-2 text-[13px] text-[#8a8a8a] hover:bg-[#fafafa] hover:text-[#1a1a1a]` (white/30 border on BAND). No filled or pill CTAs.

**Inputs:** same geometry, placeholder Faint, focus border Accent, no ring, `resize-none`.

**Hero / CTA band:** BAND, `relative overflow-hidden`, white type. Backdrop = two soft radial gradients + 48×48px white grid at `opacity: 0.07`:
```css
background-image:
  linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px),
  linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px);
background-size: 48px 48px;
opacity: 0.07;
```
Structure: eyebrow → H1 `mt-6` → lede `mt-6` → chips `mt-10 gap-2` → ghost CTAs `mt-12 gap-3`. Chip: `rounded-lg border border-white/20 px-3 py-1.5 text-[13px] text-white/70 hover:border-white/50 hover:text-white`. Grid texture never appears on white pages.

**Icons:** Lucide, 1.5px stroke, 16–20px, never filled, one family.
**Imagery:** editorial, candid, desaturated, warm matte. No stock handshakes, rocket ships, group shots, illustration.

---

## 8. Page recipes

**Home:** BAND hero (mount animation, chips) → white 3-card differentiators (`i * 0.08`) → Wash "how it works" (lede, 3 pillars, closing H3) → white 3 rich cards → BAND CTA (single Reveal).

**Inner page:**
```
max-w-[1280px] px-6 py-20 md:px-8
<Reveal> eyebrow 13 · h1 text-4xl · lede 15 max-w-xl </Reveal>
<grid> each card in <Reveal delay={i * 0.08}> </grid>
<Reveal delay={0.1}> supporting panel </Reveal>
```

---

## 9. Voice

Measured, precise, candid. Headlines are short declaratives, often ending in a period ("Data." / "Execution."). Eyebrows are plain-English labels. Use "you"; name specifics over superlatives.

Never: exclamation marks, hype vocabulary, emoji, urgency/scarcity, "We" opening a hero headline, empty mission-speak, AI-forward framing when the product is human.

---

## 10. Never

Bold or display webfonts · shadows, glow, colored cards · filled or pill buttons · gradients, glassmorphism, dark mode · uppercase tracked eyebrows · second accent · competitor feature tables · testimonial carousels with circle headshots · simulated-software demos · any motion besides the rise-and-fade.
