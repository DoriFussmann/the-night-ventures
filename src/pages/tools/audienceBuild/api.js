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

// Audience Build call. The AudienceLab and Anthropic keys stay on the server.
export async function audienceBuild(resource, payload = {}) {
  const headers = await authHeaders();
  const res = await fetch("/api/check-article-update?action=audience-build", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, resource }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Audience Build request failed (${res.status})`);
  }
  return data.data;
}
