import { supabase } from "@/lib/supabase";

const ENDPOINT = "/api/audit-snapshot";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request(url, options) {
  const res = await fetch(url, { ...options, headers: await authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * @param {string} companyId
 * @param {number} days
 */
export function getAnalyticsSummary(companyId, days) {
  const qs = new URLSearchParams({ action: "analytics.summary", companyId, days: String(days) });
  return request(`${ENDPOINT}?${qs}`, { method: "GET" });
}

/**
 * Pull fresh data now. `ai: true` also runs the paid AI visibility checks.
 * @param {string} companyId
 * @param {{ ai?: boolean }} [options]
 */
export function refreshAnalytics(companyId, { ai = false } = {}) {
  return request(`${ENDPOINT}?action=analytics.refresh`, {
    method: "POST",
    body: JSON.stringify({ action: "analytics.refresh", companyId, ai }),
  });
}

/**
 * @param {string} companyId
 * @param {{ gsc: string, ga4: string, bing: string }} overrides
 */
export function saveAnalyticsSettings(companyId, overrides) {
  return request(`${ENDPOINT}?action=analytics.settings`, {
    method: "POST",
    body: JSON.stringify({ action: "analytics.settings", companyId, ...overrides }),
  });
}
