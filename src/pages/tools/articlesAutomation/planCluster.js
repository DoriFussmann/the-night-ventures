import { supabase } from "@/lib/supabase";
import { slugify } from "../clusterImage/slugify";
import { stripNoVolumeTag } from "../articleGeneration/stripNoVolumeTag";

const ARTICLE_TYPES = [
  "comprehensive",
  "howto",
  "comparison",
  "faq",
  "flex",
];

export const DEFAULT_ARTICLE_TYPE_COUNTS = {
  comprehensive: 1,
  howto: 1,
  comparison: 1,
  faq: 1,
  flex: 1,
};

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

export async function syncSupportingFromCompanyData(companyId) {
  try {
    const [profileResult, coverageResult] = await Promise.all([
      supabase
        .from("company_profiles")
        .select("core_keywords")
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("content_coverage")
        .select("id, pillars")
        .eq("company_id", companyId)
        .maybeSingle(),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (coverageResult.error) throw coverageResult.error;

    const coverage = coverageResult.data;
    const coreKeywords = profileResult.data?.core_keywords;
    if (!coverage || !Array.isArray(coreKeywords) || coreKeywords.length === 0) {
      return;
    }

    const pillars = Array.isArray(coverage.pillars) ? coverage.pillars : [];
    let added = false;

    for (const item of coreKeywords) {
      const keyword =
        typeof item === "string"
          ? item.trim()
          : item && typeof item === "object"
            ? String(item.keyword || "").trim()
            : "";
      if (!keyword) continue;

      const pillarSlug = slugify(keyword);
      const coveragePillar = pillars.find(
        (pillar) =>
          String(pillar?.slug || "") === pillarSlug ||
          slugify(pillar?.keyword) === pillarSlug
      );
      if (!coveragePillar) continue;

      const supporting =
        item && typeof item === "object" && Array.isArray(item.supporting)
          ? item.supporting
          : [];

      for (const raw of supporting) {
        if (typeof raw !== "string") continue;
        const supportingKeyword = raw.trim();
        if (!supportingKeyword) continue;

        const supportingSlug = slugify(supportingKeyword);
        const entries = Array.isArray(coveragePillar.supporting)
          ? coveragePillar.supporting
          : [];
        const exists = entries.some(
          (entry) =>
            String(entry?.slug || "") === supportingSlug ||
            slugify(entry?.keyword) === supportingSlug
        );
        if (exists) continue;

        if (!Array.isArray(coveragePillar.supporting)) {
          coveragePillar.supporting = [];
        }
        coveragePillar.supporting.push({
          slug: supportingSlug,
          keyword: supportingKeyword,
          plannedArticles: [],
        });
        added = true;
      }
    }

    if (!added) return;

    const { error } = await supabase
      .from("content_coverage")
      .update({
        pillars,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId);

    if (error) throw error;
  } catch (err) {
    console.error(err);
  }
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

  return {
    companyName: companyResult.data?.name || "",
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
  articleTypeCounts = DEFAULT_ARTICLE_TYPE_COUNTS,
}) {
  const typeCounts = {};
  for (const [type, count] of Object.entries(articleTypeCounts || {})) {
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
        return {
          ...sup,
          plannedArticles,
          clusterRationale: String(clusterRationale || "").trim(),
        };
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
