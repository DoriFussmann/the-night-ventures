import JSZip from "jszip";
import { articleFilename } from "./serializeArticleMarkdown";

function b64ToUint8Array(b64) {
  const binary = atob(String(b64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Bundle successful articles into a zip of .md files (and matching .png heroes).
 * @param {Array<{ frontmatter: object, markdown: string, image?: { b64_json?: string } | null }>} articles
 * @param {string} [zipName]
 */
export async function downloadArticlesZip(articles, zipName = "articles.zip") {
  const zip = new JSZip();
  const used = new Set();
  const list = Array.isArray(articles) ? articles : [];

  for (const item of list) {
    let name = articleFilename(item.frontmatter);
    if (used.has(name)) {
      const base = name.replace(/\.md$/i, "");
      let n = 2;
      while (used.has(`${base}-${n}.md`)) n += 1;
      name = `${base}-${n}.md`;
    }
    used.add(name);
    zip.file(name, item.markdown || "");

    const b64 = item?.image?.b64_json;
    if (b64) {
      const pngName = name.replace(/\.md$/i, ".png");
      zip.file(pngName, b64ToUint8Array(b64));
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
