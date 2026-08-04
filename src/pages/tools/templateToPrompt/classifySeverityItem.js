/**
 * Classify a Highest-severity audit label for the Personalize Prompt UI.
 * - config: site.ts / env / identity config fields (not content files)
 * - missing: surface that does not exist yet
 * - content: published/demo/template content needing draft/delete/rewrite
 */
export function classifySeverityItem(label) {
  const text = String(label || "").trim();
  if (!text) return "content";

  const lower = text.toLowerCase();

  // Explicit tags from newer audits, if present
  if (/^\[config\]/i.test(text) || /\b\[config\]\b/i.test(text)) return "config";
  if (/^\[missing\]/i.test(text) || /\b\[missing\]\b/i.test(text)) return "missing";
  if (/^\[content\]/i.test(text) || /\b\[content\]\b/i.test(text)) return "content";

  // Missing surfaces (no file / page / route / collection entry)
  if (
    /\bmissing\b/.test(lower) ||
    /\bdoes\s+not\s+exist\b/.test(lower) ||
    /\bnot\s+(?:found|present|created)\b/.test(lower) ||
    /\bno\s+(?:file|page|surface|route|entry|collection)\b/.test(lower) ||
    /\babsent\b/.test(lower) ||
    /\bnever\s+(?:added|created)\b/.test(lower)
  ) {
    return "missing";
  }

  // Config fields: site.ts, env vars, identity constants — not content files
  if (
    /\bsite\.ts\b/i.test(text) ||
    /\b\.env(?:\.\w+)?\b/i.test(text) ||
    /\benv(?:ironment)?\s*var(?:iable)?s?\b/i.test(lower) ||
    /\bprocess\.env\b/i.test(text) ||
    /\bimport\.meta\.env\b/i.test(text) ||
    /\bSITE_[A-Z0-9_]+\b/.test(text) ||
    /\bSAME_AS\b/.test(text) ||
    /\bOG_(?:TITLE|DESCRIPTION|IMAGE|URL)\b/.test(text) ||
    (/\bconfig\b/i.test(lower) &&
      !/\b(content|article|service|team|page|mdx?)\b/i.test(lower))
  ) {
    return "config";
  }

  // Content-file cues (collections, markdown, published pages)
  if (
    /\.(mdx?|astro)\b/i.test(text) ||
    /\b(?:src\/)?content\//i.test(text) ||
    /\b(?:article|service|team|author|bio|page|homepage|footer|nav|404)\b/i.test(
      lower
    )
  ) {
    return "content";
  }

  // Default: treat as content decision (draft / delete / rewrite)
  return "content";
}

export function emptySeverityDecision(label) {
  const kind = classifySeverityItem(label);
  return {
    label,
    kind,
    action: "",
    rewriteSummary: "",
    setToValue: "",
    defer: false,
  };
}
