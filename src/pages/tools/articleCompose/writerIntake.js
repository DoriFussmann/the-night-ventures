import { supabase } from "@/lib/supabase";
import {
  keepWriterImages,
  removeBlocks,
  splitSourceBlocks,
  writerImagesToStorage,
} from "../../../../lib/writer-intake/markdown.js";
import { HERO_BUCKET, heroStoragePath } from "../articleGeneration/heroImageStorage";
import { coverageArticles } from "./cannibalization";

// Bucket limit is 5 MB; leave headroom.
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024;
const THUMB_MAX_SIDE = 640;

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function extForType(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "png";
}

function base64ToBytes(b64) {
  const binary = atob(String(b64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read an image from the document."));
    img.src = src;
  });
}

async function drawScaled(dataUrl, maxSide, type, quality) {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

/**
 * Upload the document's images to storage and make small previews for the
 * analysis. Returns [{ n, storagePath, contentType, preview, thumb }].
 */
export async function uploadWriterImages({ companyId, images }) {
  const list = Array.isArray(images) ? images : [];
  if (!companyId || list.length === 0) return [];
  const batch =
    (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const out = [];
  for (const image of list) {
    try {
      out.push(await uploadOne({ companyId, batch, image }));
    } catch (err) {
      // An image the browser can't read (e.g. a Word drawing) is left out.
      console.warn(`Writer image ${image.n} skipped:`, err);
    }
  }
  return out;
}

async function uploadOne({ companyId, batch, image }) {
  let contentType = String(image.contentType || "image/png").toLowerCase();
  let bytes = base64ToBytes(image.base64);
  const original = `data:${contentType};base64,${image.base64}`;
  if (bytes.length > MAX_UPLOAD_BYTES || !/^image\/(png|jpe?g|webp|gif)$/.test(contentType)) {
    // Too large (or a format the site can't use, e.g. EMF): re-encode as JPEG.
    const reencoded = await drawScaled(original, 2400, "image/jpeg", 0.9);
    contentType = "image/jpeg";
    bytes = base64ToBytes(reencoded.split(",")[1]);
  }
  const storagePath = `${companyId}/writer/${batch}/${image.n}.${extForType(contentType)}`;
  const { error } = await supabase.storage
    .from(HERO_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: true });
  if (error) throw new Error(error.message || "Failed to upload a writer image");
  const thumb = await drawScaled(original, THUMB_MAX_SIDE, "image/jpeg", 0.8);
  return { n: image.n, storagePath, contentType, preview: thumb, thumb };
}

async function libraryArticles(companyId) {
  const { data, error } = await supabase
    .from("generated_articles")
    .select("slug, title, status, target_keyword, pillar_keyword, supporting_keyword, type")
    .eq("company_id", companyId);
  if (error) throw new Error(error.message || "Failed to load existing articles");
  return (Array.isArray(data) ? data : []).map((row) => ({
    slug: row.slug,
    title: row.title,
    targetKeyword: row.target_keyword,
    pillarKeyword: row.pillar_keyword,
    supportingKeyword: row.supporting_keyword,
    articleType: row.type,
    status: String(row.status || "drafted"),
    where: "library",
  }));
}

function keywordMapFromPillars(pillars) {
  return (Array.isArray(pillars) ? pillars : []).map((pillar) => ({
    keyword: String(pillar?.keyword || "").trim(),
    supporting: (Array.isArray(pillar?.supporting) ? pillar.supporting : [])
      .map((item) => String(item?.keyword || "").trim())
      .filter(Boolean),
  }));
}

/**
 * Ask the server to separate the brief from the article, classify the images
 * and rank keyword options from Company Intelligence (always read live).
 */
export async function analyzeWriterArticle({ companyId, source, writerImages, pillars, positioning }) {
  const blocks = splitSourceBlocks(source);
  const existing = [...(await libraryArticles(companyId)), ...coverageArticles(pillars)];
  const res = await fetch("/api/analyze-writer-article", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      domain: positioning?.domain || "",
      commercialUrl: positioning?.seoControls?.commercialUrl || "",
      positioning: [positioning?.shortDescription, positioning?.seoControls?.primaryOffer]
        .filter(Boolean)
        .join("\n"),
      blocks,
      images: (Array.isArray(writerImages) ? writerImages : []).map((img) => ({
        n: img.n,
        mediaType: "image/jpeg",
        data: String(img.thumb || "").split(",")[1] || "",
      })),
      keywordMap: keywordMapFromPillars(pillars),
      existing,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Analysis failed (${res.status})`);
  const briefBlocks = Array.isArray(data.briefBlocks) ? data.briefBlocks : [];
  return {
    ...data,
    sourceBlocks: blocks.length,
    briefText: briefBlocks.map((i) => blocks[i]).filter(Boolean),
    cleanedSource: removeBlocks(source, briefBlocks),
  };
}

/** { [n]: "hero" | "inline" | "exclude" } from the analysis. */
export function imageChoicesFromAnalysis(images) {
  const out = {};
  for (const img of Array.isArray(images) ? images : []) out[img.n] = img.role;
  return out;
}

export function inlineImageNumbers(choices) {
  return Object.entries(choices || {})
    .filter(([, role]) => role === "inline")
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
}

export function heroImageNumber(choices) {
  const entry = Object.entries(choices || {}).find(([, role]) => role === "hero");
  return entry ? Number(entry[0]) : null;
}

/** Source sent to the model: only the in-article images keep their placeholder. */
export function sourceForGeneration(source, choices) {
  return keepWriterImages(source, inlineImageNumbers(choices));
}

export function writerBriefForGeneration({ intake, choices, option, domain }) {
  if (!intake) return null;
  const inline = inlineImageNumbers(choices);
  const alts = {};
  for (const img of intake.images || []) if (inline.includes(img.n) && img.alt) alts[img.n] = img.alt;
  return {
    domain,
    targetUrl: intake.brief?.targetUrl || "",
    writerKeyword: intake.brief?.keyword || "",
    metaTitle: intake.brief?.metaTitle || "",
    metaDescription: intake.brief?.metaDescription || "",
    h1: intake.brief?.h1 || "",
    changes: option?.changes || "",
    imageNumbers: inline,
    imageAlts: alts,
  };
}

/** writer-image:N -> tnv-image:<storage path> in the generated body. */
export function bodyWithStoredImages(body, writerImages) {
  const paths = {};
  for (const img of Array.isArray(writerImages) ? writerImages : []) paths[img.n] = img.storagePath;
  return writerImagesToStorage(body, paths);
}

/**
 * Use the writer's chosen image as the hero: copy it to the article's hero
 * path ({companyId}/{slug}.{ext}) so publishing picks it up.
 */
export async function applyWriterHero({ companyId, slug, image }) {
  if (!image?.storagePath || !slug) return null;
  const ext = String(image.storagePath.split(".").pop() || "png").toLowerCase();
  const target = heroStoragePath(companyId, slug, ext);
  const { data, error } = await supabase.storage.from(HERO_BUCKET).download(image.storagePath);
  if (error || !data) throw new Error(error?.message || "Could not load the writer's hero image");
  const { error: uploadError } = await supabase.storage
    .from(HERO_BUCKET)
    .upload(target, data, { contentType: image.contentType || data.type || "image/png", upsert: true });
  if (uploadError) throw new Error(uploadError.message || "Could not save the hero image");
  return {
    storagePath: target,
    heroSource: { source: "writer", sourceId: image.storagePath, attribution: null },
  };
}
