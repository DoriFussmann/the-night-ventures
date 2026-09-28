import { parseFrontmatter } from "../../../../lib/frontmatter.js";
import { prepareSource } from "./sourceText.js";

const MAX_BYTES = 5 * 1024 * 1024;

export async function htmlToMarkdown(html) {
  const turndown = await import("turndown");
  const TurndownService = turndown.default;
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
  });
  return service.turndown(String(html || ""));
}

export async function docxToMarkdown(arrayBuffer) {
  const mammoth = await import("mammoth");
  const convert = mammoth.convertToHtml || mammoth.default?.convertToHtml;
  // Node mammoth reads buffer; the browser build reads arrayBuffer.
  const result = await convert({ buffer: arrayBuffer, arrayBuffer });
  return htmlToMarkdown(result.value || "");
}

export function sourceFileError(file) {
  const name = String(file?.name || "").toLowerCase();
  const allowed =
    name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".docx");
  if (!allowed) return "Only .md, .txt, and .docx files are supported.";
  if (Number(file?.size) > MAX_BYTES) return "File must be 5 MB or smaller.";
  return "";
}

export async function readSourceFile(file, domain) {
  const name = String(file.name || "").toLowerCase();
  let markdown = "";
  let originalTitle = "";
  let originalDescription = "";

  if (name.endsWith(".docx")) {
    markdown = await docxToMarkdown(await file.arrayBuffer());
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
  };
}
