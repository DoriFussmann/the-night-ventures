/**
 * Order selected articles: comprehensive first (preserving source order among
 * them), then remaining selected articles in source-file order.
 */
export function orderSelectedArticles(articles, selectedIndices) {
  const list = Array.isArray(articles) ? articles : [];
  const indices = [...(selectedIndices || [])]
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < list.length)
    .sort((a, b) => a - b);

  const comprehensive = [];
  const rest = [];

  for (const index of indices) {
    const article = list[index];
    const entry = { index, article };
    if (article?.type === "comprehensive") {
      comprehensive.push(entry);
    } else {
      rest.push(entry);
    }
  }

  return [...comprehensive, ...rest];
}
