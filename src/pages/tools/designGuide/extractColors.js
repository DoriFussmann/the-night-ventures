function rgbToHex(r, g, b) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function colorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/**
 * Extract dominant hex colors from an image File/Blob via canvas sampling.
 * Draws a scaled-down image, samples pixels, buckets similar colors, returns top N.
 */
export function extractColorsFromImage(file, { maxColors = 5, maxDimension = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas not supported"));
          return;
        }

        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);

        const buckets = [];
        const step = 4 * 4; // sample every 4th pixel

        for (let i = 0; i < data.length; i += step) {
          const a = data[i + 3];
          if (a < 128) continue;

          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Skip near-white / near-black noise for palette usefulness
          const brightness = (r + g + b) / 3;
          if (brightness > 245 || brightness < 10) continue;

          const pixel = { r, g, b };
          let matched = null;
          for (const bucket of buckets) {
            if (colorDistance(bucket, pixel) < 60) {
              matched = bucket;
              break;
            }
          }

          if (matched) {
            matched.r = (matched.r * matched.count + r) / (matched.count + 1);
            matched.g = (matched.g * matched.count + g) / (matched.count + 1);
            matched.b = (matched.b * matched.count + b) / (matched.count + 1);
            matched.count += 1;
          } else {
            buckets.push({ r, g, b, count: 1 });
          }
        }

        buckets.sort((a, b) => b.count - a.count);

        const colors = [];
        for (const bucket of buckets) {
          if (colors.length >= maxColors) break;
          const hex = rgbToHex(bucket.r, bucket.g, bucket.b);
          if (!colors.includes(hex)) {
            colors.push(hex);
          }
        }

        URL.revokeObjectURL(url);
        resolve(colors);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}
