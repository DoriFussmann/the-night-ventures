import { supabase } from "@/lib/supabase";

export const HERO_BUCKET = "article-heroes";

function stripDataUrl(b64) {
  const raw = String(b64 || "").trim();
  const comma = raw.indexOf(",");
  if (raw.startsWith("data:") && comma !== -1) return raw.slice(comma + 1);
  return raw.replace(/\s+/g, "");
}

function base64ToBytes(b64) {
  const raw = stripDataUrl(b64);
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function heroStoragePath(companyId, slug, ext = "png") {
  const id = String(companyId || "").trim();
  const s = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const e = String(ext || "png").toLowerCase() === "jpeg" ? "jpg" : String(ext || "png").toLowerCase();
  if (!id || !s) return "";
  return `${id}/${s}.${e}`;
}

/**
 * Upload a generated hero to Storage and record the path on generated_articles
 * when a matching (company_id, slug) row already exists.
 */
export async function persistGeneratedHeroImage({ companyId, slug, b64 }) {
  const path = heroStoragePath(companyId, slug, "png");
  const bytes = base64ToBytes(b64);
  if (!path || bytes.length === 0) {
    throw new Error("Hero image is missing company, slug, or bytes");
  }

  const { error } = await supabase.storage.from(HERO_BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) {
    throw new Error(error.message || "Failed to upload hero image");
  }

  const { error: updateError } = await supabase
    .from("generated_articles")
    .update({
      hero_storage_path: path,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("slug", slug);
  if (updateError) {
    console.error("Failed to record hero_storage_path:", updateError);
  }

  return path;
}

export async function finishHeroImage({ companyId, slug, cropped }) {
  let storagePath = null;
  try {
    storagePath = await persistGeneratedHeroImage({
      companyId,
      slug,
      b64: cropped?.b64_json,
    });
  } catch (err) {
    console.error("Hero image storage failed:", err);
  }
  return {
    status: "done",
    result: cropped,
    error: null,
    storagePath,
  };
}

export function resolveHeroPath(companyId, article) {
  const recorded = String(article?.hero_storage_path || "").trim();
  if (recorded) return recorded;
  return heroStoragePath(companyId, article?.slug);
}

export async function signedHeroUrl(path, expiresIn = 3600) {
  const objectPath = String(path || "").trim();
  if (!objectPath) return "";
  const { data, error } = await supabase.storage
    .from(HERO_BUCKET)
    .createSignedUrl(objectPath, expiresIn);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

export async function heroPreviewUrl(companyId, article) {
  const path = resolveHeroPath(companyId, article);
  if (!path) return "";
  const signed = await signedHeroUrl(path);
  if (signed) return signed;
  const downloaded = await downloadGeneratedHeroBase64({
    companyId,
    slug: article?.slug,
    path,
  });
  if (!downloaded?.b64) return "";
  const mime = downloaded.ext === "jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${downloaded.b64}`;
}

export async function downloadGeneratedHeroBase64({ companyId, slug, path }) {
  const objectPath = String(path || heroStoragePath(companyId, slug, "png")).trim();
  if (!objectPath) return null;
  const { data, error } = await supabase.storage.from(HERO_BUCKET).download(objectPath);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const ext = objectPath.split(".").pop()?.toLowerCase() || "png";
  return {
    b64: btoa(binary),
    ext: ext === "jpeg" ? "jpg" : ext,
    path: objectPath,
  };
}
