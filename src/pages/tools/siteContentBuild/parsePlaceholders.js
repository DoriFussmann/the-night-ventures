const LABEL_DESCRIPTION_RE = /^([^:]+):\s*(.+)$/;

/**
 * Parse Cursor's placeholder report: one "Label: description" per line.
 * Lines without a colon use the whole line as both label and description.
 */
export function parsePlaceholders(text) {
  const lines = String(text || "").split(/\r?\n/);
  const items = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(LABEL_DESCRIPTION_RE);
    if (match) {
      items.push({
        label: match[1].trim(),
        description: match[2].trim(),
      });
    } else {
      items.push({ label: line, description: line });
    }
  }

  return items;
}
