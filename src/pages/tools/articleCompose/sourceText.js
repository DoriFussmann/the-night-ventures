import {
  hostMatchesDomain,
  isolateImageLines,
} from "../../../../lib/writer-intake/markdown.js";

export { hostMatchesDomain };

const LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
// Writer-image placeholders (from a .docx) are kept; any other image is removed.
const MD_IMAGE_RE = /!\[[^\]]*\]\((?!writer-image:\d+\))[^)]*\)|!\[[^\]]*\]\[[^\]]*\]/g;
const HTML_IMAGE_RE = /<img\b[^>]*>/gi;
const WRITER_IMAGE_RE = /!\[[^\]]*\]\(writer-image:\d+\)/g;

export function stripImages(markdown) {
  let removed = 0;
  const text = String(markdown || "")
    .replace(MD_IMAGE_RE, () => {
      removed += 1;
      return "";
    })
    .replace(HTML_IMAGE_RE, () => {
      removed += 1;
      return "";
    });
  return { text, removed };
}

export function extractUserLinks(markdown, domain) {
  const links = [];
  const seen = new Set();
  const text = String(markdown || "").replace(LINK_RE, (match, anchor, url) => {
    const href = String(url || "").trim();
    if (!href || hostMatchesDomain(href, domain)) return match;
    if (!seen.has(href)) {
      seen.add(href);
      links.push({
        url: href,
        anchor: String(anchor || "").trim(),
        checked: true,
      });
    }
    return String(anchor || "").trim() || href;
  });
  return { text, links };
}

export function prepareSource(markdown, domain) {
  const images = stripImages(markdown);
  // Empty links Word leaves behind ("[](https://…)") carry nothing.
  const withoutEmptyLinks = images.text.replace(/(^|[^!])\[\s*\]\((https?:\/\/[^)\s]+)\)/g, "$1");
  const links = extractUserLinks(withoutEmptyLinks, domain);
  const source = isolateImageLines(
    links.text
      // Word headings arrive as "### **Title**"; empty ones as "###".
      .replace(/^(#{1,6})[ \t]+\*\*(.+?)\*\*[ \t]*$/gm, "$1 $2")
      .replace(/^#{1,6}[ \t]*$/gm, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  ).trim();
  return {
    source,
    userLinks: links.links,
    imagesRemoved: images.removed,
    writerImageCount: (source.match(WRITER_IMAGE_RE) || []).length,
  };
}
