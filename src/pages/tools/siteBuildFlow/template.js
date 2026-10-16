import { supabase } from "@/lib/supabase";
import { PREDEFINED_ITEMS, STAGES } from "./seedData";

/**
 * The Site Build Flow template: the phases and items every company's checklist
 * is synced from. It lives in setup_flow_template_stages / _items and is edited
 * on the Site Build Flow page. seedData.js is the original checklist: it fills
 * the template tables (migration 062) and is used as-is until they exist.
 *
 * Shape: [{ stage_key, name, items: [{ item_key, title, description, prompts, link_to, link_label }] }]
 * Array order is display order.
 */

export function templateFromSeed() {
  return STAGES.map((stage) => ({
    stage_key: stage.stage_key,
    name: stage.name,
    items: (PREDEFINED_ITEMS[stage.stage_key] || []).map((entry) => ({
      item_key: entry.item_key,
      title: entry.title,
      description: entry.description || "",
      prompts: entry.prompts || [],
      link_to: entry.linkTo || null,
      link_label: entry.linkLabel || null,
    })),
  }));
}

/** @returns {Promise<{ template: Array, stored: boolean }>} stored=false means the tables are missing or empty. */
export async function loadTemplate() {
  const [stagesResult, itemsResult] = await Promise.all([
    supabase
      .from("setup_flow_template_stages")
      .select("stage_key, name, order_index")
      .order("order_index", { ascending: true }),
    supabase
      .from("setup_flow_template_items")
      .select("stage_key, item_key, title, description, prompts, link_to, link_label, sort_order")
      .order("sort_order", { ascending: true }),
  ]);

  if (stagesResult.error || itemsResult.error || !stagesResult.data?.length) {
    return { template: templateFromSeed(), stored: false };
  }

  const itemsByStage = new Map();
  for (const item of itemsResult.data || []) {
    const list = itemsByStage.get(item.stage_key) || [];
    list.push({
      item_key: item.item_key,
      title: item.title,
      description: item.description || "",
      prompts: Array.isArray(item.prompts) ? item.prompts : [],
      link_to: item.link_to || null,
      link_label: item.link_label || null,
    });
    itemsByStage.set(item.stage_key, list);
  }

  return {
    template: stagesResult.data.map((stage) => ({
      stage_key: stage.stage_key,
      name: stage.name,
      items: itemsByStage.get(stage.stage_key) || [],
    })),
    stored: true,
  };
}

/** Replace the whole template in one transaction (save_setup_flow_template). */
export async function saveTemplate(template) {
  const { error } = await supabase.rpc("save_setup_flow_template", {
    p_stages: template.map((stage) => ({
      stage_key: stage.stage_key,
      name: stage.name.trim(),
      items: stage.items.map((item) => ({
        item_key: item.item_key,
        title: item.title.trim(),
        description: item.description.trim(),
        prompts: item.prompts || [],
        link_to: item.link_to || null,
        link_label: item.link_label || null,
      })),
    })),
  });
  if (error) {
    const missing = /save_setup_flow_template|setup_flow_template/i.test(error.message || "");
    throw new Error(
      missing
        ? "The checklist template is not set up yet. Apply supabase/migrations/062_setup_flow_template.sql in the Supabase SQL editor, then try again."
        : error.message || "Failed to save the checklist"
    );
  }
}

/** A key that is unique among `taken`, derived from a label ("New phase" → "custom-new-phase-k3f9"). */
export function newTemplateKey(label, taken) {
  const base =
    String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item";
  let key;
  do {
    key = `custom-${base}-${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.has(key));
  return key;
}

/** "Open X →" link of a template item, with :companyId filled in. */
export function templateItemLink(template, stageKey, itemKey, companyId) {
  const stage = template.find((s) => s.stage_key === stageKey);
  const item = stage?.items.find((i) => i.item_key === itemKey);
  if (!item?.link_to || !companyId) return null;
  return {
    to: item.link_to.replaceAll(":companyId", companyId),
    label: item.link_label || "Open →",
  };
}
