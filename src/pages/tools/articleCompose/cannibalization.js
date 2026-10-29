import { supabase } from "@/lib/supabase";
import { findKeywordOverlaps } from "../../../../lib/keyword-overlap.js";

export function coverageArticles(pillars) {
  const out = [];
  for (const pillar of Array.isArray(pillars) ? pillars : []) {
    const pillarKeyword = String(pillar?.keyword || "").trim();
    const pillarArticle =
      pillar?.pillarArticle && typeof pillar.pillarArticle === "object" ? pillar.pillarArticle : null;
    if (pillarArticle) {
      out.push({
        slug: pillarArticle.slug,
        title: pillarArticle.title,
        targetKeyword: pillarArticle.targetKeyword,
        pillarKeyword,
        articleType: "comprehensive",
        status: String(pillarArticle.status || "planned"),
        where: "coverage plan",
      });
    }
    for (const supporting of Array.isArray(pillar?.supporting) ? pillar.supporting : []) {
      for (const item of Array.isArray(supporting?.plannedArticles) ? supporting.plannedArticles : []) {
        if (!item || typeof item !== "object") continue;
        out.push({
          slug: item.slug,
          title: item.title,
          targetKeyword: item.targetKeyword,
          pillarKeyword,
          supportingKeyword: String(supporting?.keyword || "").trim(),
          articleType: item.articleType || item.type,
          status: String(item.status || "planned"),
          where: "coverage plan",
        });
      }
    }
  }
  return out;
}

/**
 * Articles in the library or the coverage plan whose keywords overlap the one
 * being composed (see lib/keyword-overlap.js for the rules). The draft being
 * edited (`excludeId`) is ignored.
 */
export async function findCannibalization({
  companyId,
  pillars,
  targetKeyword,
  pillarKeyword,
  supportingKeyword,
  articleType,
  excludeId,
}) {
  const keyword = String(targetKeyword || "").trim();
  if (!companyId || !keyword) return [];

  const { data, error } = await supabase
    .from("generated_articles")
    .select("id, slug, title, status, target_keyword, pillar_keyword, supporting_keyword, type")
    .eq("company_id", companyId);

  if (error) {
    throw new Error(error.message || "Failed to check existing articles");
  }

  const library = (Array.isArray(data) ? data : [])
    .filter((row) => !excludeId || row.id !== excludeId)
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      targetKeyword: row.target_keyword,
      pillarKeyword: row.pillar_keyword,
      supportingKeyword: row.supporting_keyword,
      articleType: row.type,
      status: String(row.status || "drafted"),
      where: "library",
    }));

  return findKeywordOverlaps(
    { targetKeyword: keyword, pillarKeyword, supportingKeyword, articleType },
    [...library, ...coverageArticles(pillars)]
  );
}
