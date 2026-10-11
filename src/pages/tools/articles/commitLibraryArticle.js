import { supabase } from "@/lib/supabase";
import {
  DEFAULT_PUBLISH_BRANCH,
  generatedArticleToPublishItem,
  isPublishDestinationMapped,
  publishArticlesToSite,
} from "../articleGeneration/publishToSite";
import { persistGeneratedHeroImage } from "../articleGeneration/heroImageStorage";
import { updateCoveragePublished } from "../articleGeneration/updateCoverageDrafted";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function splitCommaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function applyArticleForm(article, form) {
  return {
    ...article,
    title: String(form?.title || "").trim(),
    h1: String(form?.h1 || "").trim() || null,
    description: String(form?.description || "").trim(),
    category: String(form?.category || "").trim(),
    image_alt: String(form?.image_alt || "").trim(),
    tags: splitCommaList(form?.tags),
    keywords: splitCommaList(form?.keywords),
    body: String(form?.body || ""),
    updated_date: todayIsoDate(),
  };
}

/**
 * Persist library edits, optionally replace the hero, then commit to the
 * destination site. Publish moves drafted → published after a successful commit.
 */
export async function commitLibraryArticle({
  companyId,
  destination,
  article,
  form,
  heroB64,
  mode,
  onProgress,
}) {
  if (!companyId || !article?.id) {
    throw new Error("Missing article");
  }
  if (!isPublishDestinationMapped(destination)) {
    throw new Error("Set Publish Destination in Company Data first");
  }

  const now = new Date().toISOString();
  let next = form
    ? applyArticleForm(article, form)
    : { ...article, updated_date: todayIsoDate() };
  next.updated_at = now;

  if (heroB64) {
    next.hero_storage_path = await persistGeneratedHeroImage({
      companyId,
      slug: next.slug,
      b64: heroB64,
    });
  }

  const asDraft = mode === "save" && article.status !== "published";
  const contentPatch = {
    title: next.title,
    h1: next.h1 ?? null,
    description: next.description,
    category: next.category,
    image_alt: next.image_alt,
    tags: next.tags,
    keywords: next.keywords,
    body: next.body,
    updated_date: next.updated_date,
    updated_at: now,
    ...(next.hero_storage_path
      ? { hero_storage_path: next.hero_storage_path }
      : {}),
  };

  const { data: saved, error: saveError } = await supabase
    .from("generated_articles")
    .update(contentPatch)
    .eq("id", article.id)
    .eq("company_id", companyId)
    .select()
    .maybeSingle();

  if (saveError) {
    throw new Error(saveError.message || "Failed to save article");
  }

  const row = saved || { ...article, ...contentPatch };

  const result = await publishArticlesToSite(
    [generatedArticleToPublishItem(row, { asDraft })],
    {
      companyId,
      owner: destination.owner,
      repo: destination.repo,
      tokenKey: destination.tokenKey,
      branch: DEFAULT_PUBLISH_BRANCH,
    },
    // The library row is the source of truth: a draft already committed to the
    // site (draft: true) must be replaceable, otherwise Publish is skipped as
    // "already exists".
    { onProgress, overwrite: true }
  );

  if (!result.ok) {
    const err = new Error(
      result.errors?.[0]?.message ||
        result.skipped?.[0]?.message ||
        "Commit did not complete"
    );
    err.result = result;
    throw err;
  }

  if (asDraft) {
    return { row, result, asDraft: true };
  }

  const publishedUrl = result.pullRequestUrl || row.published_url || "";
  const publishedPatch = {
    status: "published",
    draft: false,
    published_at: row.published_at || now,
    updated_at: now,
    ...(publishedUrl ? { published_url: publishedUrl } : {}),
  };

  const { data: published, error: publishError } = await supabase
    .from("generated_articles")
    .update(publishedPatch)
    .eq("id", article.id)
    .eq("company_id", companyId)
    .select()
    .maybeSingle();

  if (publishError) {
    throw new Error(
      publishError.message ||
        "Committed to the site, but failed to mark the library row published"
    );
  }

  await updateCoveragePublished({
    companyId,
    pillarKeyword: row.pillar_keyword,
    supportingKeyword: String(row.supporting_keyword || "").trim(),
    successes: [
      {
        targetKeyword: row.target_keyword,
        title: row.title,
        frontmatter: { title: row.title, slug: row.slug },
      },
    ],
    publishedUrl,
  });

  return {
    row: published || { ...row, ...publishedPatch },
    result,
    asDraft: false,
  };
}
