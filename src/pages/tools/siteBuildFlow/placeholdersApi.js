import { supabase } from "@/lib/supabase";
import { summarize } from "./placeholdersSummary";
import { DEFAULT_PUBLISH_BRANCH, loadCompanyPublishDestination } from "../articleGeneration/publishToSite";

/** Virtual Build Blueprint stage (not in the editable template, so it can't be edited away). */
export const PLACEHOLDERS_STAGE_KEY = "live-placeholders";
export const PLACEHOLDERS_STAGE_NAME = "Placeholders";
/** Shown right after this template stage (or first, when it is missing). */
export const PLACEHOLDERS_AFTER_STAGE = "code-setup";

const MIGRATION_HINT =
  "Apply supabase/migrations/066_site_placeholder_scans.sql in the Supabase SQL editor, then reload.";

async function sessionToken() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return token;
}

export { loadCompanyPublishDestination, summarize };

/** Run a live scan of the company's site repo. */
export async function scanSitePlaceholders(destination) {
  const owner = String(destination?.owner || "").trim();
  const repo = String(destination?.repo || "").trim();
  const tokenKey = String(destination?.tokenKey || "").trim().toUpperCase();
  if (!owner || !repo || !tokenKey) throw new Error("No Publish Destination set for this company.");
  const token = await sessionToken();
  const res = await fetch("/api/site-placeholders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      owner,
      repo,
      github_token_key: tokenKey,
      branch: String(destination?.branch || DEFAULT_PUBLISH_BRANCH).trim() || DEFAULT_PUBLISH_BRANCH,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `Scan failed (${res.status})`);
  return data;
}

function friendly(error) {
  const message = error?.message || String(error || "");
  return /site_placeholder_scans/i.test(message) ? `The Placeholders table is missing. ${MIGRATION_HINT}` : message;
}

/** @returns {Promise<object|null>} the saved row, or null */
export async function loadSavedScan(companyId) {
  const { data, error } = await supabase
    .from("site_placeholder_scans")
    .select("company_id, scanned_at, commit_sha, branch, site_root, core_version, manifest_source, report, signoffs")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(friendly(error));
  return data || null;
}

export async function saveScan(companyId, scan) {
  const { error } = await supabase.from("site_placeholder_scans").upsert(
    {
      company_id: companyId,
      scanned_at: scan.scannedAt,
      commit_sha: scan.commitSha,
      branch: scan.project?.branch || null,
      site_root: scan.siteRoot,
      core_version: scan.coreVersion,
      manifest_source: scan.manifestSource,
      report: scan.report,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );
  if (error) throw new Error(friendly(error));
}

export async function saveSignoffs(companyId, signoffs) {
  const { error } = await supabase
    .from("site_placeholder_scans")
    .upsert(
      { company_id: companyId, signoffs, updated_at: new Date().toISOString() },
      { onConflict: "company_id" }
    );
  if (error) throw new Error(friendly(error));
}
