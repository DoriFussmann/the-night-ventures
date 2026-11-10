import { supabase } from "@/lib/supabase";

/** Empty Brand Facts document: the shape every section of the UI edits. */
export const EMPTY_BRAND_FACTS = Object.freeze({
  live_wording: [],
  offer: "",
  customer: "",
  problem: "",
  triggers: "",
  signals: "",
  difference: "",
  conversion: "",
  conversion_action: "",
  conversion_url: "",
  voice: "",
  approved_claims: [],
  never_claims: [],
  out_of_scope: [],
  competitors: [],
  open_items: [],
});

/** Keys that used to live in Brand Facts. Proof and image style moved to the Company tab. */
const MOVED_TO_COMPANY = { proof: "gtm_customer_evidence", image_style: "image_style" };
const REMOVED_BRAND_KEYS = [
  ...Object.keys(MOVED_TO_COMPANY),
  "fit_size_band", "fit_ability_to_pay", "fit_floor_ceiling", "fit_problem_cost", "fit_buying_window", "fit_signals", "fit_environment",
];

export const BRAND_FACTS_NOTE =
  "Approved messaging lives here. Pricing, customer evidence and proof, and operating constraints live in the Company tab.";

export const BRAND_SECTIONS = [
  { key: "offer", label: "1 · The offer", helper: "What exactly is sold, the price model, what the customer gets step by step." },
  {
    key: "customer",
    label: "2 · Customer qualification & fit",
    helper: "Who buys today and who it is not for; markets and stages served; tools or prerequisites the customer must have, and what rules them out.",
  },
  {
    key: "problem",
    label: "3 · Customer problem & impact",
    helper: "The problem, and what it costs the customer in money or time if unsolved. Qualitative is fine; no invented numbers.",
  },
  {
    key: "triggers",
    label: "4 · Buying triggers & timing",
    helper: "The moment that triggers the purchase, how recent it must be, and how long the window stays open.",
  },
  { key: "signals", label: "5 · Observable signals", helper: "Public evidence that the trigger has happened." },
  { key: "difference", label: "6 · The difference", helper: "Why this over competitors, DIY or doing nothing; what is never done." },
  { key: "conversion", label: "7 · The conversion", helper: "What counts as a win and the next step after reading. The call to action and page below are what articles link to." },
  {
    key: "voice",
    label: "8 · Voice & tone",
    helper: "How articles should sound: register, sentence style, words and framings to use and avoid. The writer follows this. Claims that must never be made go under Never claim.",
  },
];

/** Company tab, "Commercial and sales": how the company sells, its evidence and what limits it. Columns on company_profiles. */
export const COMMERCIAL_FIELDS = [
  { key: "gtm_deal_size", label: "Deal size", rows: 2, hint: "Typical price or contract value, as a band." },
  { key: "gtm_sales_motion", label: "Sales motion", rows: 2, hint: "Sales model, cycle length, how many people are involved. The Persona Builder needs this too." },
  {
    key: "gtm_customer_evidence",
    label: "Customer evidence & proof",
    rows: 8,
    wide: true,
    hint: "Who stands behind it, credentials, clients, results that can be stated, the database. Best customers and what they share; worst or churned and why; lost deals and why. Proxy evidence if pre-launch. Keep the founder's earlier results apart from the company's own. Articles take their proof from here.",
  },
  { key: "gtm_where_to_find", label: "Where to find them", rows: 3, hint: "Databases, lists, communities, channels." },
  {
    key: "gtm_constraints",
    label: "Operating constraints",
    rows: 3,
    hint: "Legal, regulatory or ownership limits; delivery capacity. What articles must not say goes in Brand Facts (Never claim, Voice & tone).",
  },
];

/** Company tab, "Article images". Column on company_profiles; article generation reads it. */
export const IMAGE_STYLE_FIELD = {
  key: "image_style",
  label: "Image style",
  rows: 4,
  hint: "How article hero images should look. Each image gets a scene written for its article in this style. Leave empty to use the default (editorial desk still life, warm light).",
};

export const TIERS = ["Buy", "Problem", "Learn"];
export const GROUP_STATUSES = ["new", "planned", "drafted", "scheduled", "published", "live", "money"];
export const PAGE_TYPES = ["pillar", "supporting", "money"];

function normalizeBrandFacts(value) {
  const v = { ...(value && typeof value === "object" ? value : {}) };
  for (const key of REMOVED_BRAND_KEYS) delete v[key];
  return { ...EMPTY_BRAND_FACTS, ...v };
}

function check(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

export async function loadPlaybook(companyId) {
  const [playbook, personas, pillars, groups, prompts] = await Promise.all([
    supabase.from("aeo_playbook").select("*").eq("company_id", companyId).maybeSingle(),
    supabase.from("aeo_personas").select("*").eq("company_id", companyId).order("sort"),
    supabase.from("aeo_pillars").select("*").eq("company_id", companyId).order("sort"),
    supabase.from("aeo_prompt_groups").select("*").eq("company_id", companyId).order("sort"),
    supabase.from("aeo_prompts").select("*").eq("company_id", companyId).order("code").range(0, 4999),
  ]);
  const row = check(playbook, "Playbook");
  return {
    playbook: {
      brand_facts: normalizeBrandFacts(row?.brand_facts),
      icp: row?.icp || "",
      shared_traits: Array.isArray(row?.shared_traits) ? row.shared_traits : [],
      updated_at: row?.updated_at || null,
    },
    personas: check(personas, "Personas") || [],
    pillars: check(pillars, "Pillars") || [],
    groups: check(groups, "Prompt groups") || [],
    prompts: check(prompts, "Prompts") || [],
  };
}

export async function savePlaybook(companyId, patch) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("aeo_playbook")
    .upsert({ company_id: companyId, ...patch, updated_at: now }, { onConflict: "company_id" });
  if (error) throw new Error(error.message);
}

