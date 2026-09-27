/** ChatGPT prompt: write every page from company-data.md. No design direction. */

export const CHATGPT_SITE_CONTENT_PROMPT = `You are writing the complete content for a company website. company-data.md is attached — it is the only source of facts. Do not invent services, team members, clients, numbers, awards, prices or claims.

You write content only. Do not describe design, colors, fonts, layout or mood. The website template already has a fixed set of section types (below). You pick them according to the page recipes and fill their fields.

PAGES — write all of them, in this order:
home, about, services, contact, faq, testimonials, privacy, terms
Plus one SERVICE DETAIL for each service in company-data.md.
Do not write Articles or Team pages — they already exist and are generated automatically. Link to them where natural.
Valid internal links only: /, /about/, /services/, /services/<service-slug>/, /contact/, /faq/, /testimonials/, /privacy/, /terms/, /articles/, /team/

SECTION TYPES — use only these, with exactly these fields (? = optional):
- hero: eyebrow, h1, sub, cta_primary {label, href}, cta_secondary {label, href}, slides [4] {image, alt}
- page-header: eyebrow?, h1, intro
- trust: heading, items [] {label}
- feature-split: eyebrow?, heading, body, highlights [2–3] {title, text}, image, alt
- feature-grid: eyebrow?, heading, intro?, items [3–6] {title, text}
- stats: heading?, items [3–4] {value, label}
- process: eyebrow?, heading, intro?, steps [3–6] {title, text}
- offerings: eyebrow?, heading, intro?, source: "services"
- testimonials: heading, items [] {quote, name, role}
- faq: eyebrow?, heading, intro?, cta? {label, href}, items [] {q, a}
- cta-band: heading, sub?, cta_primary {label, href}, cta_secondary? {label, href}
- rich-text: heading?, body (markdown)
- contact: heading, body, email, response_note?
- team-teaser: heading, intro?
- articles-teaser: heading, intro?

PAGE RECIPES — sections in this order. "if real" = only when company-data.md supports it; otherwise omit the section.
- home: hero → trust (if real) → feature-split ×3–5 → offerings → process (if real) → testimonials → faq (6–8 Q&As) → articles-teaser → cta-band
- about: page-header → rich-text (story / why we exist) → feature-split ×2 (approach; what makes it different) → stats (if real) → team-teaser → cta-band
- services: page-header → rich-text (overview) → offerings → process → faq (4–6) → cta-band
- contact: page-header → contact → faq (3–4 practical: response time, what to include, what happens next)
- faq: page-header → faq (12–16)
- testimonials: page-header → testimonials (6 items) → cta-band
- privacy: page-header → rich-text
- terms: page-header → rich-text

HERO (home): h1 = the core promise in 10 words or fewer. sub = 1–2 sentences: who it is for and the outcome. cta_primary → /contact/ (or the most relevant conversion page). cta_secondary → /services/ or /about/.
slides: exactly 4. Each image is a brief for an image generator, 30–60 words: subject, setting, action, composition, framing for a 4:5 vertical crop, lighting, mood. Describe content only — no colors, filters or art direction (the design system adds those). Never text, logos or UI screenshots in the image. alt: 15 words or fewer.
Every feature-split image follows the same rules.

DEPTH — no thin pages. Minimum visible words per page (excluding meta fields, image briefs and placeholders):
home 900 · about 700 · services 500 · each service detail 600 · contact 150 · faq page 12+ Q&As · privacy 900 · terms 900
FAQ answers 40–90 words each. feature-split body 60–120 words. Card, step and highlight texts 20–45 words.
Depth comes from specifics in company-data.md: who it is for, the problem, how it works, what is included, outcomes, objections, proof. If the data cannot reach a minimum without inventing, stop short and insert a line "[GAP: what information is missing]" at that spot. Never pad with generic filler, repetition or buzzwords.

VOICE: plain, specific, confident. Short sentences. No hype, no clichés ("unlock", "elevate", "seamless", "cutting-edge", "in today's fast-paced world"), no emoji, no exclamation marks.

GUARDRAILS
- testimonials: every quote "[PLACEHOLDER: real client testimonial]", name "[PLACEHOLDER: client name]", role "[PLACEHOLDER: role, company]". Never write anything that reads like a real quote.
- trust and stats: real names and numbers from company-data.md only; otherwise omit the section.
- privacy: a complete standard draft tailored to the business: what data is collected (contact forms, analytics, cookies), why, third-party processors, retention, user rights, how to contact. terms: use of the site, intellectual property, disclaimers, limitation of liability, governing law as "[PLACEHOLDER: jurisdiction]". The first line of each body is "**Draft — review with legal counsel before publishing.**" Use the company name and contact email from company-data.md.
- One H1 per page: only hero.h1 or page-header.h1. Markdown bodies use ## and ### only, never #.
- meta_title 50–60 characters. meta_description 140–160 characters. Each page targets one clear search intent.

OUTPUT FORMAT — exactly this, nothing before or after.

For each page:
=== PAGE: <id> ===
\`\`\`yaml
route: "/"
meta_title: "..."
meta_description: "..."
sections:
  - type: "hero"
    eyebrow: "..."
    h1: "..."
    sub: "..."
    cta_primary:
      label: "..."
      href: "/contact/"
    slides:
      - image: "..."
        alt: "..."
  - type: "rich-text"
    body: |
      ## ...
      ...
\`\`\`
Page ids and routes: home "/", about "/about/", services "/services/", contact "/contact/", faq "/faq/", testimonials "/testimonials/", privacy "/privacy/", terms "/terms/".

For each service (slug = kebab-case of its title):
=== SERVICE: <slug> ===
\`\`\`markdown
---
title: "..."
description: "... (140–160 characters)"
order: 1
icon: "<one lowercase word, e.g. layers>"
---
<body: markdown, ## and ### only, 600+ words>
\`\`\`

Then:
=== QA ===
1. A table: page | words | minimum | met?
2. Every [GAP] line (page → section → text).
3. Every [PLACEHOLDER] (page → section → text).
4. Every image brief (page → section → slide/image → brief) — this is the owner's image sourcing checklist.

YAML rules: 2-space indent. Double-quote every string value. Use | block scalars for markdown bodies. Field names and section types exactly as listed. No extra fields.`;
