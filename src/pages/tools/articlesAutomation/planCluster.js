import { supabase } from "@/lib/supabase";
import { stripNoVolumeTag } from "../articleGeneration/stripNoVolumeTag";
import { advanceSpecStatus, slugifyKeyword } from "../../../../lib/seo-advisor/pillars.js";
import { writtenArticlesFromMap } from "../../../../lib/seo-advisor/serpOverlap.js";
import {
  blockingOverlaps,
  findKeywordOverlaps,
  summarizeOverlaps,
} from "../../../../lib/keyword-overlap.js";

/**
 * Cannibalization guard: the article about to be planned must not target the
 * same query as an article already written for the map.
 */
export function plannedArticleClashes({ pillars, pillarKeyword, supportingKeyword, spec }) {
  const keyword = supportingKeyword || pillarKeyword;
  const target = spec?.primaryKeyword || keyword;
  const isPillar = !supportingKeyword || supportingKeyword === pillarKeyword;
  return blockingOverlaps(
    findKeywordOverlaps(
      {
        slug: slugifyKeyword(target),
        targetKeyword: target,
        pillarKeyword,
        supportingKeyword: isPillar ? "" : supportingKeyword,
        articleType: isPillar ? "comprehensive" : "flex",
      },
      writtenArticlesFromMap(pillars, { exceptKeyword: keyword })
    )
  );
}

const ARTICLE_TYPES = [
  "comprehensive",
  "howto",
  "comparison",
  "faq",
  "flex",
];

/** Legacy multi-article cluster. Kept only for callers that still pass counts. */
export const DEFAULT_ARTICLE_TYPE_COUNTS = {
  comprehensive: 1,
};

/** Spec format → planner article type (one article per keyword). */
export const TYPE_BY_FORMAT = {
  guide: "comprehensive",
  "how-to": "howto",
  comparison: "comparison",
  faq: "faq",
  list: "flex",
  template: "flex",
  explainer: "flex",
};

export function articleTypeForSpec(spec, { isPillar = false } = {}) {
  if (isPillar) return "comprehensive";
  return TYPE_BY_FORMAT[spec?.format] || "comprehensive";
}

/** The parts of a keyword's spec the planner and writer use. */
export function plannerSpec(entry, keyword) {
  const spec = entry?.spec && typeof entry.spec === "object" ? entry.spec : {};
  return {
    primaryKeyword: String(spec.primaryKeyword || "").trim() || keyword,
    angle: String(spec.angle || "").trim(),
    keyMessages: asStringArray(spec.keyMessages),
    format: String(spec.format || "").trim(),
    secondaryKeywords: asStringArray(spec.secondaryKeywords),
    expertNotes: String(spec.expertNotes || "").trim(),
  };
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `art_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function pillarArticleStatus(pillarArticle) {
  if (!pillarArticle) return "missing";
  if (typeof pillarArticle === "string") return pillarArticle;
  return pillarArticle.status || "missing";
}

export function buildContentMapPayload(pillars) {
  return (Array.isArray(pillars) ? pillars : []).map((pillar) => ({
    keyword: pillar.keyword,
    pillarArticle: pillar.pillarArticle
      ? { status: pillarArticleStatus(pillar.pillarArticle) }
      : null,
    supporting: (pillar.supporting || []).map((sup) => ({
      keyword: sup.keyword,
      articles: (sup.plannedArticles || []).map((article) => ({
        title: article.title,
        targetKeyword: article.targetKeyword,
        type: article.type,
        status: article.status,
      })),
    })),
  }));
}

export function normalizeProposalArticles(articles) {
  if (!Array.isArray(articles)) return [];
  return articles
    .map((raw) => {
      const type = ARTICLE_TYPES.includes(raw?.type) ? raw.type : "flex";
      const wordCountRaw = Number(raw?.wordCount);
      return {
        id: newId(),
        title: String(raw?.title || "").trim(),
        targetKeyword: stripNoVolumeTag(raw?.targetKeyword),
        type,
        searchIntent: String(raw?.searchIntent || "").trim(),
        keyMessages: asStringArray(raw?.keyMessages),
        wordCount: Number.isFinite(wordCountRaw)
          ? wordCountRaw
          : type === "comprehensive"
            ? 2000
            : 1500,
        internalLinks: asStringArray(raw?.internalLinks),
        ctaAngle: String(raw?.ctaAngle || "").trim(),
        angle: String(raw?.angle || "").trim(),
        secondaryKeywords: asStringArray(raw?.secondaryKeywords),
        expertInput: String(raw?.expertInput || "").trim(),
      };
    })
    .filter((item) => item.title && item.targetKeyword);
}

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

export async function loadAutomationContext(companyId) {
  const [companyResult, profileResult, coverageResult] = await Promise.all([
    supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
    supabase
      .from("company_profiles")
      .select("abstract, short_description, competitors, target_audience, domain")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("content_coverage")
      .select("pillars")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  if (companyResult.error) {
    throw new Error(companyResult.error.message || "Failed to load company");
  }
  if (profileResult.error) {
    throw new Error(
      profileResult.error.message || "Failed to load company data"
    );
  }
  if (coverageResult.error) {
    throw new Error(
      coverageResult.error.message || "Failed to load content coverage"
    );
  }

  // SEO Controls (migration 065); optional so planning works without them.
  const seo = await supabase
    .from("company_profiles")
    .select("seo_conversion_action")
    .eq("company_id", companyId)
    .maybeSingle();

  return {
    companyName: companyResult.data?.name || "",
    conversionAction: seo.error ? "" : String(seo.data?.seo_conversion_action || "").trim(),
    abstract: profileResult.data?.abstract || "",
    shortDescription: profileResult.data?.short_description || "",
    audience: String(profileResult.data?.target_audience || "").trim(),
    domain: String(profileResult.data?.domain || "").trim(),
    competitors: normalizeCompetitors(profileResult.data?.competitors),
    pillars: Array.isArray(coverageResult.data?.pillars)
      ? coverageResult.data.pillars
      : [],
  };
}

export async function requestClusterPlan({
  pillarKeyword,
  supportingKeyword,
  abstract,
  shortDescription,
  audience,
  competitors,
  pillars,
  spec,
  articleTypeCounts,
  conversionAction,
}) {
  // One keyword = one article: the type comes from the spec's format.
  const counts = spec
    ? { [articleTypeForSpec(spec)]: 1 }
    : articleTypeCounts || DEFAULT_ARTICLE_TYPE_COUNTS;
  if (spec) {
    const clashes = plannedArticleClashes({ pillars, pillarKeyword, supportingKeyword, spec });
    if (clashes.length > 0) {
      throw new Error(
        `${summarizeOverlaps(clashes)} Change the primary keyword in the spec, or fold it into that article.`
      );
    }
  }
  const typeCounts = {};
  for (const [type, count] of Object.entries(counts || {})) {
    const n = Number(count);
    if (Number.isInteger(n) && n >= 1) typeCounts[type] = n;
  }
  if (Object.keys(typeCounts).length === 0) {
    throw new Error("Select at least one article type");
  }

  const res = await fetch("/api/plan-cluster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pillarKeyword,
      supportingKeyword,
      abstract,
      shortDescription,
      audience,
      contentMap: buildContentMapPayload(pillars),
      competitors,
      articleTypeCounts: typeCounts,
      ...(spec ? { spec } : {}),
      ...(conversionAction ? { conversionAction } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Plan cluster failed (${res.status})`);
  }

  const articles = normalizeProposalArticles(data.articles);
  if (!articles.length) {
    throw new Error("No articles returned in proposal");
  }

  return {
    clusterRationale: String(data.clusterRationale || "").trim(),
    articles,
  };
}

