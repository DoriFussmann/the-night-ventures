import { slugify } from "../aiImage/slugify";
import { downloadMarkdown } from "../siteBuildFlow/buildFlowMarkdown";
import { CTA_PRIMARY } from "./briefs";

/**
 * A brief as a markdown file to work on outside the app: title, keyword, angle,
 * outline and the prompts it answers, with "Your key points" last to fill in.
 * `outlineText` is the outline as shown in the card ("## Heading" / "- point").
 */
export function briefToMarkdown({ brief, group, pillar, prompts = [], personasById, title, keyword, angle, outlineText, keyPoints }) {
  const cta = CTA_PRIMARY.find((c) => c.value === (brief.cta?.primary || "consultation"))?.label || "";
  const meta = [
    ["Group", [group?.code, group?.name].filter(Boolean).join(" · ")],
    ["Pillar", pillar?.name],
    ["Primary keyword", keyword],
    ["Article type", brief.article_type],
    ["Call to action", cta],
    ["Must link to", (brief.link_targets || []).map((l) => `/${l.slug}/`).join(", ")],
  ].filter(([, v]) => String(v || "").trim());

  // Outline headings sit one level down so they nest under the "Outline" section.
  const outline = String(outlineText || "")
    .split("\n")
    .map((line) => (/^#+\s/.test(line.trim()) ? `### ${line.trim().replace(/^#+\s*/, "")}` : line))
    .join("\n")
    .trim();

  const promptLines = prompts.map((p) => {
    const tag = [personasById?.get(p.persona_id)?.code, p.intent_tier].filter(Boolean).join(" · ");
    return `- ${tag ? `[${tag}] ` : ""}${p.prompt}`;
  });

  return [
    `# ${String(title || "").trim() || group?.name || "Untitled brief"}`,
    meta.map(([k, v]) => `- **${k}:** ${v}`).join("\n"),
    `## Angle\n\n${String(angle || "").trim() || "_None yet_"}`,
    `## Outline\n\n${outline || "_None yet_"}`,
    promptLines.length ? `## Prompts this article answers (${promptLines.length})\n\n${promptLines.join("\n")}` : "",
    `## Your key points\n\n${String(keyPoints || "").trim() || "<!-- Your expert input: what you'd tell a client. The writer leads with these. -->"}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

export function briefMarkdownFilename({ group, title }) {
  return `${[group?.code, slugify(title || group?.name)].filter(Boolean).join("-").toLowerCase()}-brief.md`;
}

export function downloadBriefMarkdown(args) {
  downloadMarkdown(briefMarkdownFilename(args), briefToMarkdown(args));
}
