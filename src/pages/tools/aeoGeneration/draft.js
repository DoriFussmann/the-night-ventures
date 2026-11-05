import { supabase } from "@/lib/supabase";
import { generateOneArticle, loadCompanyPositioning } from "../articleGeneration/singleArticle";
import { generateOneImage, imageSrcFromResult } from "../aiImage/generateImageClient";
import { cropImageTo16x9 } from "../aiImage/cropImage";
import { finishHeroImage } from "../articleGeneration/heroImageStorage";
import { jsonAuthHeaders } from "@/lib/authHeaders";
import { saveGeneratedArticles } from "../articleGeneration/saveGeneratedArticles";
import { groupStats } from "../../../../lib/aeo/nextUp.js";
import { aeoScheduleSlug, ctaAngleFor, planPublishDays, searchIntentFor } from "../../../../lib/aeo/schedule.js";
import { OPEN_SCHEDULE_STATUSES, normalizeSettings, takenDays, todayIn } from "../../../../lib/publish-schedule/plan.js";
import { browserTimezone } from "../articlesAutomation/publishSchedule";

const PILLAR_WORDS = 2500;
const SUPPORTING_WORDS = 1500;

function fail(error, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

async function patchBrief(id, values) {
  const { error } = await supabase
    .from("aeo_briefs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  fail(error, "Brief");
}

async function patchGroup(id, values) {
  const { error } = await supabase
    .from("aeo_prompt_groups")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  fail(error, "Prompt group");
}

/**
 * Hero image: Claude writes a concrete scene for this article in the
 * company's image style, then the image model renders it (high quality).
 */
export async function makeHero({ companyId, slug, title, description, angle, outline, imageStyle, note = "" }) {
  const res = await fetch("/api/aeo-hero-scene", {
    method: "POST",
    headers: await jsonAuthHeaders(),
    body: JSON.stringify({
      title,
      description,
      angle,
      headings: (outline || []).map((s) => s.heading).filter(Boolean),
      imageStyle,
      note,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.scene) throw new Error(body.error || `Image scene failed (${res.status})`);
  const raw = await generateOneImage({ prompt: body.scene, size: "1536x1024", quality: "high" });
  const src = imageSrcFromResult(raw);
  if (!src) throw new Error("No image returned");
  const cropped = await cropImageTo16x9(src);
  const finished = await finishHeroImage({ companyId, slug, cropped });
  if (!finished.storagePath) throw new Error(finished.storageError || "The image was not saved");
  return { storagePath: finished.storagePath, scene: body.scene };
}

/** Replace a draft's hero image, optionally with a direction note. */
export async function newHeroForDraft({ companyId, brief, draft, imageStyle, note }) {
  const hero = await makeHero({
    companyId,
    slug: draft.slug,
    title: draft.title,
    description: draft.description,
    angle: brief.angle,
    outline: brief.outline,
    imageStyle,
    note,
  });
  const { error } = await supabase
    .from("generated_articles")
    .update({
      hero_storage_path: hero.storagePath,
      hero_source: { source: "openai", sourceId: null, attribution: null, scene: hero.scene, note: note || null },
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id);
  fail(error, "Draft");
  return hero;
}

/** Company positioning for the writer, with the AEO Brand Facts added. */
export async function loadWriterContext(companyId, brandFacts) {
  const positioning = await loadCompanyPositioning(companyId);
  const bf = brandFacts || {};
  const facts = [
    bf.offer && `Offer: ${bf.offer}`,
    bf.customer && `Customer: ${bf.customer}`,
    bf.difference && `Difference: ${bf.difference}`,
    bf.proof && `Proof: ${bf.proof}`,
    (bf.approved_claims || []).length && `Approved claims (the only claims to make about the company): ${bf.approved_claims.join("; ")}`,
  ].filter(Boolean);
  const never = (bf.never_claims || []).length ? `Never claim: ${bf.never_claims.join("; ")}` : "";
  const known = new Set(positioning.competitors.map((c) => c.name.toLowerCase()));
  const competitors = [
    ...positioning.competitors,
    ...(bf.competitors || [])
      .filter((c) => c?.name && !known.has(String(c.name).toLowerCase()))
      .map((c) => ({ name: String(c.name), url: String(c.url || "") })),
  ];
  return {
    ...positioning,
    abstract: [positioning.abstract, facts.length ? `\nBrand Facts (approved):\n${facts.join("\n")}` : ""].filter(Boolean).join("\n"),
    competitors,
    seoControls: {
      ...positioning.seoControls,
      outOfScope: [positioning.seoControls.outOfScope, never].filter(Boolean).join("\n"),
    },
  };
}

/** The writer's article spec, built from a brief. */
export function articleSpecFromBrief({ brief, group, prompts, conversion }) {
  const stats = groupStats(prompts);
  const keywords = [...new Set(prompts.map((p) => String(p.keyword || "").trim()).filter(Boolean))];
  return {
    title: brief.title,
    targetKeyword: brief.primary_keyword,
    type: brief.article_type,
    searchIntent: searchIntentFor(stats.dominant),
    wordCount: group.page_type === "pillar" ? PILLAR_WORDS : SUPPORTING_WORDS,
    ctaAngle: ctaAngleFor(brief.cta, conversion),
    keyMessages: [
      ...(brief.outline || []).map((s) => (s.points?.length ? `${s.heading}: ${s.points.join(" ")}` : s.heading)),
      `Answer each of these reader questions directly somewhere in the article: ${prompts.map((p) => p.prompt).join(" | ")}`,
    ],
    expertInput: brief.key_points || "",
    angle: brief.angle || "",
    secondaryKeywords: keywords.filter((k) => k.toLowerCase() !== String(brief.primary_keyword || "").toLowerCase()).slice(0, 8),
  };
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function slugTaken(companyId, slug, ownId) {
  const { data, error } = await supabase.from("generated_articles").select("id").eq("company_id", companyId).eq("slug", slug).limit(1);
  fail(error, "Slug check");
  return Boolean(data?.length) && data[0].id !== ownId;
}

/** The writer's slug if no other article uses it, else one from the primary keyword. */
async function freeSlug(companyId, proposed, brief) {
  const own = brief.generated_article_id || null;
  const candidates = [slugify(proposed), slugify(brief.primary_keyword), slugify(`${brief.primary_keyword} guide`)].filter(Boolean);
  for (const slug of candidates) {
    if (!(await slugTaken(companyId, slug, own))) return slug;
  }
  throw new Error(`The slug "${candidates[0]}" is already used by another article. Change the title or primary keyword and write again.`);
}

/**
 * Write one draft from a ready brief: article, hero image, saved to the
 * Articles library as a draft. The brief becomes "generated".
 */
export async function generateDraft({ companyId, brief, group, pillar, prompts, writer, batchContext = [], onStatus }) {
  if (!pillar?.topic_name) throw new Error("The pillar has no site topic name (AEO Playbook › Content Map).");
  const spec = articleSpecFromBrief({ brief, group, prompts, conversion: writer.brandFacts?.conversion });
  onStatus?.("Writing the article…");
  const data = await generateOneArticle({
    positioning: writer.positioning,
    article: spec,
    pillarKeyword: pillar.topic_name,
    batchContext,
  });

  // Never overwrite another article: the library upserts on slug.
  data.frontmatter.slug = await freeSlug(companyId, data.frontmatter.slug, brief);

  onStatus?.("Finding a hero image…");
  let hero = null;
  try {
    hero = await makeHero({
      companyId,
      slug: data.frontmatter.slug,
      title: data.frontmatter.title,
      description: data.frontmatter.description,
      angle: brief.angle,
      outline: brief.outline,
      imageStyle: writer.brandFacts?.image_style || "",
    });
  } catch (err) {
    console.warn("Hero image failed:", err);
  }

  onStatus?.("Saving the draft…");
  const { saved, error } = await saveGeneratedArticles({
    supabase,
    companyId,
    pillarKeyword: pillar.topic_name,
    source: group.page_type === "pillar" ? "pillar" : "cluster",
    articles: [
      {
        type: spec.type,
        targetKeyword: spec.targetKeyword,
        frontmatter: data.frontmatter,
        body: data.body,
        whereThingsStandSources: data.whereThingsStandSources,
        heroStoragePath: hero?.storagePath || "",
        heroSource: hero ? { source: "openai", sourceId: null, attribution: null, scene: hero.scene } : null,
      },
    ],
  });
  if (error) throw error;
  const row = saved[0];
  await patchBrief(brief.id, { status: "generated", generated_article_id: row.id });
  await patchGroup(group.id, { status: "drafted" });
  return {
    row,
    heroMissing: !hero,
    notes: [
      ...(Array.isArray(data.sourceCheck?.warnings) ? data.sourceCheck.warnings : []),
    ],
  };
}

export async function loadDrafts(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from("generated_articles")
    .select("id, slug, title, description, body, hero_storage_path, status")
    .in("id", ids);
  fail(error, "Drafts");
  return new Map((data || []).map((r) => [r.id, r]));
}

export async function approveBrief(brief) {
  await patchBrief(brief.id, { status: "approved" });
}

export async function unapproveBrief(brief) {
  await patchBrief(brief.id, { status: "generated" });
}

/** Back to "ready" so the draft can be written again (the old draft stays in the library). */
export async function resetToReady(brief, group) {
  await patchBrief(brief.id, { status: "ready", generated_article_id: null });
  await patchGroup(group.id, { status: "new" });
}

async function loadOpenSchedules(companyId) {
  const { data: schedules, error } = await supabase
    .from("publish_schedules")
    .select("*")
    .eq("company_id", companyId)
    .in("status", [...OPEN_SCHEDULE_STATUSES]);
  fail(error, "Schedules");
  if (!schedules?.length) return { schedules: [], items: [] };
  const { data: items, error: itemsError } = await supabase
    .from("publish_schedule_items")
    .select("*")
    .in("schedule_id", schedules.map((s) => s.id));
  fail(itemsError, "Schedule items");
  return { schedules, items: items || [] };
}

/**
 * Schedule approved briefs: one article per workday. Each goes into an AEO
 * schedule for its pillar, already approved (approval happened here), and the
 * daily publisher puts it live on its day.
 */
/** Days other schedules of this site already publish on (one article per day). */
export async function loadTakenDays(companyId) {
  const { items } = await loadOpenSchedules(companyId);
  return takenDays(items);
}

export function todayHere() {
  return todayIn(browserTimezone());
}

export async function scheduleBriefs({ companyId, briefs, groupsById, pillarsById, draftsById, start = "" }) {
  if (!briefs.length) return [];
  const timezone = browserTimezone();
  const today = todayIn(timezone);
  const { schedules, items } = await loadOpenSchedules(companyId);
  const days = planPublishDays(briefs.length, { today, start, taken: takenDays(items) });
  const now = new Date().toISOString();
  const scheduleByPillar = new Map(schedules.map((s) => [s.pillar_slug, s]));
  const out = [];

  for (let i = 0; i < briefs.length; i += 1) {
    const brief = briefs[i];
    const group = groupsById.get(brief.group_id);
    const pillar = pillarsById.get(group?.pillar_id);
    const draft = draftsById.get(brief.generated_article_id);
    if (!group || !pillar || !draft) throw new Error(`"${brief.title}" has no draft or pillar.`);
    const slug = aeoScheduleSlug(pillar);

    let schedule = scheduleByPillar.get(slug);
    if (!schedule) {
      const { data, error } = await supabase
        .from("publish_schedules")
        .insert({
          company_id: companyId,
          pillar_slug: slug,
          pillar_keyword: pillar.topic_name,
          status: "active",
          settings: normalizeSettings({ intervalDays: 1, weekends: "skip", approval: "approve", timezone }),
        })
        .select()
        .single();
      fail(error, "Schedule");
      schedule = data;
      scheduleByPillar.set(slug, schedule);
    } else if (schedule.status !== "active") {
      throw new Error(`The ${pillar.name} schedule is ${schedule.status}. Resume it in Articles automation first.`);
    }

    const position = items.filter((it) => it.schedule_id === schedule.id).reduce((n, it) => Math.max(n, it.position + 1), 0);
    const { data: item, error: itemError } = await supabase
      .from("publish_schedule_items")
      .insert({
        schedule_id: schedule.id,
        company_id: companyId,
        position,
        keyword: brief.primary_keyword,
        supporting_slug: draft.slug,
        generated_article_id: draft.id,
        publish_on: days[i],
        status: "scheduled",
        approved_at: now,
      })
      .select()
      .single();
    fail(itemError, "Schedule item");
    items.push(item);
    await patchBrief(brief.id, { status: "scheduled", publish_on: days[i] });
    await patchGroup(group.id, { status: "scheduled" });
    out.push({ brief, day: days[i] });
  }
  return out;
}

/**
 * Briefs whose scheduled article went live: mark the brief published and the
 * group live with its slug, so Next up and the content map stay current.
 */
export async function syncPublished(companyId, briefs, groupsById) {
  const waiting = briefs.filter((b) => b.status === "scheduled" && b.generated_article_id);
  if (!waiting.length) return 0;
  const { data, error } = await supabase
    .from("publish_schedule_items")
    .select("generated_article_id, status, supporting_slug")
    .eq("company_id", companyId)
    .in("generated_article_id", waiting.map((b) => b.generated_article_id));
  fail(error, "Schedule items");
  const live = new Map((data || []).filter((i) => i.status === "published").map((i) => [i.generated_article_id, i]));
  let changed = 0;
  for (const brief of waiting) {
    const item = live.get(brief.generated_article_id);
    if (!item) continue;
    await patchBrief(brief.id, { status: "published" });
    const group = groupsById.get(brief.group_id);
    if (group) await patchGroup(group.id, { status: "live", live_slug: item.supporting_slug || group.live_slug });
    changed += 1;
  }
  return changed;
}
