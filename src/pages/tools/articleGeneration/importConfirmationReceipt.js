import { supabase } from "@/lib/supabase";

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function normalizeReceiptEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slug = String(raw.slug || "").trim();
  const confirmedDate = String(
    raw.confirmedDate || raw.newUpdatedDate || raw.updatedDate || ""
  ).trim();
  if (!slug || !isIsoDate(confirmedDate)) return null;
  const confirmedAt = String(raw.confirmedAt || "").trim() || null;
  return { slug, confirmedDate, confirmedAt };
}

/**
 * Parse a CMS confirmation receipt JSON string into normalized entries.
 * Accepts a bare array or `{ receipts|confirmed|articles: [...] }`.
 */
export function parseConfirmationReceipt(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    throw new Error("Receipt is not valid JSON");
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.receipts)
      ? parsed.receipts
      : Array.isArray(parsed?.confirmed)
        ? parsed.confirmed
        : Array.isArray(parsed?.articles)
          ? parsed.articles
          : null;

  if (!list) {
    throw new Error(
      "Receipt must be a JSON array of { slug, confirmedDate, confirmedAt }"
    );
  }

  const entries = [];
  const seen = new Set();
  for (const raw of list) {
    const entry = normalizeReceiptEntry(raw);
    if (!entry) continue;
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    entries.push(entry);
  }

  if (entries.length === 0) {
    throw new Error(
      "No valid confirmation entries found (need slug + confirmedDate YYYY-MM-DD)"
    );
  }

  return entries;
}

/**
 * Apply a CMS confirmation receipt to generated_articles for a company.
 * Sets updated_date from confirmedDate and last_synced_at to now (or confirmedAt).
 *
 * @returns {Promise<{ updated: Array<{ id, slug, updated_date, last_synced_at }>, unmatched: string[] }>}
 */
export async function applyConfirmationReceipt({ companyId, entries }) {
  if (!companyId) throw new Error("Missing companyId");
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    return { updated: [], unmatched: [] };
  }

  const slugs = list.map((e) => e.slug);
  const { data: rows, error: lookupError } = await supabase
    .from("generated_articles")
    .select("id, slug")
    .eq("company_id", companyId)
    .in("slug", slugs);

  if (lookupError) {
    throw new Error(lookupError.message || "Failed to look up articles");
  }

  const bySlug = new Map((rows || []).map((row) => [row.slug, row]));
  const unmatched = [];
  const updated = [];
  const syncedAt = new Date().toISOString();

  for (const entry of list) {
    const row = bySlug.get(entry.slug);
    if (!row) {
      unmatched.push(entry.slug);
      continue;
    }

    const payload = {
      updated_date: entry.confirmedDate,
      last_synced_at: syncedAt,
      updated_at: syncedAt,
    };

    const { data, error } = await supabase
      .from("generated_articles")
      .update(payload)
      .eq("id", row.id)
      .eq("company_id", companyId)
      .select("id, slug, updated_date, last_synced_at")
      .maybeSingle();

    if (error) {
      // Tolerate missing last_synced_at until migration is applied.
      if (
        /last_synced_at/i.test(error.message || "") ||
        error.code === "PGRST204"
      ) {
        const { last_synced_at: _ignored, ...fallbackPayload } = payload;
        const retry = await supabase
          .from("generated_articles")
          .update(fallbackPayload)
          .eq("id", row.id)
          .eq("company_id", companyId)
          .select("id, slug, updated_date")
          .maybeSingle();
        if (retry.error) {
          throw new Error(retry.error.message || `Failed to sync ${entry.slug}`);
        }
        updated.push({
          id: retry.data?.id || row.id,
          slug: entry.slug,
          updated_date: entry.confirmedDate,
          last_synced_at: null,
        });
        continue;
      }
      throw new Error(error.message || `Failed to sync ${entry.slug}`);
    }

    updated.push({
      id: data?.id || row.id,
      slug: entry.slug,
      updated_date: data?.updated_date || entry.confirmedDate,
      last_synced_at: data?.last_synced_at || syncedAt,
    });
  }

  return { updated, unmatched };
}
