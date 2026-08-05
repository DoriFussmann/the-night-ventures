/**
 * Classify a Highest-severity audit label for the Personalize Prompt UI.
 * - config: site.ts / env / identity config fields (not content files)
 * - missing: surface that does not exist yet
 * - content: published/demo/template content needing draft/delete/rewrite
 * - alreadyResolved: finding fully covered elsewhere in the assembled prompt
 *   (section 1 homepage copy, section 7 llms.txt) — excluded from section 4
 */

import {
  formatSocialLinksForConfig,
  normalizeServices,
  normalizeTeamMembers,
} from "./customFieldKeys";

export const CONFIG_SKIP_VALUE = "skip this run";

/** Known identity config field names that may be merged into one audit line. */
export const KNOWN_CONFIG_FIELD_NAMES = [
  "SITE_NAME",
  "SITE_URL",
  "SAME_AS",
  "CONTACT_EMAIL",
  "OG_TITLE",
  "OG_DESCRIPTION",
  "OG_IMAGE",
  "OG_URL",
];

const KNOWN_CONFIG_FIELD_RE = new RegExp(
  `\\b(${KNOWN_CONFIG_FIELD_NAMES.join("|")})\\b`,
  "g"
);

export function classifySeverityItem(label) {
  const text = String(label || "").trim();
  if (!text) return "content";

  const lower = text.toLowerCase();

  // Explicit kind tags from audits
  if (/^\[config\]/i.test(text) || /\b\[config\]\b/i.test(text)) return "config";
  if (/^\[missing\]/i.test(text) || /\b\[missing\]\b/i.test(text)) return "missing";

  // Already fully specified elsewhere in the assembled prompt — skip section 4
  if (isAlreadyResolvedFinding(text)) return "alreadyResolved";

  if (/^\[content\]/i.test(text) || /\b\[content\]\b/i.test(text)) return "content";

  // Missing surfaces (no file / page / route / collection entry)
  if (
    /\bmissing\b/.test(lower) ||
    /\bdoes\s+not\s+exist\b/.test(lower) ||
    /\bnot\s+(?:found|present|created)\b/.test(lower) ||
    /\bno\s+(?:file|page|surface|route|entry|collection)\b/.test(lower) ||
    /\babsent\b/.test(lower) ||
    /\bnever\s+(?:added|created)\b/.test(lower)
  ) {
    return "missing";
  }

  // Config fields: site.ts, env vars, identity constants — not content files
  if (
    /\bsite\.ts\b/i.test(text) ||
    /\b\.env(?:\.\w+)?\b/i.test(text) ||
    /\benv(?:ironment)?\s*var(?:iable)?s?\b/i.test(lower) ||
    /\bprocess\.env\b/i.test(text) ||
    /\bimport\.meta\.env\b/i.test(text) ||
    /\bSITE_[A-Z0-9_]+\b/.test(text) ||
    /\bCONTACT_EMAIL\b/.test(text) ||
    /\bcontact[_\s-]?email\b/i.test(text) ||
    /\bSAME_AS\b/.test(text) ||
    /\bsocial[_\s-]?links?\b/i.test(text) ||
    /\bOG_(?:TITLE|DESCRIPTION|IMAGE|URL)\b/.test(text) ||
    /\bog[_\s-]?image\b/i.test(text) ||
    /\bsite[_\s-]?wide[_\s-]?description\b/i.test(text) ||
    (/\bconfig\b/i.test(lower) &&
      !/\b(content|article|service|team|page|mdx?)\b/i.test(lower))
  ) {
    return "config";
  }

  // Content-file cues (collections, markdown, published pages)
  if (
    /\.(mdx?|astro)\b/i.test(text) ||
    /\b(?:src\/)?content\//i.test(text) ||
    /\b(?:article|service|team|author|bio|page|homepage|footer|nav|404)\b/i.test(
      lower
    )
  ) {
    return "content";
  }

  // Default: treat as content decision (draft / delete / rewrite)
  return "content";
}

