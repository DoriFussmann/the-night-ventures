// Checks the campaign copy's {{variables}} against a cleaned lead list, so a
// push never sends "Hi {{first_name}}," with a blank. Pure, unit-testable.

// SmartLead variable name → field on a cleaned lead. Keep in sync with
// mapLead() in lib/smartlead/handler.js.
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

export function sequenceSteps(sequences) {
  return Array.isArray(sequences)
    ? sequences
    : sequences?.data || sequences?.sequences || [];
}

// Every text block (subject + body, including A/B variants) in the sequence.
function copyBlocks(sequences) {
  const out = [];
  for (const step of sequenceSteps(sequences)) {
    out.push(step.subject, step.email_body);
    for (const v of step.sequence_variants || []) out.push(v.subject, v.email_body);
  }
  return out.filter(Boolean).map(String);
}

export function extractVariables(sequences) {
  const found = new Set();
  for (const text of copyBlocks(sequences)) {
    for (const m of text.matchAll(VAR_RE)) found.add(m[1].toLowerCase());
  }
  return [...found].sort();
}

// Returns one row per variable: how many leads would render it blank.
// `supported: false` means this lead source never provides that variable.
export function validateCopy(sequences, leads) {
  const vars = extractVariables(sequences);
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
export function leadsMissingVariables(sequences, leads) {
  const fields = extractVariables(sequences)
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

// SmartLead campaign lead → the cleaned-lead shape used everywhere else.
export function fromSmartleadLead(row) {
  const l = row?.lead || row || {};
  const cf = l.custom_fields || {};
  return {
    first_name: l.first_name || "",
    last_name: l.last_name || "",
    email: l.email || "",
    company_name: l.company_name || "",
    company_domain: l.company_url || l.website || "",
    linkedin_url: l.linkedin_profile || "",
    company_state: l.location || "",
    job_title: cf.job_title || "",
    headline: cf.headline || "",
    company_industry: cf.industry || "",
    company_employee_count: cf.company_size || "",
    company_revenue: cf.company_revenue || "",
  };
}
