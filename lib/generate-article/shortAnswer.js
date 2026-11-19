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
  const paragraph = after.split(/\n\s*\n/)[0]
  const first = words(paragraph)
  if (first < MIN_WORDS || first > MAX_WORDS) {
    errors.push(
      `the paragraph under "## ${SHORT_ANSWER_HEADING}" is ${first} words (write 60-90; it must be ${MIN_WORDS}-${MAX_WORDS}).`
    )
  }
  const leadText = text.slice(0, at).trim()
  if (leadText) errors.push(...disclosureErrors(leadText, paragraph, after))
  return errors
}

/** The one line allowed before the Short Answer, with the company's name in place of COMPANY. */
export const DISCLOSURE_TEMPLATE = '*COMPANY wrote this article and is one of the options it describes.*'
const DISCLOSURE_LINE = /^[*_](.+?) wrote this article and is one of the options it describes\.[*_]$/

/**
 * A disclosure means the article names the company as one of the options, so the
 * name must also be in the Short Answer paragraph and in the first main section.
 */
function disclosureErrors(leadText, paragraph, afterHeading) {
  const match = leadText.match(DISCLOSURE_LINE)
  if (!match) {
    return [
      `the only line allowed before "## ${SHORT_ANSWER_HEADING}" is the disclosure, exactly: ${DISCLOSURE_TEMPLATE} (with the company's name). Found: "${leadText.slice(0, 160)}".`,
    ]
  }
  const company = match[1].trim()
  const errors = []
  if (!paragraph.includes(company)) {
    errors.push(
      `the article opens with the disclosure, so the paragraph under "## ${SHORT_ANSWER_HEADING}" must name ${company} once, among the other options, with a short gloss. Otherwise remove the disclosure line.`
    )
  }
  const sections = afterHeading.split(/^##\s+.+$/m)
  const firstMain = sections[1] || ''
  const secondMain = sections[2] || ''
  if (!firstMain.includes(company) && !secondMain.includes(company)) {
    errors.push(
      `the Short Answer names ${company}, so the first main section after it (or the next, if the first is about law, regulation, medicine or safety) must name ${company} in one or two sentences tied to that section's point.`
    )
  }
  return errors
}
