const ARROW_SPLIT = /\s*(?:→|->)\s*/;

function stripListMarker(line) {
  return String(line || "")
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .trim();
}

/** Skip the format legend: "page → section → slide/image → brief". */
function isFormatLegend(page, section) {
  return /^page$/i.test(page) && /^section$/i.test(section);
}

function briefFromArrowLine(line) {
  const cleaned = stripListMarker(line);
  if (!cleaned || !/(?:→|->)/.test(cleaned)) return null;
  if (/image brief/i.test(cleaned)) return null;

  const parts = cleaned
    .split(ARROW_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 4) return null;

  const page = parts[0];
  const section = parts[1];
  const slot = parts[2];
  const brief = parts.slice(3).join(" → ").trim();
  if (!brief || isFormatLegend(page, section)) return null;

  return {
    label: `${page} / ${section} / ${slot}`,
    description: brief,
  };
}

function briefFromTableRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  if (cells.length < 4) return null;
  if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;

  const [page, section, slot, ...rest] = cells;
  if (!page || /^page$/i.test(page)) return null;
  const brief = rest.join(" | ").trim();
  if (!brief || /^brief$/i.test(brief)) return null;

  return {
    label: `${page} / ${section} / ${slot}`,
    description: brief,
  };
}

/**
 * Parse the QA section's image-brief list.
 * Expected lines: page → section → slide/image → brief
 * A markdown table with those four columns is accepted after an image-brief heading.
 */
export function parsePlaceholders(text) {
  const lines = String(text || "").split(/\r?\n/);
  let start = 0;
  const qaAt = lines.findIndex((line) => /===\s*QA\s*===/i.test(line));
  if (qaAt >= 0) start = qaAt;

  let headerAt = -1;
  for (let i = start; i < lines.length; i += 1) {
    if (/image brief/i.test(lines[i])) {
      headerAt = i;
      break;
    }
  }

  const from = headerAt >= 0 ? headerAt + 1 : start;
  const items = [];

  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^===\s+\S+/.test(line)) break;

    const parsed =
      briefFromArrowLine(line) ||
      (headerAt >= 0 ? briefFromTableRow(line) : null);
    if (parsed) {
      items.push(parsed);
      continue;
    }

    const continuesBrief =
      headerAt >= 0 &&
      items.length > 0 &&
      !/(?:→|->|\|)/.test(line) &&
      !/^#{1,6}\s/.test(line) &&
      !/^\d+\.\s/.test(line);
    if (continuesBrief) {
      items[items.length - 1].description += ` ${stripListMarker(line)}`;
    }
  }

  return items;
}
