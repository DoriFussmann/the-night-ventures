import { supabase } from "@/lib/supabase";
import { getImageryContext } from "@/lib/design/getImageryContext";
import {
  getImage,
  imageSrcFromResult,
} from "../aiImage/generateImageClient";
import { cropImageTo16x9 } from "../aiImage/cropImage";
import { finishHeroImage } from "./heroImageStorage";
import {
  DEFAULT_PUBLISH_BRANCH,
  generatedArticleToPublishItem,
  loadCompanyPublishDestination,
  publishArticlesToSite,
} from "./publishToSite";
import { jsonAuthHeaders } from "@/lib/authHeaders";
import { positioningFromPlaybook } from "../../../../lib/aeo/positioning.js";

export function buildArticleImagePrompt(article, frontmatter) {
  const title = String(frontmatter?.title || article?.title || "").trim();
  const description = String(frontmatter?.description || "").trim();
  const type = String(article?.type || "").trim();
  const searchIntent = String(article?.searchIntent || "").trim();

  const typeHint =
    type === "howto"
      ? "practical how-to / process atmosphere"
      : type === "comparison"
        ? "balanced comparison / decision-making atmosphere"
        : type === "faq"
          ? "clarity and answers / approachable guidance atmosphere"
          : type === "comprehensive"
            ? "authoritative overview / landmark resource atmosphere"
            : "editorial thought-leadership atmosphere";

  const parts = [
    "Photorealistic blog hero image, wide landscape composition, no text, no letters, no watermarks, no logos.",
    "No people, no humans, no faces, no figures, no body parts, no silhouettes of people.",
    title ? `Topic: ${title}.` : "",
    description ? `Mood and subject: ${description}` : "",
    searchIntent ? `Reader intent: ${searchIntent}.` : "",
    `Visual tone: ${typeHint}.`,
    "Show a single cohesive scene that evokes the article's subject through environments, objects, materials, or symbolic still life — not a collage or UI mockup.",
  ];

  return parts.filter(Boolean).join(" ");
}

/**
 * What the writer knows about the company: Brand Facts and ICP from the AEO
 * Playbook, plus domain, market, language and imagery from the company settings.
 */
export async function loadCompanyPositioning(companyId) {
  const [playbook, profile] = await Promise.all([
    supabase.from("aeo_playbook").select("brand_facts, icp").eq("company_id", companyId).maybeSingle(),
    supabase
      .from("company_profiles")
      .select("domain, design_guide_raw, seo_market, seo_language")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);
  if (playbook.error) throw new Error(playbook.error.message || "Failed to load the AEO Playbook");
  if (profile.error) throw new Error(profile.error.message || "Failed to load company profile");

  return {
    ...positioningFromPlaybook({
      brandFacts: playbook.data?.brand_facts,
      icp: playbook.data?.icp,
      settings: profile.data || {},
    }),
    imageryContext: getImageryContext(profile.data?.design_guide_raw),
  };
}

export async function generateOneArticle({
  positioning,
  article,
  pillarKeyword,
  supportingKeyword,
  batchContext,
}) {
  const res = await fetch("/api/generate-article", {
    method: "POST",
    headers: await jsonAuthHeaders(),
    body: JSON.stringify({
      abstract: positioning.abstract,
      shortDescription: positioning.shortDescription,
      competitors: positioning.competitors,
      audience: positioning.audience,
      pillarKeyword,
      supportingKeyword: supportingKeyword || undefined,
      batchContext,
      seoControls: positioning.seoControls,
      ownHost: positioning.domain,
      article: {
        title: article.title,
        targetKeyword: article.targetKeyword,
        type: article.type,
        searchIntent: article.searchIntent,
        wordCount: article.wordCount,
        ctaAngle: article.ctaAngle,
        keyMessages: article.keyMessages,
        expertInput: article.expertInput || "",
        angle: article.angle || "",
        secondaryKeywords: Array.isArray(article.secondaryKeywords) ? article.secondaryKeywords : [],
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = Array.isArray(data.validationErrors)
      ? data.validationErrors.join("; ")
      : "";
    const message = data.error || `Generation failed (${res.status})`;
    const err = new Error(details ? `${message}: ${details}` : message);
    err.validationErrors = data.validationErrors || [];
    throw err;
  }

  return data;
}

export async function generateAndCropArticleImage({
  article,
  frontmatter,
  styleContext,
  excludeIds,
}) {
  const prompt = buildArticleImagePrompt(article, frontmatter);
  const raw = await getImage({
    prompt,
    size: "1536x1024",
    styleContext: styleContext || "",
    stock: {
      title: frontmatter?.title || article?.title || "",
      description: frontmatter?.description || "",
      keyword: article?.targetKeyword || "",
      articleType: article?.type || "",
      excludeIds,
    },
  });
  const src = imageSrcFromResult(raw);
  if (!src) {
    throw new Error("No image returned");
  }
  const cropped = await cropImageTo16x9(src);
  return {
    cropped,
    meta: {
      source: raw.source,
      sourceId: raw.sourceId,
      attribution: raw.attribution,
      trail: raw.trail,
    },
  };
}

export async function generateHeroForArticle({
  companyId,
  article,
  frontmatter,
  styleContext,
  excludeIds,
}) {
  const { cropped, meta } = await generateAndCropArticleImage({
    article,
    frontmatter,
    styleContext,
    excludeIds,
  });
  const finished = await finishHeroImage({
    companyId,
    slug: String(frontmatter?.slug || "").trim(),
    cropped,
  });
  if (!finished.storagePath) {
    throw new Error(finished.storageError || "Hero image was not saved.");
  }
  return {
    storagePath: finished.storagePath,
    previewSrc: imageSrcFromResult(cropped),
    meta,
  };
}

export async function publishSingleArticle({ companyId, row, onProgress, allowOverlap = false }) {
  if (!String(row?.hero_storage_path || "").trim()) {
    throw new Error(
      "No hero image saved for this article — generate the image before publishing."
    );
  }

  const mapped = await loadCompanyPublishDestination(companyId);
  const destination = {
    companyId,
    owner: mapped.owner,
    repo: mapped.repo,
    tokenKey: mapped.tokenKey,
    branch: DEFAULT_PUBLISH_BRANCH,
  };
  const item = generatedArticleToPublishItem(row);
  const result = await publishArticlesToSite([item], destination, {
    ...(onProgress ? { onProgress } : {}),
    ...(allowOverlap ? { allowOverlap: true } : {}),
  });

  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const failure = skipped[0] || errors[0];
  if (failure) {
    const reason = String(failure.reason || "").trim();
    const message = String(failure.message || "Publish failed").trim();
    const err = new Error(reason && reason !== "keyword_overlap" ? `${reason}: ${message}` : message);
    if (reason) err.reason = reason;
    throw err;
  }

  return result;
}
