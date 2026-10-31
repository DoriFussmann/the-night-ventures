// Checks the campaign copy's {{variables}} against a cleaned lead list, so a
// push never sends "Hi {{first_name}}," with a blank. Pure, unit-testable.

// Variable name in TNV copy → field on a cleaned lead. On sync to Instantly the
// core ones become camelCase ({{first_name}} → {{firstName}}) and the rest are
// custom variables. Keep in sync with lib/instantly/mapping.js.
export const VARIABLE_MAP = {
  first_name: "first_name",
  last_name: "last_name",
  email: "email",
  company_name: "company_name",
  company_url: "company_domain",
  website: "company_domain",
  linkedin_profile: "linkedin_url",
  location: "company_state",
  job_title: "job_title",
  headline: "headline",
  industry: "company_industry",
  company_size: "company_employee_count",
  company_revenue: "company_revenue",
};

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// copy = { subject, body } — the single-touch email.
function copyBlocks(copy) {
  return [copy?.subject, copy?.body].filter(Boolean).map(String);
}

export function extractVariables(copy) {
  const found = new Set();
  for (const text of copyBlocks(copy)) {
    for (const m of text.matchAll(VAR_RE)) found.add(m[1].toLowerCase());
  }
  return [...found].sort();
}

// Returns one row per variable: how many leads would render it blank.
// `supported: false` means this lead source never provides that variable.
export function validateCopy(copy, leads) {
  const vars = extractVariables(copy);
  const total = leads?.length || 0;
  const rows = vars.map((name) => {
    const field = VARIABLE_MAP[name];
    if (!field) return { name, field: null, supported: false, missing: total, total };
    const missing = (leads || []).filter((l) => !String(l[field] ?? "").trim()).length;
    return { name, field, supported: true, missing, total };
  });
  return {
    variables: rows,
    problems: rows.filter((r) => r.missing > 0),
    ok: rows.every((r) => r.missing === 0),
  };
}

// Leads missing any variable the copy uses.
export function leadsMissingVariables(copy, leads) {
  const fields = extractVariables(copy)
    .map((n) => VARIABLE_MAP[n])
    .filter(Boolean);
  return (leads || []).filter((l) => fields.some((f) => !String(l[f] ?? "").trim()));
}

// ---- Preview helpers -------------------------------------------------------

export const SAMPLE_LEAD = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@acme.com",
  job_title: "Head of Operations",
  headline: "Operations leader at Acme",
  company_name: "Acme Inc",
  company_domain: "acme.com",
  company_industry: "Software",
  company_employee_count: "51-200",
  company_revenue: "$10M-$50M",
  company_state: "California",
  linkedin_url: "linkedin.com/in/janedoe",
};

// Value a {{variable}} resolves to for this lead ("" when missing/unknown).
export function resolveVar(name, lead) {
  const field = VARIABLE_MAP[String(name).toLowerCase()];
  return field ? String(lead?.[field] ?? "").trim() : "";
}

// Plain-text merge (subjects). Missing values become "[name]".
export function renderText(text, lead) {
  return String(text || "").replace(VAR_RE, (_, name) => resolveVar(name, lead) || `[${name}]`);
}
