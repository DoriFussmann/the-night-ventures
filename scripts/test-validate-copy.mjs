// Run: node scripts/test-validate-copy.mjs
import assert from "node:assert/strict";
import {
  extractVariables,
  validateCopy,
  leadsMissingVariables,
} from "../src/pages/tools/emailCampaigns/validateCopy.js";

const seq = [
  { subject: "Quick q, {{first_name}}", email_body: "<p>Saw {{ company_name }} is in {{industry}}</p>" },
  {
    subject: "",
    email_body: "Following up",
    sequence_variants: [{ subject: "Hey", email_body: "{{Favorite_Color}} {{first_name}}" }],
  },
];

assert.deepEqual(extractVariables(seq), ["company_name", "favorite_color", "first_name", "industry"]);

const leads = [
  { first_name: "A", company_name: "Acme", company_industry: "SaaS" },
  { first_name: "", company_name: "Beta", company_industry: "" },
];
const v = validateCopy(seq, leads);
const byName = Object.fromEntries(v.variables.map((r) => [r.name, r]));
assert.equal(byName.first_name.missing, 1);
assert.equal(byName.industry.missing, 1);
assert.equal(byName.company_name.missing, 0);
assert.equal(byName.favorite_color.supported, false);
assert.equal(v.ok, false);
assert.equal(leadsMissingVariables(seq, leads).length, 1);
assert.equal(validateCopy([], leads).ok, true);

console.log("validate-copy: all assertions passed.");
