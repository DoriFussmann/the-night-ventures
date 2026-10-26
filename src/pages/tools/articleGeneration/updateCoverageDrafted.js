import { supabase } from "@/lib/supabase";
import { stripNoVolumeTag } from "./stripNoVolumeTag";
import { advanceSpecStatus } from "../../../../lib/seo-advisor/pillars.js";

import {
  applyCoveragePublished,
  articleMatches,
  findPillar,
  findSupporting,
  norm,
  siteBaseFromDomain,
} from "../../../../lib/publish-schedule/coverage.js";

export { articleMatches, findPillar, findSupporting };

/**
 * Resolve a coverage planned-article / pillarArticle match for a library row.
 * Matching mirrors updateCoverageDrafted (pillar → supporting → targetKeyword/title).
 */
export function findCoverageArticle(pillars, article) {
  const pillarKeyword = article?.pillar_keyword ?? article?.pillarKeyword;
  const supportingKeyword =
    article?.supporting_keyword ?? article?.supportingKeyword;
  const targetKeyword = article?.target_keyword ?? article?.targetKeyword;
  const title = article?.title;

  const pillar = findPillar(
    Array.isArray(pillars) ? pillars : [],
    pillarKeyword
  );
  if (!pillar) return null;

  const isPillar = !String(supportingKeyword || "").trim();
  if (isPillar) {
    const current =
      pillar.pillarArticle && typeof pillar.pillarArticle === "object"
        ? pillar.pillarArticle
        : null;
    if (!current) return null;
    return articleMatches(current, { targetKeyword, title }) ? current : null;
  }

  const supporting = findSupporting(pillar, supportingKeyword);
  if (!supporting) return null;
  const planned = Array.isArray(supporting.plannedArticles)
    ? supporting.plannedArticles
    : [];
  return (
    planned.find((item) => articleMatches(item, { targetKeyword, title })) ||
    null
  );
}

function mergeFrontmatterFields(existing, frontmatter) {
  const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const now = new Date().toISOString();

  return {
    ...existing,
    status: "drafted",
    updatedAt: now,
    ...(fm.title ? { title: String(fm.title) } : {}),
    ...(fm.description != null ? { description: String(fm.description) } : {}),
    ...(fm.slug ? { slug: String(fm.slug) } : {}),
    ...(fm.date ? { date: String(fm.date) } : {}),
    ...(fm.updatedDate ? { updatedDate: String(fm.updatedDate) } : {}),
    ...(fm.category ? { category: String(fm.category) } : {}),
    ...(Array.isArray(fm.tags) ? { tags: fm.tags.map(String) } : {}),
    ...(fm.imageAlt != null ? { imageAlt: String(fm.imageAlt) } : {}),
    ...(Array.isArray(fm.keywords) ? { keywords: fm.keywords.map(String) } : {}),
    ...(Array.isArray(fm.faqs) ? { faqs: fm.faqs } : {}),
    draft: fm.draft !== false,
    author: fm.author ?? null,
    ...(Array.isArray(fm.internalLinks)
      ? { internalLinks: fm.internalLinks }
      : {}),
    ...(Array.isArray(fm.externalLinks)
      ? { externalLinks: fm.externalLinks }
      : {}),
    image: fm.image ?? null,
    image2: fm.image2 ?? null,
    image3: fm.image3 ?? null,
  };
}

/**
 * Mark matched coverage articles as drafted and persist generated frontmatter.
 *
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string} opts.pillarKeyword
 * @param {string} [opts.supportingKeyword]
 * @param {Array<{ targetKeyword?: string, title?: string, frontmatter: object }>} opts.successes
 * @returns {Promise<{ updated: number, unmatched: number, warning?: string }>}
 */
