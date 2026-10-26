/**
 * In-text internal links: place a link inside an existing sentence that
 * already talks about the target, instead of appending a "Further reading"
 * line. Pure string functions; no I/O.
 *
 * A link target: { href, phrases: [string], slug?, kind? }
 * - href     '/articles/<slug>/' or the commercial page URL
 * - phrases  wording to look for, best first (target keyword, variants)
 */

const SKIP_SECTION = /^##\s+(where things stand|key takeaways|faq|frequently asked|sources|references)\b/i

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Phrase variants: the phrase, and a simple singular/plural swap of its last word. */
export function phraseVariants(phrase) {
  const p = String(phrase || '').replace(/\s+/g, ' ').trim()
  if (p.length < 3) return []
  const out = [p]
  const words = p.split(' ')
  const last = words[words.length - 1]
  let alt = null
  if (/ies$/i.test(last)) alt = last.replace(/ies$/i, 'y')
  else if (/s$/i.test(last) && !/ss$/i.test(last)) alt = last.slice(0, -1)
  else if (/y$/i.test(last) && !/[aeiou]y$/i.test(last)) alt = last.replace(/y$/i, 'ies')
  else alt = `${last}s`
  if (alt && alt.length > 2) out.push([...words.slice(0, -1), alt].join(' '))
  return out
}

function hrefPath(href) {
  try {
    return new URL(href).pathname
  } catch {
    return String(href || '')
  }
}

/** Does the body already link to this target (by slug path or full URL)? */
export function bodyLinksTo(body, href) {
  const path = hrefPath(href).replace(/\/+$/, '')
  if (!path) return false
  const re = new RegExp(`\\]\\((?:https?://[^)\\s]*)?${escapeRe(path)}/?(?:[#?][^)]*)?\\)`, 'i')
  return re.test(String(body || ''))
}

/**
 * Split the body into lines with a flag saying whether a link may be placed
 * on that line: prose paragraphs only, outside Where Things Stand, Key
 * Takeaways, FAQs and other marker blocks.
 */
function eligibleLines(body) {
  const lines = String(body || '').split('\n')
  let inSkipSection = false
  let inMarker = false
  let inFence = false
  return lines.map((line) => {
    const t = line.trim()
    if (/^```/.test(t)) inFence = !inFence
    if (/<!--\s*[\w-]+:START\s*-->/.test(t)) inMarker = true
    if (/<!--\s*[\w-]+:END\s*-->/.test(t)) {
      inMarker = false
      return { line, ok: false }
    }
    if (/^##\s/.test(t)) inSkipSection = SKIP_SECTION.test(t)
    const ok =
      !inFence &&
      !inMarker &&
      !inSkipSection &&
      t.length > 0 &&
      !/^(#|>|\||<|!\[|-{3,}|\*{3,})/.test(t) &&
      // a list item is fine to link inside, but not a bare link list
      !/^[-*]\s*\[[^\]]*\]\([^)]*\)\s*$/.test(t)
    return { line, ok }
  })
}

/** Character ranges already inside markdown links or inline code. */
function protectedRanges(line) {
  const ranges = []
  const re = /\[[^\]]*\]\([^)]*\)|`[^`]*`|https?:\/\/\S+/g
  let m
  while ((m = re.exec(line)) !== null) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

function findPhrase(line, phrase) {
  const re = new RegExp(`(^|[^\\w-])(${escapeRe(phrase)})(?=$|[^\\w-])`, 'i')
  const ranges = protectedRanges(line)
  let offset = 0
  let rest = line
  while (rest.length) {
    const m = re.exec(rest)
    if (!m) return null
    const start = offset + m.index + m[1].length
    const end = start + m[2].length
    if (!ranges.some(([a, b]) => start < b && end > a)) return { start, end, text: line.slice(start, end) }
    offset = end
    rest = line.slice(end)
  }
  return null
}

/**
 * Place each target once, on the first eligible line that mentions one of
 * its phrases. At most one new link per paragraph.
 *
 * @returns { body, placed: [{ href, slug, anchor, sentence }], unplaced: [{ href, slug, phrases }] }
 */
export function placeInTextLinks(body, targets) {
  const rows = eligibleLines(body)
  const used = new Set()
  const placed = []
  const unplaced = []
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target?.href) continue
    if (bodyLinksTo(rows.map((r) => r.line).join('\n'), target.href)) continue
    const phrases = (target.phrases || []).flatMap(phraseVariants)
    let done = false
    for (const phrase of phrases) {
      for (let i = 0; i < rows.length && !done; i += 1) {
        if (!rows[i].ok || used.has(i)) continue
        const hit = findPhrase(rows[i].line, phrase)
        if (!hit) continue
        const line = rows[i].line
        rows[i] = {
          ...rows[i],
          line: `${line.slice(0, hit.start)}[${hit.text}](${target.href})${line.slice(hit.end)}`,
        }
        used.add(i)
        placed.push({
          href: target.href,
          slug: target.slug || '',
          kind: target.kind || 'internal',
          anchor: hit.text,
          sentence: sentenceAround(line, hit.start),
        })
        done = true
      }
      if (done) break
    }
    if (!done) unplaced.push({ href: target.href, slug: target.slug || '', kind: target.kind || 'internal', phrases: target.phrases || [] })
  }
  return { body: rows.map((r) => r.line).join('\n'), placed, unplaced }
}

function sentenceAround(line, index) {
  const before = line.slice(0, index)
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '))
  const after = line.slice(index)
  const endRel = after.search(/[.?!](\s|$)/)
  const end = endRel === -1 ? line.length : index + endRel + 1
  return line.slice(start === -1 ? 0 : start + 2, end).trim().slice(0, 240)
}

/** Remove the legacy "Further reading" signpost block and any bare "Further reading:" line. */
export function stripFurtherReading(body) {
  return String(body || '')
    .replace(/\n*<!-- CMS-INTERNAL:START -->[\s\S]*?<!-- CMS-INTERNAL:END -->\n?/g, '\n')
    .replace(/^\s*Further reading:.*$\n?/gim, '')
    .replace(/\n{3,}/g, '\n\n')
}
