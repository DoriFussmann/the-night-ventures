/**
 * Remove compose test drafts and their coverage entries.
 *
 * Usage:
 *   node scripts/cleanup-compose-test-drafts.mjs <companyId> <slug> [slug...]
 *   node scripts/cleanup-compose-test-drafts.mjs <companyId> <slug> [slug...] --yes
 *
 * Without --yes, prints the rows and coverage entries that would be removed.
 * generated_articles rows are deleted only when status is drafted.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function parseArgs(argv) {
  const yes = argv.includes("--yes");
  const positional = argv.filter((arg) => arg !== "--yes");
  const [companyId, ...slugs] = positional;
  return {
    yes,
    companyId: String(companyId || "").trim(),
    slugs: slugs.map((slug) => String(slug || "").trim()).filter(Boolean),
  };
}

const { yes, companyId, slugs } = parseArgs(process.argv.slice(2));
if (!companyId || slugs.length === 0) {
  console.error(
    "Usage: node scripts/cleanup-compose-test-drafts.mjs <companyId> <slug> [slug...] [--yes]"
  );
  process.exit(1);
}

const env = loadEnvLocal();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const slugSet = new Set(slugs);

const { data: rows, error: rowError } = await sb
  .from("generated_articles")
  .select("id, slug, title, status, source")
  .eq("company_id", companyId)
  .in("slug", slugs);
if (rowError) {
  console.error(rowError.message);
  process.exit(1);
}

const found = new Map((rows || []).map((row) => [row.slug, row]));
const drafted = [];
console.log(yes ? "Deleting:" : "Dry run. Would delete:");
for (const slug of slugs) {
  const row = found.get(slug);
  if (!row) {
    console.log(`  generated_articles  ${slug}  not found`);
    continue;
  }
  if (row.status !== "drafted") {
    console.log(
      `  generated_articles  ${slug}  skip status=${row.status}  title=${row.title || ""}`
    );
    continue;
  }
  drafted.push(row);
  console.log(
    `  generated_articles  ${slug}  id=${row.id}  status=${row.status}  source=${row.source || ""}  title=${row.title || ""}`
  );
}

const { data: coverage, error: coverageError } = await sb
  .from("content_coverage")
  .select("pillars")
  .eq("company_id", companyId)
  .maybeSingle();
if (coverageError) {
  console.error(coverageError.message);
  process.exit(1);
}

const pillars = Array.isArray(coverage?.pillars) ? coverage.pillars : [];
const removed = [];
const nextPillars = pillars.map((pillar) => ({
  ...pillar,
  supporting: (Array.isArray(pillar?.supporting) ? pillar.supporting : []).map(
    (supporting) => {
      const planned = Array.isArray(supporting?.plannedArticles)
        ? supporting.plannedArticles
        : [];
      const kept = [];
      for (const article of planned) {
        const slug = String(article?.slug || "").trim();
        if (slug && slugSet.has(slug)) {
          removed.push({
            pillar: String(pillar?.keyword || "").trim(),
            cluster: String(supporting?.keyword || "").trim(),
            slug,
            title: String(article?.title || "").trim(),
            status: String(article?.status || "").trim(),
          });
          continue;
        }
        kept.push(article);
      }
      return { ...supporting, plannedArticles: kept };
    }
  ),
}));

console.log(yes ? "Removing coverage entries:" : "Dry run. Would remove coverage entries:");
if (removed.length === 0) {
  console.log("  none");
} else {
  for (const entry of removed) {
    console.log(
      `  plannedArticles  ${entry.slug}  pillar=${entry.pillar}  cluster=${entry.cluster}  status=${entry.status}  title=${entry.title}`
    );
  }
}

if (!yes) {
  console.log("Dry run only. Re-run with --yes to delete.");
  process.exit(0);
}

if (drafted.length > 0) {
  const { error: deleteError } = await sb
    .from("generated_articles")
    .delete()
    .eq("company_id", companyId)
    .eq("status", "drafted")
    .in(
      "slug",
      drafted.map((row) => row.slug)
    );
  if (deleteError) {
    console.error(deleteError.message);
    process.exit(1);
  }
}

if (removed.length > 0) {
  const { error: updateError } = await sb.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars: nextPillars,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );
  if (updateError) {
    console.error(updateError.message);
    process.exit(1);
  }
}

console.log(
  `Deleted ${drafted.length} drafted article${drafted.length === 1 ? "" : "s"} and removed ${removed.length} coverage entr${removed.length === 1 ? "y" : "ies"}.`
);
