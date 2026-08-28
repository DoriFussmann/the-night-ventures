import { stripNoVolumeTag } from "./stripNoVolumeTag";

function yamlEscape(value) {
  const text = String(value ?? "");
  if (
    text === "" ||
    /[:#{}[\],&*?|>!%@`]/.test(text) ||
    /^\s|\s$/.test(text) ||
    text.includes("\n") ||
    text.includes('"') ||
    /^(true|false|null|yes|no|on|off)$/i.test(text)
  ) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return text;
}

/**
 * Serialize generated frontmatter + body into a CMS-ready markdown file.
 * Zip/download path: omit options (draft stays true, author stays null).
 * Publish path: serializeArticleMarkdown(fm, body, { draft: false }) and pass
 * a real author + image path on the frontmatter object.
 */
export function serializeArticleMarkdown(frontmatter, body, options = {}) {
  const fm = frontmatter && typeof frontmatter === "object" ? frontmatter : {};
  const tags = Array.isArray(fm.tags) ? fm.tags : [];
  const keywords = (Array.isArray(fm.keywords) ? fm.keywords : [])
    .map(stripNoVolumeTag)
    .filter(Boolean);
  const faqs = Array.isArray(fm.faqs) ? fm.faqs : [];
  const supportingKeyword = stripNoVolumeTag(fm.supportingKeyword);
  const author = String(fm.author || "").trim();
  const image = String(fm.image || "").trim();
  const draft = options.draft !== false;

  const lines = ["---"];
  lines.push(`title: ${yamlEscape(fm.title || "")}`);
  lines.push(`description: ${yamlEscape(fm.description || "")}`);
  lines.push(`slug: ${String(fm.slug || "").trim()}`);
  lines.push(`date: ${String(fm.date || "").trim()}`);
  lines.push(`updatedDate: ${String(fm.updatedDate || "").trim()}`);
  lines.push(author ? `author: ${yamlEscape(author)}` : `author: null`);
  lines.push(`category: ${yamlEscape(fm.category || "")}`);
  lines.push(`pillarKeyword: ${yamlEscape(stripNoVolumeTag(fm.pillarKeyword))}`);
  if (supportingKeyword) {
    lines.push(`supportingKeyword: ${yamlEscape(supportingKeyword)}`);
  }
  lines.push(`articleType: ${yamlEscape(fm.articleType || "")}`);
  lines.push(`targetKeyword: ${yamlEscape(stripNoVolumeTag(fm.targetKeyword))}`);

  lines.push("tags:");
  for (const tag of tags) {
    lines.push(`  - ${yamlEscape(tag)}`);
  }

  if (image) {
    lines.push(`image: ${yamlEscape(image)}`);
  }
  lines.push(`imageAlt: ${yamlEscape(fm.imageAlt || "")}`);

  lines.push("keywords:");
  for (const kw of keywords) {
    lines.push(`  - ${yamlEscape(kw)}`);
  }

  lines.push(`draft: ${draft ? "true" : "false"}`);
  lines.push("internalLinks: []");
  lines.push("externalLinks: []");

  lines.push("faqs:");
  for (const faq of faqs) {
    lines.push(`  - question: ${yamlEscape(faq?.question || "")}`);
    lines.push(`    answer: ${yamlEscape(faq?.answer || "")}`);
  }

  lines.push("---", "");
  lines.push(String(body || "").replace(/^\uFEFF/, "").replace(/\s+$/, ""), "");

  return lines.join("\n");
}

export function articleFilename(frontmatter) {
  const slug = String(frontmatter?.slug || "article")
    .trim()
    .replace(/[^a-z0-9-]/g, "") || "article";
  return `${slug}.md`;
}

export function downloadMarkdownFile(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
