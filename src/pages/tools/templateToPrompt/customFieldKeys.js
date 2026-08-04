/** Keys stored under company_profiles.custom_fields for Specific Prompt reuse. */
export const SERVICES_CUSTOM_FIELD = "Services";
export const TEAM_BIOS_CUSTOM_FIELD = "Team bios";

export function emptyServiceEntry() {
  return { title: "", summary: "" };
}

export function emptyTeamEntry() {
  return { name: "", bio: "" };
}

export function emptyNewContentEntry() {
  return {
    title: "",
    description: "",
    author: "",
    category: "",
    tags: "",
    body: "",
    heroImage: "",
  };
}

export function parseJsonArrayField(raw, mapItem) {
  if (raw == null || raw === "") return [];

  if (Array.isArray(raw)) {
    return raw.map(mapItem).filter(Boolean);
  }

  if (typeof raw === "object") {
    return [mapItem(raw)].filter(Boolean);
  }

  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(mapItem).filter(Boolean);
    if (parsed && typeof parsed === "object") {
      return [mapItem(parsed)].filter(Boolean);
    }
  } catch {
    // fall through
  }

  return [];
}

export function serializeServices(services) {
  return JSON.stringify(
    (services || [])
      .map((s) => ({
        title: String(s.title || "").trim(),
        summary: String(s.summary || "").trim(),
      }))
      .filter((s) => s.title || s.summary)
  );
}

export function serializeTeamBios(teamBios) {
  return JSON.stringify(
    (teamBios || [])
      .map((t) => ({
        name: String(t.name || "").trim(),
        bio: String(t.bio || "").trim(),
      }))
      .filter((t) => t.name || t.bio)
  );
}

export function parseServicesField(raw) {
  return parseJsonArrayField(raw, (item) => {
    if (!item || typeof item !== "object") return null;
    return {
      title: String(item.title || ""),
      summary: String(item.summary || ""),
    };
  });
}

export function parseTeamBiosField(raw) {
  return parseJsonArrayField(raw, (item) => {
    if (!item || typeof item !== "object") return null;
    return {
      name: String(item.name || ""),
      bio: String(item.bio || ""),
    };
  });
}
