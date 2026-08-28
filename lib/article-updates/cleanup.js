// lib/article-updates/cleanup.js
//
// Slice 1 — Deterministic AI-writing cleanup. No LLM, no network.
//
// Governing principle: small, defined, faithful, gradual — never sudden.
// Every pass is additive-safe, idempotent, and emits a reviewable diff.
//
// Four passes, run only over EDITABLE PROSE:
//   1. em-dash density  — pull toward a human range (default ~10 / 1k words),
//                         never to zero, using only lossless rewrites.
//   2. stray markdown   — strip leftover ** (unpaired) and mid-line ## hashes.
//   3. tracking params  — strip utm_* / gclid / fbclid etc. from URLs.
//   4. curly quotes     — normalize “ ” ‘ ’ to straight ASCII " '.
//
// NEVER touched: YAML frontmatter, heading lines (#..######), fenced code,
// inline code spans, and any <!-- X:START --> … <!-- X:END --> block
// (WHERE-THINGS-STAND, CMS-INTERNAL, CMS-EXTERNAL). URLs are only ever
// modified by the tracking-param pass; all other passes leave them intact.

const EM = '\u2014' // —
const LSQUO = '\u2018' // ‘
const RSQUO = '\u2019' // ’
const LDQUO = '\u201C' // “
const RDQUO = '\u201D' // ”

const DEFAULT_OPTS = {
  emDashTargetPer1k: 10, // human range; pass reduces only when above this
  normalizeQuotes: true,
  stripTracking: true,
  stripStrayMarkdown: true,
  stripBalancedBold: false, // paired **bold** is valid markdown; off by default
  trackingKeys: [/^utm_/i, /^gclid$/i, /^fbclid$/i, /^mc_eid$/i, /^igshid$/i],
}

// ---------------------------------------------------------------------------
// Document split: frontmatter (verbatim) + body
// ---------------------------------------------------------------------------
function splitFrontmatter(doc) {
  const src = String(doc ?? '')
  if (!src.startsWith('---')) return { frontmatter: '', body: src }
  const firstNl = src.indexOf('\n')
  if (firstNl === -1) return { frontmatter: '', body: src }
  if (src.slice(0, firstNl).trim() !== '---') return { frontmatter: '', body: src }
  // Closing delimiter: a `---` line (after opening). Capture through its
  // trailing newline so that frontmatter + body === src exactly.
  const re = /\n---[ \t]*(\r?\n|$)/
  const m = re.exec(src)
  if (!m) return { frontmatter: '', body: src }
  const end = m.index + m[0].length
  return { frontmatter: src.slice(0, end), body: src.slice(end) }
}

