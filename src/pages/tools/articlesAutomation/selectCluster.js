function pillarArticleStatus(pillarArticle) {
  if (!pillarArticle) return "missing";
  if (typeof pillarArticle === "string") return pillarArticle;
  return pillarArticle.status || "missing";
}

export const MIN_KEY_MESSAGES = 3;

/** Pillar counts as published when its article is published or its spec is Live. */
export function isPillarPublished(pillar) {
  return (
    pillarArticleStatus(pillar?.pillarArticle) === "published" ||
    pillar?.spec?.status === "live"
  );
}

function specStatus(entry) {
  return String(entry?.spec?.status || "");
}

export function specIsComplete(entry) {
  const messages = Array.isArray(entry?.spec?.keyMessages) ? entry.spec.keyMessages : [];
  return messages.filter((m) => String(m || "").trim()).length >= MIN_KEY_MESSAGES;
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
    if (!isPillarPublished(pillar)) continue;
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

  const pillarPublished = isPillarPublished(pillar);
  const count = plannedCount(supporting);
  const plannedArticles = Array.isArray(supporting?.plannedArticles)
    ? supporting.plannedArticles
    : [];
  const spec = specStatus(supporting);
  let status = "available";
  if (hasGeneratedArticles(supporting) || spec === "drafted" || spec === "live") {
    status = "completed";
  } else if (!pillarPublished) status = "blocked";
  // Keywords managed in the keyword map carry a spec; legacy entries don't.
  else if (supporting?.spec && !specIsComplete(supporting)) status = "needs_spec";
  else if (count > 0 || spec === "planned") status = "planned";

  return {
    pillarKeyword: String(pillar.keyword || "").trim(),
    pillarSlug: pillar.slug,
    clusterKeyword,
    clusterSlug: supporting.slug,
    plannedCount: count,
    plannedArticles,
    status,
    specStatus: spec || "approved",
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

/**
 * One cluster per pillar — the "ensure each pillar has at least one cluster"
 * batch. For each PUBLISHED pillar that has no cluster article yet (no
 * "completed" cluster), take its first "available" supporting cluster (no plan
 * yet, so Confirm won't overwrite), falling back to a "planned" one. Pillars
 * that already have a cluster article are skipped, so it stops once every
 * pillar has one and is safely re-runnable. Returns the SAME full cluster
 * objects as listRunnableClusters, so it drops straight into the batch loop.
 */
export function pickCoverageClusters(pillars) {
  const out = [];
  for (const node of buildClusterTree(pillars)) {
    if (!node.pillarPublished) continue;
    const clusters = Array.isArray(node.clusters) ? node.clusters : [];
    const alreadyCovered = clusters.some((c) => c.status === "completed");
    if (alreadyCovered) continue;
    const pick =
      clusters.find((c) => c.status === "available") ||
      clusters.find((c) => c.status === "planned");
    if (pick) out.push(pick);
  }
  return out;
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
        pillarPublished: isPillarPublished(pillar),
        pillar,
        clusters,
      };
    })
    .filter(Boolean);
}
