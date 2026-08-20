/** Shared empty-row helpers for Company Data / Specific Prompt shapes. */

export function emptyServiceEntry() {
  return {
    title: "",
    summary: "",
    detail: "",
    isbn: "",
    publisher: "",
    author: "",
    publicationDate: "",
  };
}

export function emptyTeamEntry() {
  return { name: "", role: "", bio: "", credentials: "", same_as: [] };
}

export function emptySocialLinkEntry() {
  return { label: "", url: "" };
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

function asText(value) {
  return value == null ? "" : String(value);
}

export function normalizeServices(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return emptyServiceEntry();
    return {
      title: asText(item.title),
      summary: asText(item.summary),
      detail: asText(item.detail),
      isbn: asText(item.isbn),
      publisher: asText(item.publisher),
      author: asText(item.author),
      publicationDate: asText(item.publicationDate || item.publication_date),
    };
  });
}

export function serviceHasContent(service) {
  const s = service && typeof service === "object" ? service : {};
  return Boolean(
    String(s.title || "").trim() ||
      String(s.summary || "").trim() ||
      String(s.detail || "").trim() ||
      String(s.isbn || "").trim() ||
      String(s.publisher || "").trim() ||
      String(s.author || "").trim() ||
      String(s.publicationDate || "").trim()
  );
}

export function formatServiceCopyBlock(service) {
  const s = normalizeServices([service])[0] || emptyServiceEntry();
  const lines = [`Title: ${s.title.trim() || "(untitled)"}`];
  if (s.summary.trim()) lines.push(`Summary: ${s.summary.trim()}`);
  if (s.detail.trim()) lines.push(`Detail: ${s.detail.trim()}`);
  if (s.isbn.trim()) lines.push(`ISBN: ${s.isbn.trim()}`);
  if (s.publisher.trim()) lines.push(`Publisher: ${s.publisher.trim()}`);
  if (s.author.trim()) lines.push(`Author: ${s.author.trim()}`);
  if (s.publicationDate.trim()) {
    lines.push(`Publication date: ${s.publicationDate.trim()}`);
  }
  return lines.join("\n");
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

export function normalizeSocialLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return emptySocialLinkEntry();
    return {
      label: item.label == null ? "" : String(item.label),
      url: item.url == null ? "" : String(item.url),
    };
  });
}

export function formatSocialLinksForConfig(value) {
  return normalizeSocialLinks(value)
    .map((item) => ({
      label: item.label.trim(),
      url: item.url.trim(),
    }))
    .filter((item) => item.label || item.url)
    .map((item) =>
      item.label && item.url
        ? `${item.label}: ${item.url}`
        : item.url || item.label
    )
    .join("\n");
}

export function trimSocialLinksForSave(socialLinks) {
  return normalizeSocialLinks(socialLinks)
    .map((item) => ({
      label: item.label.trim(),
      url: item.url.trim(),
    }))
    .filter((item) => item.label || item.url);
}

export function trimServicesForSave(services) {
  return normalizeServices(services)
    .map((s) => ({
      title: s.title.trim(),
      summary: s.summary.trim(),
      detail: s.detail.trim(),
      isbn: s.isbn.trim(),
      publisher: s.publisher.trim(),
      author: s.author.trim(),
      publicationDate: s.publicationDate.trim(),
    }))
    .filter(serviceHasContent)
    .map((s) => {
      const row = { title: s.title, summary: s.summary };
      if (s.detail) row.detail = s.detail;
      if (s.isbn) row.isbn = s.isbn;
      if (s.publisher) row.publisher = s.publisher;
      if (s.author) row.author = s.author;
      if (s.publicationDate) row.publicationDate = s.publicationDate;
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
