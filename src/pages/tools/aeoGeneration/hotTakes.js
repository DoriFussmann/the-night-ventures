import { supabase } from "@/lib/supabase";
import { jsonAuthHeaders } from "@/lib/authHeaders";
import { findDuplicate, nextCode } from "../../../../lib/aeo/hotTakesBank.js";

function fail(error, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** The company's whole bank, dropped takes included, in code order. */
export async function loadHotTakes(companyId) {
  const { data, error } = await supabase.from("aeo_hot_takes").select("*").eq("company_id", companyId).order("code");
  fail(error, "Hot takes");
  return data || [];
}

export async function loadCompanyName(companyId) {
  const { data } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  return data?.name || "";
}

export async function updateHotTake(id, values) {
  const { error } = await supabase
    .from("aeo_hot_takes")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  fail(error, "Hot take");
}

export async function addHotTake(companyId, takes, companyName, values) {
  const { error } = await supabase
    .from("aeo_hot_takes")
    .insert({ company_id: companyId, code: nextCode(takes, companyName), ...values });
  fail(error, "Hot take");
}

/** Remove a take from the bank for good. */
export async function deleteHotTake(id) {
  const { error } = await supabase.from("aeo_hot_takes").delete().eq("id", id);
  fail(error, "Hot take");
}

/**
 * Save one take from a brief into the bank. The bank is read again first, so a
 * take that is already there (also one saved a moment ago, or a dropped one) is
 * not added twice. Returns {saved: code} or {duplicate: code}.
 */
export async function saveTakeToBank(companyId, companyName, values) {
  const takes = await loadHotTakes(companyId);
  const dup = findDuplicate(values.take, takes);
  if (dup) return { duplicate: dup.code };
  const code = nextCode(takes, companyName);
  const { error } = await supabase.from("aeo_hot_takes").insert({ company_id: companyId, code, ...values });
  fail(error, "Hot take");
  return { saved: code };
}

/** Add the rows of an import file; a take whose code is already in the bank is replaced. */
export async function importHotTakes(companyId, rows) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("aeo_hot_takes")
    .upsert(rows.map((r) => ({ ...r, company_id: companyId, updated_at: now })), { onConflict: "company_id,code" });
  fail(error, "Import");
}

async function ask(mode, payload, what) {
  const res = await fetch("/api/aeo-brief-outline", {
    method: "POST",
    headers: await jsonAuthHeaders(),
    body: JSON.stringify({ mode, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${what} failed (${res.status})`);
  return body;
}

/** Takes in the bank that already speak to this brief: {matches: [{code, why, take, topic}], conflicts}. */
export function matchHotTakes({ companyId, groupId, title, angle, outline }) {
  return ask("hot_takes_match", { companyId, groupId, title, angle, outline }, "Bank search");
}

/** One new take drafted from the bank for this brief: {take, basedOn, why}. */
export function draftHotTake({ companyId, groupId, title, angle, outline, current }) {
  return ask("hot_take_new", { companyId, groupId, title, angle, outline, current }, "New take");
}
