/** Serialize Site Build Flow stages and items into a downloadable markdown document. */

export const SITE_BUILD_FLOW_MARKDOWN_FILENAME = "site-build-flow.md";

export function downloadMarkdown(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fence(text) {
  const longest = (text.match(/`+/g) || []).reduce(
    (max, run) => Math.max(max, run.length),
    0
  );
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}\n${text}\n${ticks}`;
}

export function buildSiteBuildFlowMarkdown(stagesMeta, items) {
  const lines = ["# Site Build Flow", ""];

  stagesMeta.forEach((stage, index) => {
    lines.push(`${index + 1}. ${stage.name}`);
  });
  lines.push("");

  for (const stage of stagesMeta) {
    lines.push(`## ${stage.name}`, "");

    const stageItems = (items || [])
      .filter((item) => item.stage_key === stage.stage_key)
      .sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          String(a.item_key).localeCompare(String(b.item_key))
      );

    if (stageItems.length === 0) {
      lines.push("_No items in this stage._", "");
      continue;
    }

    for (const item of stageItems) {
      lines.push(`### ${item.title}`, "");

      const description = (item.description || "").trim();
      if (description) {
        lines.push(description, "");
      }

      const prompts = Array.isArray(item.prompts) ? item.prompts : [];
      for (const prompt of prompts) {
        const label = (prompt?.label || "").trim();
        const text = (prompt?.text || "").trim();
        if (label) {
          lines.push(`**${label}**`, "");
        }
        if (text) {
          lines.push(fence(text), "");
        }
      }

      const note = (item.note || "").trim();
      if (note) {
        lines.push("**Notes**", "", note, "");
      }
    }
  }

  return `${lines.join("\n").trim()}\n`;
}
