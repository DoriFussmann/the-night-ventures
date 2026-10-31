// Turns email HTML into safe HTML for display: keeps formatting
// (bold, italic, underline, lists, links, line breaks, headings, simple
// tables), drops scripts/styles/event handlers, and highlights {{variables}}.

const ALLOWED = new Set([
  "P", "DIV", "SPAN", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
  "UL", "OL", "LI", "A", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "HR",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SUB", "SUP", "CODE", "PRE",
]);
const DROP_WITH_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "HEAD", "TITLE", "META", "LINK"]);
// Inline styles email editors use for bold/italic/underline.
const STYLE_KEEP = /^(font-weight|font-style|text-decoration|text-align)$/i;
const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function cleanNode(node, doc, opts) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) {
      child.remove(); // comment
      continue;
    }
    if (child.nodeType === 3) {
      highlightVars(child, doc, opts);
      continue;
    }
    if (child.nodeType !== 1) {
      child.remove();
      continue;
    }
    const tag = child.tagName;
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove();
      continue;
    }
    cleanNode(child, doc, opts);
    if (!ALLOWED.has(tag)) {
      child.replaceWith(...child.childNodes); // unwrap, keep text
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      if (tag === "A" && name === "href") {
        if (!/^(https?:|mailto:)/i.test(attr.value.trim())) child.removeAttribute("href");
      } else if (name === "style") {
        const kept = attr.value
          .split(";")
          .map((d) => d.trim())
          .filter((d) => STYLE_KEEP.test(d.split(":")[0]?.trim() || ""))
          .join("; ");
        if (kept) child.setAttribute("style", kept);
        else child.removeAttribute("style");
      } else if (!(tag === "TD" || tag === "TH") || !["colspan", "rowspan"].includes(name)) {
        child.removeAttribute(attr.name);
      }
    }
    if (tag === "A") {
      child.setAttribute("target", "_blank");
      child.setAttribute("rel", "noopener noreferrer");
    }
  }
}

// Without opts.resolve: wrap {{vars}} for highlighting. With it: substitute
// the lead's value, or mark the variable as missing.
function highlightVars(textNode, doc, opts) {
  const text = textNode.nodeValue;
  if (!VAR_RE.test(text)) return;
  VAR_RE.lastIndex = 0;
  const frag = doc.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(VAR_RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const value = opts?.resolve ? opts.resolve(m[1]) : null;
    if (value) {
      frag.append(value);
    } else {
      const mark = doc.createElement("span");
      mark.setAttribute(opts?.resolve ? "data-missing" : "data-var", "");
      mark.textContent = opts?.resolve ? `[${m[1]}]` : m[0];
      frag.append(mark);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  textNode.replaceWith(frag);
}

// opts.resolve(name) → value merges a lead into the copy (preview / test).
// opts.forEmail → inline styles instead of classes (email clients).
export function toSafeHtml(html, opts = {}) {
  const raw = String(html || "");
  if (!raw.trim()) return "";
  // Plain text (no tags): keep line breaks.
  const source = /<[a-z][\s\S]*>/i.test(raw)
    ? raw
    : raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  const doc = new DOMParser().parseFromString(`<div>${source}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  cleanNode(root, doc, opts);
  // Markers are added after attribute cleaning, so apply classes/styles here.
  for (const el of root.querySelectorAll("[data-var]")) {
    el.removeAttribute("data-var");
    el.setAttribute("class", "tnv-var");
  }
  for (const el of root.querySelectorAll("[data-missing]")) {
    el.removeAttribute("data-missing");
    if (opts.forEmail) el.setAttribute("style", "background:#fee2e2;color:#991b1b;padding:0 2px");
    else el.setAttribute("class", "tnv-missing");
  }
  return root.innerHTML;
}
