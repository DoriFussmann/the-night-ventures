import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { DENSITY_PX, typeScale } from "@/lib/design/scale";

function aspectCss(value) {
  const match = String(value || "").match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  if (!match) return "4 / 5";
  return `${match[1]} / ${match[2]}`;
}

function motionEase(easing) {
  const raw = String(easing || "").trim();
  const match = raw.match(
    /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/
  );
  if (match) return match.slice(1).map(Number);
  if (raw === "ease-in") return "easeIn";
  if (raw === "ease-in-out") return "easeInOut";
  if (raw === "linear") return "linear";
  return "easeOut";
}

function slideDescriptions(imagery) {
  const direction = String(imagery?.direction || "").trim();
  const sentences = direction
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [
    sentences[0] || "Placeholder frame",
    sentences[1] || `Treatment: ${imagery?.treatment || "image"}`,
    sentences[2] || `Avoid: ${imagery?.avoid || "text baked into the image"}`,
  ];
}

function cssVars(tokens, viewport) {
  const sizes = typeScale(tokens.type);
  const density = DENSITY_PX[tokens.layout?.density] || DENSITY_PX.regular;
  const mobile = viewport === "mobile";
  const colors = tokens.colors;
  return {
    "--bg": colors.bg,
    "--surface": colors.surface,
    "--surface-alt": colors.surfaceAlt,
    "--fg": colors.fg,
    "--muted": colors.muted,
    "--border": colors.border,
    "--accent": colors.accent,
    "--accent-hover": colors.accentHover,
    "--accent-fg": colors.accentFg,
    "--highlight": colors.highlight,
    "--band": colors.band,
    "--band-fg": colors.bandFg,
    "--band-muted": colors.bandMuted,
    "--header-bg": colors.headerBg,
    "--header-fg": colors.headerFg,
    "--footer-bg": colors.footerBg,
    "--footer-fg": colors.footerFg,
    "--focus": colors.focus,
    "--body": sizes.body,
    "--lead": sizes.lead,
    "--h1": mobile ? sizes.h1Mobile : sizes.h1,
    "--h2": mobile ? sizes.h2Mobile : sizes.h2,
    "--h3": mobile ? sizes.h3Mobile : sizes.h3,
    "--section-y": `${mobile ? density.mobile : density.desktop}px`,
    "--radius": tokens.shape.radius,
    "--radius-lg": tokens.shape.radiusLg,
    "--image-radius": tokens.imagery.radius,
    "--container": tokens.layout.container,
    "--measure": tokens.layout.measure,
    "--heading-weight": tokens.type.headingWeight,
    "--body-weight": tokens.type.bodyWeight,
    "--heading-tracking": tokens.type.headingTracking,
    "--heading-leading": String(tokens.type.headingLeading),
    "--button-radius": tokens.shape.button === "pill" ? "999px" : tokens.shape.radius,
    "--aspect": aspectCss(tokens.imagery.aspect),
    "--image-filter": tokens.imagery.cssFilter || "none",
  };
}

