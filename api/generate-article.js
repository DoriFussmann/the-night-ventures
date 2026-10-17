import Anthropic from '@anthropic-ai/sdk'
import {
  countMainBodyWords,
  modifyMainBodyBounds,
} from '../lib/generate-article/mainBodyWords.js'
import {
  GENERATE_ARTICLE_MODEL,
  buildModifyPrompt,
  buildUserPrompt,
  mergeAllowedBrands,
  normalizeArticleSpec,
  normalizeBatchContext,
  normalizeCompetitors,
  normalizeKeywordOptions,
  resolveKeywordAssignment,
} from '../lib/generate-article/prompt.js'
import { stripNoVolumeTag } from '../lib/stripNoVolumeTag.js'
import { slugify } from '../lib/slugify.js'
import { demoteBodyH1 } from '../lib/demoteBodyH1.js'

// Mirrors seo-core's H1 rules (lib/h1.ts): 20-70 chars and not the title.
export function cleanH1(value, title) {
  const h1 = String(value || '').replace(/\s+/g, ' ').trim()
  const norm = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (h1.length < 20 || h1.length > 70) return null
  if (norm(h1) === norm(title)) return null
  return h1
}

export const config = {
  maxDuration: 300,
}

function resolveMode(value) {
  if (value == null || String(value).trim() === '') return 'spec'
  const mode = String(value).trim()
  return ARTICLE_MODES.has(mode) ? mode : ''
}

function countWords(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function normalizeUserLinks(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      url: item.url == null ? '' : String(item.url),
      anchor: item.anchor == null ? '' : String(item.anchor),
    }))
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MODEL = GENERATE_ARTICLE_MODEL
const ARTICLE_MODES = new Set(['spec', 'idea', 'modify'])
const SOURCE_ARTICLE_MAX_CHARS = 40000
const SOURCE_ARTICLE_MIN_WORDS = 300
// Long articles + web-search narration need headroom; embedding body in JSON
// previously truncated around 8k.
const MAX_TOKENS = 16000
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WTS_START = '<!-- WHERE-THINGS-STAND:START -->'
const WTS_END = '<!-- WHERE-THINGS-STAND:END -->'
const FM_START = '<<<FRONTMATTER>>>'
const BODY_START = '<<<BODY>>>'
const BODY_END = '<<<END>>>'

function stripOuterMarkdownFences(text) {
  let cleaned = String(text || '').trim()
  // Only strip a single outer fence wrapper — never strip fences inside article body.
  const fenced = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fenced) return fenced[1].trim()
  return cleaned
}

function extractBalancedJsonObjects(text) {
  const source = String(text || '')
  const objects = []

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{') continue

    let depth = 0
    let inString = false
    let escaped = false

    for (let j = i; j < source.length; j++) {
      const ch = source[j]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (ch === '\\') {
          escaped = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }

      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') depth += 1
      if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          objects.push(source.slice(i, j + 1))
          i = j
          break
        }
      }
    }
  }

  return objects
}

/**
 * Escape literal newlines/tabs/carriage returns that appear inside JSON strings.
 * Models often emit pretty-printed string values that break JSON.parse.
 */
function escapeControlCharsInJsonStrings(text) {
  const source = String(text || '')
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]

    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch === '"') {
        out += ch
        inString = false
        continue
      }
      if (ch === '\n') {
        out += '\\n'
        continue
      }
      if (ch === '\r') {
        out += '\\r'
        continue
      }
      if (ch === '\t') {
        out += '\\t'
        continue
      }
      out += ch
      continue
    }

    if (ch === '"') {
      inString = true
    }
    out += ch
  }

  return out
}

function tryParseJsonObject(text) {
  const cleaned = stripOuterMarkdownFences(text)
  const candidates = [cleaned, escapeControlCharsInJsonStrings(cleaned)]

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try next
    }
  }

  for (const candidate of candidates) {
    const objects = extractBalancedJsonObjects(candidate)
    for (let i = objects.length - 1; i >= 0; i--) {
      for (const variant of [objects[i], escapeControlCharsInJsonStrings(objects[i])]) {
        try {
          return JSON.parse(variant)
        } catch {
          // try earlier
        }
      }
    }
  }

  return null
}

function looksLikeFrontmatter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    typeof value.title === 'string' ||
    typeof value.slug === 'string' ||
    typeof value.description === 'string' ||
    Array.isArray(value.tags) ||
    Array.isArray(value.faqs)
  )
}

function looksLikeArticleResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.frontmatter && typeof value.frontmatter === 'object') return true
  if (typeof value.body === 'string' && looksLikeFrontmatter(value)) return true
  return false
}

