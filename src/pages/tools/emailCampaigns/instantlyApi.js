import { supabase } from "@/lib/supabase";

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// Instantly call scoped to a company. The server resolves the campaign ID from
// the company record — the client never sends one. `payload` is passed through
// as-is (leads, cursor, status, days, …).
export async function instantly(resource, companyId, payload = {}) {
  const headers = await authHeaders();
  const res = await fetch("/api/check-article-update?action=instantly", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, resource, companyId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Instantly request failed (${res.status})`);
  }
  return data.data;
}
