import { FIELD_SCHEMA, isFilled } from "./schema";

export function toDesignGuideMarkdown(fields) {
  const lines = ["# Design Guide", ""];

  for (const category of FIELD_SCHEMA) {
    lines.push(`## ${category.title}`, "");
    for (const field of category.fields) {
      const value = isFilled(fields[field.key])
        ? String(fields[field.key]).trim()
        : "_(not set)_";
      lines.push(`- **${field.label}:** ${value}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

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