export async function updateCoverageDrafted({
  companyId,
  pillarKeyword,
  supportingKeyword,
  successes,
}) {
  const list = Array.isArray(successes) ? successes : [];
  if (!companyId || list.length === 0) {
    return { updated: 0, unmatched: list.length };
  }

  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }

  const pillars = Array.isArray(data?.pillars)
    ? data.pillars.map((p) => ({ ...p }))
    : [];

  const pillar = findPillar(pillars, pillarKeyword);
  if (!pillar) {
    return {
      updated: 0,
      unmatched: list.length,
      warning: `No coverage pillar matched “${pillarKeyword || "(empty)"}”. Downloads are still available.`,
    };
  }

  const isPillarArticle = !supportingKeyword;
  let updated = 0;
  let unmatched = 0;

  if (isPillarArticle) {
    for (const success of list) {
      const current =
        pillar.pillarArticle && typeof pillar.pillarArticle === "object"
          ? pillar.pillarArticle
          : { status: "planned" };

      const matches =
        !pillar.pillarArticle ||
        typeof pillar.pillarArticle !== "object" ||
        articleMatches(current, success) ||
        (!current.targetKeyword && !current.title);

      if (!matches) {
        unmatched += 1;
        continue;
      }

      pillar.pillarArticle = mergeFrontmatterFields(current, success.frontmatter);
      Object.assign(pillar, advanceSpecStatus(pillar, "drafted", { type: "core" }));
      updated += 1;
    }
  } else {
    const supporting = findSupporting(pillar, supportingKeyword);
    if (!supporting) {
      return {
        updated: 0,
        unmatched: list.length,
        warning: `No coverage supporting keyword matched “${supportingKeyword}”. Downloads are still available.`,
      };
    }

    const planned = Array.isArray(supporting.plannedArticles)
      ? [...supporting.plannedArticles]
      : [];

    for (const success of list) {
      const idx = planned.findIndex((item) => articleMatches(item, success));
      if (idx === -1) {
        unmatched += 1;
        continue;
      }
      planned[idx] = mergeFrontmatterFields(planned[idx], success.frontmatter);
      updated += 1;
    }

    supporting.plannedArticles = planned;
    if (updated > 0) Object.assign(supporting, advanceSpecStatus(supporting, "drafted"));

    pillar.supporting = (pillar.supporting || []).map((s) =>
      s.slug === supporting.slug || norm(s.keyword) === norm(supporting.keyword)
        ? supporting
        : s
    );
  }

  const nextPillars = pillars.map((p) =>
    p.slug === pillar.slug || norm(p.keyword) === norm(pillar.keyword)
      ? pillar
      : p
  );

  const { error: upsertError } = await supabase.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars: nextPillars,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to update content coverage");
  }

  const result = { updated, unmatched };
  if (unmatched > 0) {
    result.warning = `${unmatched} article${unmatched === 1 ? "" : "s"} could not be matched in coverage. Downloads are still available.`;
  }
  return result;
}

