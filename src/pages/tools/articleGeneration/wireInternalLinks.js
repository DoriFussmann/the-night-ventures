import { supabase } from "@/lib/supabase";
import { DEFAULT_PUBLISH_BRANCH } from "./publishToSite";

async function postWire(token, body) {
  const res = await fetch("/api/wire-internal-links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || `Wire links failed (${res.status})`;
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
  return {
    companyId,
    owner,
    repo,
    github_token_key: tokenKey,
    branch,
  };
}

export async function proposeInternalLinks(destination) {
  const token = await sessionToken();
  return postWire(token, { ...destBody(destination), step: "propose" });
}

export async function commitInternalLinks(destination) {
  const token = await sessionToken();
  return postWire(token, { ...destBody(destination), step: "commit" });
}
