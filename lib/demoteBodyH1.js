/**
 * Demote a Markdown H1 to H2. Leaves ## and deeper headings alone.
 * Fenced code blocks (``` ... ```) are skipped, including HTML tags inside them.
 */
export function demoteBodyH1(body) {
  const text = String(body || '')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  let inFence = false
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.trim().startsWith('```')) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      return line.replace(/^#\s+/, '## ').replace(/<(\/?)h1\b/gi, '<$1h2')
    })
    .join(newline)
}

/** Demote H1s in the markdown body, leaving a leading frontmatter block unchanged. */
export function demoteArticleMarkdownH1(markdown) {
  const text = String(markdown || '')
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/)
  if (!match) return demoteBodyH1(text)
  const head = match[0]
  return head + demoteBodyH1(text.slice(head.length))
}