function parseDelimitedArticle(text) {
  const source = String(text || '')
  const fmIdx = source.lastIndexOf(FM_START)
  const bodyIdx = source.lastIndexOf(BODY_START)
  if (fmIdx === -1 || bodyIdx === -1 || bodyIdx < fmIdx) return null

  const endIdx = source.indexOf(BODY_END, bodyIdx + BODY_START.length)
  const fmRaw = source.slice(fmIdx + FM_START.length, bodyIdx).trim()
  const bodyRaw =
    endIdx === -1
      ? source.slice(bodyIdx + BODY_START.length).trim()
      : source.slice(bodyIdx + BODY_START.length, endIdx).trim()

  const frontmatter = tryParseJsonObject(fmRaw)
  if (!looksLikeFrontmatter(frontmatter)) return null
  if (!bodyRaw) return null

  return { frontmatter, body: bodyRaw }
}

function parseLegacyJsonArticle(text) {
  const parsed = tryParseJsonObject(text)
  if (!parsed) return null

  // Shape: { frontmatter, body }
  if (parsed.frontmatter && typeof parsed.body === 'string') {
    return { frontmatter: parsed.frontmatter, body: parsed.body }
  }

  // Shape: flat frontmatter fields + body
  if (typeof parsed.body === 'string' && looksLikeFrontmatter(parsed)) {
    const { body, ...frontmatter } = parsed
    return { frontmatter, body }
  }

  return null
}

function extractTextBlocks(content) {
  if (!Array.isArray(content)) return []
  return content
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => String(block.text))
}

function parseArticleFromContent(content) {
  const texts = extractTextBlocks(content)
  if (!texts.length) {
    throw new Error('No text content in Anthropic response')
  }

  // Prefer later blocks (JSON/delimited payload after tool-use narration),
  // then the full joined text, then each earlier block.
  const candidates = []
  candidates.push(texts[texts.length - 1])
  if (texts.length > 1) candidates.push(texts.join('\n'))
  for (let i = texts.length - 2; i >= 0; i--) {
    candidates.push(texts[i])
  }

  let lastError = null
  for (const candidate of candidates) {
    try {
      const delimited = parseDelimitedArticle(candidate)
      if (delimited) return delimited

      const legacy = parseLegacyJsonArticle(candidate)
      if (legacy) return legacy

      lastError = new Error('No valid article payload found in model response')
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('Failed to parse model response as JSON')
}

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function normalizeFaqs(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      question: String(item.question || '').trim(),
      answer: String(item.answer || '').trim(),
    }))
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while (true) {
    const found = haystack.indexOf(needle, idx)
    if (found === -1) break
    count += 1
    idx = found + needle.length
  }
  return count
}

function countKeyTakeawayBullets(body) {
  const match = String(body || '').match(
    /(?:^|\n)##\s+Key Takeaways\s*\n([\s\S]*?)(?=\n##\s+|\n<!--|$)/
  )
  if (!match) return 0
  return match[1]
    .split('\n')
    .filter((line) => /^\s*[-*+]\s+\S/.test(line)).length
}

