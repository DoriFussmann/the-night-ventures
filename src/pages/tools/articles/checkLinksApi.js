import { supabase } from "@/lib/supabase";
import { DEFAULT_PUBLISH_BRANCH } from "../articleGeneration/publishToSite";

async function postCheckLinks(token, body) {
  const res = await fetch("/api/check-links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data?.error;
    const fromBody = typeof raw === "string" ? raw : raw?.message;
    const message =
      fromBody ||
      (res.status === 504
        ? "Check Links timed out (504)"
        : `Check Links failed (${res.status})`);
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

export async function auditLiveLinks(destination) {
  const token = await sessionToken();
  return postCheckLinks(token, { ...destBody(destination), step: "audit" });
}

export async function proposeExternalFixes(destination, { slugs } = {}) {
  const token = await sessionToken();
  const list = Array.isArray(slugs)
    ? slugs.map((slug) => String(slug || "").trim()).filter(Boolean)
    : [];
  return postCheckLinks(token, {
    ...destBody(destination),
    step: "propose-external",
    ...(list.length ? { slugs: list } : {}),
  });
}

export async function commitLinkFixes(
  destination,
  confirmedExternal,
  excludeSlugs = []
) {
  const token = await sessionToken();
  return postCheckLinks(token, {
    ...destBody(destination),
    step: "commit",
    confirmedExternal,
    excludeSlugs,
  });
}
