/**
 * "The Short Answer": the section every generated article opens with.
 * Pure; shared by the writer prompt and the generator's validation.
 */
import { stripMarkdownSyntax } from './mainBodyWords.js'

export const SHORT_ANSWER_HEADING = 'The Short Answer'

const HEADING_LINE = /^##\s+The Short Answer\s*$/m
const ANY_H2 = /^##\s+.+$/gm
/** Words allowed before the heading: room for a one-line disclosure, nothing more. */
const MAX_LEAD_WORDS = 60
/** The prompt asks for 60-90 words; the check allows a little either side, no more. */
const MIN_WORDS = 40
const MAX_WORDS = 100

function words(text) {
  const clean = stripMarkdownSyntax(String(text || '')).trim()
  return clean ? clean.split(/\s+/).length : 0
}

/** Problems with the opening Short Answer section of a generated body. Empty when it is in order. */
export function shortAnswerErrors(body) {
  const text = String(body || '')
  const headings = text.match(ANY_H2) || []
  const count = headings.filter((h) => HEADING_LINE.test(h)).length
  if (count !== 1 || !HEADING_LINE.test(headings[0] || '')) {
    return [
      `body must open with a "## ${SHORT_ANSWER_HEADING}" heading, exactly once, as its first heading (found ${count}): one paragraph of 60-90 words that answers the target keyword outright.`,
    ]
  }
  const errors = []
  const at = text.search(HEADING_LINE)
  const lead = words(text.slice(0, at))
  if (lead > MAX_LEAD_WORDS) {
    errors.push(
      `only a one-line disclosure may come before "## ${SHORT_ANSWER_HEADING}" (found ${lead} words before it).`
    )
  }
  const after = text.slice(at).replace(HEADING_LINE, '').trim()
  const first = words(after.split(/\n\s*\n/)[0])
  if (first < MIN_WORDS || first > MAX_WORDS) {
    errors.push(
      `the paragraph under "## ${SHORT_ANSWER_HEADING}" is ${first} words (write 60-90; it must be ${MIN_WORDS}-${MAX_WORDS}).`
    )
  }
  return errors
}
