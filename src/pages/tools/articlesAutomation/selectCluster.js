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

function hasGeneratedArticles(supporting) {
  return (Array.isArray(supporting?.plannedArticles)
    ? supporting.plannedArticles
    : []
  ).some((article) => {
    const status =
      typeof article === "string" ? article : article?.status || "";
    return status === "drafted" || status === "published";
  });
}

/**
 * Tile state for Cluster Generation.
 * AVAILABLE = pillar published, no plan yet.
 * PLANNED = pillar published, has a plan, zero drafted/published articles.
 * COMPLETED = drafted or published articles.
 * BLOCKED = pillar article is not published (same gate as listEligibleClusters).
 */
export function classifySupportingCluster(pillar, supporting) {
  const clusterKeyword = String(supporting?.keyword || "").trim();
  if (!clusterKeyword) return null;

  const pillarPublished =
    pillarArticleStatus(pillar?.pillarArticle) === "published";
  const count = plannedCount(supporting);
  const plannedArticles = Array.isArray(supporting?.plannedArticles)
    ? supporting.plannedArticles
    : [];
  let status = "available";
  if (!pillarPublished) status = "blocked";
  else if (hasGeneratedArticles(supporting)) status = "completed";
  else if (count > 0) status = "planned";

  return {
    pillarKeyword: String(pillar.keyword || "").trim(),
    pillarSlug: pillar.slug,
    clusterKeyword,
    clusterSlug: supporting.slug,
    plannedCount: count,
    plannedArticles,
    status,
    pillarPublished,
    pillar,
    supporting,
  };
}

export function listRunnableClusters(pillars) {
  return buildClusterTree(pillars)
    .flatMap((pillar) => pillar.clusters)
    .filter(
      (cluster) => cluster.status === "available" || cluster.status === "planned"
    );
}

export function buildClusterTree(pillars) {
  return (Array.isArray(pillars) ? pillars : [])
    .map((pillar) => {
      const keyword = String(pillar?.keyword || "").trim();
      if (!keyword) return null;
      const clusters = (
        Array.isArray(pillar?.supporting) ? pillar.supporting : []
      )
        .map((supporting) => classifySupportingCluster(pillar, supporting))
        .filter(Boolean);
      return {
        keyword,
        slug: pillar.slug,
        pillarPublished: pillarArticleStatus(pillar?.pillarArticle) === "published",
        pillar,
        clusters,
      };
    })
    .filter(Boolean);
}
