import { supabase } from "@/lib/supabase";
import { stripNoVolumeTag } from "./stripNoVolumeTag";

function norm(value) {
  return stripNoVolumeTag(value).toLowerCase();
}

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "";
}

export function findPillar(pillars, pillarKeyword) {
  const lower = norm(pillarKeyword);
  const slug = slugify(pillarKeyword);
  return (
    pillars.find((p) => slugify(p.keyword) === slug || p.slug === slug) ||
    pillars.find((p) => norm(p.keyword) === lower) ||
    null
  );
}

export function findSupporting(pillar, supportingKeyword) {
  const supporting = Array.isArray(pillar?.supporting) ? pillar.supporting : [];
  if (!supportingKeyword) return null;
  const lower = norm(supportingKeyword);
  const slug = slugify(supportingKeyword);
  return (
    supporting.find((s) => slugify(s.keyword) === slug || s.slug === slug) ||
    supporting.find((s) => norm(s.keyword) === lower) ||
    null
  );
}

export function articleMatches(item, { targetKeyword, title }) {
  const kw = norm(targetKeyword);
  const t = norm(title);
  if (kw && norm(item?.targetKeyword) === kw) return true;
  if (t && norm(item?.title) === t) return true;
  return false;
}

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

  const pillars = Array.isArray(data?.pillars)
    ? data.pillars.map((p) => ({ ...p }))
    : [];

  const pillar = findPillar(pillars, pillarKeyword);
  if (!pillar) {
    return {
      updated: 0,
      unmatched: list.length,
      pillars,
      warning: `No coverage pillar matched “${pillarKeyword || "(empty)"}”.`,
    };
  }

  const now = new Date().toISOString();
  const url = String(publishedUrl || "").trim();
  let updated = 0;
  let unmatched = 0;

  const markPublished = (existing, frontmatter) => {
    const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
    return {
      ...existing,
      status: "published",
      publishedAt: now,
      updatedAt: now,
      draft: false,
      ...(url ? { publishedUrl: url } : {}),
      ...(fm.title ? { title: String(fm.title) } : {}),
      ...(fm.slug ? { slug: String(fm.slug) } : {}),
    };
  };

  if (!supportingKeyword) {
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

      pillar.pillarArticle = markPublished(current, success.frontmatter);
      updated += 1;
    }
  } else {
    const supporting = findSupporting(pillar, supportingKeyword);
    if (!supporting) {
      return {
        updated: 0,
        unmatched: list.length,
        pillars,
        warning: `No coverage supporting keyword matched “${supportingKeyword}”.`,
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
      planned[idx] = markPublished(planned[idx], success.frontmatter);
      updated += 1;
    }

    supporting.plannedArticles = planned;
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
      updated_at: now,
    },
    { onConflict: "company_id" }
  );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to update content coverage");
  }

  const result = { updated, unmatched, pillars: nextPillars };
  if (unmatched > 0) {
    result.warning = `${unmatched} article${unmatched === 1 ? "" : "s"} could not be marked published in coverage.`;
  }
  return result;
}