function looksLikeCapitalizedBrandPhrases(body) {
  // Soft heuristic only: 2+ consecutive Capitalized words in prose
  // (ignore markdown headings / HTML comments — Title Case is common there).
  const prose = String(body || '')
    .replace(/^#+\s+.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  return /(?:\b[A-Z][a-zA-Z0-9&']+(?:\s+[A-Z][a-zA-Z0-9&']+)+\b)/.test(prose)
}

function isAuthorizedCompetitorMention(mentioned, authorizedNames) {
  const m = String(mentioned || '')
    .toLowerCase()
    .trim()
  if (!m) return true
  return authorizedNames.some((auth) => {
    const a = String(auth || '')
      .toLowerCase()
      .trim()
    if (!a) return false
    // Exact or reasonable substring either way ("Etsy" vs "Etsy sellers").
    return m === a || m.includes(a) || a.includes(m)
  })
}

function validateGeneratedArticle(
  frontmatter,
  body,
  { competitors = [], competitorsMentioned, length } = {}
) {
  const errors = []
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {}
  const title = String(fm.title || '')
  const description = String(fm.description || '')
  const slug = String(fm.slug || '').trim()
  const imageAlt = String(fm.imageAlt || '')
  const tags = asStringArray(fm.tags)
  const faqs = normalizeFaqs(fm.faqs)
  const bodyText = String(body || '')

  if (title.length < 55 || title.length > 60) {
    errors.push(
      `Your title was ${title.length} characters: '${title}'. It must be 55-60 characters. Rewrite it to fit that exact range, counting carefully.`
    )
  }
  if (description.length < 140 || description.length > 160) {
    errors.push(
      `Your description was ${description.length} characters: '${description}'. It must be 140-160 characters. Rewrite it to fit that exact range, counting carefully.`
    )
  }
  if (tags.length < 4 || tags.length > 6) {
    errors.push(`tags length is ${tags.length} (must be 4-6)`)
  }
  if (imageAlt.length < 10) {
    errors.push(`imageAlt length is ${imageAlt.length} (must be >= 10)`)
  }
  if (!SLUG_RE.test(slug)) {
    errors.push(
      `slug "${slug}" is invalid (must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/)`
    )
  }

  const startCount = countOccurrences(bodyText, WTS_START)
  const endCount = countOccurrences(bodyText, WTS_END)
  if (startCount !== 1) {
    errors.push(
      `body must contain WHERE-THINGS-STAND:START marker exactly once (found ${startCount})`
    )
  }
  if (endCount !== 1) {
    errors.push(
      `body must contain WHERE-THINGS-STAND:END marker exactly once (found ${endCount})`
    )
  }

  const takeawayHeadings = bodyText.match(/(?:^|\n)##\s+Key Takeaways\s*(?:\n|$)/g) || []
  if (takeawayHeadings.length !== 1) {
    errors.push(
      `body must contain a "## Key Takeaways" heading exactly once (found ${takeawayHeadings.length}). Place it after Where Things Stand, with 3–5 concise bullet points.`
    )
  } else {
    const bullets = countKeyTakeawayBullets(bodyText)
    if (bullets < 3 || bullets > 5) {
      errors.push(
        `## Key Takeaways must contain 3–5 bullet points (found ${bullets}).`
      )
    }
  }

  if (faqs.length < 2 || faqs.length > 4) {
    errors.push(`faqs length is ${faqs.length} (must be 2-4)`)
  } else {
    faqs.forEach((faq, i) => {
      if (!faq.question) errors.push(`faqs[${i}].question is empty`)
      if (!faq.answer) errors.push(`faqs[${i}].answer is empty`)
    })
  }

  // Self-reported brand names — missing/non-array treated as empty (soft), not a hard fail.
  const mentioned = Array.isArray(competitorsMentioned)
    ? asStringArray(competitorsMentioned)
    : asStringArray(fm.competitorsMentioned)
  const authorized = (Array.isArray(competitors) ? competitors : [])
    .map((c) => String(c?.name || '').trim())
    .filter(Boolean)
  const authorizedLabel = authorized.join(', ') || '(none)'

  if (mentioned.length === 0 && looksLikeCapitalizedBrandPhrases(bodyText)) {
    console.warn(
      'generate-article: competitorsMentioned empty/missing but body appears to contain capitalized multi-word phrases that may be brand names'
    )
  }

  for (const name of mentioned) {
    if (!isAuthorizedCompetitorMention(name, authorized)) {
      errors.push(
        `Unauthorized competitor named: "${name}". Only these are allowed: ${authorizedLabel}. Remove or genericize this reference.`
      )
    }
  }

  const minWords = Number(length?.min)
  const maxWords = Number(length?.max)
  if (Number.isFinite(minWords) && Number.isFinite(maxWords)) {
    const mainBodyWords = countMainBodyWords(bodyText)
    if (mainBodyWords < minWords || mainBodyWords > maxWords) {
      errors.push(
        `Main body is ${mainBodyWords} words; it must be between ${minWords} and ${maxWords}. Cut/expand while preserving the author's wording.`
      )
    }
  }

  return errors
}

function uniqueWordsNotInText(source, existingText) {
  const existing = String(existingText || '').toLowerCase()
  const words = String(source || '')
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)

  const seen = new Set()
  const out = []
  for (const word of words) {
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    if (existing.includes(key)) continue
    seen.add(key)
    out.push(word)
  }
  return out
}

/** Trim to maxLen at the last complete word boundary. Returns null if result < minLen. */
function trimAtWordBoundary(text, maxLen, minLen) {
  const value = String(text || '').trim()
  if (value.length <= maxLen) {
    return value.length >= minLen ? value : null
  }

  let slice = value.slice(0, maxLen)
  if (value[maxLen] && !/\s/.test(value[maxLen]) && !/\s/.test(slice[slice.length - 1])) {
    const lastSpace = slice.lastIndexOf(' ')
    if (lastSpace <= 0) return null
    slice = slice.slice(0, lastSpace)
  }

  const trimmed = slice.replace(/\s+$/g, '').replace(/[,\:;.–—-]+$/g, '').trim()
  if (trimmed.length > maxLen) return null
  if (trimmed.length < minLen) return null
  return trimmed
}

/** Trim description at sentence/clause boundary under maxLen, staying >= minLen. */
function trimAtClauseBoundary(text, maxLen, minLen) {
  const value = String(text || '').trim()
  if (value.length <= maxLen) {
    return value.length >= minLen ? value : null
  }

  const window = value.slice(0, maxLen)
  const boundaries = ['. ', '? ', '! ', '; ', ', ', ' — ', ' – ', ' - ', ' ']
  let best = null

  for (const boundary of boundaries) {
    const idx = window.lastIndexOf(boundary)
    if (idx < minLen - boundary.length) continue
    let candidate = window.slice(0, idx + (boundary.trim() ? boundary.trim().length : 0)).trim()
    // For space-only boundary, don't keep trailing space; for punctuation keep it.
    if (boundary === ' ') {
      candidate = window.slice(0, idx).trim()
    } else if (boundary.endsWith(' ')) {
      candidate = window.slice(0, idx + boundary.trimEnd().length).trim()
    }
    if (candidate.length >= minLen && candidate.length <= maxLen) {
      best = candidate
      break
    }
  }

  if (best) return best
  return trimAtWordBoundary(value, maxLen, minLen)
}

function extendWithWordPhrases(text, wordPool, minLen, maxLen) {
  let result = String(text || '').trim()
  if (result.length >= minLen && result.length <= maxLen) return result

  const pool = [...wordPool]
  while (result.length < minLen && pool.length > 0) {
    // Prefer a 2-4 word phrase that fits under maxLen.
    let chosen = null
    for (let n = Math.min(4, pool.length); n >= 2; n--) {
      const phrase = pool.slice(0, n).join(' ')
      const candidate = `${result}${result.endsWith(':') || result.endsWith('—') ? ' ' : ': '}${phrase}`
      if (candidate.length <= maxLen) {
        chosen = { candidate, n }
        if (candidate.length >= minLen) break
      }
    }
    if (!chosen) {
      // Try a single remaining word.
      const word = pool[0]
      const candidate = `${result} ${word}`
      if (candidate.length <= maxLen) {
        result = candidate
        pool.shift()
        continue
      }
      break
    }
    result = chosen.candidate
    pool.splice(0, chosen.n)
  }

  if (result.length > maxLen) {
    return trimAtWordBoundary(result, maxLen, minLen)
  }
  if (result.length < minLen) return null
  return result
}

function extendDescriptionWithClauses(text, wordPool, minLen, maxLen) {
  let result = String(text || '').trim()
  if (result.length >= minLen && result.length <= maxLen) return result

  const pool = [...wordPool]
  const clauseBuilders = [
    (words) => ` Focus on ${words.join(' ')}.`,
    (words) => ` Practical guidance on ${words.join(' ')}.`,
    (words) => ` Covers ${words.join(' ')}.`,
  ]

  let builderIdx = 0
  while (result.length < minLen && pool.length > 0) {
    const n = Math.min(4, Math.max(1, pool.length))
    const builder = clauseBuilders[builderIdx % clauseBuilders.length]
    builderIdx += 1

    // Prefer fitting under max; if clause is too long, shrink word count.
    let addition = builder(pool.slice(0, n))
    for (let use = n; use >= 1; use--) {
      const trial = builder(pool.slice(0, use))
      if (result.length + trial.length <= maxLen || use === 1) {
        addition = trial
        pool.splice(0, use)
        break
      }
    }

    const candidate = `${result}${addition}`.replace(/\s+/g, ' ').trim()
    if (candidate.length > maxLen) {
      const trimmed = trimAtClauseBoundary(candidate, maxLen, minLen)
      return trimmed
    }
    result = candidate
  }

  if (result.length > maxLen) {
    return trimAtClauseBoundary(result, maxLen, minLen)
  }
  if (result.length < minLen) return null
  return result
}

/**
 * Last-resort programmatic length fix for title/description only.
 * Returns { frontmatter, changed } or { frontmatter, changed: false, failed: true }.
 */
function applyLengthFallbacks(frontmatter, { targetKeyword, category }) {
  const fm = { ...frontmatter }
  let changed = false
  let failed = false

  const title = String(fm.title || '').trim()
  if (title.length < 55 || title.length > 60) {
    let next = title
    if (next.length > 60) {
      next = trimAtWordBoundary(next, 60, 55)
      if (!next) {
        failed = true
      }
    } else if (next.length < 55) {
      const pool = [
        ...uniqueWordsNotInText(targetKeyword, next),
        ...uniqueWordsNotInText(category, next),
      ]
      next = extendWithWordPhrases(next, pool, 55, 60)
      if (!next) failed = true
    }
    if (next && next !== title && next.length >= 55 && next.length <= 60) {
      fm.title = next
      changed = true
    } else if (title.length < 55 || title.length > 60) {
      failed = true
    }
  }

  const description = String(fm.description || '').trim()
  if (description.length < 140 || description.length > 160) {
    let next = description
    if (next.length > 160) {
      next = trimAtClauseBoundary(next, 160, 140)
      if (!next) failed = true
    } else if (next.length < 140) {
      const pool = [
        ...uniqueWordsNotInText(targetKeyword, next),
        ...uniqueWordsNotInText(category, next),
      ]
      next = extendDescriptionWithClauses(next, pool, 140, 160)
      if (!next) failed = true
    }
    if (
      next &&
      next !== description &&
      next.length >= 140 &&
      next.length <= 160
    ) {
      fm.description = next
      changed = true
    } else if (description.length < 140 || description.length > 160) {
      failed = true
    }
  }

  return { frontmatter: fm, changed, failed }
}

/**
 * Always construct keywords server-side. Model output for this field is ignored.
 */
function buildKeywords({ targetKeyword, supportingKeyword, pillarKeyword }) {
  const seen = new Set()
  const out = []
  for (const item of [targetKeyword, supportingKeyword, pillarKeyword]) {
    const value = stripNoVolumeTag(item)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function normalizeWhereThingsStandSources(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      url: String(item.url || '').trim(),
      note: String(item.note || '').trim(),
    }))
    .filter((item) => item.url || item.note)
}

