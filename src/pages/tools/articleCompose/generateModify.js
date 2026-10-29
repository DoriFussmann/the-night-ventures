import { loadCompanyPositioning } from "../articleGeneration/singleArticle";
import { todayIso } from "../../../../lib/wire-internal-links/externalLinksYaml.js";
import { countMainBodyWords } from "../../../../lib/generate-article/mainBodyWords.js";
import { countWords, modifyKeywordOptions, parseAllowedBrands } from "./composeState";
import { saveHeroOnDraft, updateComposedDraftById } from "./draftRecord";
import { keepWriterImages } from "../../../../lib/writer-intake/markdown.js";
import {
  bodyWithStoredImages,
  heroImageNumber,
  sourceForGeneration,
  applyWriterHero,
  writerBriefForGeneration,
} from "./writerIntake";
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

export async function generateModifyArticle({
  companyId,
  state,
  existingDraftId = "",
  pillars = [],
}) {
  const positioning = await loadCompanyPositioning(companyId);
  const targetKeyword = String(state.targetKeyword || "").trim();
  const pillarKeyword = String(state.pillarKeyword || "").trim();
  const clusterKeyword = String(state.clusterKeyword || "").trim();
  const chosen = Boolean(pillarKeyword && clusterKeyword && targetKeyword);
  const keywordOptions = chosen ? [] : modifyKeywordOptions(pillars);
  const expand = state.expandLength === true;
  const intake = state.intake || null;
  const choices = state.imageChoices || {};
  const option =
    intake && Number.isInteger(state.selectedOption) ? intake.options?.[state.selectedOption] : null;
  // Only images placed in the article go to the model; without an intake none do.
  const sourceArticle = intake
    ? sourceForGeneration(state.sourceArticle, choices)
    : keepWriterImages(state.sourceArticle, []);
  const writerBrief = writerBriefForGeneration({
    intake,
    choices,
    option,
    domain: positioning.domain,
  });
  const wordCount = expand
    ? Number(state.wordCount)
    : countWords(sourceArticle);
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
      sourceArticle,
      expand,
      writerBrief,
      seoControls: positioning.seoControls,
      allowedBrands: parseAllowedBrands(state.allowedBrandsText),
      userLinks: checkedLinks,
      abstract: positioning.abstract,
      shortDescription: positioning.shortDescription,
      competitors: positioning.competitors,
      audience: positioning.audience,
      pillarKeyword: chosen ? pillarKeyword : "",
      supportingKeyword: chosen ? clusterKeyword : "",
      keywordOptions,
      article: {
        title: "",
        targetKeyword: chosen ? targetKeyword : "",
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
  const assigned = data.assignment && typeof data.assignment === "object" ? data.assignment : {};
  const savedPillar = String(assigned.pillarKeyword || pillarKeyword).trim();
  const savedCluster = String(assigned.supportingKeyword || clusterKeyword).trim();
  const savedTarget = String(assigned.targetKeyword || targetKeyword).trim();
  const savedType = String(assigned.articleType || state.articleType).trim() || state.articleType;
  const body = bodyWithStoredImages(data.body || "", state.writerImages);
  const saveInput = {
    companyId,
    pillarKeyword: savedPillar,
    supportingKeyword: savedCluster,
    source: "modify",
    type: savedType,
    targetKeyword: savedTarget,
    frontmatter,
    body,
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
          : countMainBodyWords(body),
      })
    : await saveComposedDraft(saveInput);
  if (saved.slugChangedFrom) {
    frontmatter.slug = saved.row.slug;
  }
  if (saved.frontmatter?.slug) {
    frontmatter.slug = saved.frontmatter.slug;
  }

  // The writer's hero image, unless the user left every image out.
  let hero = null;
  const heroN = intake ? heroImageNumber(choices) : null;
  const heroImage = (state.writerImages || []).find((img) => img.n === heroN);
  if (heroImage) {
    hero = await applyWriterHero({ companyId, slug: saved.row.slug, image: heroImage });
    if (hero) {
      await saveHeroOnDraft({
        companyId,
        draftId: String(saved.row.id),
        storagePath: hero.storagePath,
        heroSource: hero.heroSource,
      });
    }
  }

  return {
    draftId: String(saved.row.id),
    pillarKeyword: savedPillar,
    clusterKeyword: savedCluster,
    targetKeyword: savedTarget,
    articleType: savedType,
    frontmatter,
    body,
    whereThingsStandSources: Array.isArray(data.whereThingsStandSources)
      ? data.whereThingsStandSources
      : [],
    heroStoragePath: hero?.storagePath || "",
    heroSource: hero?.heroSource || null,
    missingImages: Array.isArray(data.missingImages) ? data.missingImages : [],
    slugNote: saved.slugChangedFrom
      ? `Slug changed to ${saved.row.slug} because ${saved.slugChangedFrom} already exists.`
      : "",
    coverageWarning: saved.coverageWarning,
  };
}
