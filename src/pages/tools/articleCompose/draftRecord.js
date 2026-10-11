import { supabase } from "@/lib/supabase";
import { buildGeneratedArticleRow } from "../articleGeneration/saveGeneratedArticles";
import { syncComposedCoverageBySlug } from "../articleGeneration/updateCoverageDrafted";

export class SlugTakenError extends Error {
  constructor(slug) {
    super(`Slug “${slug}” is already used by another article in this company.`);
    this.name = "SlugTakenError";
    this.slug = slug;
  }
}

const DRAFT_COLUMNS = [
  "id",
  "pillar_keyword",
  "supporting_keyword",
  "type",
  "target_keyword",
  "status",
  "title",
  "h1",
  "description",
  "slug",
  "date",
  "updated_date",
  "author",
  "category",
  "tags",
  "image_alt",
  "keywords",
  "draft",
  "internal_links",
  "external_links",
  "faqs",
  "body",
  "where_things_stand_sources",
  "hero_storage_path",
  "hero_source",
  "published_at",
  "published_url",
  "source",
].join(", ");

export async function loadComposeDraft({ companyId, id }) {
  const { data, error } = await supabase
    .from("generated_articles")
    .select(DRAFT_COLUMNS)
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to load the draft");
  return data;
}

export function frontmatterFromRow(row) {
  return {
    title: row?.title || "",
    h1: row?.h1 || "",
    description: row?.description || "",
    slug: row?.slug || "",
    date: row?.date || null,
    updatedDate: row?.updated_date || null,
    author: row?.author ?? null,
    category: row?.category || "",
    tags: Array.isArray(row?.tags) ? row.tags : [],
    imageAlt: row?.image_alt || "",
    keywords: Array.isArray(row?.keywords) ? row.keywords : [],
    faqs: Array.isArray(row?.faqs) ? row.faqs : [],
    draft: row?.draft !== false,
    internalLinks: Array.isArray(row?.internal_links) ? row.internal_links : [],
    externalLinks: Array.isArray(row?.external_links) ? row.external_links : [],
    pillarKeyword: row?.pillar_keyword || "",
    supportingKeyword: row?.supporting_keyword || "",
    articleType: row?.type || "flex",
    targetKeyword: row?.target_keyword || "",
  };
}

export function composePatchFromRow(row) {
  const frontmatter = frontmatterFromRow(row);
  const hero = String(row?.hero_storage_path || "").trim();
  const body = String(row?.body || "");
  const published = row?.status === "published";
  let stage = "review";
  if (published) stage = "publish";
  else if (body.trim() && !hero) stage = "image";
  return {
    stage,
    pillarKeyword: row?.pillar_keyword || "",
    clusterKeyword: row?.supporting_keyword || "",
    targetKeyword: row?.target_keyword || "",
    articleType: row?.type || "flex",
    draftId: String(row?.id || ""),
    savedSlug: row?.slug || "",
    frontmatter,
    body,
    whereThingsStandSources: Array.isArray(row?.where_things_stand_sources)
      ? row.where_things_stand_sources
      : [],
    heroStoragePath: hero,
    heroSource:
      row?.hero_source && typeof row.hero_source === "object" ? row.hero_source : null,
    status: row?.status || "drafted",
    publishedUrl: row?.published_url || "",
    dirty: false,
    originalSource: "",
    showOriginal: false,
    resumeLoading: false,
    resumeError: "",
    slugConflict: "",
    generationError: "",
    validationErrors: [],
    publishDone: false,
    wireFinished: false,
    publishError: "",
    publishProgress: "",
  };
}

export async function nextFreeSlug(companyId, slug, exceptId = "") {
  const base = String(slug || "").trim();
  if (!base) return { slug: base, changedFrom: "" };
  const skip = String(exceptId || "");

  let candidate = base;
  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const { data, error } = await supabase
      .from("generated_articles")
      .select("id")
      .eq("company_id", companyId)
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw new Error(error.message || "Failed to check slug");
    if (!data || (skip && data.id === skip)) {
      return {
        slug: candidate,
        changedFrom: candidate === base ? "" : base,
      };
    }
    candidate = `${base}-${suffix}`;
  }
  throw new Error("Could not find a free slug");
}

async function slugOwnedByOther(companyId, slug, exceptId) {
  const { data, error } = await supabase
    .from("generated_articles")
    .select("id")
    .eq("company_id", companyId)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to check slug");
  if (!data) return false;
  return data.id !== exceptId;
}

