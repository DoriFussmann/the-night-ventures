import { supabase } from "@/lib/supabase";
import { articleMatches } from "../articleGeneration/updateCoverageDrafted";

function escapeIlike(value) {
  return String(value || "").replace(/[%_\\]/g, "\\$&");
}

function coverageMatches(pillars, targetKeyword) {
  const matches = [];
  for (const pillar of Array.isArray(pillars) ? pillars : []) {
    const pillarArticle =
      pillar?.pillarArticle && typeof pillar.pillarArticle === "object"
        ? pillar.pillarArticle
        : null;
    if (
      pillarArticle &&
      articleMatches(pillarArticle, { targetKeyword, title: "" })
    ) {
      matches.push({
        title: String(pillarArticle.title || targetKeyword).trim() || targetKeyword,
        status: String(pillarArticle.status || "planned"),
        where: "coverage plan",
      });
    }

    for (const supporting of Array.isArray(pillar?.supporting)
      ? pillar.supporting
      : []) {
      for (const item of Array.isArray(supporting?.plannedArticles)
        ? supporting.plannedArticles
        : []) {
        if (!item || typeof item !== "object") continue;
        if (!articleMatches(item, { targetKeyword, title: "" })) continue;
        matches.push({
          title: String(item.title || targetKeyword).trim() || targetKeyword,
          status: String(item.status || "planned"),
          where: "coverage plan",
        });
      }
    }
  }
  return matches;
}

export async function findCannibalization({
  companyId,
  pillars,
  targetKeyword,
}) {
  const keyword = String(targetKeyword || "").trim();
  if (!companyId || !keyword) return [];

  const { data, error } = await supabase
    .from("generated_articles")
    .select("title, status, target_keyword")
    .eq("company_id", companyId)
    .ilike("target_keyword", escapeIlike(keyword));

  if (error) {
    throw new Error(error.message || "Failed to check existing articles");
  }

  const library = (Array.isArray(data) ? data : []).map((row) => ({
    title: String(row.title || keyword).trim() || keyword,
    status: String(row.status || "drafted"),
    where: "library",
  }));

  return [...library, ...coverageMatches(pillars, keyword)];
}