const PREVIEW_CSS = `
.tnv-design-preview {
  font-family: Inter, sans-serif;
  font-weight: var(--body-weight);
  font-size: var(--body);
  line-height: 1.65;
  color: var(--fg);
  background: var(--bg);
  max-height: calc(100vh - 8rem);
  overflow: auto;
}
.tnv-design-preview * { box-sizing: border-box; }
.tnv-design-preview h1,
.tnv-design-preview h2,
.tnv-design-preview h3 {
  font-family: Inter, sans-serif;
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-tracking);
  line-height: var(--heading-leading);
  margin: 0;
}
.tnv-design-preview h1 { font-size: var(--h1); }
.tnv-design-preview h2 { font-size: var(--h2); }
.tnv-design-preview h3 { font-size: var(--h3); }
.tnv-design-preview p { margin: 0; }
.tnv-design-preview :focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.tnv-design-preview a { color: var(--accent); text-decoration: none; }
.tnv-design-preview a:hover { text-decoration: underline; }
.tnv-design-preview .wrap {
  width: min(100%, var(--container));
  margin: 0 auto;
  padding: 0 24px;
}
.tnv-design-preview .section { padding: var(--section-y) 0; position: relative; }
.tnv-design-preview .lead {
  font-size: var(--lead);
  max-width: var(--measure);
  color: var(--muted);
}
.tnv-design-preview .muted { color: var(--muted); }
.tnv-design-preview .site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 64px;
  padding: 12px 24px;
  background: var(--header-bg);
  color: var(--header-fg);
  z-index: 3;
}
.tnv-design-preview[data-header="solid"] .site-header {
  border-bottom: 1px solid var(--border);
}
.tnv-design-preview[data-header="blur"] .site-header {
  position: sticky;
  top: 0;
  background: color-mix(in srgb, var(--header-bg) 85%, transparent);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.tnv-design-preview[data-header="band"] .site-header { border-bottom: none; }
.tnv-design-preview .wordmark {
  font-size: 1.05rem;
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-tracking);
  color: var(--header-fg);
  text-decoration: none;
}
.tnv-design-preview .wordmark:hover { text-decoration: none; }
.tnv-design-preview .wordmark-accent { color: var(--accent); }
.tnv-design-preview .nav {
  display: flex;
  align-items: center;
  gap: 18px;
}
.tnv-design-preview .nav-link {
  color: var(--header-fg);
  font-size: 0.95rem;
  text-decoration: none;
}
.tnv-design-preview .nav-link:hover { text-decoration: underline; }
.tnv-design-preview .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--button-radius);
  border: 1px solid transparent;
  font: inherit;
  font-size: 0.95rem;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}
.tnv-design-preview .btn:hover { text-decoration: none; }
.tnv-design-preview .btn-primary {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.tnv-design-preview .btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: var(--accent-fg);
}
.tnv-design-preview[data-button="outline"] .btn-primary {
  background: transparent;
  color: var(--accent);
}
.tnv-design-preview[data-button="outline"] .btn-primary:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}
.tnv-design-preview .btn-secondary {
  background: transparent;
  color: var(--fg);
  border-color: var(--fg);
}
.tnv-design-preview .on-band .btn-secondary,
.tnv-design-preview[data-hero="band"] .hero .btn-secondary {
  color: var(--band-fg);
  border-color: var(--band-fg);
}
.tnv-design-preview .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
.tnv-design-preview .eyebrow { margin: 0 0 12px; }
.tnv-design-preview[data-eyebrow="uppercase"] .eyebrow {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--accent);
}
.tnv-design-preview[data-eyebrow="sentence"] .eyebrow {
  font-size: 0.95rem;
  letter-spacing: 0;
  color: var(--muted);
}
.tnv-design-preview[data-hero="band"] .eyebrow,
.tnv-design-preview .on-band .eyebrow {
  color: var(--highlight);
}
.tnv-design-preview[data-eyebrow="sentence"][data-hero="band"] .hero .eyebrow,
.tnv-design-preview[data-eyebrow="sentence"] .on-band .eyebrow {
  color: var(--band-muted);
}
.tnv-design-preview[data-rhythm="alternate"] .flow > .section:nth-child(odd) { background: var(--bg); }
.tnv-design-preview[data-rhythm="alternate"] .flow > .section:nth-child(even) { background: var(--surface-alt); }
.tnv-design-preview[data-rhythm="flat"] .flow > .section {
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.tnv-design-preview[data-rhythm="flat"] .flow > .section:first-child { border-top: none; }
.tnv-design-preview[data-rhythm="bands"] .flow > .section { background: var(--bg); }
.tnv-design-preview .hero { --hero-ink: var(--fg); }
.tnv-design-preview[data-hero="plain"] .hero,
.tnv-design-preview[data-hero="glow"] .hero,
.tnv-design-preview[data-hero="framed"] .hero {
  background: var(--bg);
  color: var(--fg);
}
.tnv-design-preview[data-hero="band"] .hero {
  background: var(--band);
  color: var(--band-fg);
  --hero-ink: var(--band-fg);
}
.tnv-design-preview[data-hero="band"] .hero .lead { color: var(--band-muted); }
.tnv-design-preview[data-hero="glow"] .hero {
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse at 18% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 55%),
    radial-gradient(ellipse at 80% 8%, color-mix(in srgb, var(--highlight) 14%, transparent), transparent 48%);
}
.tnv-design-preview .hero-grid,
.tnv-design-preview .feature-grid {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 40px;
  align-items: center;
}
.tnv-design-preview .card-grid,
.tnv-design-preview .stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.tnv-design-preview .texture {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.tnv-design-preview[data-texture="grid"] .hero .texture,
.tnv-design-preview[data-texture="grid"] .cta .texture {
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--hero-ink) 8%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--hero-ink) 8%, transparent) 1px, transparent 1px);
  background-size: 64px 64px;
  -webkit-mask-image: linear-gradient(to right, #000 20%, transparent 85%);
  mask-image: linear-gradient(to right, #000 20%, transparent 85%);
}
.tnv-design-preview[data-texture="dots"] .hero .texture,
.tnv-design-preview[data-texture="dots"] .cta .texture {
  background-image: radial-gradient(circle, color-mix(in srgb, var(--hero-ink) 12%, transparent) 1.5px, transparent 1.6px);
  background-size: 24px 24px;
}
.tnv-design-preview .frame { position: relative; }
.tnv-design-preview[data-hero="framed"] .frame {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-alt);
  padding: 12px;
}
.tnv-design-preview .carousel {
  position: relative;
}
.tnv-design-preview .slides {
  position: relative;
  aspect-ratio: var(--aspect);
}
.tnv-design-preview .slide {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  padding: 16px;
  overflow: hidden;
  border-radius: var(--image-radius);
  background:
    linear-gradient(160deg, color-mix(in srgb, var(--highlight) 28%, var(--surface)) 0%, var(--surface-alt) 42%, var(--bg) 100%);
  filter: var(--image-filter);
  color: var(--fg);
}
.tnv-design-preview .slide p { font-size: 0.85rem; line-height: 1.45; }
.tnv-design-preview .carousel-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.tnv-design-preview .icon-btn,
.tnv-design-preview .dot {
  min-width: 44px;
  min-height: 44px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}
.tnv-design-preview .dot[aria-current="true"] {
  background: var(--accent);
  color: var(--accent-fg);
  border-color: var(--accent);
}
.tnv-design-preview .card {
  border-radius: var(--radius);
  padding: 20px;
}
.tnv-design-preview[data-card="line"] .card {
  background: transparent;
  border: 1px solid var(--border);
}
.tnv-design-preview[data-card="filled"] .card {
  background: var(--surface-alt);
  border: none;
}
.tnv-design-preview[data-card="elevated"] .card {
  background: var(--surface);
  border: none;
  box-shadow:
    0 1px 2px color-mix(in srgb, var(--fg) 10%, transparent),
    0 8px 24px color-mix(in srgb, var(--fg) 12%, transparent);
}
.tnv-design-preview .highlights { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 10px; }
.tnv-design-preview .highlights li { display: flex; gap: 10px; align-items: flex-start; }
.tnv-design-preview .mark {
  width: 10px;
  height: 10px;
  margin-top: 0.45em;
  border-radius: 999px;
  background: var(--highlight);
  flex: none;
}
.tnv-design-preview .stat strong {
  display: block;
  font-size: var(--h2);
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-tracking);
  line-height: var(--heading-leading);
}
.tnv-design-preview .faq { display: grid; gap: 8px; }
.tnv-design-preview .faq-item {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
}
.tnv-design-preview .faq-item button {
  width: 100%;
  min-height: 44px;
  padding: 12px 16px;
  text-align: left;
  background: transparent;
  color: inherit;
  border: none;
  font: inherit;
  font-weight: var(--heading-weight);
  cursor: pointer;
}
.tnv-design-preview .faq-item p { padding: 0 16px 14px; color: var(--muted); }
.tnv-design-preview .cta {
  background: var(--band);
  color: var(--band-fg);
  --hero-ink: var(--band-fg);
}
.tnv-design-preview .cta .lead { color: var(--band-muted); }
.tnv-design-preview .on-band { background: var(--band); color: var(--band-fg); }
.tnv-design-preview .on-band .muted,
.tnv-design-preview .on-band .stat span { color: var(--band-muted); }
.tnv-design-preview .site-footer {
  background: var(--footer-bg);
  color: var(--footer-fg);
  padding: 28px 0;
}
.tnv-design-preview .site-footer .wrap {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}
.tnv-design-preview .site-footer nav { display: flex; gap: 16px; }
.tnv-design-preview[data-viewport="mobile"] .hero-grid,
.tnv-design-preview[data-viewport="mobile"] .feature-grid,
.tnv-design-preview[data-viewport="mobile"] .card-grid,
.tnv-design-preview[data-viewport="mobile"] .stats-grid {
  grid-template-columns: 1fr;
}
.tnv-design-preview[data-viewport="mobile"] .nav-links { display: none; }
.tnv-design-preview[data-viewport="mobile"] .site-footer .wrap { flex-direction: column; align-items: flex-start; }
`;

