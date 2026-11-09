import { supabase } from "@/lib/supabase";
import { jsonAuthHeaders } from "@/lib/authHeaders";
import { defaultCta, groupStats, primaryKeywordFor } from "../../../../lib/aeo/nextUp.js";

export const BRIEF_STATUSES = ["draft", "ready", "generated", "approved", "scheduled", "published", "skipped"];

/** What each stage means to a person (stored values stay the same). */
export const BRIEF_STATUS_LABELS = {
  draft: "Brief",
  ready: "Ready to write",
  generated: "Written · review",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Live",
  skipped: "Skipped",
};
export const ARTICLE_TYPES = ["comprehensive", "howto", "comparison", "faq", "flex"];
export const CTA_PRIMARY = [
  { value: "consultation", label: "Book a call (Buy)" },
  { value: "tool", label: "Free tool (Problem)" },
  { value: "newsletter", label: "Newsletter (Learn)" },
];
const MAX_SIBLING_LINKS = 4;

export async function loadBriefs(companyId) {
  const { data, error } = await supabase
    .from("aeo_briefs")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at");
  if (error) throw new Error(`Briefs: ${error.message}`);
  return data || [];
}

export async function updateBrief(id, values) {
  const { error } = await supabase
    .from("aeo_briefs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Brief: ${error.message}`);
}

export async function deleteBrief(id) {
  const { error } = await supabase.from("aeo_briefs").delete().eq("id", id);
  if (error) throw new Error(`Brief: ${error.message}`);
}

/** Pillar article + live articles in the same pillar: the links the writer must include. */
export function linkTargetsFor(group, { pillars, groups }) {
  const pillar = pillars.find((p) => p.id === group.pillar_id);
  const out = [];
  if (pillar?.pillar_article_slug && group.page_type !== "pillar") {
    out.push({ slug: pillar.pillar_article_slug, title: `${pillar.name} (pillar article)`, kind: "pillar" });
  }
  const siblings = groups
    .filter((g) => g.id !== group.id && g.pillar_id === group.pillar_id && g.status === "live" && g.live_slug)
    .filter((g) => g.live_slug !== pillar?.pillar_article_slug)
    .slice(0, MAX_SIBLING_LINKS);
  for (const g of siblings) out.push({ slug: g.live_slug, title: g.name, kind: "sibling" });
  return out;
}

/** Monday of the week after `date` for a batch, as YYYY-MM-DD. */
export function nextMonday(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((8 - day) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

/** First Monday from next week on that no existing batch uses yet. */
export function nextFreeBatchLabel(briefs, from = new Date()) {
  const used = new Set(briefs.map((b) => b.batch_label).filter(Boolean));
  let monday = nextMonday(from);
  for (let i = 0; i < 104 && used.has(`Week of ${monday}`); i += 1) {
    const d = new Date(`${monday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    monday = d.toISOString().slice(0, 10);
  }
  return `Week of ${monday}`;
}

export async function createBriefs(companyId, groupItems, data, { batchLabel = "" } = {}) {
  const rows = groupItems.map(({ group }) => {
    const prompts = data.prompts.filter((p) => p.group_id === group.id);
    const stats = groupStats(prompts);
    return {
      company_id: companyId,
      group_id: group.id,
      status: "draft",
      title: group.name,
      primary_keyword: group.primary_keyword || primaryKeywordFor(prompts),
      article_type: group.page_type === "pillar" ? "comprehensive" : "flex",
      cta: defaultCta(stats.dominant),
      link_targets: linkTargetsFor(group, data),
      batch_label: batchLabel,
    };
  });
  if (!rows.length) return;
  const { error } = await supabase.from("aeo_briefs").upsert(rows, { onConflict: "company_id,group_id" });
  if (error) throw new Error(`Briefs: ${error.message}`);
}

export async function suggestOutline({ companyId, groupId, primaryKeyword }) {
  const res = await fetch("/api/aeo-brief-outline", {
    method: "POST",
    headers: await jsonAuthHeaders(),
    body: JSON.stringify({ companyId, groupId, primaryKeyword }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Outline failed (${res.status})`);
  return body;
}

/** Outline <-> editable text: "## Heading" lines, "- point" lines under them. */
export function outlineToText(outline) {
  return (Array.isArray(outline) ? outline : [])
    .map((s) => [`## ${s.heading}`, ...(s.points || []).map((p) => `- ${p}`)].join("\n"))
    .join("\n\n");
}

export function textToOutline(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) out.push({ heading: line.replace(/^#+\s*/, ""), points: [] });
    else {
      if (!out.length) out.push({ heading: "Untitled section", points: [] });
      out[out.length - 1].points.push(line.replace(/^[-*•]\s*/, ""));
    }
  }
  return out.filter((s) => s.heading);
}
