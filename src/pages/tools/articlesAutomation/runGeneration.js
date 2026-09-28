import { supabase } from "@/lib/supabase";
import { orderSelectedArticles } from "../articleGeneration/orderSelectedArticles";
import { serializeArticleMarkdown } from "../articleGeneration/serializeArticleMarkdown";
import { updateCoverageDrafted } from "../articleGeneration/updateCoverageDrafted";
import { saveGeneratedArticles } from "../articleGeneration/saveGeneratedArticles";
import { finishHeroImage } from "../articleGeneration/heroImageStorage";
import { downloadArticlesZip } from "../articleGeneration/downloadZip";
import {
  generateAndCropArticleImage,
  generateOneArticle,
  loadCompanyPositioning,
} from "../articleGeneration/singleArticle";

function skippedImageState() {
  return { status: "skipped", result: null, error: null };
}

function pendingImageState() {
  return { status: "pending", result: null, error: null };
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      url: String(item.url || "").trim(),
      note: String(item.note || "").trim(),
    }))
    .filter((item) => item.url || item.note);
}

function buildBatchContextEntry(frontmatter, article) {
  return {
    title: frontmatter.title || article.title || "",
    slug: frontmatter.slug || "",
    type: article.type || "",
    targetKeyword: article.targetKeyword || "",
    oneLinerSummary: frontmatter.description || "",
  };
}

function initJobRows(ordered, withImages) {
  return ordered.map(({ index, article }) => ({
    index,
    title: article.title || "(untitled)",
    type: article.type,
    status: "pending",
    error: null,
    validationErrors: [],
    frontmatter: null,
    body: null,
    markdown: null,
    lengthAdjusted: false,
    whereThingsStandSources: [],
    image: withImages ? pendingImageState() : skippedImageState(),
  }));
}

function cloneJobs(jobs) {
  return jobs.map((job) => ({ ...job, image: { ...job.image } }));
}

function zipNameFromKeywords(pillarKeyword, supportingKeyword) {
  const raw = [pillarKeyword, supportingKeyword].filter(Boolean).join("-");
  const slug =
    raw
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-|-$/g, "") || "articles";
  return `${slug}-drafts.zip`;
}

/**
 * Sequential generate + images (on by default), matching Article Generator.
 */