// ---------------------------------------------------------------------------
// Line classification. Returns per-line { editable, text }.
// Tracks fenced-code and comment-delimited protected blocks as state.
// ---------------------------------------------------------------------------
const FENCE_RE = /^\s*(```|~~~)/
const HEADING_RE = /^\s{0,3}#{1,6}\s/
const BLOCK_START_RE = /<!--\s*[A-Z0-9_-]+:START\s*-->/
const BLOCK_END_RE = /<!--\s*[A-Z0-9_-]+:END\s*-->/

function classifyLines(body) {
  const lines = body.split('\n')
  let inFence = false
  let inProtectedBlock = false
  return lines.map((text) => {
    if (FENCE_RE.test(text)) {
      inFence = !inFence
      return { editable: false, text }
    }
    if (inFence) return { editable: false, text }

    // Comment-delimited protected blocks (WTS / CMS). The marker lines and
    // everything between them are off-limits.
    if (BLOCK_START_RE.test(text)) {
      inProtectedBlock = true
      return { editable: false, text }
    }
    if (BLOCK_END_RE.test(text)) {
      inProtectedBlock = false
      return { editable: false, text }
    }
    if (inProtectedBlock) return { editable: false, text }

    if (HEADING_RE.test(text)) return { editable: false, text } // titles/headings sacred
    return { editable: true, text }
  })
}

// ---------------------------------------------------------------------------
// Inline masking: hide inline-code spans and URLs so char-level passes can't
// corrupt them. URLs are handled separately by the tracking pass.
// ---------------------------------------------------------------------------
const INLINE_CODE_RE = /`[^`]*`/g
// markdown link/image target: ](  url  ) and bare autolinks/urls
const MD_LINK_URL_RE = /\]\((https?:\/\/[^\s)]+)\)/g
const BARE_URL_RE = /(?<![("])\bhttps?:\/\/[^\s)<>\]]+/g

function maskSpans(line) {
  const spans = []
  const stash = (m) => {
    const token = `\u0000${spans.length}\u0000`
    spans.push(m)
    return token
  }
  let out = line.replace(INLINE_CODE_RE, stash)
  out = out.replace(MD_LINK_URL_RE, (full, url) => `](${stash(url)})`)
  out = out.replace(BARE_URL_RE, (m) => stash(m))
  return { masked: out, spans }
}

function unmask(masked, spans) {
  return masked.replace(/\u0000(\d+)\u0000/g, (_, i) => spans[Number(i)])
}

// ---------------------------------------------------------------------------
// Pass 4: curly → straight quotes (applied to masked prose only)
// ---------------------------------------------------------------------------
function normalizeQuotes(text) {
  return text
    .replace(new RegExp(`[${LSQUO}${RSQUO}]`, 'g'), "'")
    .replace(new RegExp(`[${LDQUO}${RDQUO}]`, 'g'), '"')
}

// ---------------------------------------------------------------------------
// Pass 2: stray markdown (masked prose only)
//   - drop mid-line ## (two or more hashes) that is not a heading
//   - remove ** that isn't part of a balanced **bold** pair
//     (balanced bold left intact unless stripBalancedBold)
// ---------------------------------------------------------------------------
function stripStrayMarkdown(text, opts) {
  let out = text
  let flagged = null

  // mid-line runs of 2+ hashes glued to prose (heading lines already excluded).
  // Unambiguous: any ## inside an editable prose line is leftover.
  out = out.replace(/#{2,}\s?/g, '')

  const markerCount = (out.match(/\*\*/g) || []).length
  if (opts.stripBalancedBold) {
    out = out.replace(/\*\*/g, '') // aggressive sweep: bold not part of body style
  } else if (markerCount === 1) {
    // Exactly one marker: no pair to break, so removing it is safe.
    out = out.replace('**', '')
  } else if (markerCount % 2 === 1) {
    // Odd and >1: a stray exists but which one is ambiguous. Do NOT guess —
    // leave verbatim and flag for human review.
    flagged = { kind: 'unbalanced-bold', text: out }
  }
  // Even count with !stripBalancedBold: treated as valid paired bold, kept.

  return { text: out, flagged }
}

// ---------------------------------------------------------------------------
// Pass 3: strip tracking params from a URL
// ---------------------------------------------------------------------------
function stripTrackingFromUrl(url, opts) {
  const qIdx = url.indexOf('?')
  if (qIdx === -1) return url
  const hashIdx = url.indexOf('#', qIdx)
  const base = url.slice(0, qIdx)
  const query = url.slice(qIdx + 1, hashIdx === -1 ? undefined : hashIdx)
  const frag = hashIdx === -1 ? '' : url.slice(hashIdx)
  const kept = query
    .split('&')
    .filter(Boolean)
    .filter((pair) => {
      const key = pair.split('=')[0]
      return !opts.trackingKeys.some((re) => re.test(key))
    })
  return base + (kept.length ? '?' + kept.join('&') : '') + frag
}

// ---------------------------------------------------------------------------
// Pass 1: em-dash density reduction (whole editable-prose corpus)
//   Stage A (lossless): " — X — " → " (X) "
//   Stage B (soft):     " — "     → ", "   left-to-right, only until at target
//   Never reduces below target; never touches non-spaced or masked dashes.
// ---------------------------------------------------------------------------
function countWords(s) {
  const m = s.replace(/\u0000\d+\u0000/g, ' ').match(/\b[\w'-]+\b/g)
  return m ? m.length : 0
}
function countEmDashes(s) {
  const m = s.match(new RegExp(EM, 'g'))
  return m ? m.length : 0
}

function reduceEmDashes(maskedLines, words, opts, diffs) {
  const targetCount = Math.ceil((opts.emDashTargetPer1k * words) / 1000)

  const joined = maskedLines.join('\n')
  let current = countEmDashes(joined)
  const before = current
  if (current <= targetCount) {
    return { lines: maskedLines, before, after: current, target: targetCount }
  }

  const paren = new RegExp(` ${EM} ([^${EM}\\n]{1,80}?) ${EM} `)
  const single = new RegExp(` ${EM} `)

  const work = maskedLines.slice()

  // Stage A — lossless parenthetical, as many as exist.
  for (let i = 0; i < work.length && current > targetCount; i++) {
    let guard = 0
    while (paren.test(work[i]) && current > targetCount && guard++ < 50) {
      const prev = work[i]
      work[i] = work[i].replace(paren, ' ($1) ')
      if (work[i] !== prev) {
        diffs.push({ pass: 'em-dash', kind: 'parenthetical', before: prev, after: work[i] })
        current -= 2
      } else break
    }
  }

  // Stage B — soften single clause dashes, left-to-right, only until at target.
  for (let i = 0; i < work.length && current > targetCount; i++) {
    let guard = 0
    while (single.test(work[i]) && current > targetCount && guard++ < 200) {
      const prev = work[i]
      work[i] = work[i].replace(single, ', ')
      if (work[i] !== prev) {
        diffs.push({ pass: 'em-dash', kind: 'clause', before: prev, after: work[i] })
        current -= 1
      } else break
    }
  }

  return { lines: work, before, after: current, target: targetCount }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export function cleanupArticle(doc, options = {}) {
  const opts = { ...DEFAULT_OPTS, ...options }
  const diffs = []
  const flags = []
  const { frontmatter, body } = splitFrontmatter(doc)
  const classified = classifyLines(body)

  // Mask every editable line up front; keep protected lines verbatim.
  const editableMask = classified.map((l) =>
    l.editable ? maskSpans(l.text) : null
  )

  // --- char-level passes on masked editable prose (quotes, stray md, tracking)
  let quotesChanged = 0
  let strayChanged = 0
  let trackingChanged = 0

  for (let i = 0; i < classified.length; i++) {
    if (!classified[i].editable) continue
    const m = editableMask[i]
    let masked = m.masked

    if (opts.normalizeQuotes) {
      const next = normalizeQuotes(masked)
      if (next !== masked) {
        quotesChanged++
        diffs.push({ pass: 'quotes', line: i, before: masked, after: next })
        masked = next
      }
    }
    if (opts.stripStrayMarkdown) {
      const { text: next, flagged } = stripStrayMarkdown(masked, opts)
      if (next !== masked) {
        strayChanged++
        diffs.push({ pass: 'stray-markdown', line: i, before: masked, after: next })
        masked = next
      }
      if (flagged) flags.push({ line: i, ...flagged })
    }
    if (opts.stripTracking) {
      m.spans = m.spans.map((span) => {
        if (/^https?:\/\//.test(span)) {
          const cleaned = stripTrackingFromUrl(span, opts)
          if (cleaned !== span) {
            trackingChanged++
            diffs.push({ pass: 'tracking', line: i, before: span, after: cleaned })
          }
          return cleaned
        }
        return span
      })
    }
    editableMask[i].masked = masked
  }

  // --- em-dash pass across all editable masked prose
  const maskedEditableLines = []
  const editableIndex = []
  for (let i = 0; i < classified.length; i++) {
    if (classified[i].editable) {
      maskedEditableLines.push(editableMask[i].masked)
      editableIndex.push(i)
    }
  }
  const words = countWords(maskedEditableLines.join('\n'))
  let emStats = { before: 0, after: 0, target: 0 }
  if (opts.emDashTargetPer1k != null) {
    const res = reduceEmDashes(maskedEditableLines, words, opts, diffs)
    emStats = { before: res.before, after: res.after, target: res.target }
    res.lines.forEach((line, k) => {
      editableMask[editableIndex[k]].masked = line
    })
  }

  // --- reassemble
  const outLines = classified.map((l, i) => {
    if (!l.editable) return l.text
    return unmask(editableMask[i].masked, editableMask[i].spans)
  })
  const newBody = outLines.join('\n')
  const cleaned = frontmatter ? `${frontmatter}${newBody}` : newBody

  const stats = {
    words,
    emDashBefore: emStats.before,
    emDashAfter: emStats.after,
    emDashTarget: emStats.target,
    emDashPer1kBefore: words ? +((emStats.before * 1000) / words).toFixed(1) : 0,
    emDashPer1kAfter: words ? +((emStats.after * 1000) / words).toFixed(1) : 0,
    quotesChanged,
    strayMarkdownChanged: strayChanged,
    trackingChanged,
  }

  return {
    cleaned,
    changed: cleaned !== String(doc ?? ''),
    diffs,
    flags,
    stats,
  }
}

export const _internal = {
  splitFrontmatter,
  classifyLines,
  maskSpans,
  unmask,
  normalizeQuotes,
  stripStrayMarkdown,
  stripTrackingFromUrl,
  countWords,
  countEmDashes,
}
