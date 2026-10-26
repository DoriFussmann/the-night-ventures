// Deterministic clean-up of a generated body for an article imported from a
// writer's document: image placeholders kept exactly once with alt text, and
// links only to the company's own site.

import { isolateImageLines, unlinkOffSite } from './markdown.js'

const PLACEHOLDER_RE = /!\[([^\]]*)\]\(writer-image:(\d+)\)/g
const MIN_ALT = 10

/**
 * @param {string} body
 * @param {{ domain?: string, imageNumbers?: number[], imageAlts?: Record<number,string> } | null} brief
 * @returns {{ body: string, errors: string[] }}
 */
export function finalizeWriterBody(body, brief) {
  if (!brief) return { body: String(body || ''), errors: [] }
  const wanted = new Set((brief.imageNumbers || []).map(Number))
  const alts = brief.imageAlts || {}
  const seen = new Set()

  let text = String(body || '').replace(PLACEHOLDER_RE, (_match, alt, raw) => {
    const n = Number(raw)
    if (!wanted.has(n) || seen.has(n)) return ''
    seen.add(n)
    let label = String(alt || '').replace(/\s+/g, ' ').trim()
    if (label.length < MIN_ALT) label = String(alts[n] || '').trim() || label
    if (label.length < MIN_ALT) label = 'Illustration for this article'
    return `![${label.replace(/[[\]]/g, '')}](writer-image:${n})`
  })

  if (brief.domain) text = unlinkOffSite(text, brief.domain)
  if (wanted.size) text = isolateImageLines(text)

  const missing = [...wanted].filter((n) => !seen.has(n)).sort((a, b) => a - b)
  const errors = missing.length
    ? [
        `Image placeholder${missing.length > 1 ? 's' : ''} ${missing
          .map((n) => `![](writer-image:${n})`)
          .join(', ')} missing from the body. Put each back exactly once, on its own line, next to the text it illustrates.`,
      ]
    : []
  return { body: text, errors }
}
