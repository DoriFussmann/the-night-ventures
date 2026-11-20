import { supabase } from "@/lib/supabase";
import { jsonAuthHeaders } from "@/lib/authHeaders";
import { createBriefs, suggestOutline, textToOutline, updateBrief } from "./briefs";
import { monthLabel } from "../../../../lib/aeo/monthPlan.js";

function fail(error, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function loadMonthPlan(companyId, month) {
  const { data, error } = await supabase
    .from("aeo_month_plans")
    .select("*")
    .eq("company_id", companyId)
    .eq("month", month)
    .maybeSingle();
  fail(error, "Monthly plan");
  return data || null;
}

/** Create or update the plan row for a month. */
export async function saveMonthPlan(companyId, month, values) {
  const { data, error } = await supabase
    .from("aeo_month_plans")
    .upsert(
      { company_id: companyId, month, ...values, updated_at: new Date().toISOString() },
      { onConflict: "company_id,month" }
    )
    .select()
    .single();
  fail(error, "Monthly plan");
  return data;
}

export async function loadVoice(companyId) {
  const { data, error } = await supabase.from("aeo_playbook").select("key_points_voice").eq("company_id", companyId).maybeSingle();
  fail(error, "Voice");
  return data?.key_points_voice || "";
}

export async function saveVoice(companyId, voice) {
  const { error } = await supabase
    .from("aeo_playbook")
    .update({ key_points_voice: voice, updated_at: new Date().toISOString() })
    .eq("company_id", companyId);
  fail(error, "Voice");
}

/** Approve: store the picks, create one brief per pick linked to the plan. */
export async function approveMonthPlan({ companyId, month, plan, removed, data, workdays }) {
  const entries = [
    ...plan.picks.map((p) => ({
      group_id: p.group.id,
      pillar_id: p.pillar?.id || null,
      score: Number(p.score.toFixed(3)),
      value: Number(p.value.toFixed(3)),
      day: p.day,
    })),
    ...[...removed].map((id) => ({ group_id: id, removed: true })),
  ];
  const row = await saveMonthPlan(companyId, month, {
    status: "approved",
    working_days: workdays,
    plan: entries,
    approved_at: new Date().toISOString(),
  });
  await createBriefs(companyId, plan.picks, data, { batchLabel: monthLabel(month), monthPlanId: row.id });
  return row;
}

export async function writeKeyPoints({ companyId, groupId, view, title, angle, outline }) {
  const res = await fetch("/api/aeo-brief-outline", {
    method: "POST",
    headers: await jsonAuthHeaders(),
    body: JSON.stringify({ mode: "key_points", companyId, groupId, view, title, angle, outline }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Key points failed (${res.status})`);
  return body.keyPoints;
}

/**
 * Get one brief ready to write: outline if it has none, key points from the
 * theme view if it has none, then Ready when nothing is missing.
 * Returns "ready" | "draft" (something still missing).
 */
export async function prepareBrief({ companyId, brief, group, pillar, view }) {
  let { title, angle, article_type: articleType } = brief;
  let outline = Array.isArray(brief.outline) ? brief.outline : textToOutline(brief.outline);
  if (outline.length < 3) {
    const s = await suggestOutline({ companyId, groupId: group.id, primaryKeyword: brief.primary_keyword });
    title = s.title || title;
    angle = s.angle;
    articleType = s.articleType;
    outline = s.outline;
  }
  const keyPoints = String(brief.key_points || "").trim()
    ? brief.key_points
    : await writeKeyPoints({ companyId, groupId: group.id, view, title, angle, outline });
  const ready = Boolean(String(title || "").trim() && String(brief.primary_keyword || "").trim() && outline.length >= 3 && pillar?.topic_name);
  await updateBrief(brief.id, {
    title,
    angle,
    article_type: articleType,
    outline,
    key_points: keyPoints,
    status: ready ? "ready" : "draft",
  });
  return ready ? "ready" : "draft";
}
