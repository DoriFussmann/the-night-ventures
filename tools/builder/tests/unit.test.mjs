// Run from tools/builder:  node --test tests/unit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { icpImport, prompts, fixture } from "./load.mjs";

const company = fixture("company-export.md"), brand = fixture("brand-facts-export.md"), icp = fixture("strategic-icp.md");

test("import: the two exports land in the right fields", () => {
  const m = icpImport(); m.importMarkdown(company, "company.md"); m.importMarkdown(brand, "brand.md");
  assert.equal(m.field("Company name"), "Ledgerline");
  assert.match(m.field("Product / Service"), /^Accounts payable software/);
  assert.equal(m.field("Typical contract value"), "About 18k a year per customer.");
  assert.equal(m.field("Constraints"), "We only take customers in the UK and Ireland.");
  assert.match(m.field("Good fit"), /Finance teams of two to ten/);
  assert.match(m.field("Not a fit"), /fewer than 200 invoices/);
  assert.match(m.field("Existing gaps"), /spreadsheets/);
});

test("import: each competitor block becomes one line with its detail", () => {
  const m = icpImport(); m.importMarkdown(brand, "brand.md");
  const rows = m.field("Competitive alternatives").split("\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0], "PayStack Pro — URL: https://paystackpro.example; What it is: Self-serve payables tool with invoice capture; How it charges: Free plan; paid from $40/month; Category vs us: Self-serve software");
  assert.match(rows[1], /^Northbook — .*Category vs us: Outsourced service$/);
});

test("import: _Empty_ is not an answer, and left-out sections stay out", () => {
  const m = icpImport(); m.importMarkdown(company, "company.md"); m.importMarkdown(brand, "brand.md");
  for (const f of ["Sales model", "Identification sources", "Observable indicators", "Sales cycle & complexity"]) assert.equal(m.field(f), "", f);
  const all = JSON.stringify(m.state.vals);
  for (const gone of ["_Empty_", "OldCo", "old value proposition", "Subscription.", "Payroll advice", "Book a demo", "Ledgerline Flow", "Plain and exact", "Guaranteed savings"]) assert.ok(!all.includes(gone), gone);
});

test("import: two files answering one field are both kept, under their file names", () => {
  const m = icpImport();
  m.importMarkdown("## Constraints\nFirst file constraint.\n", "a.md"); m.importMarkdown("## Constraints\nSecond file constraint.\n", "b.md");
  assert.equal(m.field("Constraints"), "From a.md:\nFirst file constraint.\n\nFrom b.md:\nSecond file constraint.");
  m.importMarkdown("| Input | Your answer |\n|---|---|\n| Company name | One |\n", "a2.md"); m.importMarkdown("| Input | Your answer |\n|---|---|\n| Company name | Two |\n", "b2.md");
  assert.equal(m.field("Company name"), "Two", "company name: the latest file wins");
});

test("import: the same file uploaded again replaces its own answers", () => {
  const m = icpImport();
  m.importMarkdown("## Constraints\nA v1.\n\n## Good fit\nFit v1.\n", "a.md"); m.importMarkdown("## Constraints\nB.\n", "b.md");
  m.importMarkdown("## Constraints\nA v2.\n\n## Good fit\nFit v2.\n", "a.md");
  assert.equal(m.field("Constraints"), "From a.md:\nA v2.\n\nFrom b.md:\nB.");
  assert.equal(m.field("Good fit"), "Fit v2.");
  assert.deepEqual(m.state.uploads.map((u) => u.name), ["a.md", "b.md"]);
  m.importMarkdown("## Good fit\nFit v3.\n", "a.md");
  assert.equal(m.field("Constraints"), "B.", "a.md no longer answers Constraints, so its block is gone");
  const before = JSON.stringify(m.state.vals); m.importMarkdown("## Good fit\nFit v3.\n", "a.md");
  assert.equal(JSON.stringify(m.state.vals), before, "an unchanged re-upload changes nothing");
});

test("import: an answer typed by hand is kept next to an uploaded one", () => {
  const m = icpImport(); m.state.vals["7.1"] = "Typed by hand.";
  m.importMarkdown("## Constraints\nFrom the file.\n", "a.md");
  assert.equal(m.field("Constraints"), "Existing answer:\nTyped by hand.\n\nFrom a.md:\nFrom the file.");
});

test("parseIcp: competitor names are bare, whatever sits in brackets", () => {
  const p = prompts().parseIcp(icp);
  assert.deepEqual(p.alternatives.map((a) => a.names), [[], ["PayStack Pro", "Tallyo"], ["Northbook"], ["Corevia"]]);
  assert.equal(p.situations.length, 3);
  assert.match(p.customer, /^The ideal customer is a mid-sized distributor/);
});

test("parseIcp: variable values and the priority list under the table", () => {
  const v = Object.fromEntries(prompts().parseIcp(icp).variables.map((x) => [x.name, x.values]));
  assert.deepEqual(v["Company size"], ["50 to 200 staff", "200 to 500 staff"]);
  assert.deepEqual(v["ERP in use"], ["NetSuite", "Sage", "Dynamics"], "values inside a bracket after a filler word");
  assert.deepEqual(v["Close stage"], ["Month-end", "quarter-end"], "a bracket after a real value is a note");
  assert.deepEqual(v["Sector"], ["Food and drink wholesale", "Building supplies"], "priority sectors replace the generic list");
  assert.deepEqual(v["Location"], ["UK", "Ireland", "anywhere in the EU", "Scotland"], "a priority item goes to the variable its bracket names");
});

test("cleanNames: state saved by the older parser is repaired once", () => {
  const P = prompts();
  const old = [["PayStack Pro (free plan", "paid from $40/month)", "Tallyo (free options", "paid tiers)"], ["Northbook (monthly retainer plus a fee per entity", "claims 3", "000 clients and a 20", "000-invoice daily capacity)"]];
  const S = { src: { alternatives: old.map((names, i) => ({ category: "c" + i, names })) },
    brands: [{ name: "Ledgerline", own: true, domains: "ledgerline.example", patterns: "Ledgerline", exclude: "" }]
      .concat(old.flat().map((n) => ({ name: n, own: false, domains: "", patterns: n, exclude: "" })))
      .concat([{ name: "HandAdded", own: false, domains: "handadded.example", patterns: "HandAdded", exclude: "" }]),
    cols: [{ prompts: [
      { id: "P1-001", status: "Approved", alts: ["paid tiers)", "PayStack Pro (free plan"], text: "How do Tallyo (free options, paid tiers) and PayStack Pro (free plan, paid from $40/month) compare for a distributor with three entities?" },
      { id: "P1-002", status: "Approved", alts: [], text: "How do finance teams at distributors keep up with supplier invoices?" }] }] };
  P.set(S);
  assert.deepEqual(P.cleanNames(), { brands: 8, prompts: 1 });
  assert.deepEqual(S.brands.map((b) => b.name), ["Ledgerline", "PayStack Pro", "Tallyo", "Northbook", "HandAdded"]);
  assert.equal(S.cols[0].prompts[0].text, "How do Tallyo and PayStack Pro compare for a distributor with three entities?");
  assert.deepEqual(S.cols[0].prompts[0].alts, ["PayStack Pro", "Tallyo"]);
  assert.deepEqual(P.cleanNames(), { brands: 0, prompts: 0 }, "running it again changes nothing");
});

test("mergeBrands: brands already in The Night Ventures are sent back unchanged", () => {
  const P = prompts();
  const live = [{ name: "Ledgerline", is_own: true, domains: ["ledgerline.example"], name_patterns: ["Ledgerline"], exclude_patterns: ["Ledger Nano"] },
    { name: "PayStack Pro", is_own: false, domains: ["paystackpro.example"], name_patterns: ["PayStack Pro", "PayStack"], exclude_patterns: [] }];
  const b = (name, domains = [], own = false) => ({ name, own, domains, name_patterns: [name], exclude_patterns: [] });
  const m = P.mergeBrands(live, [b("ledgerline", [], true), b("Pay Stack", ["https://www.paystackpro.example/pricing"]), b("PayStack"), b("Northbook", ["northbook.example"], true)]);
  assert.equal(m.kept, 2); assert.deepEqual(m.addedNames, ["Northbook"]);
  assert.deepEqual(m.brands.slice(0, 2), [{ name: "Ledgerline", own: true, domains: ["ledgerline.example"], name_patterns: ["Ledgerline"], exclude_patterns: ["Ledger Nano"] },
    { name: "PayStack Pro", own: false, domains: ["paystackpro.example"], name_patterns: ["PayStack Pro", "PayStack"], exclude_patterns: [] }]);
  assert.equal(m.brands[2].own, false, "a new brand is never own when there already is one");
  assert.equal(P.mergeBrands([], [b("Ledgerline", [], true)]).brands[0].own, true, "a company with no brands yet gets the builder's list");
});

test("persona mix and trim to target", () => {
  const P = prompts(), sits = P.parseIcp(icp).situations, ids = sits.map((s) => s.id);
  const S = { src: { situations: sits, personas: [82, 10, 4, 4].map((share, i) => ({ name: "P" + i, share, situations: ids })) },
    cols: [0, 1, 2, 3].map(() => ({ target: 100, weights: Object.fromEntries(ids.map((s) => [s, 1])), prompts: [], exhausted: {}, seq: 0 })) };
  P.set(S); P.ensureMix();
  assert.deepEqual(S.mix, { total: 200, w: [82, 10, 4, 4] });
  assert.deepEqual(S.cols.map((c) => c.target), [164, 20, 8, 8]);
  S.mix.w = [1, 1, 1, 0]; S.mix.total = 100; P.applyMix();
  assert.deepEqual(S.cols.map((c) => c.target), [34, 33, 33, 0], "targets always add up to the total");
  S.mix = { total: 200, w: [82, 10, 4, 4] }; P.applyMix();
  // 45 prompts in persona 1, five per cell, against a target of 20
  let n = 0; for (const s of ids) for (const st of ["Learn", "Problem", "Buy"]) for (let k = 0; k < 5; k++) S.cols[1].prompts.push({ id: "P2-" + String(++n).padStart(3, "0"), s, st, status: n % 7 ? "Approved" : "Draft", amb: n === 3 ? "x" : undefined });
  const plan = P.trimPlan(1);
  assert.equal(plan.length, 25);
  assert.ok(plan.some((p) => p.amb), "a prompt marked as possibly misread goes first");
  for (const p of plan) p.status = "Rejected";
  assert.equal(P.live(1).length, 20); assert.equal(S.cols[1].prompts.length, 45, "rejected prompts stay stored");
  const have = P.haveMap(1), target = P.cellTargets(1);
  for (const k of Object.keys(target)) assert.ok((have[k] || 0) >= target[k], "no cell drops below its own target: " + k);
  assert.equal(P.trimPlan(1).length, 0); assert.equal(P.trimPlan(0).length, 0);
});
