import { IMAGE_HEIGHT, IMAGE_WIDTH } from "./defaults";

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [""];

  const lines = [];
  let current = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function fitHeadline(ctx, text, maxWidth, maxLines, preferredSize, minSize, weight, family) {
  let size = preferredSize;
  while (size >= minSize) {
    ctx.font = `${weight} ${size}px "${family}", Georgia, serif`;
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) {
      return { size, lines };
    }
    size -= 2;
  }
  ctx.font = `${weight} ${minSize}px "${family}", Georgia, serif`;
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  if (wrapText(ctx, text, maxWidth).length > maxLines) {
    const last = lines[maxLines - 1] || "";
    lines[maxLines - 1] = last.replace(/\s+\S*$/, "") + "…";
  }
  return { size: minSize, lines };
}

function paintBackground(ctx, spec, style) {
  const { backgroundColor, accentColor } = spec;
  const gradient = ctx.createLinearGradient(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  if (style === "bold") {
    gradient.addColorStop(0, backgroundColor);
    gradient.addColorStop(1, accentColor);
  } else if (style === "editorial") {
    gradient.addColorStop(0, backgroundColor);
    gradient.addColorStop(0.85, backgroundColor);
    gradient.addColorStop(1, accentColor);
  } else {
    gradient.addColorStop(0, backgroundColor);
    gradient.addColorStop(1, backgroundColor);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
}

function drawMinimal(ctx, { spec, companyLabel, domain, headline, eyebrow }) {
  const { accentColor, textColor, fontFamily } = spec;
  const pad = 72;

  ctx.fillStyle = accentColor;
  ctx.fillRect(pad, pad, 64, 6);

  ctx.fillStyle = textColor;
  ctx.globalAlpha = 0.72;
  ctx.font = `400 22px "${fontFamily}", Georgia, serif`;
  ctx.fillText(companyLabel, pad, pad + 56);
  ctx.globalAlpha = 1;

  if (eyebrow) {
    ctx.globalAlpha = 0.55;
    ctx.font = `400 18px "${fontFamily}", Georgia, serif`;
    ctx.fillText(eyebrow, pad, pad + 92);
    ctx.globalAlpha = 1;
  }

  const { size, lines } = fitHeadline(
    ctx,
    headline,
    IMAGE_WIDTH - pad * 2,
    3,
    72,
    40,
    "600",
    fontFamily
  );
  const startY = IMAGE_HEIGHT / 2 - ((lines.length - 1) * (size * 1.15)) / 2;
  ctx.fillStyle = textColor;
  lines.forEach((line, i) => {
    ctx.font = `600 ${size}px "${fontFamily}", Georgia, serif`;
    ctx.fillText(line, pad, startY + i * size * 1.15);
  });

  ctx.fillStyle = accentColor;
  ctx.fillRect(pad, IMAGE_HEIGHT - pad - 6, 120, 6);

  if (domain) {
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.5;
    ctx.font = `400 18px "${fontFamily}", Georgia, serif`;
    ctx.fillText(domain, pad, IMAGE_HEIGHT - pad + 28);
    ctx.globalAlpha = 1;
  }
}

function drawBold(ctx, { spec, companyLabel, domain, headline, eyebrow }) {
  const { accentColor, textColor, fontFamily } = spec;

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, 36, IMAGE_HEIGHT);

  ctx.fillStyle = textColor;
  ctx.globalAlpha = 0.85;
  ctx.font = `700 20px "${fontFamily}", Georgia, serif`;
  ctx.fillText(companyLabel.toUpperCase(), 96, 88);
  ctx.globalAlpha = 1;

  if (eyebrow) {
    ctx.fillStyle = accentColor;
    ctx.font = `600 18px "${fontFamily}", Georgia, serif`;
    ctx.fillText(eyebrow.toUpperCase(), 96, 128);
  }

  const { size, lines } = fitHeadline(
    ctx,
    headline,
    IMAGE_WIDTH - 96 - 80,
    3,
    84,
    44,
    "700",
    fontFamily
  );
  const startY = 220;
  ctx.fillStyle = textColor;
  lines.forEach((line, i) => {
    ctx.font = `700 ${size}px "${fontFamily}", Georgia, serif`;
    ctx.fillText(line, 96, startY + i * size * 1.12);
  });

  ctx.fillStyle = accentColor;
  ctx.fillRect(96, IMAGE_HEIGHT - 100, IMAGE_WIDTH - 192, 4);

  if (domain) {
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.55;
    ctx.font = `400 18px "${fontFamily}", Georgia, serif`;
    ctx.fillText(domain, 96, IMAGE_HEIGHT - 56);
    ctx.globalAlpha = 1;
  }
}

function drawEditorial(ctx, { spec, companyLabel, domain, headline, eyebrow }) {
  const { accentColor, textColor, fontFamily } = spec;
  const pad = 80;

  ctx.fillStyle = textColor;
  ctx.globalAlpha = 0.65;
  ctx.font = `400 20px "${fontFamily}", Georgia, serif`;
  ctx.fillText(companyLabel, pad, pad + 8);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 28);
  ctx.lineTo(IMAGE_WIDTH - pad, pad + 28);
  ctx.stroke();

  if (eyebrow) {
    ctx.fillStyle = accentColor;
    ctx.font = `400 16px "${fontFamily}", Georgia, serif`;
    ctx.fillText(eyebrow, pad, pad + 68);
  }

  const { size, lines } = fitHeadline(
    ctx,
    headline,
    IMAGE_WIDTH - pad * 2,
    3,
    68,
    38,
    "600",
    fontFamily
  );
  const startY = IMAGE_HEIGHT / 2 - 10;
  ctx.fillStyle = textColor;
  lines.forEach((line, i) => {
    ctx.font = `600 ${size}px "${fontFamily}", Georgia, serif`;
    ctx.fillText(line, pad, startY + i * size * 1.2);
  });

  const underlineY = startY + lines.length * size * 1.2 + 16;
  ctx.fillStyle = accentColor;
  ctx.fillRect(pad, underlineY, Math.min(180, IMAGE_WIDTH / 4), 3);

  if (domain) {
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.45;
    ctx.font = `400 16px "${fontFamily}", Georgia, serif`;
    ctx.fillText(domain, pad, IMAGE_HEIGHT - pad + 16);
    ctx.globalAlpha = 1;
  }
}

/**
 * Paint a branded topic card onto an existing canvas (1280×720).
 */
export function drawClusterImage(canvas, options) {
  if (!canvas) return;

  const {
    spec,
    companyName = "",
    productName = "",
    domain = "",
    pillarKeyword = "",
    supportingKeyword = "",
  } = options;

  const width = IMAGE_WIDTH;
  const height = IMAGE_HEIGHT;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);

  const style = ["minimal", "bold", "editorial"].includes(spec?.style)
    ? spec.style
    : "minimal";

  paintBackground(ctx, spec, style);

  const companyLabel = String(productName || companyName || "Company").trim();
  const headline = String(supportingKeyword || pillarKeyword || "Topic").trim();
  const eyebrow = supportingKeyword
    ? String(pillarKeyword || "").trim()
    : "Pillar";
  const domainLabel = String(domain || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");

  const payload = {
    spec,
    companyLabel,
    domain: domainLabel,
    headline,
    eyebrow: eyebrow || "",
  };

  if (style === "bold") drawBold(ctx, payload);
  else if (style === "editorial") drawEditorial(ctx, payload);
  else drawMinimal(ctx, payload);
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to export PNG"));
          return;
        }
        resolve(blob);
      },
      "image/png",
      1
    );
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
