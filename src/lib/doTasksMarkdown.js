/** Markdown export of the Workspace Tasks "Do" column. */

/**
 * @param {Array<{ name: string, details: string }>} tasks  already in board order
 * @param {Date} [now]
 * @returns {{ filename: string, content: string }}
 */
export function buildDoTasksMarkdown(tasks, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const count = tasks.length;
  const sections = tasks.map(({ name, details }) => {
    const body = String(details || "").trim();
    return body ? `## ${name}\n\n${body}` : `## ${name}`;
  });
  const content = [
    "# Do tasks",
    `Exported ${date} · ${count} task${count === 1 ? "" : "s"}`,
    ...sections,
  ].join("\n\n");
  return { filename: `tnv-do-tasks-${date}.md`, content: `${content}\n` };
}
