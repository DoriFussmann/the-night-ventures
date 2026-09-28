import { countMainBodyWords } from "../../../../lib/generate-article/mainBodyWords.js";
import { supabase } from "@/lib/supabase";
import { saveGeneratedArticles } from "../articleGeneration/saveGeneratedArticles";
import { upsertComposedCoverage } from "../articleGeneration/updateCoverageDrafted";

async function nextFreeSlug(companyId, slug) {
  const base = String(slug || "").trim();
  if (!base) return { slug: base, changedFrom: "" };

  let candidate = base;
  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const { data, error } = await supabase
      .from("generated_articles")
      .select("slug")
      .eq("company_id", companyId)
      .eq("slug", candidate)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || "Failed to check slug");
    }
    if (!data) {
      return {
        slug: candidate,
        changedFrom: candidate === base ? "" : base,
      };
    }
    candidate = `${base}-${suffix}`;
  }

  throw new Error("Could not find a free slug");
}

export async function saveComposedDraft({
  companyId,
  pillarKeyword,
  supportingKeyword,
  source,
  type,
  targetKeyword,
  frontmatter: rawFrontmatter,
  body,
  whereThingsStandSources,
  wordCount,
  ctaAngle,
  searchIntent,
  keyMessages,
}) {
  const frontmatter = {
    ...(rawFrontmatter && typeof rawFrontmatter === "object" ? rawFrontmatter : {}),
  };
  const reserved = await nextFreeSlug(companyId, frontmatter.slug);
  if (reserved.changedFrom) {
    frontmatter.slug = reserved.slug;
  }

  const { saved, error } = await saveGeneratedArticles({
    supabase,
    companyId,
    pillarKeyword,
    supportingKeyword,
    articles: [
      {
        type,
        targetKeyword,
        frontmatter,
        body: body || "",
        whereThingsStandSources: whereThingsStandSources || [],
        source,
      },
    ],
  });
  if (error) {
    throw new Error(error.message || "Failed to save the article");
  }

  const row = Array.isArray(saved) ? saved[0] : null;
  if (!row?.id) {
    throw new Error("Save succeeded but no article id was returned.");
  }

  let coverageWarning = "";
  try {
    await upsertComposedCoverage({
      companyId,
      pillarKeyword,
      supportingKeyword,
      article: {
        targetKeyword,
        title: frontmatter.title,
        type,
        searchIntent: searchIntent || "",
        wordCount:
          source === "modify" ? countMainBodyWords(body) : wordCount,
        keyMessages: Array.isArray(keyMessages) ? keyMessages : [],
        ctaAngle: ctaAngle || "",
        frontmatter,
      },
    });
  } catch (coverageError) {
    coverageWarning =
      coverageError?.message || "Coverage could not be updated.";
  }

  return {
    row,
    slugChangedFrom: reserved.changedFrom,
    coverageWarning,
  };
}
