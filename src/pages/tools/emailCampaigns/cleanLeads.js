// Pure lead-cleaning logic for AudienceLab-style CSV exports.
// Takes already-parsed row objects (keyed by the CSV headers) and returns a
// compact, campaign-ready lead list + stats. No I/O, so it is unit-testable.
//
// Deliberately DROPS sensitive/consumer fields (age, gender, children, married,
// homeowner, ethnicity, religion, language) and enrichment noise (skiptrace,
// phones, hashes, IP, home address). Those must never drive B2B outreach.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export const OUTPUT_FIELDS = [
  "uuid",
  "first_name",
  "last_name",
  "email",
  "email_type",
  "job_title",
  "headline",
  "company_name",
  "company_domain",
  "company_industry",
  "company_employee_count",
  "company_revenue",
  "company_state",
  "linkedin_url",
];

function firstEmail(...values) {
  for (const v of values) {
    const m = String(v || "").match(EMAIL_RE);
    if (m) return m[0].toLowerCase();
  }
  return "";
}

export function cleanLead(row) {
  const g = (k) => String(row[k] ?? "").trim();
  const bizEmail = firstEmail(g("BUSINESS_VERIFIED_EMAILS"), g("BUSINESS_EMAIL"));
  const persEmail = firstEmail(g("PERSONAL_VERIFIED_EMAILS"), g("PERSONAL_EMAILS"));
  const email = bizEmail || persEmail;
  const email_type = bizEmail ? "business" : persEmail ? "personal" : "";
  return {
    uuid: g("UUID"),
    first_name: g("FIRST_NAME"),
    last_name: g("LAST_NAME"),
    email,
    email_type,
    job_title: g("JOB_TITLE"),
    headline: g("HEADLINE"),
    company_name: g("COMPANY_NAME"),
    company_domain: g("COMPANY_DOMAIN"),
    company_industry: g("COMPANY_INDUSTRY"),
    company_employee_count: g("COMPANY_EMPLOYEE_COUNT"),
    company_revenue: g("COMPANY_REVENUE"),
    company_state: g("COMPANY_STATE"),
    linkedin_url: g("LINKEDIN_URL"),
  };
}

// rows: array of objects. Returns { leads, stats }.
// Drops rows with no usable email; de-dupes by email (case-insensitive).
// Personal-only leads (no business email) are dropped unless includePersonal.
export function cleanLeads(rows, { includePersonal = false } = {}) {
  const seen = new Set();
  const leads = [];
  let droppedNoEmail = 0;
  let droppedPersonal = 0;
  let duplicatesRemoved = 0;
  let business = 0;
  let personal = 0;

  for (const row of rows || []) {
    const c = cleanLead(row);
    if (!c.email) {
      droppedNoEmail += 1;
      continue;
    }
    if (c.email_type === "personal" && !includePersonal) {
      droppedPersonal += 1;
      continue;
    }
    if (seen.has(c.email)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(c.email);
    if (c.email_type === "business") business += 1;
    else personal += 1;
    leads.push(c);
  }

  return {
    leads,
    stats: {
      input: (rows || []).length,
      kept: leads.length,
      dropped_no_email: droppedNoEmail,
      dropped_personal: droppedPersonal,
      duplicates_removed: duplicatesRemoved,
      business,
      personal,
    },
  };
}
