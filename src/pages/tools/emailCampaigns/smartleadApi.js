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

// Read-only SmartLead call. resource is one of:
// 'campaigns' | 'campaign' | 'sequences' | 'leads' | 'analytics' | 'email-accounts'
export async function smartlead(resource, { campaignId, offset, limit } = {}) {
  const headers = await authHeaders();
  const res = await fetch("/api/check-article-update?action=smartlead", {
    method: "POST",
    headers,
    body: JSON.stringify({ resource, campaignId, offset, limit }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "SmartLead request failed");
  }
  return data.data;
}
