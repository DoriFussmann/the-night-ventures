import { loadCompanyPositioning } from "../articleGeneration/singleArticle";
import { nonEmptyKeyPoints, parseAllowedBrands } from "./composeState";
import { updateComposedDraftById } from "./draftRecord";
import { saveComposedDraft } from "./saveComposedDraft";

export class IdeaGenerationError extends Error {
  constructor(message, validationErrors = []) {
    super(message);
    this.name = "IdeaGenerationError";
    this.validationErrors = Array.isArray(validationErrors)
      ? validationErrors.map((item) => String(item))
      : [];
  }
}

export async function generateIdeaArticle({ companyId, state, existingDraftId = "" }) {
  const positioning = await loadCompanyPositioning(companyId);
  const points = nonEmptyKeyPoints(state.keyPoints);
  const targetKeyword = String(state.targetKeyword || "").trim();
  const wordCount = Number(state.wordCount);
  const ctaAngle = String(state.ctaAngle || "").trim();

  const res = await fetch("/api/generate-article", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "idea",
      abstract: positioning.abstract,
      shortDescription: positioning.shortDescription,
      competitors: positioning.competitors,
      audience: positioning.audience,
      pillarKeyword: state.pillarKeyword,
      supportingKeyword: state.clusterKeyword,
      allowedBrands: parseAllowedBrands(state.allowedBrandsText),
      article: {
        title: "",
        targetKeyword,
        type: state.articleType,
        searchIntent: "",
        wordCount,
        ctaAngle,
        keyMessages: points,
        expertInput: String(state.ideaText || ""),
      },
    }),
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new IdeaGenerationError(
      data.error || `Generation failed (${res.status})`,
      data.validationErrors
    );
  }

  const frontmatter = {
    ...(data.frontmatter && typeof data.frontmatter === "object"
      ? data.frontmatter
      : {}),
  };
  const saveInput = {
    companyId,
    pillarKeyword: state.pillarKeyword,
    supportingKeyword: state.clusterKeyword,
    source: "idea",
    type: state.articleType,
    targetKeyword,
    frontmatter,
    body: data.body || "",
    whereThingsStandSources: Array.isArray(data.whereThingsStandSources)
      ? data.whereThingsStandSources
      : [],
    wordCount,
    ctaAngle,
    searchIntent: "",
    keyMessages: points,
  };
  const saved = existingDraftId
    ? await updateComposedDraftById({ ...saveInput, draftId: existingDraftId })
    : await saveComposedDraft(saveInput);
  if (saved.slugChangedFrom) {
    frontmatter.slug = saved.row.slug;
  }
  if (saved.frontmatter?.slug) {
    frontmatter.slug = saved.frontmatter.slug;
  }

  return {
    draftId: String(saved.row.id),
    frontmatter,
    body: data.body || "",
    whereThingsStandSources: Array.isArray(data.whereThingsStandSources)
      ? data.whereThingsStandSources
      : [],
    slugNote: saved.slugChangedFrom
      ? `Slug changed to ${saved.row.slug} because ${saved.slugChangedFrom} already exists.`
      : "",
    coverageWarning: saved.coverageWarning,
  };
}
