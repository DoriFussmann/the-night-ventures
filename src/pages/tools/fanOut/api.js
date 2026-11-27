// Reads and writes for the Fan-Out Engine page. Rows are read and edited through
// Supabase directly; Claude and ChatGPT are reached through /api/fan-out.
import { supabase } from "@/lib/supabase";
import { loadPlaybook, nextCode, upsertRow } from "../aeoPlaybook/api";
import { createBriefs, loadBriefs, updateBrief } from "../aeoGeneration/briefs";
import { mergeSettings, situationText, sortPrompts } from "../../../../lib/fan-out/core.js";
import { briefFromCard, buyerPrompts } from "../../../../lib/fan-out/groups.js";

const ENDPOINT = "/api/fan-out";
/** Run columns the page lists; the full answer and raw reply are read per run, on demand. */
const RUN_COLS = "id, scenario_run_id, prompt_id, run_no, status, error, attempts, model, ran_at, seconds, cost, fan_out, search_results, cited, searched, brands, own_cited_urls";

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

/** Free text sorted into the Situation fields. Nothing is saved. */
export const structureText = (companyId, text) => post("structure", companyId, { text });
/** A suggested name and the saved Situations these fields overlap with. Nothing is saved. */
export const checkSituation = (companyId, fields, situationId = "") => post("check", companyId, { fields, situationId });
export const buildPersona = (companyId, situationId) => post("persona", companyId, { situationId });
/** All prompts again, or with promptId only that one, on a new angle. */
export const writePrompts = (companyId, situationId, promptId = "") => post("prompts", companyId, { situationId, promptId });
/** Opens a Run (the Baseline if the Scenario has none). Nothing is asked of ChatGPT yet. */
export const startRun = (companyId, situationId) => post("start_run", companyId, { situationId });
export const runStep = (companyId, scenarioRunId, calls) => post("run", companyId, { scenarioRunId, calls });
/** Ends a Run: records the actual cost and labels the mentions. */
export const finishRun = (companyId, scenarioRunId, stopped = false) => post("finish_run", companyId, { scenarioRunId, stopped });
export const labelRun = (companyId, scenarioRunId) => post("label", companyId, { scenarioRunId });
/** The score of every Run of a Scenario, calculated now from the stored answers and today's brand list. */
export const loadScore = (companyId, situationId) => post("score", companyId, { situationId });
/** Groups the searches of a Run into Query Groups (new searches go into the existing groups). */
export const groupRun = (companyId, scenarioRunId) => post("groups", companyId, { scenarioRunId });
/** Writes the card of one Query Group: reads the cited pages, then the AI's estimate of why, what to cover and the action. */
export const writeCard = (companyId, scenarioRunId, groupId) => post("card", companyId, { scenarioRunId, groupId });
/** Marks Opportunities whose brief went live as Acted on, and judges the Insights behind acted-on Opportunities. */
export const syncScenario = (companyId, situationId) => post("sync", companyId, { situationId });
export const writeTakeaway = (companyId, scenarioRunId) => post("takeaway", companyId, { scenarioRunId });

/** The engine's admin settings: the defaults with what was saved on top. */
export async function loadEngineSettings() {
  const res = await supabase.from("fo_settings").select("values").eq("id", "global").maybeSingle();
  return mergeSettings(res.error ? {} : res.data?.values);
}

/** Saves the admin settings. Only what differs from the defaults needs to be in `values`. */
export async function saveEngineSettings(values) {
  ok(await supabase.from("fo_settings").upsert({ id: "global", values, updated_at: new Date().toISOString() }), "Settings");
  return mergeSettings(values);
}

/** Every Insight of every company, for the admin view: which reasons are behind wins, across companies. */
export async function loadAllInsights() {
  return ok(await supabase.from("fo_insights").select("tag, reasons, verdict, company_id").limit(1000), "Insights") || [];
}

