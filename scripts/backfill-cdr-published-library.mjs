/**
 * One-time: sync Closing Day Ready coverage "published" articles into
 * generated_articles (status, published_at, published_url).
 *
 * Usage (from repo root, with .env.local service role):
 *   node scripts/backfill-cdr-published-library.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  const text = readFileSync(path, "utf8");
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

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function collectPublishedFromCoverage(pillars) {
  const out = [];
  for (const pillar of Array.isArray(pillars) ? pillars : []) {
    const pillarKeyword = String(pillar?.keyword || "").trim();
    const pa = pillar?.pillarArticle;
    if (pa && typeof pa === "object" && pa.status === "published") {
      out.push({
        kind: "pillar",
        pillarKeyword,
        supportingKeyword: null,
        slug: pa.slug ? String(pa.slug).trim() : "",
        title: pa.title ? String(pa.title).trim() : "",
        targetKeyword: pa.targetKeyword ? String(pa.targetKeyword).trim() : "",
        publishedUrl: pa.publishedUrl ? String(pa.publishedUrl).trim() : "",
        publishedAt: pa.publishedAt ? String(pa.publishedAt).trim() : "",
      });
    }
    for (const sup of Array.isArray(pillar?.supporting) ? pillar.supporting : []) {
      const supportingKeyword = String(sup?.keyword || "").trim();
      for (const article of Array.isArray(sup?.plannedArticles)
        ? sup.plannedArticles
        : []) {
        if (article?.status !== "published") continue;
        out.push({
          kind: "supporting",
          pillarKeyword,
          supportingKeyword,
          slug: article.slug ? String(article.slug).trim() : "",
          title: article.title ? String(article.title).trim() : "",
          targetKeyword: article.targetKeyword
            ? String(article.targetKeyword).trim()
            : "",
          publishedUrl: article.publishedUrl
            ? String(article.publishedUrl).trim()
            : "",
          publishedAt: article.publishedAt
            ? String(article.publishedAt).trim()
            : "",
        });
      }
    }
  }
  return out;
}

function matchRow(candidates, coverageArticle) {
  const slug = coverageArticle.slug;
  if (slug) {
    const bySlug = candidates.find((row) => row.slug === slug);
    if (bySlug) return { row: bySlug, matchBy: "slug" };
  }

  const pillar = coverageArticle.pillarKeyword;
  const supporting = coverageArticle.supportingKeyword;
  const scoped = candidates.filter((row) => {
    if (norm(row.pillar_keyword) !== norm(pillar)) return false;
    const rowSup = row.supporting_keyword
      ? String(row.supporting_keyword).trim()
      : "";
    if (supporting) return norm(rowSup) === norm(supporting);
    return !rowSup;
  });

  const target = norm(coverageArticle.targetKeyword);
  if (target) {
    const byTarget = scoped.find((row) => norm(row.target_keyword) === target);
    if (byTarget) return { row: byTarget, matchBy: "target_keyword" };
  }

  const title = norm(coverageArticle.title);
  if (title) {
    const byTitle = scoped.find((row) => norm(row.title) === title);
    if (byTitle) return { row: byTitle, matchBy: "title" };
  }

  return { row: null, matchBy: null };
}

async function main() {
  const env = loadEnvLocal();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const supabase = createClient(url, key);

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name")
    .ilike("name", "%Closing Day Ready%")
    .maybeSingle();

  if (companyError) throw new Error(companyError.message);
  if (!company?.id) {
    throw new Error('Company matching "Closing Day Ready" not found');
  }

  console.log(`Company: ${company.name} (${company.id})`);

  const { data: coverage, error: coverageError } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", company.id)
    .maybeSingle();

  if (coverageError) throw new Error(coverageError.message);

  const published = collectPublishedFromCoverage(coverage?.pillars);
  console.log(`Published in coverage: ${published.length}`);

  if (published.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const { data: libraryRows, error: libraryError } = await supabase
    .from("generated_articles")
    .select(
      "id, slug, title, target_keyword, pillar_keyword, supporting_keyword, status, published_at"
    )
    .eq("company_id", company.id);

  if (libraryError) throw new Error(libraryError.message);

  // Detect whether migration 025 (published_url) is applied.
  const urlProbe = await supabase
    .from("generated_articles")
    .select("id, published_url")
    .eq("company_id", company.id)
    .limit(1);
  const hasPublishedUrl = !urlProbe.error;
  if (!hasPublishedUrl) {
    console.warn(
      "Column published_url missing — will sync status/published_at only. Apply supabase/migrations/025_generated_articles_published_url.sql and re-run to store URLs."
    );
  }

  const candidates = libraryRows || [];
  console.log(`Articles library rows: ${candidates.length}`);

  let updated = 0;
  let unmatched = 0;
  let already = 0;

  for (const item of published) {
    const { row, matchBy } = matchRow(candidates, item);
    const label = item.slug || item.targetKeyword || item.title || "(untitled)";

    if (!row) {
      unmatched += 1;
      console.warn(`  UNMATCHED: ${label}`);
      continue;
    }

    const publishedAt =
      item.publishedAt || row.published_at || new Date().toISOString();
    const publishedUrl = item.publishedUrl || null;

    if (row.status === "published" && row.published_at && !item.publishedUrl) {
      already += 1;
      console.log(`  already published (${matchBy}): ${label}`);
      continue;
    }

    const payload = {
      status: "published",
      published_at: publishedAt,
      updated_at: new Date().toISOString(),
    };
    if (hasPublishedUrl) {
      payload.published_url = publishedUrl;
    }

    const { error: updateError } = await supabase
      .from("generated_articles")
      .update(payload)
      .eq("id", row.id)
      .eq("company_id", company.id);

    if (updateError) {
      console.error(`  FAIL ${label}: ${updateError.message}`);
      unmatched += 1;
      continue;
    }

    updated += 1;
    row.status = "published";
    row.published_at = publishedAt;
    console.log(`  updated (${matchBy}): ${label}`);
  }

  console.log(
    `\nDone. updated=${updated} already=${already} unmatched=${unmatched}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
