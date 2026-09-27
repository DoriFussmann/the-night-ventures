const STORAGE_PREFIX = "cluster-image-spec:";

function simpleHash(value) {
  const str = String(value || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

/** Hash of the imagery brief used as the style-spec cache key. */
export function abstractCacheKey(imagery) {
  return simpleHash(String(imagery || "").trim());
}

export function readCachedStyleSpec(companyId, abstract) {
  if (!companyId) return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${companyId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.abstractKey !== abstractCacheKey(abstract)) return null;
    if (!parsed.spec || typeof parsed.spec !== "object") return null;
    return parsed.spec;
  } catch {
    return null;
  }
}

export function writeCachedStyleSpec(companyId, abstract, spec) {
  if (!companyId || !spec) return;
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${companyId}`,
      JSON.stringify({
        abstractKey: abstractCacheKey(abstract),
        spec,
        savedAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.error("Failed to cache cluster image style spec:", err);
  }
}
