/** Shared empty-row helpers for Company Data / Specific Prompt shapes. */

export function emptyServiceEntry() {
  return { title: "", summary: "", detail: "" };
}

export function emptyTeamEntry() {
  return { name: "", role: "", bio: "", credentials: "", same_as: [] };
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

export function normalizeServices(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return emptyServiceEntry();
    return {
      title: item.title == null ? "" : String(item.title),
      summary: item.summary == null ? "" : String(item.summary),
      detail: item.detail == null ? "" : String(item.detail),
    };
  });
}

export function normalizeTeamMembers(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return emptyTeamEntry();
    const sameAsSource = Array.isArray(item.same_as) ? item.same_as : [];
    return {
      name: item.name == null ? "" : String(item.name),
      role: item.role == null ? "" : String(item.role),
      bio: item.bio == null ? "" : String(item.bio),
      credentials: item.credentials == null ? "" : String(item.credentials),
      same_as: sameAsSource.map((url) =>
        url == null ? "" : String(url)
      ),
    };
  });
}

export function trimServicesForSave(services) {
  return normalizeServices(services)
    .map((s) => ({
      title: s.title.trim(),
      summary: s.summary.trim(),
      detail: s.detail.trim(),
    }))
    .filter((s) => s.title || s.summary || s.detail)
    .map((s) => {
      const row = { title: s.title, summary: s.summary };
      if (s.detail) row.detail = s.detail;
      return row;
    });
}

export function trimTeamMembersForSave(teamMembers) {
  return normalizeTeamMembers(teamMembers)
    .map((t) => ({
      name: t.name.trim(),
      role: t.role.trim(),
      bio: t.bio.trim(),
      credentials: t.credentials.trim(),
      same_as: (t.same_as || []).map((u) => u.trim()).filter(Boolean),
    }))
    .filter(
      (t) => t.name || t.role || t.bio || t.credentials || t.same_as.length > 0
    )
    .map((t) => {
      const row = { name: t.name, role: t.role, bio: t.bio };
      if (t.credentials) row.credentials = t.credentials;
      row.same_as = t.same_as;
      return row;
    });
}
