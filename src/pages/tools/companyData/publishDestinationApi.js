import { supabase } from "@/lib/supabase";

/**
 * Run the Publish Destination connection check on the values in the dialog.
 * @param {{ owner: string, repo: string, tokenKey: string }} destination
 * @returns {Promise<{ ok: boolean, steps: Array<{ id: string, label: string, status: string, detail: string, fix: string }> }>}
 */
export async function checkPublishDestination({ owner, repo, tokenKey }) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/api/check-article-update?action=integrations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      check: "publish-destination",
      owner: owner.trim(),
      repo: repo.trim(),
      tokenKey: tokenKey.trim().toUpperCase(),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Connection check failed");
  return body;
}
