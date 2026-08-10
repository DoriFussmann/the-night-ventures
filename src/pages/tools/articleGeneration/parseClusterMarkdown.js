const ARTICLE_TYPES = ["comprehensive", "howto", "comparison", "faq", "flex"];
const ARTICLE_STATUSES = ["planned", "drafted", "published"];

const HEADER_FIELD_RE = /^-\s*\*\*(.+?):\*\*\s*(.*)$/;
const ARTICLE_FIELD_RE = /^-\s*\*\*(targetKeyword|type|status|searchIntent|wordCount|ctaAngle|keyMessages|internalLinks):\*\*\s*(.*)$/i;
const NESTED_ITEM_RE = /^\s+-\s+(.*)$/;

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeType(value) {
  const type = asTrimmed(value).toLowerCase();
  return ARTICLE_TYPES.includes(type) ? type : "flex";
}

function normalizeStatus(value) {
  const status = asTrimmed(value).toLowerCase();
  return ARTICLE_STATUSES.includes(status) ? status : "planned";
}

function parseWordCount(value) {
  const n = Number(asTrimmed(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function isNonePlaceholder(value) {
  const text = asTrimmed(value).replace(/[_\s()]/g, "").toLowerCase();
  return text === "none" || text === "";
}

function parseNestedList(lines, startIndex) {
  const items = [];
  let i = startIndex;
  while (i < lines.length) {
    const line = lines[i];
    if (ARTICLE_FIELD_RE.test(line) || /^##\s+/.test(line) || HEADER_FIELD_RE.test(line)) {
      break;
    }
    const nested = line.match(NESTED_ITEM_RE);
    if (nested) {
      const item = asTrimmed(nested[1]);
      if (!isNonePlaceholder(item)) items.push(item);
      i += 1;
      continue;
    }
    if (asTrimmed(line) === "") {
      i += 1;
      continue;
    }
    break;
  }
  return { items, nextIndex: i };
}

function parseHeader(lines) {
  const meta = {
    company: "",
    pillar: "",
    supportingKeyword: undefined,
    rationale: "",
    generatedDate: "",
    articleCount: 0,
  };

  let i = 0;
  while (i < lines.length && !/^##\s+/.test(lines[i])) {
    const match = lines[i].match(HEADER_FIELD_RE);
    if (match) {
      const key = asTrimmed(match[1]).toLowerCase();
      const value = asTrimmed(match[2]);
      if (key === "company") meta.company = value;
      else if (key === "pillar") meta.pillar = value;
      else if (key === "supporting keyword") meta.supportingKeyword = value || undefined;
      else if (key === "cluster rationale" || key === "pillar rationale") meta.rationale = value;
      else if (key === "generated") meta.generatedDate = value;
      else if (key === "articles") {
        const n = Number(value);
        meta.articleCount = Number.isFinite(n) ? n : 0;
      }
    }
    i += 1;
  }

  return { meta, bodyStart: i };
}

function parseArticleBlock(lines, startIndex) {
  const titleMatch = lines[startIndex].match(/^##\s+(.+)$/);
  if (!titleMatch) {
    return { article: null, nextIndex: startIndex + 1 };
  }

  const article = {
    title: asTrimmed(titleMatch[1]),
    targetKeyword: "",
    type: "flex",
    status: "planned",
    searchIntent: "",
    wordCount: 0,
    ctaAngle: "",
    keyMessages: [],
    internalLinks: [],
  };

  let i = startIndex + 1;
  let sawField = false;

  while (i < lines.length && !/^##\s+/.test(lines[i])) {
    const match = lines[i].match(ARTICLE_FIELD_RE);
    if (!match) {
      i += 1;
      continue;
    }

    sawField = true;
    const field = match[1].toLowerCase();
    const inlineValue = asTrimmed(match[2]);

    if (field === "keymessages") {
      const { items, nextIndex } = parseNestedList(lines, i + 1);
      article.keyMessages = items;
      i = nextIndex;
      continue;
    }
    if (field === "internallinks") {
      const { items, nextIndex } = parseNestedList(lines, i + 1);
      article.internalLinks = items;
      i = nextIndex;
      continue;
    }
    if (field === "targetkeyword") article.targetKeyword = inlineValue;
    else if (field === "type") article.type = normalizeType(inlineValue);
    else if (field === "status") article.status = normalizeStatus(inlineValue);
    else if (field === "searchintent") article.searchIntent = inlineValue;
    else if (field === "wordcount") article.wordCount = parseWordCount(inlineValue);
    else if (field === "ctaangle") article.ctaAngle = inlineValue;

    i += 1;
  }

  if (!article.title || !sawField) {
    return { article: null, nextIndex: i };
  }

  return { article, nextIndex: i };
}

/**
 * Parse a Topic Generator cluster or pillar markdown export.
 * @param {string} markdown
 * @returns {{ meta: object, articles: object[] }}
 */
export function parseClusterMarkdown(markdown) {
  if (typeof markdown !== "string" || !asTrimmed(markdown)) {
    throw new Error("File is empty.");
  }

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const hasClusterTitle = lines.some((line) => /^#\s+Article Cluster\s*$/i.test(line));
  const hasRationale = lines.some((line) =>
    /^-\s*\*\*(Cluster rationale|Pillar rationale):\*\*/i.test(line)
  );
  const hasArticleHeading = lines.some((line) => /^##\s+\S/.test(line));

  if (!hasClusterTitle && !hasRationale) {
    throw new Error(
      "Unrecognized format. Expected an Article Cluster export with Cluster rationale or Pillar rationale."
    );
  }
  if (!hasArticleHeading) {
    throw new Error("Unrecognized format. No article sections (## title) found.");
  }

  const { meta, bodyStart } = parseHeader(lines);
  const articles = [];
  let i = bodyStart;

  while (i < lines.length) {
    if (!/^##\s+/.test(lines[i])) {
      i += 1;
      continue;
    }
    const { article, nextIndex } = parseArticleBlock(lines, i);
    if (article) articles.push(article);
    i = nextIndex;
  }

  if (articles.length === 0) {
    throw new Error("Could not parse any articles from this file.");
  }

  if (!meta.pillar && !meta.company) {
    throw new Error(
      "Unrecognized format. Missing required header fields (Company / Pillar)."
    );
  }

  meta.articleCount = meta.articleCount || articles.length;

  return { meta, articles };
}

/**
 * Cluster when the export header includes a Supporting keyword; otherwise Pillar Article.
 * @param {object} meta
 * @returns {"Cluster"|"Pillar Article"}
 */
export function resolveSourceType(meta) {
  if (String(meta?.supportingKeyword || "").trim()) {
    return "Cluster";
  }
  return "Pillar Article";
}

export function totalWordCount(articles) {
  return (Array.isArray(articles) ? articles : []).reduce(
    (sum, article) => sum + (Number(article.wordCount) || 0),
    0
  );
}
