// Tests for the AudienceLab lead cleaner.
// Run: node scripts/test-clean-leads.mjs
import assert from "node:assert/strict";
import {
  cleanLead,
  cleanLeads,
  toSmartleadLead,
  OUTPUT_FIELDS,
} from "../src/pages/tools/emailCampaigns/cleanLeads.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log("\u2713", name);
};

check("best-email waterfall: business verified wins", () => {
  const c = cleanLead({
    BUSINESS_VERIFIED_EMAILS: "biz@company.com",
    BUSINESS_EMAIL: "other@company.com",
    PERSONAL_VERIFIED_EMAILS: "me@gmail.com",
  });
  assert.equal(c.email, "biz@company.com");
  assert.equal(c.email_type, "business");
});

check("falls back to personal when no business email", () => {
  const c = cleanLead({ PERSONAL_VERIFIED_EMAILS: "me@gmail.com" });
  assert.equal(c.email, "me@gmail.com");
  assert.equal(c.email_type, "personal");
});

check("extracts first email from a multi-value field", () => {
  const c = cleanLead({ BUSINESS_EMAIL: "a@x.com, b@y.com; c@z.com" });
  assert.equal(c.email, "a@x.com");
});

check("output has no sensitive fields", () => {
  const c = cleanLead({
    FIRST_NAME: "A",
    BUSINESS_EMAIL: "a@x.com",
    GENDER: "M",
    ETHNIC_CODE: "X",
    RELIGION_CODE: "Y",
    AGE_RANGE: "40-50",
  });
  for (const k of Object.keys(c)) {
    assert.ok(OUTPUT_FIELDS.includes(k), `unexpected field ${k}`);
  }
  assert.ok(!("gender" in c) && !("ethnic_code" in c));
});

check("cleanLeads drops no-email rows and de-dupes by email", () => {
  const { leads, stats } = cleanLeads([
    { FIRST_NAME: "A", BUSINESS_EMAIL: "a@x.com" },
    { FIRST_NAME: "A2", BUSINESS_EMAIL: "A@X.com" }, // dup (case-insensitive)
    { FIRST_NAME: "B", PERSONAL_VERIFIED_EMAILS: "b@gmail.com" },
    { FIRST_NAME: "C" }, // no email
  ], { includePersonal: true });
  assert.equal(leads.length, 2);
  assert.equal(stats.input, 4);
  assert.equal(stats.kept, 2);
  assert.equal(stats.duplicates_removed, 1);
  assert.equal(stats.dropped_no_email, 1);
  assert.equal(stats.business, 1);
  assert.equal(stats.personal, 1);
});

check("personal-only leads are dropped by default", () => {
  const { leads, stats } = cleanLeads([
    { BUSINESS_EMAIL: "a@x.com" },
    { PERSONAL_VERIFIED_EMAILS: "b@gmail.com" },
  ]);
  assert.equal(leads.length, 1);
  assert.equal(stats.dropped_personal, 1);
  assert.equal(stats.personal, 0);
});

check("toSmartleadLead maps to SmartLead shape with custom_fields", () => {
  const c = cleanLead({
    FIRST_NAME: "A",
    LAST_NAME: "B",
    BUSINESS_EMAIL: "a@x.com",
    COMPANY_NAME: "Acme",
    COMPANY_DOMAIN: "acme.com",
    JOB_TITLE: "CEO",
    COMPANY_INDUSTRY: "SaaS",
  });
  const s = toSmartleadLead(c);
  assert.equal(s.email, "a@x.com");
  assert.equal(s.company_name, "Acme");
  assert.equal(s.company_url, "acme.com");
  assert.equal(s.custom_fields.job_title, "CEO");
  assert.equal(s.custom_fields.industry, "SaaS");
});

console.log(`\nAll ${passed} clean-leads assertions passed.`);