function newPlannedArticleId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `art_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Add one planned article to a supporting keyword when generation did not
 * match an existing coverage entry. Status is drafted after frontmatter merge.
 */
export async function appendPlannedArticle({
  companyId,
  pillarKeyword,
  supportingKeyword,
  article,
}) {
  if (!companyId) throw new Error("Missing companyId");

  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }

  const pillars = Array.isArray(data?.pillars)
    ? data.pillars.map((p) => ({ ...p }))
    : [];
  const pillar = findPillar(pillars, pillarKeyword);
  if (!pillar) {
    throw new Error(
      `No coverage pillar matched “${pillarKeyword || "(empty)"}”.`
    );
  }
  const supporting = findSupporting(pillar, supportingKeyword);
  if (!supporting) {
    throw new Error(
      `No coverage supporting keyword matched “${supportingKeyword}”.`
    );
  }

  const fm =
    article?.frontmatter && typeof article.frontmatter === "object"
      ? article.frontmatter
      : {};
  const now = new Date().toISOString();
  const keyMessages = (Array.isArray(article?.keyMessages) ? article.keyMessages : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const base = {
    id: newPlannedArticleId(),
    title: String(article?.title || fm.title || "").trim(),
    targetKeyword: stripNoVolumeTag(article?.targetKeyword || ""),
    type: article?.type || "flex",
    status: "planned",
    searchIntent: article?.searchIntent ?? "",
    keyMessages,
    wordCount: Number(article?.wordCount) || 0,
    internalLinks: Array.isArray(article?.internalLinks)
      ? article.internalLinks.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    ctaAngle: article?.ctaAngle ?? "",
    updatedAt: now,
  };
  const entry = mergeFrontmatterFields(base, fm);

  const planned = Array.isArray(supporting.plannedArticles)
    ? [...supporting.plannedArticles]
    : [];
  planned.push(entry);
  supporting.plannedArticles = planned;
  Object.assign(supporting, advanceSpecStatus(supporting, "drafted"));
  pillar.supporting = (pillar.supporting || []).map((s) =>
    s.slug === supporting.slug || norm(s.keyword) === norm(supporting.keyword)
      ? supporting
      : s
  );

  const nextPillars = pillars.map((p) =>
    p.slug === pillar.slug || norm(p.keyword) === norm(pillar.keyword)
      ? pillar
      : p
  );

  const { error: upsertError } = await supabase.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars: nextPillars,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to update content coverage");
  }

  return entry;
}

function entrySlug(item) {
  return String(item?.slug || "").trim();
}

/**
 * Place one composed article in coverage. A plannedArticles entry belongs to
 * one article: merge only when it has no slug yet, or its slug is this
 * article's slug. Any other match gets a new entry.
 */
export async function upsertComposedCoverage({
  companyId,
  pillarKeyword,
  supportingKeyword,
  article,
}) {
  if (!companyId) throw new Error("Missing companyId");

  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }

  const pillars = Array.isArray(data?.pillars)
    ? data.pillars.map((p) => ({ ...p }))
    : [];
  const pillar = findPillar(pillars, pillarKeyword);
  if (!pillar) {
    throw new Error(
      `No coverage pillar matched “${pillarKeyword || "(empty)"}”.`
    );
  }
  const supporting = findSupporting(pillar, supportingKeyword);
  if (!supporting) {
    throw new Error(
      `No coverage supporting keyword matched “${supportingKeyword}”.`
    );
  }

  const fm =
    article?.frontmatter && typeof article.frontmatter === "object"
      ? article.frontmatter
      : {};
  const slug = String(fm.slug || "").trim();
  const planned = Array.isArray(supporting.plannedArticles)
    ? [...supporting.plannedArticles]
    : [];

  let index = slug
    ? planned.findIndex((item) => entrySlug(item) === slug)
    : -1;
  if (index === -1) {
    index = planned.findIndex(
      (item) =>
        !entrySlug(item) &&
        articleMatches(item, {
          targetKeyword: article?.targetKeyword,
          title: article?.title || fm.title,
        })
    );
  }

  if (index === -1) {
    return appendPlannedArticle({
      companyId,
      pillarKeyword,
      supportingKeyword,
      article,
    });
  }

  planned[index] = mergeFrontmatterFields(planned[index], fm);
  supporting.plannedArticles = planned;
  pillar.supporting = (pillar.supporting || []).map((s) =>
    s.slug === supporting.slug || norm(s.keyword) === norm(supporting.keyword)
      ? supporting
      : s
  );
  const nextPillars = pillars.map((p) =>
    p.slug === pillar.slug || norm(p.keyword) === norm(pillar.keyword)
      ? pillar
      : p
  );

  const { error: upsertError } = await supabase.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars: nextPillars,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to update content coverage");
  }

  return planned[index];
}

/**
 * Mark matched coverage articles as published after a successful site commit.
 *
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string} opts.pillarKeyword
 * @param {string} [opts.supportingKeyword]
 * @param {Array<{ targetKeyword?: string, title?: string, frontmatter?: object }>} opts.successes
 * @param {string} [opts.publishedUrl]
 * @returns {Promise<{ updated: number, unmatched: number, pillars: object[], warning?: string }>}
 */
/** https://<domain> from Company Intelligence, for building live article URLs. */
async function loadSiteBase(companyId) {
  const { data } = await supabase
    .from("company_profiles")
    .select("domain")
    .eq("company_id", companyId)
    .maybeSingle();
  return siteBaseFromDomain(data?.domain);
}

export async function updateCoveragePublished({
  companyId,
  pillarKeyword,
  supportingKeyword,
  successes,
  publishedUrl,
}) {
  const list = Array.isArray(successes) ? successes : [];
  if (!companyId || list.length === 0) {
    return { updated: 0, unmatched: list.length, pillars: [] };
  }

  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }

  const now = new Date().toISOString();
  const siteBase = publishedUrl ? "" : await loadSiteBase(companyId);
  const result = applyCoveragePublished(data?.pillars, {
    pillarKeyword,
    supportingKeyword,
    successes: list,
    publishedUrl,
    siteBase,
    now,
  });
  // No matching pillar / supporting keyword: nothing to save.
  if (result.updated === 0 && result.warning?.startsWith("No coverage")) return result;

  const { error: upsertError } = await supabase.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars: result.pillars,
      updated_at: now,
    },
    { onConflict: "company_id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to update content coverage");
  }

  return result;
}

async function loadCoveragePillars(companyId) {
  const { data, error } = await supabase
    .from("content_coverage")
    .select("pillars")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message || "Failed to load content coverage");
  }
  return Array.isArray(data?.pillars) ? data.pillars.map((p) => ({ ...p })) : [];
}

async function saveCoveragePillars(companyId, pillars) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("content_coverage").upsert(
    {
      company_id: companyId,
      pillars,
      updated_at: now,
    },
    { onConflict: "company_id" }
  );
  if (error) {
    throw new Error(error.message || "Failed to update content coverage");
  }
}

function replacePlannedBySlug(pillars, pillarKeyword, supportingKeyword, matchSlug, replace, specStatus) {
  const slug = String(matchSlug || "").trim();
  const pillar = findPillar(pillars, pillarKeyword);
  if (!pillar) {
    return { pillars, warning: `No coverage pillar matched “${pillarKeyword || "(empty)"}”.` };
  }
  const supporting = findSupporting(pillar, supportingKeyword);
  if (!supporting) {
    return {
      pillars,
      warning: `No coverage supporting keyword matched “${supportingKeyword}”.`,
    };
  }
  const planned = Array.isArray(supporting.plannedArticles)
    ? [...supporting.plannedArticles]
    : [];
  const index = planned.findIndex((item) => entrySlug(item) === slug);
  if (index === -1) {
    return { pillars, warning: `No coverage entry with slug “${slug}”.` };
  }
  planned[index] = replace(planned[index]);
  supporting.plannedArticles = planned;
  if (specStatus) {
    Object.assign(supporting, advanceSpecStatus(supporting, specStatus.status, { url: specStatus.url }));
  }
  pillar.supporting = (pillar.supporting || []).map((item) =>
    item.slug === supporting.slug || norm(item.keyword) === norm(supporting.keyword)
      ? supporting
      : item
  );
  const nextPillars = pillars.map((item) =>
    item.slug === pillar.slug || norm(item.keyword) === norm(pillar.keyword)
      ? pillar
      : item
  );
  return { pillars: nextPillars, updated: true };
}

/**
 * Refresh the planned article that already belongs to this draft, matched by slug.
 * A slug edit updates that same entry. It does not append another one.
 */
export async function syncComposedCoverageBySlug({
  companyId,
  pillarKeyword,
  supportingKeyword,
  matchSlug,
  frontmatter,
  wordCount,
}) {
  const pillars = await loadCoveragePillars(companyId);
  const replaced = replacePlannedBySlug(
    pillars,
    pillarKeyword,
    supportingKeyword,
    matchSlug,
    (existing) => {
      const next = mergeFrontmatterFields(existing, frontmatter);
      if (wordCount != null && Number.isFinite(Number(wordCount))) {
        next.wordCount = Number(wordCount) || 0;
      }
      return next;
    },
    { status: "drafted" }
  );
  if (!replaced.updated) {
    return { updated: false, warning: replaced.warning || "" };
  }
  await saveCoveragePillars(companyId, replaced.pillars);
  return { updated: true };
}

/**
 * Mark one composed article published by its slug.
 * Never matches on target keyword or title, so two drafts that share a
 * keyword stay independent. updateCoveragePublished is unchanged for Cluster.
 */
export async function markComposedCoveragePublished({
  companyId,
  pillarKeyword,
  supportingKeyword,
  slug,
  publishedUrl,
}) {
  const pillars = await loadCoveragePillars(companyId);
  const now = new Date().toISOString();
  const url = String(publishedUrl || "").trim();
  const replaced = replacePlannedBySlug(
    pillars,
    pillarKeyword,
    supportingKeyword,
    slug,
    (existing) => ({
      ...existing,
      status: "published",
      publishedAt: now,
      updatedAt: now,
      draft: false,
      ...(url ? { publishedUrl: url } : {}),
    }),
    { status: "live", url }
  );
  if (!replaced.updated) {
    return { updated: false, warning: replaced.warning || "" };
  }
  await saveCoveragePillars(companyId, replaced.pillars);
  return { updated: true };
}