function extractWhereThingsStandSources(raw) {
  const fm = raw && typeof raw === 'object' ? raw : {}
  return normalizeWhereThingsStandSources(fm.whereThingsStandSources)
}

function isHeadingBlock(block) {
  return /^\s*#+\s/.test(String(block || ''))
}

function isListBlock(block) {
  return /^\s*(?:[-*+]|\d+\.)\s/.test(String(block || ''))
}

function isHorizontalRuleBlock(block) {
  // Exact thematic break only — never treat as prose orphan/target.
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(String(block || ''))
}

function isBlockquoteBlock(block) {
  return /^\s*>/.test(String(block || ''))
}

/** Structural markdown that must never be merged into/from as prose. */
function isStructuralBlock(block) {
  return (
    isHeadingBlock(block) ||
    isListBlock(block) ||
    isHorizontalRuleBlock(block) ||
    isBlockquoteBlock(block)
  )
}

/** Mid-block sentence breaks: sentence-ending punct followed by whitespace (+ more text). */
function countMidSentenceBreaks(block) {
  const text = String(block || '').trim()
  // Allow a final terminator; only count breaks that leave more content after.
  const core = text.replace(/[.!?]+["')\]]*$/, '')
  const matches = core.match(/[.!?]["')\]]*\s+/g)
  return matches ? matches.length : 0
}

function isShortSingleSentence(block) {
  const text = String(block || '').trim()
  if (!text || text.length >= 200) return false
  if (isStructuralBlock(text)) return false
  return countMidSentenceBreaks(text) === 0
}

function isOrphanBlock(block) {
  const text = String(block || '').trim()
  if (!text) return false
  if (isStructuralBlock(text)) return false
  if (text.length >= 200) return false
  // Exactly one sentence: no mid-block sentence-ending punctuation + whitespace.
  if (countMidSentenceBreaks(text) > 0) return false
  return true
}

function splitBlocks(text) {
  const source = String(text || '').replace(/\r\n/g, '\n')
  if (!source.trim()) return []
  return source
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
}

function joinBlocks(blocks) {
  return blocks.join('\n\n')
}

function mergeOrphansPass(blocks) {
  const pending = [...blocks]
  const out = []

  for (let i = 0; i < pending.length; i++) {
    const block = pending[i]

    // Preserve structural dividers/headings/lists/quotes untouched.
    if (isStructuralBlock(block)) {
      out.push(block)
      continue
    }

    if (!isOrphanBlock(block)) {
      out.push(block)
      continue
    }

    const prev = out[out.length - 1]
    const noPrecedingProse = !prev || isStructuralBlock(prev)

    if (noPrecedingProse) {
      const next = pending[i + 1]
      if (next != null && !isStructuralBlock(next)) {
        pending[i + 1] = `${block.trim()} ${String(next).trim()}`
        continue
      }
      out.push(block)
      continue
    }

    out[out.length - 1] = `${String(prev).trim()} ${block.trim()}`
  }

  return out
}

/** Merge orphaned single-sentence blocks into adjacent prose. Runs two passes. */
function mergeOrphanBlocks(text) {
  let blocks = splitBlocks(text)
  if (blocks.length === 0) return String(text || '').trim()
  blocks = mergeOrphansPass(blocks)
  blocks = mergeOrphansPass(blocks)
  return joinBlocks(blocks)
}

/**
 * Force-merge leftover short single-sentence WTS blocks into nearest neighbor
 * (prefer previous; if first, next), ignoring the softer orphan heuristics.
 */
function forceMergeWtsShortSingles(blocks) {
  const result = [...blocks]
  let changed = true

  while (changed) {
    changed = false
    for (let i = 0; i < result.length; i++) {
      if (!isShortSingleSentence(result[i])) continue

      if (i > 0) {
        result[i - 1] = `${String(result[i - 1]).trim()} ${String(result[i]).trim()}`
        result.splice(i, 1)
        changed = true
        break
      }

      if (i + 1 < result.length) {
        result[i + 1] = `${String(result[i]).trim()} ${String(result[i + 1]).trim()}`
        result.splice(i, 1)
        changed = true
        break
      }
    }
  }

  return result
}

/** Cap WTS at two prose blocks by folding extras backward. */
function collapseWtsToMaxBlocks(blocks, maxBlocks = 2) {
  const result = [...blocks]
  while (result.length > maxBlocks) {
    const last = result.pop()
    result[result.length - 1] = `${String(result[result.length - 1]).trim()} ${String(last).trim()}`
  }
  return result
}

/**
 * Stronger WTS-only merge: 3 orphan passes, force-merge leftover singles,
 * then hard-cap at 2 blocks.
 */
function mergeWtsBlocks(text) {
  let blocks = splitBlocks(text)
  if (blocks.length === 0) return String(text || '').trim()

  blocks = mergeOrphansPass(blocks)
  blocks = mergeOrphansPass(blocks)
  blocks = mergeOrphansPass(blocks)
  blocks = forceMergeWtsShortSingles(blocks)
  blocks = collapseWtsToMaxBlocks(blocks, 2)
  return joinBlocks(blocks)
}

/**
 * Post-process body: demote H1s, then merge orphans in main body and separately
 * in WTS content. Runs before marker validation.
 */
function processArticleBody(body) {
  const text = demoteBodyH1(String(body || '').replace(/\r\n/g, '\n'))
  const startIdx = text.indexOf(WTS_START)
  const endIdx = text.indexOf(WTS_END)

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return mergeOrphanBlocks(text)
  }

  const before = text.slice(0, startIdx)
  const wtsInner = text.slice(startIdx + WTS_START.length, endIdx)
  const after = text.slice(endIdx + WTS_END.length)

  const mergedBefore = mergeOrphanBlocks(before)
  const mergedWts = mergeWtsBlocks(wtsInner)
  const beforePart = mergedBefore.replace(/\s+$/, '')
  const wtsBlock = `${WTS_START}\n${mergedWts}\n${WTS_END}`

  if (!beforePart) return `${wtsBlock}${after}`
  return `${beforePart}\n${wtsBlock}${after}`
}

function interpretGeneratedArticle(parsed, context) {
  const assignment = context.modelChoosesKeywords
    ? resolveKeywordAssignment(parsed?.frontmatter, context.keywordOptions)
    : null
  const pillar = assignment?.ok ? assignment.pillarKeyword : context.pillarKeyword
  const supporting = assignment?.ok ? assignment.supportingKeyword : context.supportingKeyword
  const target = assignment?.ok ? assignment.targetKeyword : context.article.targetKeyword
  const type = assignment?.ok ? assignment.articleType : context.article.type
  const whereThingsStandSources = extractWhereThingsStandSources(parsed?.frontmatter)
  const frontmatter = coerceFrontmatter(parsed?.frontmatter, {
    pillarKeyword: pillar,
    targetKeyword: target,
    supportingKeyword: supporting,
    articleType: type,
  })
  const articleBody = processArticleBody(String(parsed?.body || ''))
  const validationErrors = [
    ...(assignment && !assignment.ok ? assignment.errors : []),
    ...(assignment && !assignment.ok
      ? []
      : validateGeneratedArticle(frontmatter, articleBody, {
          competitors: context.competitors,
          competitorsMentioned: parsed?.frontmatter?.competitorsMentioned,
          ...(context.lengthBounds
            ? { length: { min: context.lengthBounds.min, max: context.lengthBounds.max } }
            : {}),
        })),
  ]
  return {
    whereThingsStandSources,
    frontmatter,
    articleBody,
    validationErrors,
    assignment: {
      pillarKeyword: pillar,
      supportingKeyword: supporting,
      targetKeyword: target,
      articleType: type,
    },
  }
}

function coerceFrontmatter(
  raw,
  { pillarKeyword, targetKeyword, supportingKeyword, articleType } = {}
) {
  const fm = raw && typeof raw === 'object' ? raw : {}
  const today = todayIsoDate()
  const pillar = stripNoVolumeTag(pillarKeyword)
  const supporting = stripNoVolumeTag(supportingKeyword)
  const target = stripNoVolumeTag(targetKeyword)
  const type = String(articleType || '').trim() || 'flex'
  const isPillar = type === 'comprehensive' && !supporting
  const effectiveTarget = isPillar ? pillar : target
  const enforcedSlug = slugify(effectiveTarget) || String(fm.slug || '').trim()

  const title = String(fm.title || '').trim()
  const frontmatter = {
    title,
    description: String(fm.description || '').trim(),
    slug: enforcedSlug,
    date: String(fm.date || '').trim() || today,
    updatedDate: String(fm.updatedDate || '').trim() || today,
    category: String(fm.category || '').trim() || pillar,
    pillarKeyword: pillar,
    articleType: type,
    targetKeyword: effectiveTarget,
    tags: asStringArray(fm.tags),
    imageAlt: String(fm.imageAlt || '').trim(),
    keywords: buildKeywords({
      targetKeyword: effectiveTarget,
      supportingKeyword: supporting,
      pillarKeyword: pillar,
    }),
    faqs: normalizeFaqs(fm.faqs),
    draft: true,
    author: null,
    internalLinks: [],
    externalLinks: [],
    image: null,
    image2: null,
    image3: null,
  }

  // h1 is soft: an unusable value is dropped (never retried) and seo-core
  // derives one from the title at build time.
  const h1 = cleanH1(fm.h1, title)
  if (h1) frontmatter.h1 = h1

  // Pillar hub articles have no supporting keyword — omit rather than empty string.
  if (supporting) {
    frontmatter.supportingKeyword = supporting
  }

  return frontmatter
}

function buildCorrectiveMessage(validationErrors) {
  return [
    'Your previous response failed validation. Resend the full article using the delimiter format only (no markdown fences, no preamble), fixing exactly these issues:',
    ...validationErrors.map((err) => `- ${err}`),
    '',
    'Keep the same article intent, Where Things Stand, and Key Takeaways section requirements. Count title and description characters carefully before sending.',
    'Output exactly:',
    `${FM_START}`,
    '{ ...frontmatter fields... }',
    `${BODY_START}`,
    '<markdown body>',
    `${BODY_END}`,
  ].join('\n')
}

function buildParseRecoveryMessage() {
  return [
    'Your previous response could not be parsed. Do not apologize or explain.',
    'Resend the COMPLETE article now using this exact delimiter format (no markdown fences, no preamble):',
    `${FM_START}`,
    '{ "title": "...", "h1": "...", "description": "...", "slug": "...", "date": "YYYY-MM-DD", "updatedDate": "YYYY-MM-DD", "category": "...", "tags": [], "imageAlt": "...", "keywords": [], "faqs": [{"question":"...","answer":"..."}], "draft": true, "author": null, "internalLinks": [], "externalLinks": [], "image": null, "image2": null, "image3": null, "whereThingsStandSources": [{"url":"...","note":"..."}], "competitorsMentioned": [] }',
    `${BODY_START}`,
    '<full markdown body including Where Things Stand markers and ## Key Takeaways with 3–5 bullets>',
    `${BODY_END}`,
  ].join('\n')
}

async function callAnthropic(anthropic, messages) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages,
  })

  if (message?.stop_reason === 'max_tokens') {
    const err = new Error(
      'Model response was truncated before finishing JSON. Try again.'
    )
    err.code = 'truncated'
    throw err
  }

  return message
}

