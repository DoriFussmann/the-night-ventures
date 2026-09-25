export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"];

export function slugifyFilename(label) {
  const base = String(label || "image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "image";
}

export function imageSrcFromResult(result) {
  if (result?.b64_json) {
    const mime = result.mime || "image/png";
    return `data:${mime};base64,${result.b64_json}`;
  }
  if (result?.url) return result.url;
  return "";
}

export async function generateOneImage({ prompt, size, styleContext }) {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size, styleContext }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Image generation failed (${res.status})`);
  }
  if (!data.b64_json && !data.url) {
    throw new Error("No image returned");
  }
  return { b64_json: data.b64_json || null, url: data.url || null };
}

function stockFailure(reason) {
  return {
    found: false,
    trail: [{ provider: "stock", outcome: "error", reason: String(reason || "stock failed") }],
  };
}

export async function findStockImage(params) {
  try {
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "stock", ...params }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== "object") {
      return stockFailure(data?.error || `Stock search failed (${res.status})`);
    }
    return data;
  } catch (err) {
    return stockFailure(err?.message || "Stock search failed");
  }
}

export async function getImage({ prompt, size, styleContext, stock }) {
  let stockTrail = [];
  if (stock) {
    const stockResult = await findStockImage({
      title: stock.title,
      description: stock.description,
      keyword: stock.keyword,
      articleType: stock.articleType,
      styleContext,
      excludeIds: stock.excludeIds,
    });
    stockTrail = Array.isArray(stockResult?.trail) ? stockResult.trail : [];
    if (stockResult?.found && stockResult.b64_json) {
      return {
        b64_json: stockResult.b64_json,
        url: null,
        mime: stockResult.mime || "image/jpeg",
        source: stockResult.source,
        sourceId: stockResult.sourceId ?? null,
        attribution: stockResult.attribution ?? null,
        altText: stockResult.altText || "",
        trail: stockTrail,
      };
    }
  }

  const gen = await generateOneImage({ prompt, size, styleContext });
  return {
    ...gen,
    mime: "image/png",
    source: "openai",
    sourceId: null,
    attribution: null,
    trail: [...stockTrail, { provider: "openai", outcome: "used" }],
  };
}

export async function downloadGeneratedImage(label, result) {
  const isJpeg = result?.mime === "image/jpeg";
  const filename = `${slugifyFilename(label)}.${isJpeg ? "jpg" : "png"}`;
  if (result?.b64_json) {
    const binary = atob(result.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: isJpeg ? "image/jpeg" : "image/png" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    return;
  }
  if (result?.url) {
    const res = await fetch(result.url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }
}

/** Append optional pillar / supporting keywords so the image can reflect them. */
export function appendKeywordContext(prompt, pillarKeyword, supportingKeyword) {
  const base = String(prompt || "").trim();
  const extras = [];
  if (pillarKeyword) extras.push(`pillar keyword “${pillarKeyword}”`);
  if (supportingKeyword) extras.push(`supporting keyword “${supportingKeyword}”`);
  if (extras.length === 0) return base;
  return `${base}\n\nThe image should clearly reflect the ${extras.join(" and the ")}.`;
}

/** Combine company design guide + optional extra guidelines for styleContext. */
export function buildStyleContext(designGuideAbstract, extraGuidelines) {
  const brand = String(designGuideAbstract || "").trim();
  const extra = String(extraGuidelines || "").trim();
  if (brand && extra) {
    return `${brand}\n\nAdditional guidelines:\n${extra}`;
  }
  return brand || extra;
}
