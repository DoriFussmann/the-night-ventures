const APPENDIX_HEADING = /^##\s+(?:where things stand|key takeaways)\s*$/i

/** Text before the first Where Things Stand or Key Takeaways heading. */
export function mainBodyMarkdown(text) {
  const lines = String(text || '').split(/\r?\n/)
  const cut = lines.findIndex((line) => APPENDIX_HEADING.test(line))
  return (cut === -1 ? lines : lines.slice(0, cut)).join('\n')
}

/** Drop markdown / HTML syntax and keep the readable words. */
export function stripMarkdownSyntax(markdown) {
  return String(markdown || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, ' ')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    .replace(/~~([\s\S]*?)~~/g, '$1')
    .replace(/<[^>]+>/g, ' ')
}

export function countMainBodyWords(text) {
  const stripped = stripMarkdownSyntax(mainBodyMarkdown(text)).trim()
  if (!stripped) return 0
  return stripped.split(/\s+/).length
}

/**
 * Inclusive word window for a modify-mode main body.
 * Keep length: ±15% of the source. Expand: ±10% of the requested wordCount.
 */
export function modifyMainBodyBounds({
  sourceArticle = '',
  expand = false,
  wordCount = 0,
} = {}) {
  const sourceWordCount = countMainBodyWords(sourceArticle)
  const requested = Number(wordCount)
  const target = expand && Number.isFinite(requested) ? requested : sourceWordCount
  const safe = target > 0 ? target : 0
  // Integer percent avoids binary float error (100 * 1.15 === 114.999…).
  const percent = expand ? 10 : 15
  return {
    sourceWordCount,
    min: Math.ceil((safe * (100 - percent)) / 100),
    max: Math.floor((safe * (100 + percent)) / 100),
  }
}
