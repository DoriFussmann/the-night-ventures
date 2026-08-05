export const NEEDS_INPUT_MARKER = "[NEEDS INPUT — not provided]";

function filled(value) {
  return String(value ?? "").trim();
}

function valueOrNeeds(value) {
  return filled(value) || NEEDS_INPUT_MARKER;
}

function formatServices(services) {
  const rows = Array.isArray(services) ? services : [];
  const usable = rows.filter(
    (s) => filled(s?.title) || filled(s?.summary) || filled(s?.detail)
  );
  if (usable.length === 0) {
    return "(None added in Company Data yet — skip inventing services this run.)";
  }

  return usable
    .map((s, i) => {
      const lines = [
        `${i + 1}. Title: ${valueOrNeeds(s.title)}`,
        `   Summary: ${valueOrNeeds(s.summary)}`,
      ];
      if (filled(s.detail)) {
        lines.push(`   Detail: ${filled(s.detail)}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function formatTeamBios(teamBios) {
  const rows = Array.isArray(teamBios) ? teamBios : [];
  const usable = rows.filter(
    (t) =>
      filled(t?.name) ||
      filled(t?.role) ||
      filled(t?.bio) ||
      filled(t?.credentials) ||
      (Array.isArray(t?.same_as) && t.same_as.some((u) => filled(u)))
  );
  if (usable.length === 0) {
    return "(None added in Company Data yet — skip inventing team bios this run.)";
  }

  return usable
    .map((t, i) => {
      const lines = [
        `${i + 1}. Name: ${valueOrNeeds(t.name)}`,
        `   Role: ${valueOrNeeds(t.role)}`,
        `   Bio: ${valueOrNeeds(t.bio)}`,
      ];
      if (filled(t.credentials)) {
        lines.push(`   Credentials: ${filled(t.credentials)}`);
      }
      const sameAs = (Array.isArray(t.same_as) ? t.same_as : [])
        .map((u) => filled(u))
        .filter(Boolean);
      if (sameAs.length > 0) {
        lines.push(`   sameAs: ${sameAs.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

function formatContentDecisions(decisions) {
  const rows = (Array.isArray(decisions) ? decisions : []).filter(
    (d) => !d?.kind || d.kind === "content"
  );
  if (rows.length === 0) {
    return "(None — no content-file findings in Highest severity.)";
  }

  return rows
    .map((d, i) => {
      const label = valueOrNeeds(d.label);
      const action = filled(d.action);
      if (!action) {
        return `${i + 1}. ${label} → ${NEEDS_INPUT_MARKER}`;
      }
      if (action === "draft") {
        return `${i + 1}. ${label} → draft it (set draft: true; do not delete)`;
      }
      if (action === "delete") {
        return `${i + 1}. ${label} → delete it`;
      }
      if (action === "rewrite") {
        const summary = valueOrNeeds(d.rewriteSummary);
        return `${i + 1}. ${label} → rewrite it\n   Replacement summary: ${summary}`;
      }
      return `${i + 1}. ${label} → ${NEEDS_INPUT_MARKER}`;
    })
    .join("\n");
}

function formatConfigUpdates(decisions) {
  const rows = (Array.isArray(decisions) ? decisions : []).filter(
    (d) => d?.kind === "config"
  );
  if (rows.length === 0) {
    return "(None — no config-field findings in Highest severity.)";
  }

  return rows
    .map((d, i) => {
      const label = valueOrNeeds(d.label);
      const value = filled(d.setToValue);
      if (!value) {
        if (d.companyDataUnset) {
          return `${i + 1}. ${label} → skip this run (not set in Company Data)`;
        }
        return `${i + 1}. ${label} → set to: ${NEEDS_INPUT_MARKER}`;
      }
      if (value.toLowerCase() === "skip this run") {
        return `${i + 1}. ${label} → skip this run`;
      }
      return `${i + 1}. ${label} → set to: ${value}`;
    })
    .join("\n");
}

function formatDeferredSurfaces(decisions) {
  const rows = (Array.isArray(decisions) ? decisions : []).filter(
    (d) => d?.kind === "missing"
  );
  if (rows.length === 0) {
    return "(None — no missing-surface findings in Highest severity.)";
  }

  return rows
    .map((d, i) => {
      const label = valueOrNeeds(d.label);
      if (d.defer) {
        return `${i + 1}. ${label} → defer to Full Site Content Build stage (do not invent this run)`;
      }
      return `${i + 1}. ${label} → ${NEEDS_INPUT_MARKER}`;
    })
    .join("\n");
}

function formatNewContent(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter((e) =>
    [
      e?.title,
      e?.description,
      e?.author,
      e?.category,
      e?.tags,
      e?.body,
      e?.heroImage,
    ].some((v) => filled(v))
  );

  if (rows.length === 0) {
    return "(None for this run — skip adding new content.)";
  }

  return rows
    .map((e, i) => {
      return [
        `${i + 1}. Title: ${valueOrNeeds(e.title)}`,
        `   Description: ${valueOrNeeds(e.description)}`,
        `   Author: ${valueOrNeeds(e.author)}`,
        `   Category: ${valueOrNeeds(e.category)}`,
        `   Tags: ${valueOrNeeds(e.tags)}`,
        `   Hero image: ${valueOrNeeds(e.heroImage)}`,
        `   Body:`,
        valueOrNeeds(e.body),
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * Phase 2 fill-prompt template. Substitutes every auto-filled and manually-filled
 * value. Empty required spots become NEEDS_INPUT_MARKER — never raw placeholders.
 */
export function buildPhase2Prompt({
  businessName,
  domain,
  oneLinePositioning,
  homepageHero,
  llmsDescription,
  services,
  teamBios,
  contentDecisions,
  newContent,
  auditReport,
} = {}) {
  const name = valueOrNeeds(businessName);
  const siteDomain = valueOrNeeds(domain);
  const positioning = valueOrNeeds(oneLinePositioning);
  const hero = valueOrNeeds(homepageHero);
  const llms = valueOrNeeds(llmsDescription);
  const audit = valueOrNeeds(auditReport);

  return `Replace remaining template placeholder content in this repo with real ${name} content (${siteDomain}). Do not change build/infra/sitemap code unless a content decision below explicitly requires a rename.

Identity to apply:
- Business name: ${name}
- Domain: ${siteDomain}
- One-line positioning: ${positioning}
- Homepage hero paragraph: ${hero}
- LLMS.txt description: ${llms}

Use the pasted audit report as the source of truth for what still needs replacing:

--- AUDIT REPORT ---
${audit}
--- END AUDIT REPORT ---

1. HOMEPAGE
   - Set meta description / hero copy from the homepage hero paragraph above.
   - Replace any remaining template instruction text with real ${name} positioning (${positioning}).

2. SERVICES / PRODUCTS
   Replace placeholder service entries with:
${formatServices(services)}

3. TEAM / AUTHOR BIOS
   Ensure team/author content matches:
${formatTeamBios(teamBios)}

4. PUBLISHED DEMO / TEMPLATE CONTENT DECISIONS
   For each highest-severity content-file item from the audit, apply the decision below:
${formatContentDecisions(contentDecisions)}

5. CONFIG UPDATES
   For each config-field finding (site.ts / env / identity config — not a content file), set the value as specified. Do not treat these as draft/delete/rewrite content decisions:
${formatConfigUpdates(contentDecisions)}

6. DEFERRED TO FULL SITE CONTENT BUILD
   The following missing surfaces are deferred. Do not invent or scaffold them in this run:
${formatDeferredSurfaces(contentDecisions)}

7. LLMS.TXT
   Update public/llms.txt and any generators so the site description is:
   "${llms}"
   Remove leftover template-topic language that does not match ${name}.

8. NEW CONTENT TO ADD THIS RUN
${formatNewContent(newContent)}

9. VERIFICATION
   Run a clean build. Grep for common template leftovers. Report: final homepage copy, services/products entries, team bios touched, each highest-severity content decision applied, each config update applied, deferred missing surfaces left untouched, and any spots still marked as needing input that blocked a change.
`;
}

export function countNeedsInputMarkers(text) {
  const matches = String(text || "").match(/\[NEEDS INPUT — not provided\]/g);
  return matches ? matches.length : 0;
}