/** When each Scenario of a company was last run (its latest Run that returned anything), for the re-run reminder. */
export async function lastRuns(companyId) {
  const rows = ok(await supabase.from("fo_scenario_runs").select("situation_id, started_at, finished_at").eq("company_id", companyId).order("started_at", { ascending: false }).limit(1000), "Runs") || [];
  const out = {};
  for (const r of rows) if (!out[r.situation_id]) out[r.situation_id] = r.finished_at || r.started_at;
  return out;
}

export async function listSituations(companyId) {
  return ok(await supabase.from("fo_situations").select("id, code, title, description, step, stale_from, created_at, version, variant_of").eq("company_id", companyId).order("created_at", { ascending: false }), "Situations") || [];
}

export async function loadSituation(id) {
  const [situation, prompts, cards, scenarioRuns] = await Promise.all([
    supabase.from("fo_situations").select("*").eq("id", id).maybeSingle(),
    supabase.from("fo_prompts").select("*").eq("situation_id", id).is("archived_at", null),
    supabase.from("fo_cards").select("*").eq("situation_id", id).order("created_at"),
    supabase.from("fo_scenario_runs").select("*").eq("situation_id", id).order("seq"),
  ]);
  const all = ok(scenarioRuns, "Runs") || [];
  const latest = all[all.length - 1];
  // Only the captures of the latest Run are listed on the page; earlier Runs are read by the score.
  const runs = latest ? ok(await supabase.from("fo_runs").select(RUN_COLS).eq("scenario_run_id", latest.id).order("run_no").limit(200), "Runs") || [] : [];
  return { situation: ok(situation, "Situation"), prompts: sortPrompts(ok(prompts, "Prompts") || []), runs, cards: ok(cards, "Cards") || [], scenarioRuns: all };
}

/** Adds a brand ChatGPT named to the tracked list, as a competitor. */
export async function trackBrand(companyId, name, brands) {
  const clean = String(name).trim().toLowerCase();
  if ((brands || []).some((b) => String(b.name).trim().toLowerCase() === clean)) throw new Error(`${name} is already on the tracked list.`);
  const row = { company_id: companyId, name: String(name).trim().slice(0, 80), is_own: false, sort: (brands || []).length };
  return ok(await supabase.from("pt_brands").insert(row).select("id, name, is_own").single(), "Brand");
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
  const every = brands.flatMap((b) => [b.name, ...(Array.isArray(b.name_patterns) ? b.name_patterns : [])]);
  return {
    pillars: ok(pillars, "Pillars") || [],
    groups: ok(groups, "Topics") || [],
    brands: brands.map((b) => ({ id: b.id, name: b.name, is_own: b.is_own })),
    ownNames: [...new Set(names.map((n) => String(n || "").trim()).filter((n) => n.length >= 2))],
    // Own brand and competitors, with aliases: prompts are unbranded.
    allNames: [...new Set(every.map((n) => String(n || "").trim()).filter((n) => n.length >= 2))],
  };
}

/** The Situation fields as stored. The description is the same Situation as one paragraph, for lists. */
export function situationRow(fields) {
  const row = {
    who: String(fields.who || "").trim(),
    trigger_event: String(fields.trigger_event || "").trim(),
    goal: String(fields.goal || "").trim(),
    stage: fields.stage || null,
    direction: fields.direction || "recommend",
    comments: String(fields.comments || "").trim(),
  };
  return { ...row, description: situationText(row) || "(no description)" };
}

/** Saves a new Situation to the bank. variantOf is the id of the Situation it is a variant of, or "". */
export async function createSituation(companyId, { fields, title, variantOf = "" }, existing) {
  const settings = await loadEngineSettings();
  const row = { company_id: companyId, code: nextCode(existing, "F", 3), version: 2, runs: settings.runs_per_prompt, title: String(title || "").trim().slice(0, 120), variant_of: variantOf || null, ...situationRow(fields) };
  return ok(await supabase.from("fo_situations").insert(row).select("*").single(), "Situation");
}

