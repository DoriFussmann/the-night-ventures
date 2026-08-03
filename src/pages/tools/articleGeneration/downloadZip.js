import JSZip from "jszip";
import { articleFilename } from "./serializeArticleMarkdown";

/**
 * Bundle successful articles into a zip of individual .md files.
 * @param {Array<{ frontmatter: object, markdown: string }>} articles
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
