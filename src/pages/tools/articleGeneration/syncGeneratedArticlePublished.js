import { supabase } from "@/lib/supabase";
import { stripNoVolumeTag } from "./stripNoVolumeTag";

function norm(value) {
  return stripNoVolumeTag(value).toLowerCase();
}

/**
 * Find a generated_articles row for a coverage article.
 * Prefer company_id + slug (set when Article Generator drafted into coverage).
 * Fallback: company_id + pillar_keyword + supporting_keyword + target_keyword/title
 * (reverse of updateCoverageDrafted matching).
 *
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string} opts.pillarKeyword
 * @param {string} [opts.supportingKeyword]
 * @param {{ slug?: string, title?: string, targetKeyword?: string }} opts.article
 * @returns {Promise<{ row: object | null, matchBy: string | null }>}
 */
export async function findGeneratedArticleForCoverage({
  companyId,
  pillarKeyword,
  supportingKeyword,
  article,
}) {
  if (!companyId) return { row: null, matchBy: null };

  const slug = String(article?.slug || "").trim();
  if (slug) {
    const { data, error } = await supabase
      .from("generated_articles")
      .select("id, slug, title, target_keyword, status")
      .eq("company_id", companyId)
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || "Failed to look up Articles library row");
    }
    if (data) return { row: data, matchBy: "slug" };
  }

  const pillar = String(pillarKeyword || "").trim();
  if (!pillar) return { row: null, matchBy: null };

  let query = supabase
    .from("generated_articles")
    .select("id, slug, title, target_keyword, supporting_keyword, status")
    .eq("company_id", companyId)
    .eq("pillar_keyword", pillar);

  const supporting = String(supportingKeyword || "").trim();
  if (supporting) {
    query = query.eq("supporting_keyword", supporting);
  } else {
    query = query.is("supporting_keyword", null);
  }

  const { data: candidates, error: listError } = await query;
  if (listError) {
    throw new Error(listError.message || "Failed to look up Articles library rows");
  }

  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return { row: null, matchBy: null };

  const target = norm(article?.targetKeyword);
  if (target) {
    const byTarget = list.find((row) => norm(row.target_keyword) === target);
    if (byTarget) return { row: byTarget, matchBy: "target_keyword" };
  }

  const title = norm(article?.title);
  if (title) {
    const byTitle = list.find((row) => norm(row.title) === title);
    if (byTitle) return { row: byTitle, matchBy: "title" };
  }

  return { row: null, matchBy: null };
}

/**
 * When Topic Generator marks an article published, sync the matching
 * generated_articles library row (status, published_at, published_url).
 *
 * @returns {Promise<{ matched: boolean, warning?: string, rowId?: string }>}
 */
export async function syncGeneratedArticlePublished({
  companyId,
  pillarKeyword,
  supportingKeyword,
  article,
  publishedUrl,
  publishedAt,
}) {
  const label =
    String(article?.title || article?.targetKeyword || article?.slug || "").trim() ||
    "this article";

  try {
    const { row } = await findGeneratedArticleForCoverage({
      companyId,
      pillarKeyword,
      supportingKeyword,
      article,
    });

    if (!row?.id) {
      return {
        matched: false,
        warning: `No matching Articles library entry found for “${label}”. Coverage publish was saved; library status was not updated.`,
      };
    }

    const now = publishedAt || new Date().toISOString();
    const url = String(publishedUrl || "").trim() || null;

    const fullPayload = {
      status: "published",
      published_at: now,
      published_url: url,
      updated_at: now,
    };

    let { error: updateError } = await supabase
      .from("generated_articles")
      .update(fullPayload)
      .eq("id", row.id)
      .eq("company_id", companyId);

    // Tolerate pre-migration DBs missing published_url (025).
    if (
      updateError &&
      /published_url/i.test(String(updateError.message || ""))
    ) {
      const { published_url: _omit, ...withoutUrl } = fullPayload;
      ({ error: updateError } = await supabase
        .from("generated_articles")
        .update(withoutUrl)
        .eq("id", row.id)
        .eq("company_id", companyId));
    }

    if (updateError) {
      return {
        matched: false,
        warning: `Could not sync Articles library for “${label}”: ${updateError.message}`,
      };
    }

    return { matched: true, rowId: row.id };
  } catch (err) {
    return {
      matched: false,
      warning:
        err?.message ||
        `Could not sync Articles library for “${label}”. Coverage publish was saved.`,
    };
  }
}