/** On-page hero/homepage copy — covered by section 1, not a content-collection file. */
export function isPageCopyFinding(label) {
  const text = String(label || "").trim();
  if (!text) return false;

  // Named content-collection paths are real content decisions
  if (/\bsrc\/content\//i.test(text)) return false;

  const lower = text.toLowerCase();

  if (/\bhomepage\s+hero\b/i.test(text)) return true;
  if (/\bhero\s*(?:copy|text|paragraph|section|intro)?\s*:/i.test(text)) return true;
  if (/\bhomepage\s*(?:copy|text|intro|tagline|instruction)\b/i.test(text)) {
    return true;
  }
  if (
    /\bhomepage\b/.test(lower) &&
    /\b(hero|intro|tagline|instruction\s+text|replace this)\b/.test(lower) &&
    !/\.(mdx?)\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

/** llms.txt / public site-description branding — covered by section 7. */
export function isLlmsTxtFinding(label) {
  const text = String(label || "").trim();
  if (!text) return false;

  // Named content-collection paths are real content decisions
  if (/\bsrc\/content\//i.test(text)) return false;

  const lower = text.toLowerCase();

  if (/\bllms\.txt\b/i.test(text)) return true;
  if (/\bpublic\/llms\.txt\b/i.test(text)) return true;
  if (
    /\bllms\b/.test(lower) &&
    /\b(description|branding|site\s+description|leftover|template[-\s]?topic)\b/.test(
      lower
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Findings whose resolution is already fully specified elsewhere in the
 * assembled prompt (section 1 homepage, section 7 llms.txt).
 */
export function isAlreadyResolvedFinding(label) {
  return isPageCopyFinding(label) || isLlmsTxtFinding(label);
}

/**
 * Split a merged [config] audit line that names multiple identity fields into
 * one label per field so each gets its own Config Updates row + auto-fill.
 * Non-config labels and single-field config lines are returned unchanged.
 */
export function expandSeverityLabels(label) {
  const text = String(label || "").trim();
  if (!text) return [];

  if (classifySeverityItem(text) !== "config") return [text];

  const matches = [...text.matchAll(KNOWN_CONFIG_FIELD_RE)];
  if (matches.length <= 1) return [text];

  const tagPrefixMatch = text.match(
    /^(?:\[(?:config|content|missing|demo-seed)\]\s*)+/i
  );
  const tagPrefix = tagPrefixMatch ? tagPrefixMatch[0].trim() : "[config]";

  const seen = new Set();
  const expanded = [];

  for (let i = 0; i < matches.length; i++) {
    const fieldName = matches[i][1];
    if (seen.has(fieldName)) continue;
    seen.add(fieldName);

    const start = matches[i].index;
    const end =
      i + 1 < matches.length ? matches[i + 1].index : text.length;
    let segment = text.slice(start, end).trim();
    // Trim trailing separators that belonged to the join between fields
    segment = segment.replace(/[,;|/]+$/g, "").trim();
    // Trim leading separators if a prior field left them
    segment = segment.replace(/^[,;|/]+\s*/g, "").trim();
    if (!segment) segment = fieldName;

    expanded.push(`${tagPrefix} ${segment}`.replace(/\s+/g, " ").trim());
  }

  return expanded.length > 0 ? expanded : [text];
}

export function formatSiteUrl(domain) {
  let value = String(domain || "").trim();
  if (!value) return "";
  value = value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!value) return "";
  return `https://${value}`;
}

export function isSiteUrlConfig(label) {
  return /\bSITE_URL\b/.test(String(label || ""));
}

export function isSiteNameConfig(label) {
  return /\bSITE_NAME\b/.test(String(label || ""));
}

export function isContactEmailConfig(label) {
  const text = String(label || "");
  return /\bCONTACT_EMAIL\b/.test(text) || /\bcontact[_\s-]?email\b/i.test(text);
}

export function isSocialLinksConfig(label) {
  const text = String(label || "");
  return /\bSAME_AS\b/.test(text) || /\bsocial[_\s-]?links?\b/i.test(text);
}

export function isSkipByDefaultConfig(label) {
  const text = String(label || "");
  return (
    /\bOG_IMAGE\b/.test(text) ||
    /\bog[_\s-]?image\b/i.test(text) ||
    /\bOG_DESCRIPTION\b/.test(text) ||
    /\bsite[_\s-]?wide[_\s-]?description\b/i.test(text)
  );
}

export function hasDemoSeedTag(label) {
  return /\[demo-seed\]/i.test(String(label || ""));
}

/**
 * Which scaffold seed role a [demo-seed] finding refers to.
 * - article: published demo article or draft-only test fixtures → default delete
 * - team / service: single seed entries → rewrite from Company Data, else draft
 */
export function classifyDemoSeedRole(label) {
  const text = String(label || "").toLowerCase();
  if (/\b(?:team|author|bio|member)\b/.test(text)) return "team";
  if (/\b(?:service|product)\b/.test(text)) return "service";
  return "article";
}

function formatServicesRewriteSummary(services) {
  const usable = normalizeServices(services).filter(
    (s) => s.title.trim() || s.summary.trim() || s.detail.trim()
  );
  if (usable.length === 0) return "";
  return usable
    .map((s) => {
      const head = [s.title.trim(), s.summary.trim()].filter(Boolean).join(" — ");
      if (s.detail.trim()) {
        return head ? `${head}. ${s.detail.trim()}` : s.detail.trim();
      }
      return head;
    })
    .filter(Boolean)
    .join("; ");
}

function formatTeamRewriteSummary(teamMembers) {
  const usable = normalizeTeamMembers(teamMembers).filter(
    (t) =>
      t.name.trim() ||
      t.role.trim() ||
      t.bio.trim() ||
      t.credentials.trim() ||
      (t.same_as || []).some((u) => u.trim())
  );
  if (usable.length === 0) return "";
  return usable
    .map((t) => {
      const nameRole = [t.name.trim(), t.role.trim()].filter(Boolean).join(" — ");
      const parts = [nameRole, t.bio.trim()].filter(Boolean);
      if (t.credentials.trim()) parts.push(`Credentials: ${t.credentials.trim()}`);
      return parts.join(". ");
    })
    .filter(Boolean)
    .join("; ");
}

function applyDemoSeedDefaults(decision, companyData = {}) {
  const role = classifyDemoSeedRole(decision.label);
  decision.demoSeed = true;
  decision.demoSeedRole = role;

  if (role === "article") {
    decision.action = "delete";
    decision.demoSeedDefault = "delete";
    return decision;
  }

  if (role === "service") {
    const summary = formatServicesRewriteSummary(companyData.services);
    if (summary) {
      decision.action = "rewrite";
      decision.rewriteSummary = summary;
      decision.demoSeedDefault = "rewrite";
    } else {
      decision.action = "draft";
      decision.demoSeedDefault = "draft";
    }
    return decision;
  }

  if (role === "team") {
    const summary = formatTeamRewriteSummary(companyData.teamMembers);
    if (summary) {
      decision.action = "rewrite";
      decision.rewriteSummary = summary;
      decision.demoSeedDefault = "rewrite";
    } else {
      decision.action = "draft";
      decision.demoSeedDefault = "draft";
    }
    return decision;
  }

  decision.action = "delete";
  decision.demoSeedDefault = "delete";
  return decision;
}

/**
 * Build a decision row for a Highest-severity label, applying company-data and
 * [demo-seed] defaults so Tab 2 does not re-ask the same scaffold leftovers.
 */
export function emptySeverityDecision(label, companyData = {}) {
  const kind = classifySeverityItem(label);
  const decision = {
    label,
    kind,
    action: "",
    rewriteSummary: "",
    setToValue: "",
    defer: false,
    companyDataUnset: false,
    demoSeed: false,
    demoSeedRole: "",
    demoSeedDefault: "",
  };

  if (kind === "alreadyResolved") return decision;

  if (kind === "content" && hasDemoSeedTag(label)) {
    return applyDemoSeedDefaults(decision, companyData);
  }

  if (kind !== "config") return decision;

  if (isSiteUrlConfig(label)) {
    const url = formatSiteUrl(companyData.domain);
    if (url) {
      decision.setToValue = url;
    } else {
      decision.companyDataUnset = true;
    }
    return decision;
  }

  if (isSiteNameConfig(label)) {
    const name = String(companyData.productName ?? "").trim();
    if (name) {
      decision.setToValue = name;
    } else {
      decision.companyDataUnset = true;
    }
    return decision;
  }

  if (isContactEmailConfig(label)) {
    const email = String(companyData.contactEmail ?? "").trim();
    if (email) {
      decision.setToValue = email;
    } else {
      decision.companyDataUnset = true;
    }
    return decision;
  }

  if (isSocialLinksConfig(label)) {
    const formatted = formatSocialLinksForConfig(companyData.socialLinks);
    if (formatted) {
      decision.setToValue = formatted;
    } else {
      decision.companyDataUnset = true;
    }
    return decision;
  }

  if (isSkipByDefaultConfig(label)) {
    decision.setToValue = CONFIG_SKIP_VALUE;
    return decision;
  }

  return decision;
}

export function demoSeedDefaultLabel(decision) {
  if (!decision?.demoSeed) return "";
  if (decision.demoSeedDefault === "delete") {
    return "Demo seed — default: delete.";
  }
  if (decision.demoSeedDefault === "rewrite") {
    return "Demo seed — default: rewrite from Company Data.";
  }
  if (decision.demoSeedDefault === "draft") {
    return "Demo seed — default: draft (no Company Data replacement yet).";
  }
  return "Demo seed — default applied.";
}
