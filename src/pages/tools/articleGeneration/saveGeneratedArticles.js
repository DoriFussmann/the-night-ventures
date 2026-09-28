import { stripNoVolumeTag } from "./stripNoVolumeTag";

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

function asExternalLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === "object") {
        const url = String(item.url || "").trim();
        if (!url) return null;
        return {
          label: String(item.label || url).trim(),
          url,
          addedAt: String(item.addedAt || "").trim(),
          kind: String(item.kind || "").trim(),
        };
      }
      const text = String(item ?? "").trim();
      return text || null;
    })
    .filter(Boolean);
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
  heroStoragePath,
  heroSource,
  source,
  status = "drafted",
}) {
  const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const slug = String(fm.slug || "").trim();
  if (!slug) {
    throw new Error("Article slug is required to save");
  }

  const row = {
    company_id: companyId,
    pillar_keyword: stripNoVolumeTag(pillarKeyword),
    supporting_keyword: supportingKeyword
      ? stripNoVolumeTag(supportingKeyword)
      : null,
    type: type || "flex",
    target_keyword: stripNoVolumeTag(targetKeyword),
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
    keywords: asStringArray(fm.keywords).map(stripNoVolumeTag).filter(Boolean),
    draft: fm.draft !== false,
    internal_links: asStringArray(fm.internalLinks),
    external_links: asExternalLinks(fm.externalLinks),
    faqs: asFaqArray(fm.faqs),
    body: String(body || ""),
    where_things_stand_sources: asSourceArray(whereThingsStandSources),
    updated_at: new Date().toISOString(),
  };
  const storedHero = String(heroStoragePath || "").trim();
  if (storedHero) row.hero_storage_path = storedHero;
  if (heroSource != null) row.hero_source = heroSource;
  if (source != null) row.source = source;
  return row;
}

/**
 * @param {object} args
 * @param {import("@supabase/supabase-js").SupabaseClient} args.supabase
 * @param {string} args.companyId
 * @param {string} args.pillarKeyword
 * @param {string} [args.supportingKeyword]
 * @param {string} [args.source] pillar | cluster | modify | idea
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
  source,
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
        heroStoragePath: article.heroStoragePath || article.image?.storagePath,
        heroSource: article.heroSource,
        source: article.source != null ? article.source : source,
        status: "drafted",
      })
    );
  } catch (err) {
    return { saved: [], error: err instanceof Error ? err : new Error(String(err)) };
  }

  const seenSlugs = new Map();
  for (const row of rows) {
    const first = seenSlugs.get(row.slug);
    if (first) {
      return {
        saved: [],
        error: new Error(
          `Duplicate slug "${row.slug}": "${first.title}" and "${row.title}". Give these topics different target keywords and regenerate.`
        ),
      };
    }
    seenSlugs.set(row.slug, row);
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