function Reveal({ id, index, shown, motionTokens, reduced, className, children }) {
  const style = reduced ? "none" : motionTokens.style;
  const hidden =
    style === "rise" ? { opacity: 0, y: 24 } : style === "fade" ? { opacity: 0, y: 0 } : { opacity: 1, y: 0 };
  const visible = shown || style === "none";
  return (
    <motion.div
      data-reveal-id={id}
      className={className}
      initial={false}
      animate={visible ? { opacity: 1, y: 0 } : hidden}
      transition={{
        duration: style === "none" ? 0 : motionTokens.duration / 1000,
        ease: motionEase(motionTokens.easing),
        delay: visible && style !== "none" ? (index * motionTokens.stagger) / 1000 : 0,
      }}
    >
      {children}
    </motion.div>
  );
}

function Carousel({ tokens, reduced }) {
  const slides = slideDescriptions(tokens.imagery);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(0);
  const count = slides.length;

  useEffect(() => {
    if (reduced || paused || held > 0) return undefined;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, tokens.motion.carouselInterval);
    return () => window.clearInterval(timer);
  }, [reduced, paused, held, count, tokens.motion.carouselInterval]);

  const hold = (event, delta) => {
    const next = event.relatedTarget;
    if (next && event.currentTarget.contains(next)) return;
    setHeld((value) => Math.max(0, value + delta));
  };

  const go = (next) => setIndex((next + count) % count);

  return (
    <div
      className="carousel"
      aria-roledescription="carousel"
      aria-label="Image placeholders"
      onMouseEnter={(event) => hold(event, 1)}
      onMouseLeave={(event) => hold(event, -1)}
      onFocus={(event) => hold(event, 1)}
      onBlur={(event) => hold(event, -1)}
    >
      <div className="frame">
        <div className="slides">
          {slides.map((text, slideIndex) => (
            <motion.div
              key={slideIndex}
              className="slide"
              aria-hidden={slideIndex !== index}
              initial={false}
              animate={{ opacity: slideIndex === index ? 1 : 0 }}
              transition={{
                duration: reduced ? 0 : Math.min(tokens.motion.duration, 700) / 1000,
                ease: motionEase(tokens.motion.easing),
              }}
            >
              <p>{text}</p>
            </motion.div>
          ))}
        </div>
      </div>
      <div className="carousel-controls">
        <button type="button" className="icon-btn" onClick={() => go(index - 1)} aria-label="Previous slide">
          Prev
        </button>
        {slides.map((text, slideIndex) => (
          <button
            key={slideIndex}
            type="button"
            className="dot"
            aria-label={`Show slide ${slideIndex + 1}`}
            aria-current={slideIndex === index ? "true" : undefined}
            onClick={() => setIndex(slideIndex)}
          >
            {slideIndex + 1}
          </button>
        ))}
        <button type="button" className="icon-btn" onClick={() => go(index + 1)} aria-label="Next slide">
          Next
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={paused || reduced}
          onClick={() => setPaused((value) => !value)}
        >
          {paused || reduced ? "Play" : "Pause"}
        </button>
      </div>
    </div>
  );
}

