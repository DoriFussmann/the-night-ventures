import { supabase } from "@/lib/supabase";
import { DEFAULT_PUBLISH_BRANCH } from "../articleGeneration/publishToSite";

async function postCoreVersion(token, body) {
  const res = await fetch("/api/core-version", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || `Core version request failed (${res.status})`;
    const err = new Error(message);
    err.result = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function sessionToken() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

function destBody(destination) {
  const companyId = String(destination?.companyId || "").trim();
  const owner = String(destination?.owner || "").trim();
  const repo = String(destination?.repo || "").trim();
  const tokenKey = String(destination?.tokenKey || "").trim().toUpperCase();
  const branch =
    String(destination?.branch || DEFAULT_PUBLISH_BRANCH).trim() ||
    DEFAULT_PUBLISH_BRANCH;
  if (!owner || !repo || !tokenKey) {
    throw new Error("No destination repo set for this company.");
  }
  return { companyId, owner, repo, github_token_key: tokenKey, branch };
}

// Read the project's current seo-core version, the latest available tag, and
// whether an update is available (and safe to one-click).
export async function getCoreVersionStatus(destination) {
  const token = await sessionToken();
  return postCoreVersion(token, { ...destBody(destination), step: "status" });
}

// Apply a one-click (green/minor) update. The server refuses breaking (major)
// updates with a 409 — those require a Cursor migration first.
export async function applyCoreVersionUpdate(destination) {
  const token = await sessionToken();
  return postCoreVersion(token, { ...destBody(destination), step: "apply" });
}
