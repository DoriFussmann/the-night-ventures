import { supabase } from "@/lib/supabase";

const ENDPOINT = "/api/prompt-tests";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function get(action, companyId) {
  const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ action, companyId })}`, { headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function post(action, companyId, body = {}) {
  const res = await fetch(`${ENDPOINT}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, companyId, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const loadPromptTests = (companyId) => get("state", companyId);
export const exportPromptRuns = (companyId) => get("export", companyId);
export const savePromptTestSettings = (companyId, settings) => post("settings", companyId, { settings });
export const previewPromptTest = (companyId, promptIds) => post("preview", companyId, { promptIds });
export const startPromptTest = (companyId, promptIds) => post("start", companyId, { promptIds });
export const stepPromptTest = (companyId, cycleId, calls) => post("step", companyId, { cycleId, calls });
export const finishPromptTest = (companyId, cycleId, stopped) => post("finish", companyId, { cycleId, stopped });