export async function upsertRow(table, row) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(table)
    .upsert({ ...row, updated_at: now }, { onConflict: "company_id,code" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateRow(table, id, patch) {
  const { data, error } = await supabase
    .from(table)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteRow(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Next free code with a prefix, e.g. nextCode(rows, "R") -> "R301". */
export function nextCode(rows, prefix, width = 3) {
  const max = rows.reduce((m, r) => {
    const n = Number(String(r.code || "").replace(prefix, ""));
    return Number.isFinite(n) && String(r.code || "").startsWith(prefix) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

/**
 * Import a playbook file. Rows are matched by `code`, so importing again
 * updates rather than duplicates; rows not in the file are left untouched.
 * File shape: { brand_facts, icp, shared_traits, personas[], pillars[], groups[], prompts[] }
 * with groups referencing pillars by `pillar` (code) and prompts referencing
 * `persona` and `group` by code.
 */
export async function importPlaybook(companyId, file, onProgress = () => {}) {
  if (!file || typeof file !== "object") throw new Error("The file is not a playbook JSON object");
  const now = new Date().toISOString();
  const counts = { personas: 0, pillars: 0, groups: 0, prompts: 0 };

  onProgress("Brand Facts and ICP");
  // Older playbook files keep proof and image style in brand_facts; they now live on the company profile.
  const moved = Object.fromEntries(
    Object.entries(MOVED_TO_COMPANY)
      .map(([from, to]) => [to, String(file.brand_facts?.[from] || "").trim()])
      .filter(([, value]) => value)
  );
  if (Object.keys(moved).length) {
    const { error } = await supabase.from("company_profiles").update(moved).eq("company_id", companyId);
    if (error) throw new Error(`Company profile: ${error.message}`);
  }
  await savePlaybook(companyId, {
    brand_facts: normalizeBrandFacts(file.brand_facts),
    icp: String(file.icp || ""),
    shared_traits: Array.isArray(file.shared_traits) ? file.shared_traits : [],
  });

  const upsertMany = async (table, rows) => {
    if (!rows.length) return [];
    const out = [];
    for (let i = 0; i < rows.length; i += 100) {
      const { data, error } = await supabase
        .from(table)
        .upsert(rows.slice(i, i + 100).map((r) => ({ ...r, company_id: companyId, updated_at: now })), {
          onConflict: "company_id,code",
        })
        .select("id, code");
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data || []));
    }
    return out;
  };

  onProgress("Personas");
  const personaRows = (file.personas || []).map((p, i) => ({
    code: String(p.code), name: p.name || "", summary: p.summary || "", stage: p.stage || "",
    trigger: p.trigger || "", need: p.need || "", pains: p.pains || "",
    decision_criteria: p.decision_criteria || "", alternatives: p.alternatives || "",
    their_words: p.their_words || "", where_they_listen: p.where_they_listen || "",
    main_tiers: p.main_tiers || "", sort: p.sort ?? i,
  }));
  const personaIds = new Map((await upsertMany("aeo_personas", personaRows)).map((r) => [r.code, r.id]));
  counts.personas = personaIds.size;

  onProgress("Pillars");
  const pillarRows = (file.pillars || []).map((p, i) => ({
    code: String(p.code), name: p.name || "", hub_path: p.hub_path || "",
    pillar_article_slug: p.pillar_article_slug || "", is_new: Boolean(p.is_new), sort: p.sort ?? i,
    ...(p.topic_name !== undefined ? { topic_name: String(p.topic_name || "") } : {}),
  }));
  const pillarIds = new Map((await upsertMany("aeo_pillars", pillarRows)).map((r) => [r.code, r.id]));
  counts.pillars = pillarIds.size;

  onProgress("Prompt groups");
  const groupRows = (file.groups || []).map((g, i) => ({
    code: String(g.code), name: g.name || "", pillar_id: pillarIds.get(String(g.pillar)) || null,
    page_type: PAGE_TYPES.includes(g.page_type) ? g.page_type : "supporting",
    live_slug: g.live_slug || "", status: GROUP_STATUSES.includes(g.status) ? g.status : "new",
    notes: g.notes || "", sort: g.sort ?? i,
    ...(g.primary_keyword !== undefined ? { primary_keyword: String(g.primary_keyword || "") } : {}),
  }));
  const groupIds = new Map((await upsertMany("aeo_prompt_groups", groupRows)).map((r) => [r.code, r.id]));
  counts.groups = groupIds.size;

  onProgress("Prompts");
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const promptRows = (file.prompts || []).map((p) => ({
    code: String(p.code), prompt: String(p.prompt || ""), keyword: p.keyword || "",
    intent_tier: TIERS.includes(p.intent_tier) ? p.intent_tier : "Problem",
    persona_id: personaIds.get(String(p.persona)) || null,
    group_id: groupIds.get(String(p.group)) || null,
    search_volume: num(p.search_volume), keyword_difficulty: num(p.keyword_difficulty),
    gsc_impressions: num(p.gsc_impressions), gsc_best_position: num(p.gsc_best_position),
    bing_impressions: num(p.bing_impressions), cited_today: p.cited_today || "",
    business_value: num(p.business_value),
  }));
  counts.prompts = (await upsertMany("aeo_prompts", promptRows)).length;

  return counts;
}
