/**
 * Upsert generated article drafts into the Articles library.
 * Conflict target: (company_id, slug) — re-save updates the existing row.
 *
 * Plan columns `pillar_keyword`, `supporting_keyword`, `type`, and
 * `target_keyword` are the persisted source for the matching .md frontmatter
 * fields (`pillarKeyword`, `supportingKeyword`, `articleType`, `targetKeyword`).
 * No extra columns are required for those four.
 */

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "")).filter(Boolean);
}

function asFaqArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      question: String(item.question || "").trim(),
      answer: String(item.answer || "").trim(),
    }))
    .filter((item) => item.question || item.answer);
}

function asSourceArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      url: String(item.url || "").trim(),
      note: String(item.note || "").trim(),
    }))
    .filter((item) => item.url || item.note);
}

export function buildGeneratedArticleRow({
  companyId,
  pillarKeyword,
  supportingKeyword,
  type,
  targetKeyword,
  frontmatter,
  body,
  whereThingsStandSources,
  status = "drafted",
}) {
  const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const slug = String(fm.slug || "").trim();
  if (!slug) {
    throw new Error("Article slug is required to save");
  }

  return {
    company_id: companyId,
    pillar_keyword: String(pillarKeyword || "").trim(),
    supporting_keyword: supportingKeyword
      ? String(supportingKeyword).trim()
      : null,
    type: type || "flex",
    target_keyword: String(targetKeyword || "").trim(),
    status: status === "published" ? "published" : "drafted",
    title: String(fm.title || "").trim(),
    description: String(fm.description || "").trim(),
    slug,
    date: fm.date != null ? String(fm.date) : null,
    updated_date: fm.updatedDate != null ? String(fm.updatedDate) : null,
    author: fm.author != null ? String(fm.author) : null,
    category: fm.category != null ? String(fm.category) : null,
    tags: asStringArray(fm.tags),
    image_alt: fm.imageAlt != null ? String(fm.imageAlt) : null,
    keywords: asStringArray(fm.keywords),
    draft: fm.draft !== false,
    internal_links: asStringArray(fm.internalLinks),
    external_links: asStringArray(fm.externalLinks),
    faqs: asFaqArray(fm.faqs),
    body: String(body || ""),
    where_things_stand_sources: asSourceArray(whereThingsStandSources),
    updated_at: new Date().toISOString(),
  };
}

/**
 * @param {object} args
 * @param {import("@supabase/supabase-js").SupabaseClient} args.supabase
 * @param {string} args.companyId
 * @param {string} args.pillarKeyword
 * @param {string} [args.supportingKeyword]
 * @param {Array<{
 *   type?: string,
 *   targetKeyword?: string,
 *   frontmatter: object,
 *   body: string,
 *   whereThingsStandSources?: Array<{ url?: string, note?: string }>,
 * }>} args.articles
 * @returns {Promise<{ saved: object[], error: Error | null }>}
 */
export async function saveGeneratedArticles({
  supabase,
  companyId,
  pillarKeyword,
  supportingKeyword,
  articles,
}) {
  if (!companyId) {
    return { saved: [], error: new Error("Missing companyId") };
  }
  if (!Array.isArray(articles) || articles.length === 0) {
    return { saved: [], error: null };
  }

  let rows;
  try {
    rows = articles.map((article) =>
      buildGeneratedArticleRow({
        companyId,
        pillarKeyword,
        supportingKeyword,
        type: article.type,
        targetKeyword: article.targetKeyword,
        frontmatter: article.frontmatter,
        body: article.body,
        whereThingsStandSources: article.whereThingsStandSources,
        status: "drafted",
      })
    );
  } catch (err) {
    return { saved: [], error: err instanceof Error ? err : new Error(String(err)) };
  }

  const { data, error } = await supabase
    .from("generated_articles")
    .upsert(rows, { onConflict: "company_id,slug" })
    .select();

  if (error) {
    return {
      saved: [],
      error: new Error(error.message || "Failed to save articles"),
    };
  }

  return { saved: data || [], error: null };
}
