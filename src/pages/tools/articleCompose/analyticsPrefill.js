// Prefill Article Modify / Idea from an Analytics opportunity link:
//   ?target=<query>            → target keyword
//   ?page=<published url>      → (Modify) load that article from the library when it is one of ours
import { supabase } from "@/lib/supabase";
import { urlKey } from "../../../../lib/analytics/opportunities.js";
import { prepareSource } from "./sourceText";

/**
 * @param {{ companyId: string, mode: "idea" | "modify", target: string, page: string }} input
 * @returns {Promise<{ patch: object, libraryMatch: boolean }>}
 */
export async function analyticsPrefill({ companyId, mode, target, page }) {
  const patch = {};
  const keyword = String(target || "").trim().slice(0, 200);
  if (keyword) patch.targetKeyword = keyword;

  const key = urlKey(page);
  if (mode !== "modify" || !key) return { patch, libraryMatch: false };

  const [{ data: rows, error }, { data: profile }] = await Promise.all([
    supabase
      .from("generated_articles")
      .select("title, description, body, pillar_keyword, supporting_keyword, target_keyword, published_url")
      .eq("company_id", companyId)
      .not("published_url", "is", null)
      .limit(1000),
    supabase.from("company_profiles").select("domain").eq("company_id", companyId).maybeSingle(),
  ]);
  if (error) throw error;
  const row = (rows || []).find((r) => urlKey(r.published_url) === key);
  if (!row?.body) return { patch, libraryMatch: false };

  const prepared = prepareSource(row.body, String(profile?.domain || "").trim());
  return {
    libraryMatch: true,
    patch: {
      ...patch,
      targetKeyword: patch.targetKeyword || row.target_keyword || "",
      pillarKeyword: row.pillar_keyword || "",
      clusterKeyword: row.supporting_keyword || "",
      sourceArticle: prepared.source,
      userLinks: prepared.userLinks,
      imagesRemoved: prepared.imagesRemoved,
      originalTitle: row.title || "",
      originalDescription: row.description || "",
    },
  };
}
