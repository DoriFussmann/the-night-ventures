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

export async function listIntegrations(companyId) {
  const headers = await authHeaders();
  const qs = new URLSearchParams({ action: "integrations" });
  if (companyId) qs.set("companyId", companyId);
  const res = await fetch(`/api/check-article-update?${qs}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load integrations");
  return data;
}

export async function testIntegration(companyId, id) {
  const headers = await authHeaders();
  const res = await fetch("/api/check-article-update?action=integrations", {
    method: "POST",
    headers,
    body: JSON.stringify({ companyId, id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Test failed");
  return data;
}
