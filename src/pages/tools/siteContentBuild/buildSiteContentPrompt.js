function filled(value) {
  return String(value ?? "").trim();
}

function valueOrFallback(value, fallback) {
  return filled(value) || fallback;
}

function formatServices(services) {
  const rows = Array.isArray(services) ? services : [];
  const usable = rows.filter(
    (s) => filled(s?.title) || filled(s?.summary) || filled(s?.detail)
  );
  if (usable.length === 0) {
    return "(None added in Company Data yet — do not invent services.)";
  }

  return usable
    .map((s, i) => {
      const lines = [
        `${i + 1}. Title: ${valueOrFallback(s.title, "(untitled)")}`,
        `   Summary: ${valueOrFallback(s.summary, "(none)")}`,
      ];
      if (filled(s.detail)) {
        lines.push(`   Detail: ${filled(s.detail)}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function formatTeamMembers(teamMembers) {
  const rows = Array.isArray(teamMembers) ? teamMembers : [];
  const usable = rows.filter(
    (t) =>
      filled(t?.name) ||
      filled(t?.role) ||
      filled(t?.bio) ||
      filled(t?.credentials) ||
      (Array.isArray(t?.same_as) && t.same_as.some((u) => filled(u)))
  );
  if (usable.length === 0) {
    return "(None added in Company Data yet — do not invent team members.)";
  }

  return usable
    .map((t, i) => {
      const lines = [
        `${i + 1}. Name: ${valueOrFallback(t.name, "(unnamed)")}`,
        `   Role: ${valueOrFallback(t.role, "(none)")}`,
        `   Bio: ${valueOrFallback(t.bio, "(none)")}`,
      ];
      if (filled(t.credentials)) {
        lines.push(`   Credentials: ${filled(t.credentials)}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function checkedPageLabels(pages) {
  const labels = [];
  if (pages.about) labels.push("About (/about/)");
  if (pages.services) labels.push("Services (/services/)");
  if (pages.contact) labels.push("Contact (/contact/)");
  if (pages.faq) labels.push("FAQ (/faq/)");
  if (pages.testimonials) labels.push("Testimonials (/testimonials/)");
  if (pages.legal) labels.push("Privacy (/privacy/) and Terms (/terms/)");
  return labels.length > 0
    ? labels.join(", ")
    : "(no other pages selected this run — link CTAs to existing routes that already make sense, e.g. Contact or Team)";
}

function buildHomepageSpec({ pages, faqContent }) {
  const ctaTargets = checkedPageLabels(pages);
  const faqSeed = filled(faqContent);

  const testimonialsBlock = pages.testimonials
    ? `5. TESTIMONIALS: A rotating/carousel structure with quote cards, star ratings, and avatar placeholders — but every quote must be exactly '[PLACEHOLDER: Real client testimonial needed here — do not publish with fabricated content]', every name '[PLACEHOLDER: Client name]', never invented text that reads as a real quote. Add a visible HTML comment directly above this section: '<!-- TESTIMONIALS: placeholder content — populate with real quotes or remove this section before launch -->' so it's unmistakable in the source that this section needs attention before going live.`
    : `5. TESTIMONIALS: SKIP this section entirely — Testimonials was not selected in the page checklist for this run.`;

  const faqBlock = faqSeed
    ? `6. FAQ: Left column: a 'Have Questions?' heading with brief supporting text and a Contact link/button. Right column: collapsible accordion panels, collapsed by default, each with the question visible and the answer revealed on expand. Use the following real FAQ content — do not invent additional questions:\n\n${faqSeed}`
    : `6. FAQ: Left column: a 'Have Questions?' heading with brief supporting text and a Contact link/button. Right column: collapsible accordion panels, collapsed by default, each with the question visible and the answer revealed on expand. No real FAQ content was provided — use structural placeholder questions clearly marked as needing real content (e.g. '[PLACEHOLDER: Real FAQ question needed]') — never invent real-sounding Q&A content.`;

  return `HOMEPAGE: Rebuild the homepage with this exact section structure, in this order. Reuse existing layout components from the audit where they fit; only introduce new components where nothing reusable exists.

1. HERO: Two-column layout — text left, image right. Left: headline + subheadline drawn from company positioning, plus 1-2 buttons at the bottom linking to the most relevant pages being built this run (choose from: ${ctaTargets}). Right: an image placeholder; if 2-3 distinct images would genuinely showcase the product/service, make it a simple rotating/cycling image placeholder rather than one static image — clearly label each placeholder with what it should show.
2. TRUST SECTION (conditional): Only include if Company Data contains real partner names, press mentions, or credible stats to show. If so: a 'Trusted by' heading with a logo strip or stat line. If no real trust signals exist in Company Data, SKIP this section entirely — do not fabricate logos, press mentions, or client names.
3. ALTERNATING SECTIONS (3 to 5, choose count and topics based on what Company Data actually supports — e.g. positioning, services, differentiators, process): Each section alternates image side (odd sections: text left/image right; even sections: image left/text right, or vice versa — alternate consistently). Each section: a title, a short paragraph grounded in real Company Data, an image placeholder with a specific description of what it should depict, and 2-3 small highlight cards/boxes beneath the paragraph, each with a short label and one-line summary point.
4. WORK WITH US / PRICING / OFFERING SECTION: Present the company's services/products (from the services collection) as distinct option cards — title, summary, and a CTA per card (e.g. Contact, Learn More). If the company has a single offering, present it as one clear featured card rather than forcing multiple options.
${testimonialsBlock}
${faqBlock}
7. FOOTER: Confirm links to Privacy Policy, Terms of Service, and other standard pages being built this run are present, alongside existing footer content — don't duplicate or restructure footer sections that already work.

Ground every piece of real copy (not placeholder-marked content) in the COMPANY CONTEXT data below — do not write generic marketing copy. Be specific to this company's actual positioning, not generic SaaS/business language.`;
}

function buildPageSections({ pages, faqContent }) {
  const sections = [];

  if (pages.homepage) {
    sections.push(buildHomepageSpec({ pages, faqContent }));
  }

  if (pages.about) {
    sections.push(
      `ABOUT PAGE (/about/): Build /about/ with this structure: a hero-style intro section (headline + short positioning paragraph), a 'Story' or 'Why We Exist' section grounded in company data, a philosophy/approach section (how the service works at a conceptual level, distinct from the Services page's mechanics), and a founder/team section linking to the existing Team page. Add to primary navigation.`
    );
  }

  if (pages.services) {
    sections.push(
      `SERVICES PAGE (/services/): Create a real route consuming the existing services content collection (currently unused — collection exists at src/content/services/). Render each service entry (title, summary, detail). Un-draft the existing service entry as part of this (set draft: false) since it will now have a page to live on. Add to primary navigation.`
    );
  }

  if (pages.contact) {
    sections.push(
      `CONTACT PAGE (/contact/): Build a contact page using the contact email from site config. If a contact form is feasible without a backend service, note that a static form needs a form-handling service (e.g. Formspree, Netlify Forms) and flag this as a decision point rather than guessing one — otherwise default to a simple mailto: contact display. Add to primary navigation.`
    );
  }

  // Standalone FAQ route only when real Q&As were provided (homepage already has an FAQ section).
  if (pages.faq && filled(faqContent)) {
    sections.push(
      `FAQ PAGE (/faq/): Build a dedicated FAQ page (distinct from the homepage FAQ section) using the following real Q&As provided by the user. Do not invent additional questions.\n\n${filled(faqContent)}`
    );
  }

  if (pages.testimonials) {
    sections.push(
      `TESTIMONIALS PAGE (/testimonials/): Build the page structure only, with clearly marked placeholder blocks (e.g. '[PLACEHOLDER: Real client testimonial needed here — do not publish with fabricated content]') for each testimonial slot. Do not generate any placeholder text that reads as a real quote. Add a visible HTML comment directly above the testimonials section: '<!-- TESTIMONIALS: placeholder content — populate with real quotes or remove this section before launch -->' so it's unmistakable in the source that this page needs attention before going live.`
    );
  }

  if (pages.legal) {
    sections.push(
      `LEGAL PAGES (/privacy/, /terms/): Scaffold page structure and routing only, with placeholder text: '[PLACEHOLDER: Replace with real Privacy Policy from legal counsel or a template service]'. Do not generate actual legal/policy language.`
    );
  }

  return sections.join("\n\n");
}

/**
 * Assemble the Stage 6 Site Content Build Cursor prompt from Company Data,
 * the pasted structure audit, and the user's page-selection checklist.
 */
export function buildSiteContentPrompt({
  productName,
  domain,
  shortDescription,
  mediumDescription,
  services,
  teamMembers,
  designGuideAbstract,
  pages,
  faqContent,
  auditReport,
}) {
  const designDirection = filled(designGuideAbstract)
    ? filled(designGuideAbstract)
    : "(No Design Guidelines abstract set in Company Data — match whatever visual system is already in the repo; do not invent a new brand system.)";

  const pageSections = buildPageSections({ pages, faqContent });
  const audit = filled(auditReport) || "(No audit report pasted — inspect the repo before building and reuse existing components where they fit.)";

  return `Build out the following pages for this Astro site, using the real company data, design direction, and structure audit below. This runs after infra, design system, and identity personalization are already complete — do not touch build config, content schemas, CMS logic, or already-published articles.

COMPANY CONTEXT:
- Name: ${valueOrFallback(productName, "(not set)")}
- Domain: ${valueOrFallback(domain, "(not set)")}
- Positioning: ${valueOrFallback(shortDescription, "(not set)")}
- Full description: ${valueOrFallback(mediumDescription, "(not set)")}
- Services:
${formatServices(services)}
- Team: (these already exist as team collection entries — link to them rather than duplicating)
${formatTeamMembers(teamMembers)}

DESIGN DIRECTION: Follow Design Guide.md and this brand abstract: ${designDirection}. Match the visual system already implemented in the design pass — do not introduce new colors, fonts, or component patterns not already established.

STRUCTURE AUDIT (from a prior read-only pass — use this as ground truth for what already exists; reuse listed components; do not reinvent patterns the audit already covers):
${audit}

IMAGES: This run does NOT generate real images. For every image placement needed on these pages, insert a clearly labeled placeholder (a simple styled div or an Astro Image with a placeholder asset) containing visible text describing exactly what should go there — e.g. '[PLACEHOLDER: Team photo of Dori Fussmann, professional headshot]' or '[PLACEHOLDER: Hero image conveying founder-investor connection/trust]'. The user will manually source and replace every placeholder image after this run — make the replacement instructions specific enough that a non-designer knows exactly what to source.

PAGES TO BUILD:

${pageSections}

SITE-WIDE WIRING:
- Add all newly built pages to primary navigation (Header.astro) and footer, following the existing nav pattern.
- Confirm all new pages have proper title/meta description per the existing BaseLayout pattern.
- Confirm new pages appear correctly in the sitemap (should be automatic via existing @astrojs/sitemap config — verify, don't reconfigure).
- Internal-link new pages naturally where relevant (e.g. homepage services teaser links to /services/, About links to /team/).

VERIFICATION: Run a clean build. Confirm every new route renders. Confirm nav/footer links work. Report every image placeholder inserted with its exact replacement instruction text, listed in one place so the user has a checklist of what to source.`;
}
