function pillarArticleStatus(pillarArticle) {
  if (!pillarArticle) return "missing";
  if (typeof pillarArticle === "string") return pillarArticle;
  return pillarArticle.status || "missing";
}

function plannedCount(supporting) {
  return Array.isArray(supporting?.plannedArticles)
    ? supporting.plannedArticles.length
    : 0;
}

function compareClusters(a, b) {
  return (
    a.pillarKeyword.localeCompare(b.pillarKeyword) ||
    a.clusterKeyword.localeCompare(b.clusterKeyword)
  );
}

/**
 * Supporting clusters whose pillar article is published.
 * Automation prefers clusters with no plan yet so Confirm does not overwrite.
 */
export function listEligibleClusters(pillars) {
  const out = [];
  for (const pillar of Array.isArray(pillars) ? pillars : []) {
    if (pillarArticleStatus(pillar?.pillarArticle) !== "published") continue;
    for (const supporting of Array.isArray(pillar?.supporting)
      ? pillar.supporting
      : []) {
      const keyword = String(supporting?.keyword || "").trim();
      if (!keyword) continue;
      out.push({
        pillarKeyword: String(pillar.keyword || "").trim(),
        pillarSlug: pillar.slug,
        clusterKeyword: keyword,
        clusterSlug: supporting.slug,
        plannedCount: plannedCount(supporting),
        pillar,
        supporting,
      });
    }
  }
  return out.sort(compareClusters);
}

export function pickUnplannedCluster(pillars) {
  const eligible = listEligibleClusters(pillars).filter(
    (item) => item.plannedCount === 0
  );
  return eligible[0] || null;
}
