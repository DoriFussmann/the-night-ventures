// Writer intake: shared, dependency-free helpers for articles delivered by a
// writer as a document (brief + article + images in one file, any layout).
//
// Image references move through three forms:
//   writer-image:N   placeholder written at import, N = order in the document
//   tnv-image:PATH   after generation; PATH is the object in the article-heroes bucket
//   ../../assets/articles/<slug>-N.<ext>   in the published markdown (publish handler)

export const WRITER_IMAGE_SCHEME = 'writer-image:'
export const TNV_IMAGE_SCHEME = 'tnv-image:'

const WRITER_IMAGE_RE = /!\[([^\]]*)\]\(writer-image:(\d+)\)/g
const TNV_IMAGE_RE = /!\[([^\]]*)\]\(tnv-image:([^)\s]+)\)/g
const MD_LINK_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

export function writerImageRef(n) {
  return `${WRITER_IMAGE_SCHEME}${n}`
}

/** Numbers of the writer-image placeholders in the text, in order, unique. */
export function writerImageNumbers(text) {
  const out = []
  for (const match of String(text || '').matchAll(WRITER_IMAGE_RE)) {
    const n = Number(match[2])
    if (!out.includes(n)) out.push(n)
  }
  return out
}

/** How many times each placeholder appears: { [n]: count }. */
export function writerImageCounts(text) {
  const counts = {}
  for (const match of String(text || '').matchAll(WRITER_IMAGE_RE)) {
    const n = Number(match[2])
    counts[n] = (counts[n] || 0) + 1
  }
  return counts
}

function tidy(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Remove every writer-image placeholder whose number is not in `keep`. */
export function keepWriterImages(text, keep) {
  const allowed = new Set((Array.isArray(keep) ? keep : [...(keep || [])]).map(Number))
  return tidy(
    String(text || '').replace(WRITER_IMAGE_RE, (match, _alt, n) =>
      allowed.has(Number(n)) ? match : ''
    )
  )
}

const STANDALONE_IMAGE_RE = /[ \t]*(!\[[^\]]*\]\((?:writer-image:\d+|tnv-image:[^)\s]+)\))[ \t]*/g

/**
 * Put each kept image on its own block so it survives paragraph merging.
 * Table rows are left alone (an image in a cell stays in its cell).
 */
export function isolateImageLines(text) {
  return tidy(
    String(text || '')
      .split('\n')
      .map((line) => (/^\s*\|/.test(line) ? line : line.replace(STANDALONE_IMAGE_RE, '\n\n$1\n\n')))
      .join('\n')
  )
}

/**
 * writer-image:N -> tnv-image:PATH for every N in `paths` ({ [n]: path });
 * placeholders without a path are dropped.
 */
export function writerImagesToStorage(text, paths) {
  const map = paths && typeof paths === 'object' ? paths : {}
  return tidy(
    String(text || '').replace(WRITER_IMAGE_RE, (_match, alt, n) => {
      const path = String(map[n] || map[Number(n)] || '').trim()
      if (!path) return ''
      return `![${String(alt || '').trim()}](${TNV_IMAGE_SCHEME}${path})`
    })
  )
}

/** [{ alt, path, match }] for each tnv-image reference, in order. */
export function tnvImageRefs(markdown) {
  const out = []
  for (const match of String(markdown || '').matchAll(TNV_IMAGE_RE)) {
    out.push({ alt: match[1], path: match[2], match: match[0] })
  }
  return out
}

export function hostMatchesDomain(url, domain) {
  const base = String(domain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
  if (!base) return false
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return false
  }
  return host === base || host.endsWith(`.${base}`)
}

/** Links (not images) in markdown: [{ anchor, url }]. */
export function markdownLinks(markdown) {
  const out = []
  for (const match of String(markdown || '').matchAll(MD_LINK_RE)) {
    if (match[1] === '!') continue
    out.push({ anchor: match[2], url: match[3] })
  }
  return out
}

/** Own-site links that are not plain-text URLs, unique by URL. */
export function ownSiteLinks(markdown, domain) {
  const seen = new Set()
  const out = []
  for (const link of markdownLinks(markdown)) {
    if (!/^https?:\/\//i.test(link.url) || !hostMatchesDomain(link.url, domain)) continue
    if (seen.has(link.url)) continue
    seen.add(link.url)
    out.push(link)
  }
  return out
}

/** Unlink every link that does not point to the company's own site. */
export function unlinkOffSite(markdown, domain) {
  return String(markdown || '').replace(MD_LINK_RE, (match, bang, anchor, url) => {
    if (bang === '!') return match
    if (/^https?:\/\//i.test(url) && hostMatchesDomain(url, domain)) return match
    return anchor || url
  })
}

/** Blocks separated by blank lines — the units the intake model classifies. */
export function splitSourceBlocks(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
}

/** Drop the blocks at `indices` (from splitSourceBlocks) and rejoin. */
export function removeBlocks(text, indices) {
  const drop = new Set((Array.isArray(indices) ? indices : []).map(Number))
  return splitSourceBlocks(text)
    .filter((_block, i) => !drop.has(i))
    .join('\n\n')
}

function cellMarkdown(service, cell) {
  return service
    .turndown(String(cell.innerHTML || ''))
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

/**
 * GFM tables for Turndown (docx tables otherwise come out as one paragraph per
 * cell). Works with the browser DOM and Turndown's Node DOM.
 */
export function addTableRule(service) {
  service.addRule('gfmTable', {
    filter: 'table',
    replacement(_content, node) {
      const rows = Array.from(node.querySelectorAll('tr'))
        .map((row) =>
          Array.from(row.childNodes || [])
            .filter((cell) => /^(td|th)$/i.test(String(cell.nodeName || '')))
            .map((cell) => cellMarkdown(service, cell))
        )
        .filter((cells) => cells.length > 0 && cells.some(Boolean))
      if (rows.length === 0) return '\n\n'
      const width = Math.max(...rows.map((cells) => cells.length))
      const pad = (cells) => [...cells, ...Array(width - cells.length).fill('')]
      const line = (cells) => `| ${pad(cells).join(' | ')} |`
      const header = rows[0].map((cell) => cell.replace(/^\*\*(.*)\*\*$/, '$1'))
      const lines = [line(header), line(Array(width).fill('---')), ...rows.slice(1).map(line)]
      return `\n\n${lines.join('\n')}\n\n`
    },
  })
  return service
}
