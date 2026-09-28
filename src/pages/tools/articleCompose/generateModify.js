import { loadCompanyPositioning } from "../articleGeneration/singleArticle";
import { todayIso } from "../../../../lib/wire-internal-links/externalLinksYaml.js";
import { countMainBodyWords } from "../../../../lib/generate-article/mainBodyWords.js";
import { countWords, parseAllowedBrands } from "./composeState";
import { updateComposedDraftById } from "./draftRecord";
import { saveComposedDraft } from "./saveComposedDraft";
import { IdeaGenerationError } from "./generateIdea";

function authorSourceLinks(userLinks) {
  const addedAt = todayIso();
  return (Array.isArray(userLinks) ? userLinks : [])
    .map((link) => {
      const url = String(link?.url || "").trim();
      if (!url) return null;
      const anchor = String(link?.anchor || "").trim();
      return {
        label: anchor || url,
        url,
        addedAt,
        kind: "author-source",
      };
    })
    .filter(Boolean);
}

export async function generateModifyArticle({ companyId, state, existingDraftId = "" }) {
  const positioning = await loadCompanyPositioning(companyId);
  const targetKeyword = String(state.targetKeyword || "").trim();
  const expand = state.expandLength === true;
  const wordCount = expand
    ? Number(state.wordCount)
    : countWords(state.sourceArticle);
  const ctaAngle = String(state.ctaAngle || "").trim();
  const checkedLinks = (Array.isArray(state.userLinks) ? state.userLinks : [])
    .filter((link) => link?.checked !== false)
    .map((link) => ({
      url: String(link.url || "").trim(),
      anchor: String(link.anchor || "").trim(),
    }))
    .filter((link) => link.url);

  const res = await fetch("/api/generate-article", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "modify",
      sourceArticle: String(state.sourceArticle || ""),
      expand,
      allowedBrands: parseAllowedBrands(state.allowedBrandsText),
      userLinks: checkedLinks,
      abstract: positioning.abstract,
      shortDescription: positioning.shortDescription,
      competitors: positioning.competitors,
      audience: positioning.audience,
      pillarKeyword: state.pillarKeyword,
      supportingKeyword: state.clusterKeyword,
      article: {
        title: "",
        targetKeyword,
        type: state.articleType,
        searchIntent: "",
        wordCount,
        ctaAngle,
        keyMessages: [],
        expertInput: "",
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
    externalLinks: authorSourceLinks(
      Array.isArray(data.userLinks) ? data.userLinks : checkedLinks
    ),
  };
  const saveInput = {
    companyId,
    pillarKeyword: state.pillarKeyword,
    supportingKeyword: state.clusterKeyword,
    source: "modify",
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
    keyMessages: [],
  };
  const saved = existingDraftId
    ? await updateComposedDraftById({
        ...saveInput,
        draftId: existingDraftId,
        wordCount: Number.isFinite(Number(data.mainBodyWordCount))
          ? Number(data.mainBodyWordCount)
          : countMainBodyWords(data.body || ""),
      })
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