export async function generateClusterArticles({
  companyId,
  pillarKeyword,
  supportingKeyword,
  articles,
  withImages = true,
  onJobsChange,
  onStep,
  onStatus,
}) {
  const list = Array.isArray(articles) ? articles : [];
  if (!companyId || list.length === 0) {
    throw new Error("Nothing to generate");
  }

  onStatus?.("Loading company positioning…");
  const positioning = await loadCompanyPositioning(companyId);
  const styleContext = positioning.imageryContext || "";
  const selected = new Set(list.map((_, index) => index));
  const ordered = orderSelectedArticles(list, selected);
  const jobs = initJobRows(ordered, withImages);
  onJobsChange?.(cloneJobs(jobs));
  onStep?.(0, ordered.length);

  const context = [];
  const successAcc = [];
  const usedStockIds = new Set();

  for (let step = 0; step < ordered.length; step++) {
    const { index, article } = ordered[step];
    onStep?.(step + 1, ordered.length);
    onStatus?.(
      `Generating ${step + 1} of ${ordered.length}: ${article.title || "(untitled)"}`
    );
    jobs[step] = {
      ...jobs[step],
      status: "running",
      error: null,
      validationErrors: [],
    };
    onJobsChange?.(cloneJobs(jobs));

    try {
      const data = await generateOneArticle({
        positioning,
        article,
        pillarKeyword,
        supportingKeyword,
        batchContext: context,
      });
      const markdown = serializeArticleMarkdown(data.frontmatter, data.body);
      context.push(buildBatchContextEntry(data.frontmatter, article));

      let image = withImages ? pendingImageState() : skippedImageState();
      jobs[step] = {
        ...jobs[step],
        title: article.title || data.frontmatter?.title || "(untitled)",
        status: "done",
        error: null,
        validationErrors: [],
        frontmatter: data.frontmatter,
        body: data.body,
        markdown,
        lengthAdjusted: Boolean(data.lengthAdjusted),
        whereThingsStandSources: normalizeSources(data.whereThingsStandSources),
        image,
      };
      onJobsChange?.(cloneJobs(jobs));

      if (withImages) {
        onStatus?.(
          `Finding hero image ${step + 1} of ${ordered.length}: ${
            article.title || "(untitled)"
          }`
        );
        jobs[step] = {
          ...jobs[step],
          image: { status: "running", result: null, error: null },
        };
        onJobsChange?.(cloneJobs(jobs));
        try {
          const { cropped, meta } = await generateAndCropArticleImage({
            article,
            frontmatter: data.frontmatter,
            styleContext,
            excludeIds: [...usedStockIds],
          });
          image = await finishHeroImage({
            companyId,
            slug: String(data.frontmatter?.slug || "").trim(),
            cropped,
          });
          image = {
            ...image,
            source: meta.source,
            sourceId: meta.sourceId,
            attribution: meta.attribution,
            trail: meta.trail,
          };
          if (meta.source && meta.source !== "openai" && meta.sourceId) {
            usedStockIds.add(String(meta.sourceId));
          }
        } catch (imgErr) {
          image = {
            status: "failed",
            result: null,
            error: imgErr?.message || "Image generation failed",
          };
        }
        jobs[step] = { ...jobs[step], image };
        onJobsChange?.(cloneJobs(jobs));
      }

      successAcc.push(jobs[step]);
    } catch (err) {
      jobs[step] = {
        ...jobs[step],
        status: "failed",
        error: err?.message || "Generation failed",
        validationErrors: err?.validationErrors || [],
        image: skippedImageState(),
      };
      onJobsChange?.(cloneJobs(jobs));
    }
  }

  let coverageWarning = null;
  if (successAcc.length > 0) {
    onStatus?.("Updating coverage to drafted…");
    try {
      const result = await updateCoverageDrafted({
        companyId,
        pillarKeyword,
        supportingKeyword,
        successes: successAcc.map((job) => ({
          targetKeyword: list[job.index]?.targetKeyword,
          title: list[job.index]?.title,
          frontmatter: job.frontmatter,
        })),
      });
      coverageWarning = result.warning || null;
    } catch (err) {
      coverageWarning =
        err?.message ||
        "Coverage store update failed. Downloads are still available.";
    }
  }

  onStatus?.("Generation complete");
  return {
    jobs: cloneJobs(jobs),
    coverageWarning,
    positioning,
  };
}

export async function saveAndDownloadGenerated({
  companyId,
  pillarKeyword,
  supportingKeyword,
  articles,
  jobs,
}) {
  const successJobs = (Array.isArray(jobs) ? jobs : []).filter(
    (job) => job.status === "done" && job.markdown
  );
  if (successJobs.length === 0) {
    throw new Error("No successful articles to save");
  }

  const { error } = await saveGeneratedArticles({
    supabase,
    companyId,
    pillarKeyword,
    supportingKeyword,
    articles: successJobs.map((job) => {
      const article = articles[job.index] || {};
      return {
        type: job.type || article.type,
        targetKeyword: article.targetKeyword || "",
        frontmatter: job.frontmatter,
        body: job.body,
        whereThingsStandSources: job.whereThingsStandSources,
        heroStoragePath: job.image?.storagePath || null,
        heroSource: job.image?.source
          ? {
              source: job.image.source,
              sourceId: job.image.sourceId ?? null,
              attribution: job.image.attribution ?? null,
            }
          : null,
      };
    }),
  });

  if (error) {
    throw error;
  }

  await downloadArticlesZip(
    successJobs.map((job) => ({
      frontmatter: job.frontmatter,
      markdown: job.markdown,
      image:
        job.image?.status === "done" && job.image?.result?.b64_json
          ? job.image.result
          : null,
    })),
    zipNameFromKeywords(pillarKeyword, supportingKeyword)
  );

  return { saved: successJobs.length };
}
