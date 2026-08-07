/**
 * Build a Cursor prompt to backfill keyword frontmatter on already-published
 * destination-site article files.
 *
 * @param {Array<object>} articles - generated_articles rows (snake_case)
 * @returns {string}
 */
export function buildBackfillFrontmatterPrompt(articles) {
  const rows = Array.isArray(articles) ? articles : [];
  const lines = [
    "Update the frontmatter of each of the following already-published articles in site/src/content/articles/{slug}.md, adding these fields if not already present: pillarKeyword, supportingKeyword, articleType, targetKeyword (omit supportingKeyword where not applicable, e.g. pillar articles). Do not change any other frontmatter field or any body content. After all edits, confirm npm run build stays clean.",
    "",
  ];

  for (const article of rows) {
    const slug = String(article?.slug || "").trim();
    if (!slug) continue;

    const pillarKeyword = String(article?.pillar_keyword || "").trim();
    const supportingKeyword = String(article?.supporting_keyword || "").trim();
    const articleType = String(article?.type || "").trim();
    const targetKeyword = String(article?.target_keyword || "").trim();

    const parts = [
      `pillarKeyword: ${pillarKeyword || "(empty)"}`,
      ...(supportingKeyword
        ? [`supportingKeyword: ${supportingKeyword}`]
        : []),
      `articleType: ${articleType || "(empty)"}`,
      `targetKeyword: ${targetKeyword || "(empty)"}`,
    ];

    lines.push(`${slug}: ${parts.join(", ")}`);
  }

  return lines.join("\n").trimEnd() + "\n";
}
