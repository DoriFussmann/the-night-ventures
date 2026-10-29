import { parseFrontmatter } from "../../../../lib/frontmatter.js";
import { addTableRule, writerImageRef } from "../../../../lib/writer-intake/markdown.js";
import { prepareSource } from "./sourceText.js";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
// A writer's .docx carries its images; the text itself is small.
const MAX_DOCX_BYTES = 40 * 1024 * 1024;

export async function htmlToMarkdown(html) {
  const turndown = await import("turndown");
  const TurndownService = turndown.default;
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
  });
  addTableRule(service);
  return service.turndown(String(html || ""));
}

/**
 * .docx -> markdown. Embedded images become `![](writer-image:N)` placeholders
 * (N = order in the document) and are returned as { n, contentType, base64 }.
 */
export async function docxToMarkdown(arrayBuffer) {
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;
  const images = [];
  const convertImage = mammoth.images.imgElement(async (image) => {
    const n = images.length + 1;
    const base64 = await image.read("base64");
    images.push({ n, contentType: String(image.contentType || "image/png"), base64 });
    return { src: writerImageRef(n), alt: "" };
  });
  // Node mammoth reads buffer; the browser build reads arrayBuffer.
  const result = await mammoth.convertToHtml(
    { buffer: arrayBuffer, arrayBuffer },
    { convertImage }
  );
  return { markdown: await htmlToMarkdown(result.value || ""), images };
}

export function sourceFileError(file) {
  const name = String(file?.name || "").toLowerCase();
  const allowed =
    name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".docx");
  if (!allowed) return "Only .md, .txt, and .docx files are supported.";
  const limit = name.endsWith(".docx") ? MAX_DOCX_BYTES : MAX_TEXT_BYTES;
  if (Number(file?.size) > limit) {
    return `File must be ${Math.round(limit / 1024 / 1024)} MB or smaller.`;
  }
  return "";
}

export async function readSourceFile(file, domain) {
  const name = String(file.name || "").toLowerCase();
  let markdown = "";
  let originalTitle = "";
  let originalDescription = "";
  let images = [];

  if (name.endsWith(".docx")) {
    ({ markdown, images } = await docxToMarkdown(await file.arrayBuffer()));
  } else {
    const text = await file.text();
    if (name.endsWith(".md")) {
      const parsed = parseFrontmatter(text);
      markdown = parsed.ok ? parsed.body : text;
      if (parsed.ok) {
        originalTitle = String(parsed.data?.title || "").trim();
        originalDescription = String(parsed.data?.description || "").trim();
      }
    } else {
      markdown = text;
    }
  }

  return {
    ...prepareSource(markdown, domain),
    originalTitle,
    originalDescription,
    images,
  };
}
