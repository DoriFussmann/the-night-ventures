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

function normalizeCompetitors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      name: String(item.name || "").trim(),
      url: String(item.url || "").trim(),
    }))
    .filter((item) => item.name || item.url);
}

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

export async function loadCompanyPositioning(companyId) {
  const { data, error } = await supabase
    .from("company_profiles")
    .select(
      "abstract, short_description, competitors, target_audience, design_guide_raw, domain"
    )
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load company profile");
  }

  // SEO Controls (migration 065). Loaded separately so generation still works without them.
  const seo = await supabase
    .from("company_profiles")
    .select(
      "seo_primary_offer, seo_buyer_problems, seo_content_edge, seo_conversion_action, seo_commercial_url, scope_boundaries"
    )
    .eq("company_id", companyId)
    .maybeSingle();
  const seoRow = seo.error ? {} : seo.data || {};

  return {
    abstract: data?.abstract || "",
    shortDescription: data?.short_description || "",
    competitors: normalizeCompetitors(data?.competitors),
    audience: String(data?.target_audience || "").trim(),
    imageryContext: getImageryContext(data?.design_guide_raw),
    domain: String(data?.domain || "").trim(),
    seoControls: {
      primaryOffer: seoRow.seo_primary_offer || "",
      targetSearcher: String(data?.target_audience || "").trim(),
      buyerProblems: seoRow.seo_buyer_problems || "",
      contentEdge: seoRow.seo_content_edge || "",
      outOfScope: seoRow.scope_boundaries || "",
      conversionAction: seoRow.seo_conversion_action || "",
      commercialUrl: seoRow.seo_commercial_url || "",
    },
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
    headers: { "Content-Type": "application/json" },
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
