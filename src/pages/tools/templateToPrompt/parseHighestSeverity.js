/**
 * Extract numbered/bulleted items from the audit report's "Highest severity" section.
 * Tolerates common heading variants produced by agents.
 */
export function parseHighestSeverityItems(auditReport) {
  const text = String(auditReport || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const headingRe =
    /^#{1,6}\s*Highest[-\s]?(?:severity(?:ity)?|priority)(?:\s+leftovers?)?\s*$/im;
  const match = headingRe.exec(text);
  if (!match) {
    // Fallback: plain-text "Highest severity" / "Highest-priority leftovers" line
    const plainRe =
      /^(?:Highest[-\s]?sever(?:ity|e)|Highest[-\s]?priority(?:\s+leftovers?)?)\s*$/im;
    const plain = plainRe.exec(text);
    if (!plain) return [];
    return extractListItems(text.slice(plain.index + plain[0].length));
  }

  return extractListItems(text.slice(match.index + match[0].length));
}

function extractListItems(sectionTail) {
  const lines = sectionTail.split("\n");
  const items = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (items.length > 0) break;
      continue;
    }
    // Stop at next markdown heading
    if (/^#{1,6}\s+\S/.test(line)) break;

    const listMatch = line.match(/^(?:\d+[.)]\s+|[-*•]\s+)(.+)$/);
    if (listMatch) {
      const label = listMatch[1].trim();
      if (label) items.push(label);
      continue;
    }

    // Allow a short run of non-list continuation only before first item
    if (items.length > 0) break;
  }

  return items;
}
