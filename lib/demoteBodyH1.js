/**
 * Body H1 guard. The destination layout (seo-core ArticleLayout) renders the
 * article title as the page's only <h1>; a body H1 fails the site's build audit.
 *
 * demoteBodyH1: demote Markdown/HTML H1s to H2. Leaves ## and deeper alone.
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
      return line.replace(/^( {0,3})#(?=[ \t]|$)/, '$1##').replace(/<(\/?)h1\b/gi, '<$1h2')
    })
    .join(newline)
}

function normalizeTitle(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function frontmatterTitle(yamlBlock) {
  const m = String(yamlBlock || '').match(/^title:\s*(.+?)\s*$/m)
  if (!m) return ''
  let v = m[1]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'")
  }
  return v
}

/** Remove a leading `# Title` / `<h1>Title</h1>` that duplicates the article title. */
function dropLeadingTitleH1(body, title) {
  const wanted = normalizeTitle(title)
  if (!wanted) return body
  const text = String(body || '')
  const md = text.match(/^(\s*)#[ \t]+(.+?)[ \t#]*(\r?\n|$)/)
  if (md && normalizeTitle(md[2]) === wanted) {
    return md[1] + text.slice(md[0].length).replace(/^(\r?\n)+/, '')
  }
  const html = text.match(/^(\s*)<h1\b[^>]*>([\s\S]*?)<\/h1\s*>[ \t]*(\r?\n|$)/i)
  if (html && normalizeTitle(html[2]) === wanted) {
    return html[1] + text.slice(html[0].length).replace(/^(\r?\n)+/, '')
  }
  return body
}

/**
 * Normalize an article file: drop a leading H1 that repeats the frontmatter
 * title, demote any other H1 to H2. Frontmatter is left unchanged.
 */
export function demoteArticleMarkdownH1(markdown) {
  const text = String(markdown || '')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/)
  if (!match) return demoteBodyH1(text)
  const head = match[0]
  const title = frontmatterTitle(match[1])
  return head + demoteBodyH1(dropLeadingTitleH1(text.slice(head.length), title))
}

/** True if the markdown body (outside code fences) still contains an H1. */
export function hasBodyH1(markdown) {
  const text = String(markdown || '')
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/)
  const body = match ? text.slice(match[0].length) : text
  let inFence = false
  for (const line of body.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (/^ {0,3}#(?=[ \t]|$)/.test(line) || /<h1\b/i.test(line)) return true
  }
  return false
}
