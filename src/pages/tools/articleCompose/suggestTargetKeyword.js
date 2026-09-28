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

export async function suggestTargetKeyword({
  text,
  pillarKeyword,
  supportingKeyword,
}) {
  const headers = await authHeaders();
  const res = await fetch("/api/suggest-target-keyword", {
    method: "POST",
    headers,
    body: JSON.stringify({
      text: String(text || "").slice(0, 6000),
      pillarKeyword,
      supportingKeyword,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Failed to suggest target keywords");
  }
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  return suggestions.map((item) => String(item || "").trim()).filter(Boolean);
}