export async function updateSituation(id, patch) {
  return ok(await supabase.from("fo_situations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single(), "Situation");
}

export async function deleteSituation(id) {
  ok(await supabase.from("fo_situations").delete().eq("id", id), "Situation");
}

const hasRuns = async (promptId) => {
  const res = await supabase.from("fo_runs").select("id", { count: "exact", head: true }).eq("prompt_id", promptId);
  if (res.error) throw new Error(`Runs: ${res.error.message}`);
  return (res.count || 0) > 0;
};

/** The user's own prompt, added to a type. */
export async function addPrompt(situation, form, prompt, sort) {
  const row = { company_id: situation.company_id, situation_id: situation.id, form, prompt, sort, origin: "user", angle: "" };
  return ok(await supabase.from("fo_prompts").insert(row).select("*").single(), "Prompt");
}

/**
 * New wording for a prompt. If the prompt already has runs, it is archived and the new wording is saved
 * as a new prompt in its place, so every stored run stays tied to the exact text that produced it.
 */
export async function savePromptText(prompt, text) {
  if (!(await hasRuns(prompt.id))) {
    return ok(await supabase.from("fo_prompts").update({ prompt: text, updated_at: new Date().toISOString() }).eq("id", prompt.id).select("*").single(), "Prompt");
  }
  // The new wording is saved first, so a failed save leaves the old prompt in place.
  const row = { company_id: prompt.company_id, situation_id: prompt.situation_id, form: prompt.form, prompt: text, sort: prompt.sort, origin: prompt.origin, angle: prompt.angle };
  const made = ok(await supabase.from("fo_prompts").insert(row).select("*").single(), "Prompt");
  ok(await supabase.from("fo_prompts").update({ archived_at: new Date().toISOString() }).eq("id", prompt.id), "Prompt");
  return made;
}

/** Takes a prompt out of the Scenario. One with runs is archived, so its raw runs are kept. */
export async function removePrompt(prompt) {
  if (await hasRuns(prompt.id)) ok(await supabase.from("fo_prompts").update({ archived_at: new Date().toISOString() }).eq("id", prompt.id), "Prompt");
  else ok(await supabase.from("fo_prompts").delete().eq("id", prompt.id), "Prompt");
}

export async function updateCard(id, patch) {
  return ok(await supabase.from("fo_cards").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single(), "Card");
}

/** The company's Insights bank: why brands get named, one row per card. */
export async function loadInsights(companyId) {
  return ok(await supabase.from("fo_insights").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(500), "Insights") || [];
}

/**
 * "Write this": turns one Opportunity card into a brief in AEO Generation. Only new-article cards are pushed.
 * The Content Map topic is the existing one the card matched, if it has no brief; otherwise a new topic made
 * from the Query Group, with the Scenario prompts that led to it as buyer prompts (intent tier from the Stage).
 * A brief that already exists is never overwritten. `also` are cards written together with this one, as one brief.
 * @returns {Promise<{ ok: boolean, message: string, cards: object[] }>}
 */
export async function pushCard({ companyId, situation, card, stats, prompts, also = [] }) {
  if (card.action !== "new_article") throw new Error("Only a new article goes to AEO Generation. This one stays here as a to-do.");
  if (card.status !== "open") throw new Error("This card was already written or closed.");
  if (stats.other) throw new Error("These are searches that fit no group, not one topic. Analyze again to regroup them before writing.");
  // AEO Generation does not rewrite a page that is already live: that is fixed by hand.
  if (["live", "cited"].includes(card.your_page?.kind)) throw new Error("You already have a live page for this. Set the action to Fix existing page: a second article would compete with it.");
  const data = await loadPlaybook(companyId);
  let briefs = await loadBriefs(companyId);
  const fields = briefFromCard(card, stats, also);
  if (fields.outline.length < 3) throw new Error("A brief needs at least 3 lines under What to cover. Add lines to the card first.");
  // A push that stopped half-way left its topic on the card: it is picked up from there, not made again.
  let group = data.groups.find((g) => g.id === card.aeo_group_id) || (card.your_page?.kind === "topic" ? data.groups.find((g) => g.id === card.your_page.topicId) : null);
  const resumed = Boolean(group && group.id === card.aeo_group_id);
  if (group && ["live", "published"].includes(group.status)) throw new Error(`${group.code} is already live. AEO Generation does not rewrite a live topic: set the action to Fix existing page.`);
  if (group && !resumed && briefs.some((b) => b.group_id === group.id)) throw new Error(`${group.code} already has a brief. It was not changed. Open it in AEO Generation and add the lines from What to cover by hand.`);
  if (!group) {
    const pillar = data.pillars.find((p) => p.id === card.pillar_id);
    if (!pillar) throw new Error("Confirm the theme for this article first.");
    // Inserted, never upserted: a code someone else took in the meantime must not overwrite their topic.
    for (let attempt = 0; attempt < 3 && !group; attempt += 1) {
      const fresh = attempt ? ok(await supabase.from("aeo_prompt_groups").select("code").eq("company_id", companyId), "Topics") || [] : data.groups;
      const res = await supabase.from("aeo_prompt_groups").insert({
        company_id: companyId,
        pillar_id: pillar.id,
        code: nextCode(fresh, pillar.code.slice(0, 1), 2),
        name: fields.title,
        page_type: "supporting",
        status: "new",
        primary_keyword: fields.primary_keyword,
        notes: `From Fan-Out ${situation.code}: ${situation.title || ""}`.trim(),
        sort: data.groups.length,
      }).select().single();
      if (res.error && res.error.code !== "23505") throw new Error(`Topic: ${res.error.message}`);
      if (!res.error) group = res.data;
    }
    if (!group) throw new Error("The Content Map changed while this was being written. Try again.");
    data.groups.push(group);
    await updateCard(card.id, { aeo_group_id: group.id });
  }
  if (!data.prompts.some((p) => p.group_id === group.id)) {
    const buyer = buyerPrompts(prompts, stats, situation.stage, (await loadEngineSettings()).stage_tier, also);
    const count = {};
    for (const p of buyer) {
      count[p.form] = (count[p.form] || 0) + 1;
      const row = await upsertRow("aeo_prompts", {
        company_id: companyId,
        code: `${situation.code}-${group.code}-${p.form.slice(0, 1).toUpperCase()}${count[p.form]}`,
        group_id: group.id,
        intent_tier: p.intent_tier,
        prompt: p.prompt,
      });
      data.prompts.push(row);
    }
  }
  // A brief that already exists is never overwritten. The one exception is the brief this same push made
  // before it stopped: it still has no outline, and it is finished here.
  let made = briefs.find((b) => b.group_id === group.id);
  if (made && (!resumed || (Array.isArray(made.outline) && made.outline.length))) {
    if (!resumed) throw new Error(`${group.code} already has a brief. It was not changed.`);
  } else {
    if (!made) {
      await createBriefs(companyId, [{ group }], data, { batchLabel: `Fan-Out ${situation.code}` });
      briefs = await loadBriefs(companyId);
      made = briefs.find((b) => b.group_id === group.id);
      if (!made) throw new Error("The brief was not created.");
    }
    await updateBrief(made.id, {
      title: fields.title,
      primary_keyword: made.primary_keyword || fields.primary_keyword,
      angle: fields.angle,
      outline: fields.outline,
      ...(fields.article_type ? { article_type: fields.article_type } : {}),
    });
  }
  const at = new Date().toISOString();
  const patch = { status: "pushed", aeo_group_id: group.id, pillar_id: group.pillar_id, brief_id: made.id, pushed_at: at };
  const cards = [await updateCard(card.id, patch)];
  for (const c of also) cards.push(await updateCard(c.id, { ...patch, merged_into: card.id }));
  return { ok: true, message: `Brief created on ${group.code}, in the batch "Fan-Out ${situation.code}".`, cards };
}
