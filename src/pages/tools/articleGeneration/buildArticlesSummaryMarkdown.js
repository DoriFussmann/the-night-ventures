import { findCoverageArticle } from "./updateCoverageDrafted";

function companySlug(name) {
  return (
    String(name || "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company"
  );
}

function formatGeneratedDate(date = new Date()) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatFilenameDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function display(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function asTags(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function publishedUrlFor(article, pillars) {
  const match = findCoverageArticle(pillars, article);
  if (!match) return "no coverage match";
  const url = String(match.publishedUrl || "").trim();
  return url || "no coverage match";
}

function articleBlock(article, pillars) {
  const tags = asTags(article.tags);
  const lines = [
    `#### ${display(article.title)}`,
    "",
    `- **targetKeyword:** ${display(article.target_keyword)}`,
    `- **pillarKeyword:** ${display(article.pillar_keyword)}`,
    `- **supportingKeyword:** ${display(article.supporting_keyword)}`,
    `- **type:** ${display(article.type)}`,
    `- **slug:** ${display(article.slug)}`,
    `- **status:** ${display(article.status)}`,
    `- **date:** ${display(article.date)}`,
    `- **updatedDate:** ${display(article.updated_date)}`,
    `- **description:** ${display(article.description)}`,
  ];

  lines.push("- **tags:**");
  if (tags.length) {
    for (const tag of tags) lines.push(`  - ${tag}`);
  } else {
    lines.push("  - _(none)_");
  }

  lines.push(`- **publishedUrl:** ${publishedUrlFor(article, pillars)}`);
  lines.push(`- **createdAt:** ${display(article.created_at)}`);
  lines.push(`- **savedAt:** ${display(article.updated_at)}`);
  lines.push("");
  return lines;
}

function sortKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Group library articles by pillar → supporting (same hierarchy as Topic Generator).
 * Pillar articles (no supporting keyword) appear under a dedicated "Pillar article" section.
 */
function groupArticles(articles) {
  const list = Array.isArray(articles) ? articles : [];
  const pillarMap = new Map();

  for (const article of list) {
    const pillar = String(article.pillar_keyword || "").trim() || "(no pillar)";
    const supporting = String(article.supporting_keyword || "").trim();
    const supportingKey = supporting || "__pillar__";

    if (!pillarMap.has(pillar)) pillarMap.set(pillar, new Map());
    const supportingMap = pillarMap.get(pillar);
    if (!supportingMap.has(supportingKey)) supportingMap.set(supportingKey, []);
    supportingMap.get(supportingKey).push(article);
  }

  const pillars = Array.from(pillarMap.keys()).sort((a, b) =>
    sortKey(a).localeCompare(sortKey(b))
  );

  return pillars.map((pillar) => {
    const supportingMap = pillarMap.get(pillar);
    const keys = Array.from(supportingMap.keys()).sort((a, b) => {
      if (a === "__pillar__") return -1;
      if (b === "__pillar__") return 1;
      return sortKey(a).localeCompare(sortKey(b));
    });

    return {
      pillar,
      groups: keys.map((key) => ({
        supportingKey: key,
        supportingLabel: key === "__pillar__" ? null : key,
        articles: supportingMap.get(key).slice().sort((a, b) =>
          sortKey(a.title).localeCompare(sortKey(b.title))
        ),
      })),
    };
  });
}

/**
 * Build an audit-ready markdown inventory of generated_articles rows.
 *
 * @param {object} opts
 * @param {string} [opts.companyName]
 * @param {Array<object>} opts.articles - generated_articles rows (snake_case)
 * @param {Array<object>} [opts.pillars] - content_coverage.pillars
 * @param {Date} [opts.generatedAt]
 */
export function buildArticlesSummaryMarkdown({
  companyName,
  articles,
  pillars = [],
  generatedAt = new Date(),
}) {
  const list = Array.isArray(articles) ? articles : [];
  const lines = [
    `# Articles Summary`,
    "",
    `- **Company:** ${companyName || "(unnamed)"}`,
    `- **Generated:** ${formatGeneratedDate(generatedAt)}`,
    `- **Articles:** ${list.length}`,
    "",
  ];

  if (list.length === 0) {
    lines.push("_No articles in the library._", "");
    return lines.join("\n").trim() + "\n";
  }

  for (const { pillar, groups } of groupArticles(list)) {
    lines.push(`## Pillar: ${pillar}`, "");

    for (const { supportingLabel, articles: sectionArticles } of groups) {
      if (supportingLabel) {
        lines.push(`### Supporting: ${supportingLabel}`, "");
      } else {
        lines.push(`### Pillar article`, "");
      }

      for (const article of sectionArticles) {
        lines.push(...articleBlock(article, pillars));
      }
    }
  }

  return lines.join("\n").trim() + "\n";
}

export function articlesSummaryFilename(companyName, date = new Date()) {
  return `${companySlug(companyName)}-articles-summary-${formatFilenameDate(date)}.md`;
}
