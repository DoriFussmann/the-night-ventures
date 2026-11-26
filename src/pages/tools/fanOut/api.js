// Reads and writes for the Fan-Out Engine page. Rows are read and edited through
// Supabase directly; Claude and ChatGPT are reached through /api/fan-out.
import { supabase } from "@/lib/supabase";
import { loadPlaybook, nextCode, upsertRow } from "../aeoPlaybook/api";
import { createBriefs, loadBriefs, updateBrief } from "../aeoGeneration/briefs";
import { PUSHABLE, briefFromTopic } from "../../../../lib/fan-out/core.js";

const ENDPOINT = "/api/fan-out";
/** Run columns the page lists; the full answer and raw reply are read per run, on demand. */
const RUN_COLS = "id, prompt_id, run_no, status, error, attempts, model, ran_at, seconds, cost, fan_out, search_results, cited, searched, brands, own_cited_urls";

const ok = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

async function post(action, companyId, body = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${ENDPOINT}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, companyId, ...body }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

export const buildPersona = (companyId, situationId) => post("persona", companyId, { situationId });
export const writePrompts = (companyId, situationId) => post("prompts", companyId, { situationId });
export const runStep = (companyId, situationId, calls, again = false) => post("run", companyId, { situationId, calls, again });
export const buildTopics = (companyId, situationId) => post("topics", companyId, { situationId });

export async function listSituations(companyId) {
  return ok(await supabase.from("fo_situations").select("id, code, title, description, step, stale_from, created_at").eq("company_id", companyId).order("created_at", { ascending: false }), "Situations") || [];
}

export async function loadSituation(id) {
  const [situation, prompts, runs, topics] = await Promise.all([
    supabase.from("fo_situations").select("*").eq("id", id).maybeSingle(),
    supabase.from("fo_prompts").select("*").eq("situation_id", id),
    supabase.from("fo_runs").select(RUN_COLS).eq("situation_id", id).order("run_no"),
    supabase.from("fo_topics").select("*").eq("situation_id", id).order("sort"),
  ]);
  return { situation: ok(situation, "Situation"), prompts: ok(prompts, "Prompts") || [], runs: ok(runs, "Runs") || [], topics: ok(topics, "Topics") || [] };
}

export async function loadRunDetail(id) {
  return ok(await supabase.from("fo_runs").select("answer, raw").eq("id", id).maybeSingle(), "Run");
}

export async function loadContentMap(companyId) {
  const [pillars, groups, own] = await Promise.all([
    supabase.from("aeo_pillars").select("id, code, name").eq("company_id", companyId).order("sort"),
    supabase.from("aeo_prompt_groups").select("id, code, name, pillar_id, status").eq("company_id", companyId).order("code"),
    supabase.from("pt_brands").select("id, name, name_patterns, is_own").eq("company_id", companyId).order("sort"),
  ]);
  const brands = ok(own, "Brands") || [];
  const brand = brands.find((b) => b.is_own);
  const names = brand ? [brand.name, ...(Array.isArray(brand.name_patterns) ? brand.name_patterns : [])] : [];
  return {
    pillars: ok(pillars, "Pillars") || [],
    groups: ok(groups, "Topics") || [],
    brands: brands.map((b) => ({ id: b.id, name: b.name, is_own: b.is_own })),
    ownNames: [...new Set(names.map((n) => String(n || "").trim()).filter((n) => n.length >= 2))],
  };
}

export async function createSituation(companyId, description, existing) {
  const row = { company_id: companyId, code: nextCode(existing, "F", 3), description: description.trim() };
  return ok(await supabase.from("fo_situations").insert(row).select("*").single(), "Situation");
}

