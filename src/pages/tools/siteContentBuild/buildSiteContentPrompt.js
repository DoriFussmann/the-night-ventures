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

function buildPageSections({ pages, faqContent }) {
  const sections = [];

  if (pages.homepage) {
    sections.push(`HOMEPAGE REFINEMENT: Expand the existing homepage beyond the current hero + How It Works section. Add: a services teaser section (pull from the services collection), and a clear closing CTA section linking to Contact. Do NOT add a dedicated credibility/social-proof section on the homepage — founder credentials belong on the About and Team pages, not a manufactured homepage trust section, especially for single-founder or early-stage companies with no client testimonials yet. Keep the existing hero paragraph and How It Works steps as-is.`);
  }

  if (pages.about) {
    sections.push(`ABOUT PAGE (/about/): Write a real About page using the company positioning and founder background above. Structure: company story/why it exists, how the service works at a philosophy level (not a repeat of Services page mechanics), founder section linking to the team page. Add to primary navigation.`);
  }

  if (pages.services) {
    sections.push(`SERVICES PAGE (/services/): Create a real route consuming the existing services content collection (currently unused — collection exists at src/content/services/). Render each service entry (title, summary, detail). Un-draft the existing service entry as part of this (set draft: false) since it will now have a page to live on. Add to primary navigation.`);
  }

  if (pages.contact) {
    sections.push(`CONTACT PAGE (/contact/): Build a contact page using the contact email from site config. If a contact form is feasible without a backend service, note that a static form needs a form-handling service (e.g. Formspree, Netlify Forms) and flag this as a decision point rather than guessing one — otherwise default to a simple mailto: contact display. Add to primary navigation.`);
  }

  if (pages.faq) {
    const faqSeed = filled(faqContent);
    if (faqSeed) {
      sections.push(`FAQ PAGE (/faq/): Build an FAQ page using the following real Q&As provided by the user. Do not invent additional questions.\n\n${faqSeed}`);
    } else {
      sections.push(`FAQ PAGE (/faq/): Leave this as a structural placeholder page noting that real FAQ content is needed. Do not invent Q&As.`);
    }
  }

  if (pages.testimonials) {
    sections.push(`TESTIMONIALS PAGE (/testimonials/): Build the page structure only, with clearly marked placeholder blocks (e.g. '[PLACEHOLDER: Real client testimonial needed here — do not publish with fabricated content]') for each testimonial slot. Do not generate any placeholder text that reads as a real quote.`);
  }

  if (pages.legal) {
    sections.push(`LEGAL PAGES (/privacy/, /terms/): Scaffold page structure and routing only, with placeholder text: '[PLACEHOLDER: Replace with real Privacy Policy from legal counsel or a template service]'. Do not generate actual legal/policy language.`);
  }

  return sections.join("\n\n");
}

/**
 * Assemble the Stage 6 Site Content Build Cursor prompt from Company Data
 * and the user's page-selection checklist.
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
}) {
  const designDirection = filled(designGuideAbstract)
    ? filled(designGuideAbstract)
    : "(No Design Guidelines abstract set in Company Data — match whatever visual system is already in the repo; do not invent a new brand system.)";

  const pageSections = buildPageSections({ pages, faqContent });

  return `Build out the following pages for this Astro site, using the real company data and design direction below. This runs after infra, design system, and identity personalization are already complete — do not touch build config, content schemas, CMS logic, or already-published articles.

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
