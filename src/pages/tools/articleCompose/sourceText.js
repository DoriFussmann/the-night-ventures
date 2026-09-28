const LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/g;
const HTML_IMAGE_RE = /<img\b[^>]*>/gi;

export function hostMatchesDomain(url, domain) {
  const base = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  if (!base) return false;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return host === base || host.endsWith(`.${base}`);
}

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
  const links = extractUserLinks(images.text, domain);
  return {
    source: links.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    userLinks: links.links,
    imagesRemoved: images.removed,
  };
}
