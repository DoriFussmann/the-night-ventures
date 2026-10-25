/**
 * Length rules for ChatGPT's site-content document, checked before Cursor
 * builds. Service descriptions are enforced by seo-core's serviceSchema (the
 * build fails on them); the page rules match the Narrative Composer prompt.
 * Lengths are JavaScript string lengths, the same count seo-core uses.
 */

const LEGAL_PAGES = new Set(["privacy", "terms"]);

export const LENGTH_RULES = {
  pageMetaTitle: { min: 50, max: 60 },
  legalMetaTitle: { min: null, max: 60 },
  pageMetaDescription: { min: 140, max: 160 },
  serviceDescription: { min: 140, max: 160 },
};

const BLOCK_RE = /^===\s*(PAGE|SERVICE):\s*([^=\s][^=]*?)\s*===\s*$/gm;

function unquote(raw) {
  const value = String(raw || "").trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** First top-level `key: value` in a block (no indentation, so nested fields are ignored). */
function topLevelField(block, key) {
  const match = block.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return match ? unquote(match[1]) : null;
}

function describeRule({ min, max }) {
  return min == null ? `max ${max}` : `${min}–${max}`;
}

function evaluate(where, field, value, rule) {
  const length = value.length;
  const tooShort = rule.min != null && length < rule.min;
  const tooLong = length > rule.max;
  return {
    where,
    field,
    value,
    length,
    rule: describeRule(rule),
    ok: !tooShort && !tooLong,
    problem: tooShort ? "too short" : tooLong ? "too long" : null,
  };
}

/**
 * @param {string} text ChatGPT's full response
 * @returns {{ blocks: number, results: Array<{ where: string, field: string, value: string, length: number, rule: string, ok: boolean, problem: string | null }>, missing: Array<{ where: string, field: string }> }}
 */
export function checkContentLengths(text) {
  const source = String(text || "").replace(/\r\n/g, "\n");
  const heads = [...source.matchAll(BLOCK_RE)];
  const results = [];
  const missing = [];

  heads.forEach((head, index) => {
    const kind = head[1];
    const id = head[2].trim();
    const start = head.index + head[0].length;
    const end = index + 1 < heads.length ? heads[index + 1].index : source.length;
    const qaAt = source.slice(start, end).search(/^===\s*QA\s*===/m);
    const block = source.slice(start, qaAt >= 0 ? start + qaAt : end);

    if (kind === "PAGE") {
      const where = `Page: ${id}`;
      const title = topLevelField(block, "meta_title");
      const description = topLevelField(block, "meta_description");
      const titleRule = LEGAL_PAGES.has(id) ? LENGTH_RULES.legalMetaTitle : LENGTH_RULES.pageMetaTitle;
      if (title == null) missing.push({ where, field: "meta_title" });
      else results.push(evaluate(where, "meta_title", title, titleRule));
      if (description == null) missing.push({ where, field: "meta_description" });
      else results.push(evaluate(where, "meta_description", description, LENGTH_RULES.pageMetaDescription));
    } else {
      const where = `Service: ${id}`;
      const description = topLevelField(block, "description");
      if (description == null) missing.push({ where, field: "description" });
      else results.push(evaluate(where, "description", description, LENGTH_RULES.serviceDescription));
    }
  });

  return { blocks: heads.length, results, missing };
}