async function writeDraftRow({
  companyId,
  draftId,
  pillarKeyword,
  supportingKeyword,
  type,
  targetKeyword,
  frontmatter,
  body,
  whereThingsStandSources,
  source,
}) {
  const row = buildGeneratedArticleRow({
    companyId,
    pillarKeyword,
    supportingKeyword,
    type,
    targetKeyword,
    frontmatter,
    body,
    whereThingsStandSources,
    source,
    status: "drafted",
  });
  const { data, error } = await supabase
    .from("generated_articles")
    .update(row)
    .eq("id", draftId)
    .eq("company_id", companyId)
    .select("id, slug")
    .single();
  if (error) throw new Error(error.message || "Failed to update the draft");
  if (!data?.id) throw new Error("Draft update did not return a row.");
  return data;
}

export async function saveComposeEdits({
  companyId,
  draftId,
  previousSlug,
  pillarKeyword,
  supportingKeyword,
  type,
  targetKeyword,
  frontmatter,
  body,
  whereThingsStandSources,
  source,
}) {
  const slug = String(frontmatter?.slug || "").trim();
  if (await slugOwnedByOther(companyId, slug, draftId)) {
    throw new SlugTakenError(slug);
  }
  const row = await writeDraftRow({
    companyId,
    draftId,
    pillarKeyword,
    supportingKeyword,
    type,
    targetKeyword,
    frontmatter,
    body,
    whereThingsStandSources,
    source,
  });
  let coverageWarning = "";
  try {
    const synced = await syncComposedCoverageBySlug({
      companyId,
      pillarKeyword,
      supportingKeyword,
      matchSlug: previousSlug || row.slug,
      frontmatter: { ...frontmatter, slug: row.slug },
    });
    coverageWarning = synced.warning || "";
  } catch (err) {
    coverageWarning = err?.message || "Coverage could not be updated.";
  }
  return { row, coverageWarning };
}

export async function updateComposedDraftById({
  companyId,
  draftId,
  pillarKeyword,
  supportingKeyword,
  type,
  targetKeyword,
  frontmatter: rawFrontmatter,
  body,
  whereThingsStandSources,
  source,
  wordCount,
}) {
  const { data: current, error: currentError } = await supabase
    .from("generated_articles")
    .select("slug")
    .eq("id", draftId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message || "Failed to load the draft");
  if (!current) throw new Error("Draft not found.");

  const frontmatter = {
    ...(rawFrontmatter && typeof rawFrontmatter === "object" ? rawFrontmatter : {}),
  };
  const reserved = await nextFreeSlug(companyId, frontmatter.slug, draftId);
  if (reserved.changedFrom) frontmatter.slug = reserved.slug;

  const row = await writeDraftRow({
    companyId,
    draftId,
    pillarKeyword,
    supportingKeyword,
    type,
    targetKeyword,
    frontmatter,
    body,
    whereThingsStandSources,
    source,
  });

  let coverageWarning = "";
  try {
    const synced = await syncComposedCoverageBySlug({
      companyId,
      pillarKeyword,
      supportingKeyword,
      matchSlug: current.slug,
      frontmatter,
      wordCount,
    });
    coverageWarning = synced.warning || "";
  } catch (err) {
    coverageWarning = err?.message || "Coverage could not be updated.";
  }

  return {
    row,
    slugChangedFrom: reserved.changedFrom,
    coverageWarning,
    frontmatter,
  };
}

export async function saveHeroOnDraft({ companyId, draftId, storagePath, heroSource }) {
  const { error } = await supabase
    .from("generated_articles")
    .update({
      hero_storage_path: storagePath,
      hero_source: heroSource,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message || "Failed to save the hero image");
}

export async function markDraftPublished({
  companyId,
  draftId,
  publishedUrl,
  publishedAt,
}) {
  const now = publishedAt || new Date().toISOString();
  const payload = {
    status: "published",
    draft: false,
    published_at: now,
    published_url: String(publishedUrl || "").trim() || null,
    updated_at: now,
  };
  let { error } = await supabase
    .from("generated_articles")
    .update(payload)
    .eq("id", draftId)
    .eq("company_id", companyId);
  if (error && /published_url/i.test(String(error.message || ""))) {
    const { published_url: _omit, ...withoutUrl } = payload;
    ({ error } = await supabase
      .from("generated_articles")
      .update(withoutUrl)
      .eq("id", draftId)
      .eq("company_id", companyId));
  }
  if (error) throw new Error(error.message || "Failed to mark the draft published");
  return { publishedAt: now, publishedUrl: payload.published_url || "" };
}