function matchesCoverageNode(item, slug, keyword) {
  if (slug && item?.slug === slug) return true;
  if (
    keyword &&
    String(item?.keyword || "").trim().toLowerCase() ===
      String(keyword).trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

export async function persistPlannedCluster({
  companyId,
  pillarSlug,
  pillarKeyword,
  supportingSlug,
  supportingKeyword,
  articles,
  clusterRationale,
}) {
  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }

  const pillars = Array.isArray(data?.pillars) ? data.pillars : [];
  const now = new Date().toISOString();
  const plannedArticles = (Array.isArray(articles) ? articles : []).map(
    (item) => ({
      id: item.id || newId(),
      title: item.title,
      targetKeyword: stripNoVolumeTag(item.targetKeyword),
      type: item.type,
      status: "planned",
      searchIntent: item.searchIntent || undefined,
      keyMessages: asStringArray(item.keyMessages),
      wordCount: item.wordCount,
      internalLinks: asStringArray(item.internalLinks),
      ctaAngle: item.ctaAngle || undefined,
      angle: item.angle || undefined,
      secondaryKeywords: asStringArray(item.secondaryKeywords),
      expertInput: item.expertInput || undefined,
      updatedAt: now,
    })
  );

  let found = false;
  const next = pillars.map((pillar) => {
    if (!matchesCoverageNode(pillar, pillarSlug, pillarKeyword)) return pillar;
    return {
      ...pillar,
      supporting: (pillar.supporting || []).map((sup) => {
        if (!matchesCoverageNode(sup, supportingSlug, supportingKeyword)) {
          return sup;
        }
        found = true;
        return advanceSpecStatus(
          {
            ...sup,
            plannedArticles,
            clusterRationale: String(clusterRationale || "").trim(),
          },
          "planned"
        );
      }),
    };
  });

  if (!found) {
    throw new Error(
      `Could not find cluster “${supportingKeyword || supportingSlug}” under pillar “${
        pillarKeyword || pillarSlug
      }” in coverage.`
    );
  }

  const { error: upsertError } = await supabase
    .from("content_coverage")
    .upsert(
      {
        company_id: companyId,
        pillars: next,
        updated_at: now,
      },
      { onConflict: "company_id" }
    );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to save coverage");
  }

  return { pillars: next, plannedArticles };
}
