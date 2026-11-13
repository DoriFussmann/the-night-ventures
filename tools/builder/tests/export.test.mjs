// Run from tools/builder:  node --test tests/export.test.mjs
// The ICP Builder's "Load from The Night Ventures" must write exactly what the app's Export button writes.
// This test imports the app's own sectionMarkdown.js and api.js as modules (only their two imports from outside the
// folder are stubbed), runs them on a set of rows, runs the page's built-in copy (built/builder.html) on the same rows,
// and requires the two documents to match character for character. It fails when the app's export changes and the
// page has not been rebuilt, or when build.py stops copying the code faithfully.
// Set TNV_ROWS=/path/to/rows.json to run it on other rows ({company, profile, brand_facts}).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { ROOT, icpImport } from "./load.mjs";

const ID = "22222222-3333-4444-8555-666666666666";
const ROWS = JSON.parse(fs.readFileSync(process.env.TNV_ROWS || path.join(ROOT, "tests/fixtures/tnv-rows.json"), "utf8"));
const APP = path.resolve(ROOT, "../../src/pages/tools/aeoPlaybook");

/** Rows for a select, picked by table name, limited to the columns asked for. */
function answer(table, cols) {
  const row = table === "companies" ? ROWS.company : table === "company_profiles" ? ROWS.profile : table === "aeo_playbook" ? { brand_facts: ROWS.brand_facts } : null;
  if (!row) throw new Error("unexpected table " + table);
  const pick = cols.trim() === "*" ? row : Object.fromEntries(cols.split(",").map((c) => c.trim()).map((c) => [c, row[c] ?? null]));
  return pick;
}

/** The app's export, run from its own files. */
async function appExport() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnv-export-"));
  // Stand-in for the app's Supabase client: one-row reads answer from ROWS; list reads (personas, prompts …) come back empty.
  fs.writeFileSync(path.join(dir, "supabase.mjs"), `export const supabase={from(t){let c="*";const q={select(x){c=x;return q;},eq(){return q;},order(){return q;},range(){return q;},async maybeSingle(){return {data:globalThis.__answer(t,c),error:null};},then(ok,no){return Promise.resolve({data:[],error:null}).then(ok,no);}};return q;}};`);
  fs.writeFileSync(path.join(dir, "download.mjs"), "export const downloadMarkdown=()=>{};");
  const fix = (src) => src.replace('from "@/lib/supabase"', 'from "./supabase.mjs"').replace('from "../siteBuildFlow/buildFlowMarkdown"', 'from "./download.mjs"').replace('from "./api"', 'from "./api.mjs"');
  fs.writeFileSync(path.join(dir, "api.mjs"), fix(fs.readFileSync(path.join(APP, "api.js"), "utf8")));
  fs.writeFileSync(path.join(dir, "sectionMarkdown.mjs"), fix(fs.readFileSync(path.join(APP, "sectionMarkdown.js"), "utf8")));
  globalThis.__answer = answer;
  const sm = await import(pathToFileURL(path.join(dir, "sectionMarkdown.mjs")).href);
  const api = await import(pathToFileURL(path.join(dir, "api.mjs")).href);
  // Exactly what AeoPlaybook.jsx does: load the playbook with api.js, then export each tab.
  const data = await api.loadPlaybook(ID);
  return [await sm.buildSectionMarkdown("company", ID, data), await sm.buildSectionMarkdown("brand", ID, data)];
}

/** The page's built-in copy, run from built/builder.html with a stand-in for the Supabase connection. */
async function pageExport() {
  const html = fs.readFileSync(path.join(ROOT, "built/builder.html"), "utf8");
  const i = html.indexOf("window.TNVExport"), code = html.slice(i, html.indexOf("</script>", i));
  const queries = [];
  const sql = async (q) => { queries.push(q); const m = q.match(/^select (.+?) from public\.(\w+) where (\w+)='([0-9a-f-]+)'::uuid limit 1$/); assert.ok(m, "unexpected SQL: " + q); assert.equal(m[4], ID); return [answer(m[2], m[1])]; };
  const ctx = { window: {}, TNV: { sql } }; vm.createContext(ctx); vm.runInContext(code, ctx);
  return { docs: await ctx.window.TNVExport.load(ID), queries };
}

test("the page writes the same two documents as the app's Export button", async () => {
  const app = await appExport(), page = await pageExport();
  assert.equal(page.docs.length, 2);
  for (let k = 0; k < 2; k++) {
    assert.equal(page.docs[k].filename, app[k].filename);
    assert.equal(page.docs[k].content, app[k].content);
  }
  assert.ok(page.queries.every((q) => /^select [a-z0-9_, ]+ from public\.(companies|company_profiles|aeo_playbook) where (id|company_id)='/.test(q)), page.queries.join("\n"));
});

test("loading imports the documents as dropped files, and loading again replaces rather than adds", async () => {
  const { docs } = await pageExport();
  const m = icpImport(); for (const d of docs) m.importMarkdown(d.content, d.filename);
  const once = JSON.stringify(m.state.vals);
  assert.ok(Object.keys(m.state.vals).length >= 8, "fields filled: " + Object.keys(m.state.vals).length);
  for (const d of docs) m.importMarkdown(d.content, d.filename);
  assert.equal(JSON.stringify(m.state.vals), once);
  assert.equal(JSON.stringify(m.state.uploads.map((u) => u.name)), JSON.stringify(docs.map((d) => d.filename)));
});

test("the adapter refuses anything but a plain read of one row", async () => {
  const html = fs.readFileSync(path.join(ROOT, "built/builder.html"), "utf8");
  const i = html.indexOf("window.TNVExport"), code = html.slice(i, html.indexOf("</script>", i));
  const ctx = { window: {}, TNV: { sql: async () => [] } }; vm.createContext(ctx); vm.runInContext(code, ctx);
  await assert.rejects(ctx.window.TNVExport.load("x'; drop table companies; --"), (e) => e.code === "bad_id");
});
