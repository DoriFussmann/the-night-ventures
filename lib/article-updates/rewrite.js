// lib/article-updates/rewrite.js
//
// Slice 4a — deterministic backbone for the random-section improvement.
// Pure, no LLM, no network. The LLM (slice 4b) only generates candidate text;
// everything that decides WHAT is eligible and whether a proposal is LEGAL lives
// here and is unit-tested. A proposal that fails any guardrail is dropped, never
// surfaced.
//
// Principle: one section, one change, per article, per run. Additive over
// substitutive. Keyword sacred. Title/headings/meta/WTS/CMS never touched.

export const REWRITE_OPTIONS = [
  'wordsmithing', // the ONE substitutive exception (single-sentence reword)
  'concrete-example',
  'historical-note',
  'stat-refresh',
  'analogy',
]
export const ADDITIVE_OPTIONS = new Set([
  'concrete-example',
  'historical-note',
  'stat-refresh',
  'analogy',
])

const PROTECTED_HEADINGS = new Set(['where things stand', 'key takeaways'])
const MIN_SECTION_WORDS = 25 // too-short sections: an insert would dominate

const FENCE_RE = /^\s*(```|~~~)/
const HEADING_RE = /^(#{2,6})\s+(.*)$/
const LIST_RE = /^\s*([-*+]|\d+\.)\s+/

function normHeading(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function normWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function wordCount(s) {
  const m = normWs(s).match(/[A-Za-z0-9'-]+/g)
  return m ? m.length : 0
}

// Split into sentences for verbatim-presence checks (tolerant, not perfect).
export function splitSentences(text) {
  const out = []
  const re = /[^.!?\n]+[.!?]+|\S[^.!?\n]*$/g
  let m
  while ((m = re.exec(String(text || '')))) {
    const s = normWs(m[0])
    if (s) out.push(s)
  }
  return out
}

/**
 * Parse the body into ## sections. Each section spans its heading line to just
 * before the next ## heading. Fenced code is skipped when detecting headings.
 * Sections that are name-protected, contain HTML comment markers (WTS/CMS), are
 * bullet-only, or are too short are marked ineligible.
 */
export function parseSections(body) {
  const lines = String(body || '').split('\n')
  const sections = []
  let inFence = false
  let current = null

  const closeCurrent = (endLine) => {
    if (!current) return
    current.endLine = endLine
    current.text = lines.slice(current.bodyStart, endLine + 1).join('\n')
    sections.push(current)
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const h = line.match(HEADING_RE)
    if (h) {
      closeCurrent(i - 1)
      current = {
        heading: h[2].trim(),
        headingLine: i,
        bodyStart: i + 1,
        startLine: i,
        endLine: i,
        text: '',
      }
    }
  }
  closeCurrent(lines.length - 1)

  return sections.map((s, index) => {
    const reason = ineligibleReason(s)
    return { index, ...s, eligible: reason == null, ineligibleReason: reason }
  })
}

function ineligibleReason(section) {
  if (PROTECTED_HEADINGS.has(normHeading(section.heading))) return 'protected-heading'
  if (/<!--/.test(section.text)) return 'contains-markers'

  const bodyLines = section.text.split('\n').filter((l) => l.trim())
  if (bodyLines.length === 0) return 'empty'

  const proseLines = bodyLines.filter(
    (l) => !LIST_RE.test(l) && !/^#{1,6}\s/.test(l) && !l.trim().startsWith('>')
  )
  if (proseLines.length === 0) return 'no-prose'
  if (wordCount(proseLines.join(' ')) < MIN_SECTION_WORDS) return 'too-short'
  return null
}

export function listEligibleSections(body) {
  return parseSections(body).filter((s) => s.eligible)
}

/** Pick one eligible section using an injectable rng (default Math.random). */
export function pickRandomSection(body, rng = Math.random) {
  const eligible = listEligibleSections(body)
  if (eligible.length === 0) return null
  const idx = Math.floor(rng() * eligible.length) % eligible.length
  return eligible[idx]
}

/**
 * Recommend a best-fit option for a section (deterministic, explainable).
 * Never recommends wordsmithing — that's an operator-chosen exception.
 */
export function recommendOption(section) {
  const text = String(section?.text || '')
  const numbers = (text.match(/\b\d+(\.\d+)?%|\$\s?\d|\b(19|20)\d{2}\b|\b\d{3,}\b/g) || []).length
  if (numbers >= 2) return 'stat-refresh'
  if (/\b(history|historically|origin|originally|founded|invented|first introduced|dates? back)\b/i.test(text)) {
    return 'historical-note'
  }
  if (wordCount(text) >= 120 && numbers === 0) return 'analogy'
  return 'concrete-example'
}

export function sectionMenu(section) {
  return { recommended: recommendOption(section), menu: [...REWRITE_OPTIONS, 'skip'] }
}

/** Build the LLM prompt for a chosen section + option. Pure; no call made. */
export function buildRewritePrompt({ section, option, targetKeyword = '', pillarKeyword = '' }) {
  const additive = ADDITIVE_OPTIONS.has(option)
  const needsWebSearch = option === 'stat-refresh'
  const optionBrief = {
    'wordsmithing':
      'Reword EXACTLY ONE sentence for clarity/flow. Preserve its meaning and every keyword. Do not add or remove any other sentence.',
    'concrete-example':
      'ADD one short, specific concrete example (1-2 sentences). Do not alter or remove any existing sentence.',
    'historical-note':
      'ADD one short historical note (1-2 sentences) giving relevant background. Do not alter or remove any existing sentence.',
    'stat-refresh':
      'ADD an up-to-date figure as an "as of <year>" clause or sentence. Do NOT cite or add any source/link. Do not alter or remove any existing sentence.',
    'analogy':
      'ADD one brief analogy (1-2 sentences) that aids understanding. Do not alter or remove any existing sentence.',
  }[option] || 'ADD one short, relevant clarifying sentence. Do not alter or remove any existing sentence.'

  const rules = [
    'Return ONLY the full revised section body text (no heading, no markdown fences, no commentary).',
    `Keep the target keyword ("${targetKeyword}") and pillar keyword ("${pillarKeyword}") present at least as many times as now.`,
    'Never add a markdown heading, HTML comment, or list restructuring.',
    additive
      ? 'ADDITIVE ONLY: every original sentence must remain word-for-word; you only insert new text.'
      : 'Change at most one sentence; leave all others word-for-word.',
  ]

  const prompt = [
    `TASK: ${optionBrief}`,
    '',
    'CURRENT SECTION BODY:',
    normWs(section?.text || section?.text),
    '',
    'RULES:',
    ...rules.map((r) => `- ${r}`),
  ].join('\n')

  return { prompt, needsWebSearch, additive }
}

/**
 * Validate a proposed section body against the original. Returns { ok, failures }.
 * A single failure means the proposal is dropped (never surfaced/committed).
 */
export function checkGuardrails({ original, proposed, option, targetKeyword = '', pillarKeyword = '' }) {
  const failures = []
  const orig = String(original || '')
  const prop = String(proposed || '')

  if (!normWs(prop)) failures.push('empty-proposal')

  // No new headings / markers / list restructuring into a comment block.
  if (/^#{1,6}\s/m.test(prop)) failures.push('introduced-heading')
  if (/<!--/.test(prop) || /WHERE-THINGS-STAND|CMS-(INTERNAL|EXTERNAL)/.test(prop)) {
    failures.push('introduced-marker')
  }

  // Keyword counts must not decrease.
  for (const [name, kw] of [['target', targetKeyword], ['pillar', pillarKeyword]]) {
    const k = normWs(kw).toLowerCase()
    if (!k) continue
    const before = countOccurrences(orig, k)
    const after = countOccurrences(prop, k)
    if (after < before) failures.push(`keyword-decreased:${name}`)
  }

  // Additive vs substitutive sentence rules.
  const origSentences = splitSentences(orig)
  const propNorm = normWs(prop)
  const missing = origSentences.filter((s) => !propNorm.includes(s))
  if (ADDITIVE_OPTIONS.has(option)) {
    if (missing.length > 0) failures.push(`additive-violation:${missing.length}-sentences-changed`)
  } else {
    // wordsmithing: at most one original sentence may change.
    if (missing.length > 1) failures.push(`too-many-sentences-changed:${missing.length}`)
  }

  // Length sanity — prevent runaway rewrites.
  if (prop.length > orig.length * 2 + 400) failures.push('excessive-length')

  return { ok: failures.length === 0, failures }
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0
  const h = String(haystack || '').toLowerCase()
  let count = 0
  let idx = 0
  while ((idx = h.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

/**
 * Replace only the chosen section's body with proposedText, leaving the heading
 * line and every other section byte-identical. Returns the new body.
 */
export function applyRewriteToBody(body, section, proposedText) {
  const lines = String(body || '').split('\n')
  if (!section || section.bodyStart == null) return String(body || '')
  const before = lines.slice(0, section.bodyStart)
  const after = lines.slice(section.endLine + 1)
  const mid = String(proposedText || '').replace(/\s+$/, '').split('\n')
  return [...before, ...mid, ...after].join('\n')
}