function FaqList() {
  const items = [
    {
      q: "How does this work?",
      a: "A short answer that stays in the body measure and uses the muted text color.",
    },
    {
      q: "What do you need from us?",
      a: "A second answer, collapsed until the row is opened.",
    },
  ];
  const [open, setOpen] = useState(0);
  return (
    <div className="faq">
      {items.map((item, itemIndex) => {
        const expanded = open === itemIndex;
        return (
          <div key={item.q} className="faq-item">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? -1 : itemIndex)}
            >
              {item.q}
            </button>
            {expanded ? <p>{item.a}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function PreviewFrame({ tokens, viewport }) {
  const rootRef = useRef(null);
  const [reduced, setReduced] = useState(false);
  const [revealed, setRevealed] = useState({});
  const bands = tokens.variants.rhythm === "bands";
  const primary = tokens.brand?.wordmarkPrimary || "";
  const accent = tokens.brand?.wordmarkAccent || "";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const nodes = [...root.querySelectorAll("[data-reveal-id]")];
    if (reduced || tokens.motion.style === "none") {
      const next = {};
      nodes.forEach((node) => {
        next[node.dataset.revealId] = true;
      });
      setRevealed(next);
      return undefined;
    }
    setRevealed({});
    const observer = new IntersectionObserver(
      (entries) => {
        setRevealed((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const id = entry.target.dataset.revealId;
            if (id && !next[id]) {
              next[id] = true;
              changed = true;
              observer.unobserve(entry.target);
            }
          }
          return changed ? next : prev;
        });
      },
      { root, threshold: 0.2 }
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [reduced, tokens.motion.style, tokens.template]);

  const show = (id) => Boolean(revealed[id]);

  return (
    <>
      <style>{PREVIEW_CSS}</style>
      <div
        ref={rootRef}
        className="tnv-design-preview"
        data-header={tokens.variants.header}
        data-hero={tokens.variants.hero}
        data-card={tokens.variants.card}
        data-rhythm={tokens.variants.rhythm}
        data-texture={tokens.variants.texture}
        data-button={tokens.shape.button}
        data-eyebrow={tokens.type.eyebrow}
        data-viewport={viewport}
        style={cssVars(tokens, viewport)}
      >
        <header className="site-header">
          <a className="wordmark" href="#top">
            {primary}
            {accent ? <span className="wordmark-accent"> {accent}</span> : null}
          </a>
          <nav className="nav" aria-label="Primary">
            <div className="nav nav-links">
              <a className="nav-link" href="#about">About</a>
              <a className="nav-link" href="#services">Services</a>
              <a className="nav-link" href="#articles">Articles</a>
              <a className="nav-link" href="#contact">Contact</a>
            </div>
            <a className="btn btn-primary" href="#contact">Get started</a>
          </nav>
        </header>

        <div className="flow">
          <section className="section hero" id="top">
            <div className="texture" aria-hidden="true" />
            <div className="wrap hero-grid">
              <Reveal id="hero-copy" index={0} shown={show("hero-copy")} motionTokens={tokens.motion} reduced={reduced}>
                <p className="eyebrow">{tokens.tagline}</p>
                <h1>{primary || "A clearer offer"}{accent ? ` ${accent}` : ""}</h1>
                <p className="lead" style={{ marginTop: 16 }}>
                  A split hero with one promise, a short supporting line, and two actions. The carousel on the right carries the imagery direction.
                </p>
                <div className="actions">
                  <a className="btn btn-primary" href="#contact">Get started</a>
                  <a className="btn btn-secondary" href="#services">Learn more</a>
                </div>
              </Reveal>
              <Reveal id="hero-media" index={1} shown={show("hero-media")} motionTokens={tokens.motion} reduced={reduced}>
                <Carousel tokens={tokens} reduced={reduced} />
              </Reveal>
            </div>
          </section>

          <section className="section" id="about">
            <div className="wrap feature-grid">
              <Reveal id="feature-copy" index={0} shown={show("feature-copy")} motionTokens={tokens.motion} reduced={reduced}>
                <p className="eyebrow">What you get</p>
                <h2>One clear way through the work</h2>
                <p className="lead" style={{ marginTop: 12 }}>
                  A feature split: the point on the left, three highlights on the right, using the highlight color as the marker.
                </p>
              </Reveal>
              <Reveal id="feature-list" index={1} shown={show("feature-list")} motionTokens={tokens.motion} reduced={reduced}>
                <ul className="highlights">
                  <li><span className="mark" aria-hidden="true" /><span>A single accent, used for actions and links.</span></li>
                  <li><span className="mark" aria-hidden="true" /><span>Type set only in Inter, at the template scale.</span></li>
                  <li><span className="mark" aria-hidden="true" /><span>Imagery that follows the direction and the avoid list.</span></li>
                </ul>
              </Reveal>
            </div>
          </section>

          <section className="section" id="services">
            <div className="wrap">
              <Reveal id="cards-title" index={0} shown={show("cards-title")} motionTokens={tokens.motion} reduced={reduced}>
                <h2>Services</h2>
              </Reveal>
              <div className="card-grid" style={{ marginTop: 24 }}>
                {["Plan", "Build", "Measure"].map((title, cardIndex) => (
                  <Reveal
                    key={title}
                    id={`card-${cardIndex}`}
                    index={cardIndex}
                    shown={show(`card-${cardIndex}`)}
                    motionTokens={tokens.motion}
                    reduced={reduced}
                    className="card"
                  >
                    <h3>{title}</h3>
                    <p className="muted" style={{ marginTop: 8 }}>
                      A short card in the {tokens.variants.card} variant, radius {tokens.shape.radius}.
                    </p>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          <section className={`section stats${bands ? " on-band" : ""}`}>
            <div className="wrap stats-grid">
              {[
                ["12", "Projects"],
                ["48h", "First draft"],
                ["3", "Regions"],
              ].map(([value, label], statIndex) => (
                <Reveal
                  key={label}
                  id={`stat-${statIndex}`}
                  index={statIndex}
                  shown={show(`stat-${statIndex}`)}
                  motionTokens={tokens.motion}
                  reduced={reduced}
                  className="stat"
                >
                  <strong>{value}</strong>
                  <span className="muted">{label}</span>
                </Reveal>
              ))}
            </div>
          </section>

          <section className="section">
            <div className="wrap" style={{ maxWidth: "var(--measure)" }}>
              <Reveal id="faq" index={0} shown={show("faq")} motionTokens={tokens.motion} reduced={reduced}>
                <h2>Questions</h2>
                <div style={{ marginTop: 20 }}>
                  <FaqList />
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section cta" id="contact">
            <div className="texture" aria-hidden="true" />
            <div className="wrap">
              <Reveal id="cta" index={0} shown={show("cta")} motionTokens={tokens.motion} reduced={reduced}>
                <p className="eyebrow">Next step</p>
                <h2>Ready when you are</h2>
                <p className="lead" style={{ marginTop: 12 }}>
                  The closing band uses the band colors and the same texture as the hero.
                </p>
                <div className="actions">
                  <a className="btn btn-primary" href="#contact">Get started</a>
                  <a className="btn btn-secondary" href="#about">Learn more</a>
                </div>
              </Reveal>
            </div>
          </section>
        </div>

        <footer className="site-footer">
          <div className="wrap">
            <span>
              {primary}
              {accent ? ` ${accent}` : ""}
            </span>
            <nav aria-label="Legal">
              <a href="#privacy">Privacy</a>
              <a href="#terms">Terms</a>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}

export default function DesignPreview({ tokens, viewport = "desktop" }) {
  if (!tokens) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        Pick a template to preview it.
      </div>
    );
  }

  return <PreviewFrame key={tokens.template} tokens={tokens} viewport={viewport} />;
}
