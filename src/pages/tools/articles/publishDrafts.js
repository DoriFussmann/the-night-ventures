import { supabase } from "@/lib/supabase";
import { HERO_BUCKET, resolveHeroPath } from "../articleGeneration/heroImageStorage";
import {
  generateHeroForArticle,
  loadCompanyPositioning,
} from "../articleGeneration/singleArticle";
import { commitLibraryArticle } from "./commitLibraryArticle";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** A library row (not a live-only scan row) that isn't published yet. */
export function isLibraryDraft(article) {
  return Boolean(article?.id) && !article.liveOnly && article.status !== "published";
}

/**
 * Content the site schema needs that we can't safely auto-fill.
 * Hero, date and image alt are handled separately (auto-filled).
 */
export function missingContent(row) {
  const missing = [];
  if (!String(row?.title || "").trim()) missing.push("title");
  if (!String(row?.description || "").trim()) missing.push("description");
  if (!SLUG_RE.test(String(row?.slug || "").trim())) missing.push("valid slug");
  if (!String(row?.body || "").trim()) missing.push("body");
  return missing;
}

/** True when the hero object actually exists in Storage (not just a recorded path). */
export async function heroExists(companyId, row) {
  const path = resolveHeroPath(companyId, row);
  if (!path) return false;
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const { data, error } = await supabase.storage
    .from(HERO_BUCKET)
    .list(folder, { search: name, limit: 20 });
  if (error) {
    throw new Error(`Could not check hero image: ${error.message || "storage error"}`);
  }
  return (data || []).some((file) => file.name === name);
}

/**
 * Go through drafted library rows one by one:
 *   1. check content is complete (skip if not — never publish a broken article)
 *   2. generate + save a hero if none exists in Storage
 *   3. fill date / image alt if empty
 *   4. commit to the site as published and flip the library row
 *
 * @param {object} args
 * @param {string} args.companyId
 * @param {{ owner: string, repo: string, tokenKey: string }} args.destination
 * @param {object[]} args.rows  generated_articles rows (library data, not live overlay)
 * @param {(update: object) => void} [args.onItem]  per-article progress/result
 * @param {(row: object) => void} [args.onRowUpdated]  updated library row
 * @param {() => boolean} [args.shouldStop]
 */
export async function publishDrafts({
  companyId,
  destination,
  rows,
  onItem,
  onRowUpdated,
  shouldStop,
}) {
  const list = Array.isArray(rows) ? rows : [];
  const results = [];
  let positioning = null;
  const usedStockIds = new Set();

  const report = (index, patch) => {
    onItem?.({ index, total: list.length, ...patch });
  };

  for (let i = 0; i < list.length; i++) {
    if (shouldStop?.()) break;
    let row = list[i];
    const base = { id: row.id, title: row.title || row.slug || "(untitled)" };
    let imageGenerated = false;

    try {
      report(i, { ...base, phase: "checking" });

      const missing = missingContent(row);
      if (missing.length > 0) {
        const result = {
          ...base,
          outcome: "skipped",
          message: `Missing ${missing.join(", ")} — open it and fix manually.`,
        };
        results.push(result);
        report(i, { ...result, phase: "done" });
        continue;
      }

      const patch = {};

      if (!(await heroExists(companyId, row))) {
        report(i, { ...base, phase: "image" });
        if (!positioning) positioning = await loadCompanyPositioning(companyId);
        const hero = await generateHeroForArticle({
          companyId,
          article: {
            title: row.title,
            type: row.type,
            targetKeyword: row.target_keyword,
          },
          frontmatter: {
            title: row.title,
            description: row.description,
            slug: row.slug,
          },
          styleContext: positioning.imageryContext || "",
          excludeIds: [...usedStockIds],
        });
        if (hero.meta?.source && hero.meta.source !== "openai" && hero.meta.sourceId) {
          usedStockIds.add(String(hero.meta.sourceId));
        }
        patch.hero_storage_path = hero.storagePath;
        if (hero.meta?.source) {
          patch.hero_source = {
            source: hero.meta.source,
            sourceId: hero.meta.sourceId ?? null,
            attribution: hero.meta.attribution ?? null,
          };
        }
        imageGenerated = true;
      }

      if (!String(row.image_alt || "").trim()) patch.image_alt = String(row.title).trim();
      if (!String(row.date || "").trim()) patch.date = todayIsoDate();

      if (Object.keys(patch).length > 0) {
        const { data, error } = await supabase
          .from("generated_articles")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("company_id", companyId)
          .select()
          .maybeSingle();
        if (error) throw new Error(error.message || "Failed to save article fixes");
        row = data || { ...row, ...patch };
        onRowUpdated?.(row);
      }

      if (shouldStop?.()) {
        const result = {
          ...base,
          outcome: "skipped",
          imageGenerated,
          message: "Stopped before publishing.",
        };
        results.push(result);
        report(i, { ...result, phase: "done" });
        break;
      }

      report(i, { ...base, phase: "publishing" });
      const { row: published } = await commitLibraryArticle({
        companyId,
        destination,
        article: row,
        form: null,
        heroB64: null,
        mode: "publish",
      });
      onRowUpdated?.(published);

      const result = {
        ...base,
        outcome: "published",
        imageGenerated,
        message: imageGenerated ? "Image generated, published." : "Published.",
      };
      results.push(result);
      report(i, { ...result, phase: "done" });
    } catch (err) {
      const result = {
        ...base,
        outcome: "failed",
        imageGenerated,
        message: err?.message || "Failed",
      };
      results.push(result);
      report(i, { ...result, phase: "done" });
    }
  }

  return results;
}