export {
  buildKeywords,
  mergeOrphanBlocks,
  mergeWtsBlocks,
  processArticleBody,
  isOrphanBlock,
  isHorizontalRuleBlock,
  isStructuralBlock,
  normalizeWhereThingsStandSources,
  countKeyTakeawayBullets,
  validateGeneratedArticle,
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('Missing ANTHROPIC_API_KEY')
      return json(res, 500, { error: 'Server configuration error' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const mode = resolveMode(body.mode)
    if (!mode) {
      return json(res, 400, { error: "mode must be 'spec', 'idea', or 'modify'" })
    }

    const abstract = String(body.abstract || '').trim()
    const shortDescription = String(body.shortDescription || '').trim()
    const audience = String(body.audience || '').trim()
    let competitors = normalizeCompetitors(body.competitors)
    const pillarKeyword = String(body.pillarKeyword || '').trim()
    const supportingKeyword = String(body.supportingKeyword || '').trim()
    const keywordOptions = normalizeKeywordOptions(body.keywordOptions)
    const batchContext = normalizeBatchContext(body.batchContext)
    const article = normalizeArticleSpec(body.article)
    let sourceArticle = ''
    let expand = false
    let userLinks = null

    if (mode === 'idea' || mode === 'modify') {
      competitors = mergeAllowedBrands(competitors, body.allowedBrands)
      userLinks = normalizeUserLinks(body.userLinks)
    }
    if (mode === 'modify') {
      if (typeof body.sourceArticle !== 'string') {
        return json(res, 400, { error: 'sourceArticle must be a markdown string' })
      }
      if (body.sourceArticle.length > SOURCE_ARTICLE_MAX_CHARS) {
        return json(res, 400, { error: 'sourceArticle exceeds 40000 characters' })
      }
      if (countWords(body.sourceArticle) < SOURCE_ARTICLE_MIN_WORDS) {
        return json(res, 400, {
          error: 'sourceArticle must contain at least 300 words',
        })
      }
      sourceArticle = body.sourceArticle
      expand = body.expand === true
    }

    const modelChoosesKeywords =
      mode === 'modify' &&
      keywordOptions.length > 0 &&
      !(pillarKeyword && supportingKeyword && article.targetKeyword)

    if (!modelChoosesKeywords && !article.title && !article.targetKeyword) {
      return json(res, 400, { error: 'article title or targetKeyword is required' })
    }
    if (!modelChoosesKeywords && !pillarKeyword) {
      return json(res, 400, { error: 'pillarKeyword is required' })
    }

    const promptInput = {
      abstract,
      shortDescription,
      competitors,
      audience,
      article,
      pillarKeyword,
      supportingKeyword,
      batchContext,
    }
    const lengthBounds =
      mode === 'modify'
        ? modifyMainBodyBounds({
            sourceArticle,
            expand,
            wordCount: article.wordCount,
          })
        : null
    const prompt =
      mode === 'modify'
        ? buildModifyPrompt({
            ...promptInput,
            sourceArticle,
            expand,
            keywordOptions: modelChoosesKeywords ? keywordOptions : [],
          })
        : buildUserPrompt(promptInput)

    const anthropic = new Anthropic({ apiKey })
    let activeMessage = await callAnthropic(anthropic, [
      { role: 'user', content: prompt },
    ])

    let parsed
    try {
      parsed = parseArticleFromContent(activeMessage?.content)
    } catch (err) {
      const preview = extractTextBlocks(activeMessage?.content)
        .join('\n')
        .slice(0, 800)
      console.error('generate-article parse failed (attempting recovery):', err, preview)

      // One recovery turn: ask for delimiter-format resend in the same conversation.
      try {
        activeMessage = await callAnthropic(anthropic, [
          { role: 'user', content: prompt },
          { role: 'assistant', content: activeMessage.content },
          { role: 'user', content: buildParseRecoveryMessage() },
        ])
        parsed = parseArticleFromContent(activeMessage?.content)
      } catch (recoveryErr) {
        const recoveryPreview = extractTextBlocks(activeMessage?.content)
          .join('\n')
          .slice(0, 800)
        console.error(
          'generate-article parse recovery failed:',
          recoveryErr,
          recoveryPreview
        )
        const msg =
          recoveryErr?.code === 'truncated'
            ? recoveryErr.message
            : 'Failed to parse model response. Try Retry — the model likely truncated or wrapped the article incorrectly.'
        return json(res, 502, { error: msg })
      }
    }

    const interpretContext = {
      modelChoosesKeywords,
      keywordOptions,
      pillarKeyword,
      supportingKeyword,
      article,
      competitors,
      lengthBounds,
    }
    let interpreted = interpretGeneratedArticle(parsed, interpretContext)
    let { whereThingsStandSources, frontmatter, articleBody, validationErrors, assignment } =
      interpreted
    let lengthAdjusted = false

    // Up to 2 corrective retries (3 total generation attempts).
    const MAX_CORRECTIVE_RETRIES = 2
    for (
      let attempt = 0;
      validationErrors.length > 0 && attempt < MAX_CORRECTIVE_RETRIES;
      attempt += 1
    ) {
      const corrective = buildCorrectiveMessage(validationErrors)
      try {
        activeMessage = await callAnthropic(anthropic, [
          { role: 'user', content: prompt },
          { role: 'assistant', content: activeMessage.content },
          { role: 'user', content: corrective },
        ])
      } catch (err) {
        if (err?.code === 'truncated') {
          return json(res, 502, { error: err.message, validationErrors })
        }
        throw err
      }

      try {
        parsed = parseArticleFromContent(activeMessage?.content)
        interpreted = interpretGeneratedArticle(parsed, interpretContext)
        ;({ whereThingsStandSources, frontmatter, articleBody, validationErrors, assignment } =
          interpreted)
      } catch (err) {
        console.error('generate-article corrective parse failed:', err)
        return json(res, 422, {
          error: 'Corrective response failed validation parse',
          validationErrors,
        })
      }
    }

    // Deterministic title/description length fallback after all retries.
    if (validationErrors.length > 0 && !validationErrors.some((item) => /pillarKeyword|supportingKeyword|targetKeyword|articleType/.test(item))) {
      const fallback = applyLengthFallbacks(frontmatter, {
        targetKeyword: assignment.targetKeyword || article.targetKeyword,
        category: frontmatter.category || assignment.pillarKeyword || pillarKeyword,
      })
      if (fallback.changed) {
        frontmatter = fallback.frontmatter
        lengthAdjusted = true
        validationErrors = validateGeneratedArticle(frontmatter, articleBody, {
          competitors,
          competitorsMentioned: parsed?.frontmatter?.competitorsMentioned,
          ...(lengthBounds
            ? { length: { min: lengthBounds.min, max: lengthBounds.max } }
            : {}),
        })
      }
    }

    if (validationErrors.length > 0) {
      return json(res, 422, {
        error: 'Generated article failed validation',
        validationErrors,
      })
    }

    return json(res, 200, {
      frontmatter,
      body: articleBody,
      whereThingsStandSources,
      mode,
      ...(lengthAdjusted ? { lengthAdjusted: true } : {}),
      ...(userLinks ? { userLinks } : {}),
      ...(mode === 'modify'
        ? {
            mainBodyWordCount: countMainBodyWords(articleBody),
            sourceWordCount: lengthBounds.sourceWordCount,
            assignment,
          }
        : {}),
    })
  } catch (err) {
    console.error('generate-article error:', err)
    if (err?.code === 'truncated') {
      return json(res, 502, { error: err.message })
    }
    const message =
      err?.error?.message || err?.message || 'Failed to generate article'
    return json(res, 502, { error: String(message) })
  }
}
