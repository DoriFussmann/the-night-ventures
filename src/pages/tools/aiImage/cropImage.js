/**
 * Center-crop a landscape image to 16:9, then export as 1200×675 PNG.
 * Expected source from gpt-image-2 landscape: 1536×1024 (3:2).
 * Crop: height = width * 9/16 → 1536×864, 80px off top and bottom.
 *
 * @param {string} imageSrc - data URL or remote URL (from imageSrcFromResult)
 * @returns {Promise<{ b64_json: string }>}
 */
export async function cropImageTo16x9(imageSrc) {
  const src = String(imageSrc || "").trim();
  if (!src) {
    throw new Error("No image source to crop");
  }

  const image = await loadImage(src);
  const srcW = image.naturalWidth || image.width;
  const srcH = image.naturalHeight || image.height;
  if (!srcW || !srcH) {
    throw new Error("Could not read image dimensions");
  }

  // Widest 16:9 rectangle that fits inside the source.
  let cropW = srcW;
  let cropH = Math.round((srcW * 9) / 16);
  if (cropH > srcH) {
    cropH = srcH;
    cropW = Math.round((srcH * 16) / 9);
  }

  const sx = Math.floor((srcW - cropW) / 2);
  const sy = Math.floor((srcH - cropH) / 2);

  const OUT_W = 1200;
  const OUT_H = 675;
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }

  ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, OUT_W, OUT_H);

  const dataUrl = canvas.toDataURL("image/png");
  const marker = "base64,";
  const idx = dataUrl.indexOf(marker);
  if (idx === -1) {
    throw new Error("Failed to encode cropped PNG");
  }
  return { b64_json: dataUrl.slice(idx + marker.length) };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for crop"));
    // data: URLs don't need CORS; remote OpenAI URLs may.
    if (!src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.src = src;
  });
}