export async function updateSituation(id, patch) {
  return ok(await supabase.from("fo_situations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single(), "Situation");
}

export async function deleteSituation(id) {
  ok(await supabase.from("fo_situations").delete().eq("id", id), "Situation");
}

export async function savePrompt(situation, form, prompt) {
  const row = { company_id: situation.company_id, situation_id: situation.id, form, prompt, updated_at: new Date().toISOString() };
  return ok(await supabase.from("fo_prompts").upsert(row, { onConflict: "situation_id,form" }).select("*").single(), "Prompt");
}

export async function deletePrompt(id) {
  ok(await supabase.from("fo_prompts").delete().eq("id", id), "Prompt");
}

export async function updateTopic(id, patch) {
  return ok(await supabase.from("fo_topics").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single(), "Topic");
}

/**
 * Turn approved topics into briefs in AEO Generation.
 * New article or comparison article: a new Content Map topic under the chosen theme, the situation's prompts as its buyer
 * prompts, and a brief. Existing topic without a brief: the brief only. A brief that already exists
 * is never overwritten. The hot takes field is left empty for the user.
 * @returns {Promise<Array<{ id: string, ok: boolean, message: string, topic?: object }>>}
 */
export async function pushTopics({ companyId, situation, topics, prompts }) {
  const data = await loadPlaybook(companyId);
  let briefs = await loadBriefs(companyId);
  const results = [];
  for (const t of topics) {
    try {
      if (!PUSHABLE.has(t.action)) throw new Error("This action is not an article, so there is nothing to push.");
      const fields = briefFromTopic(t);
      let group = t.action === "existing_group" ? data.groups.find((g) => g.id === t.group_id) : null;
      if (t.action === "existing_group" && !group) throw new Error("The existing topic it matched is gone. Change the action to New article.");
      if (group && ["live", "published"].includes(group.status)) {
        throw new Error(`${group.code} is already live. Improve that article by hand; the answer points above say what to add.`);
      }
      if (!group) {
        const pillar = data.pillars.find((p) => p.id === t.pillar_id);
        if (!pillar) throw new Error("Choose a theme for this topic first.");
        group = await upsertRow("aeo_prompt_groups", {
          company_id: companyId,
          pillar_id: pillar.id,
          code: nextCode(data.groups, pillar.code.slice(0, 1), 2),
          name: fields.title,
          page_type: "supporting",
          status: "new",
          primary_keyword: fields.primary_keyword,
          notes: `From Fan-Out ${situation.code}: ${situation.title || ""}`.trim(),
          sort: data.groups.length,
        });
        data.groups.push(group);
        for (const p of prompts.filter((x) => x.form !== "long")) {
          const row = await upsertRow("aeo_prompts", {
            company_id: companyId,
            code: `${situation.code}-${group.code}-${p.form.slice(0, 1).toUpperCase()}`,
            group_id: group.id,
            intent_tier: "Problem",
            prompt: p.prompt,
          });
          data.prompts.push(row);
        }
      }
      const existing = briefs.find((b) => b.group_id === group.id);
      if (existing) {
        const topic = await updateTopic(t.id, { group_id: group.id });
        results.push({ id: t.id, ok: false, topic, message: `${group.code} already has a brief. It was not changed; copy the answer points into it by hand.` });
        continue;
      }
      await createBriefs(companyId, [{ group }], data, { batchLabel: `Fan-Out ${situation.code}` });
      briefs = await loadBriefs(companyId);
      const made = briefs.find((b) => b.group_id === group.id);
      if (!made) throw new Error("The brief was not created.");
      await updateBrief(made.id, {
        title: fields.title,
        primary_keyword: made.primary_keyword || fields.primary_keyword,
        angle: fields.angle,
        outline: fields.outline,
        ...(fields.article_type ? { article_type: fields.article_type } : {}),
      });
      const topic = await updateTopic(t.id, { status: "pushed", group_id: group.id, pillar_id: group.pillar_id, brief_id: made.id, pushed_at: new Date().toISOString() });
      results.push({ id: t.id, ok: true, topic, message: `Brief created on ${group.code}, in the batch "Fan-Out ${situation.code}".` });
    } catch (err) {
      results.push({ id: t.id, ok: false, message: err?.message || "Could not push this topic" });
    }
  }
  return results;
}
