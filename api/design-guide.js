import Anthropic from '@anthropic-ai/sdk'
import { buildLayer2Tokens } from './_designGuideTemplate.js'

export const config = {
  maxDuration: 120,
}

const MODEL = 'claude-sonnet-4-6'
const HEX_RE = /^#[0-9A-Fa-f]{6}$/

const TOKEN_DEFS = [
  { posted: 'brand_feel', json: 'feel', required: true },
  { posted: 'brand_accent', json: 'accent', required: true, hex: true },
  { posted: 'brand_band', json: 'band', required: true, hex: true },
  { posted: 'brand_positive', json: 'positive', required: true, hex: true },
  { posted: 'wordmark_primary', json: 'wordmark_primary', required: true },
  { posted: 'wordmark_accent', json: 'wordmark_accent', required: false },
  { posted: 'brand_voice', json: 'voice', required: true },
]

const TNV_HOUSE_RULES = `LOCKED — TNV HOUSE RULES (apply to every brand):
- Typography: Inter only. Never bold — weights 400–500 max. Hierarchy via size/color/spacing, not weight.
- Light mode only. Bright, content-forward. No dark sites.
- Motion: smooth transition/morph as a signature, applied with discipline (entrances + interactions, not everything). Respect prefers-reduced-motion.
- Standard component: collapsible panels with a chevron that open/close smoothly (accordion).
- Accessibility: WCAG AA contrast, min ~16px body, visible keyboard focus.
- Responsive down to mobile; consistent breakpoints.
- Readable measure ~65–75 chars for body/content.
- Performance: no heavy hero video by default; sensible image sizing (content/SEO sites).
- Image treatment: standard aspect ratios, a corner-radius token, never bake text into images.`

const GUIDE_SECTIONS = [
  '1. Brand tokens',
  '2. Principles',
  '3. Color',
  '4. Typography',
  '5. Layout',
  '6. Motion',
  '7. Components',
  '8. Page recipes',
  '9. Voice',
  '10. Never',
]

const SUGGEST_SYSTEM = `You propose seed brand tokens for one company. A later step authors the full Design Guide (palette, type scale, layout, spacing, motion, imagery) inside locked house rules. You only fill the missing seed tokens.

Return ONLY a JSON object. No preamble, no markdown, no keys other than the ones the user listed as missing.

The site is light mode only: bright and content-forward. Do not propose a near-black page background.

Constraints:
- feel is not yours to set.
- accent, band, positive: 6-digit hex strings starting with # (e.g. "#3A7D5E"). The three colors must be visibly different and specific to this brand.
- accent: primary brand color for links and focus. It must reach WCAG AA against white (#FFFFFF).
- band: a featured-section color on a light site, not the page background. Pair it with a text color that reaches WCAG AA — white on a deep band, or near-black on a light band.
- positive: a color for gain / included / success marks. Not neon, and not the same hue as accent.
- wordmark_primary / wordmark_accent: split the brand name into two natural parts. If it cannot be split naturally, wordmark_primary is the full name and wordmark_accent is "".
- voice: at most 120 words of brand-specific do/don't. Short declaratives. No emoji, no hype.

Do not write the Design Guide. Do not invent a type scale, spacing system, or motion language here.`

const GENERATE_SYSTEM = `You author the Design Guide markdown for ONE brand. A human and Cursor will paste it in to build the site. Be concrete and implementable: real hex values, px spacing, Tailwind classes, and Framer Motion snippets. Do not write vague mood language unless you also give the values that implement it.

Design strictly inside these house rules. Do not contradict them. Do not repeat this block — it is inserted above your sections verbatim.

${TNV_HOUSE_RULES}

Because Inter, no bold, and light mode are fixed, make this brand distinct with COLOR, LAYOUT, SPACING, and IMAGERY.

Length: finish every section, but do not pad. One code sample per pattern. Prefer tables over long prose.

FIXED SKELETON — output only these headings, in this order, with no preamble and no extra top-level sections:

${GUIDE_SECTIONS.map((title) => `## ${title}`).join('\n')}

Seed tokens are already chosen. Use those exact hex values and names. Do not change them. Build a fuller palette, type scale, and layout around them.

Section requirements:
1. Brand tokens — list BRAND_NAME, DOMAIN, FEEL, ACCENT, BAND, POSITIVE, and the wordmark split using the exact values given. Then list every additional token later sections will use.
2. Principles — 4–6 principles specific to this brand, still inside the house rules.
3. Color — a table of token, hex, and use. Light page surfaces. Call out WCAG AA pairs. Include the seed accent, band, and positive unchanged, plus the rest of the palette.
4. Typography — Inter only. Weights 400 or 500 only. A table of role, size, line-height, color, and Tailwind. Body at least 16px. Measure about 65–75 characters. Never prescribe font-bold, font-semibold, font-black, or a weight above 500.
5. Layout — container, grid, named breakpoints used consistently, section spacing, nav, and footer. Mobile through desktop.
6. Motion — one signature smooth transition or morph, used with discipline (entrances and interactions, not everything). Include Framer Motion snippets and a prefers-reduced-motion rule.
7. Components — concrete Tailwind for buttons, cards, inputs, images (standard aspect ratios, the corner-radius token, never bake text into images), and a collapsible panel with a chevron that opens and closes smoothly.
8. Page recipes — home and one inner page, with section order and which components they use.
9. Voice — use the provided voice notes, and say how headlines, labels, and body should sound for this brand.
10. Never — brand-specific refusals, plus anything that would break the house rules (bold type, dark mode, heavy hero video, text baked into images).

Output markdown only. Do not wrap the document in a code fence.`

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
}

function resolveAction(req, body) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const fromQuery = url.searchParams.get('action')
    if (fromQuery) return String(fromQuery).trim()
  } catch {
    // ignore
  }
  if (body?.action) return String(body.action).trim()
  return ''
}

function unwrapMarkdown(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return cleaned
}

function unwrapJson(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  cleaned = cleaned.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  return cleaned
}

function extractFirstJsonObject(text) {
  const source = String(text || '')
  const start = source.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

const TOKEN_JSON_PROPERTIES = {
  feel: { type: 'string', description: 'One sentence.' },
  accent: { type: 'string', description: '6-digit hex starting with #. Primary brand color for links and focus. WCAG AA on white.' },
  band: { type: 'string', description: '6-digit hex starting with #. Featured-section color on a light site, not the page background.' },
  positive: { type: 'string', description: '6-digit hex starting with #. Gain / included / success color, distinct from accent.' },
  wordmark_primary: { type: 'string', description: 'First part of the brand name, or the full name' },
  wordmark_accent: { type: 'string', description: 'Second part of the brand name, or empty string' },
  voice: { type: 'string', description: 'At most 120 words of do/don\'t voice notes' },
}

function tokenFillTool(missingKeys) {
  const keys = missingKeys.filter((key) => TOKEN_JSON_PROPERTIES[key])
  return {
    name: 'set_brand_tokens',
    description: 'Set the missing brand tokens for the design system.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(keys.map((key) => [key, TOKEN_JSON_PROPERTIES[key]])),
      required: keys,
    },
  }
}

function parseSuggestedTokens(message) {
  const toolBlock = Array.isArray(message?.content)
    ? message.content.find(
        (block) => block?.type === 'tool_use' && block?.name === 'set_brand_tokens'
      )
    : null
  if (toolBlock && toolBlock.input && typeof toolBlock.input === 'object') {
    return toolBlock.input
  }

  const raw = unwrapJson(unwrapMarkdown(textFromMessage(message)))
  const extracted = extractFirstJsonObject(raw) || raw
  if (!extracted) return null
  try {
    const parsed = JSON.parse(extracted)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function textFromMessage(message) {
  const textBlock = Array.isArray(message?.content)
    ? message.content.find((block) => block?.type === 'text')
    : null
  return String(textBlock?.text || '').trim()
}

const ABSTRACT_SYSTEM =
  "Read this project's full Design Guide document. Produce a concise Design Guide Abstract (2-4 paragraphs) that captures: the brand's core visual identity (color palette — name actual hex/color values if present in the source, typography choices, and overall aesthetic/tone in a few descriptive words), and any distinctive visual patterns or motifs worth reusing in derivative brand assets (e.g. graphics, cards, social images). Write it for reuse as context in future AI generation tasks — specific and concrete (real color values, real font names), not vague marketing language. Respond with only the abstract text, no preamble, no markdown headers."

function asText(value) {
  return String(value ?? '').trim()
}

export function stripDomain(domain) {
  let host = asText(domain)
  host = host.replace(/^https?:\/\//i, '')
  host = host.replace(/^www\./i, '')
  host = host.replace(/\/.*$/, '')
  return host
}

export function isHexColor(value) {
  return HEX_RE.test(asText(value))
}

function postedTokens(company) {
  return {
    brand_feel: asText(company.brand_feel),
    brand_accent: asText(company.brand_accent),
    brand_band: asText(company.brand_band),
    brand_positive: asText(company.brand_positive),
    wordmark_primary: asText(company.wordmark_primary),
    wordmark_accent: asText(company.wordmark_accent),
    brand_voice: asText(company.brand_voice),
  }
}

function missingTokenKeys(tokens) {
  return TOKEN_DEFS.filter((def) => {
    if (def.posted === 'brand_feel') return false
    if (def.posted === 'wordmark_accent') {
      return !tokens.wordmark_primary
    }
    return !tokens[def.posted]
  }).map((def) => def.json)
}

function applySuggested(tokens, suggested) {
  const next = { ...tokens }
  if (!suggested || typeof suggested !== 'object' || Array.isArray(suggested)) {
    return next
  }
  for (const def of TOKEN_DEFS) {
    const incoming = suggested[def.json]
    if (incoming == null) continue
    if (def.posted === 'brand_feel') continue
    if (def.posted === 'wordmark_accent') {
      if (tokens.wordmark_primary) continue
      next.wordmark_accent = asText(incoming)
      continue
    }
    if (tokens[def.posted]) continue
    next[def.posted] = asText(incoming)
  }
  return next
}

function invalidHexFields(tokens) {
  return TOKEN_DEFS.filter((def) => def.hex && tokens[def.posted] && !isHexColor(tokens[def.posted]))
    .map((def) => def.posted)
}

function toRenderTokens(company, tokens) {
  const brandName = asText(company.product_name) || asText(company.name)
  return {
    BRAND_NAME: brandName,
    DOMAIN: stripDomain(company.domain),
    FEEL: tokens.brand_feel,
    ACCENT: tokens.brand_accent,
    BAND: tokens.brand_band,
    POSITIVE: tokens.brand_positive,
    WORDMARK_PRIMARY: tokens.wordmark_primary,
    WORDMARK_ACCENT: tokens.wordmark_accent,
    VOICE: tokens.brand_voice,
  }
}

function responseTokens(company, tokens) {
  const rendered = toRenderTokens(company, tokens)
  return {
    brand_name: rendered.BRAND_NAME,
    domain: rendered.DOMAIN,
    brand_feel: tokens.brand_feel,
    brand_accent: tokens.brand_accent,
    brand_band: tokens.brand_band,
    brand_positive: tokens.brand_positive,
    wordmark_primary: tokens.wordmark_primary,
    wordmark_accent: tokens.wordmark_accent,
    brand_voice: tokens.brand_voice,
  }
}

function companyContext(company) {
  return {
    name: asText(company.name),
    product_name: asText(company.product_name),
    domain: stripDomain(company.domain),
    abstract: asText(company.abstract),
    short_description: asText(company.short_description),
    medium_description: asText(company.medium_description),
    long_description: asText(company.long_description),
    target_audience: asText(company.target_audience),
    business_model: asText(company.business_model),
    core_value_proposition: asText(company.core_value_proposition),
    scope_boundaries: asText(company.scope_boundaries),
    services: company.services,
    team_members: company.team_members,
    competitors: company.competitors,
  }
}

async function handleAbstract(req, res, body, apiKey) {
  const raw = String(body.raw || '').trim()
  if (!raw) {
    return json(res, 400, { error: 'raw is required' })
  }

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: ABSTRACT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Design Guide document:\n\n${raw}`,
      },
    ],
  })

  if (message?.stop_reason === 'max_tokens') {
    console.error('design-guide abstract truncated at max_tokens')
    return json(res, 502, {
      error: 'Model response was truncated. Try again with a shorter Design Guide.',
    })
  }

  const abstract = textFromMessage(message)
  if (!abstract) {
    return json(res, 502, { error: 'No text content in Anthropic response' })
  }

  return json(res, 200, { abstract })
}

async function suggestMissingTokens(apiKey, company, tokens, missingKeys) {
  const anthropic = new Anthropic({ apiKey })
  const alreadySet = {}
  for (const def of TOKEN_DEFS) {
    if (!missingKeys.includes(def.json) && (def.posted !== 'wordmark_accent' || tokens.wordmark_primary)) {
      alreadySet[def.json] = tokens[def.posted]
    }
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.3,
    system: SUGGEST_SYSTEM,
    tools: [tokenFillTool(missingKeys)],
    tool_choice: { type: 'tool', name: 'set_brand_tokens' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              'Propose brand tokens for this company.',
              `Fill these missing keys: ${missingKeys.join(', ')}.`,
              '',
              'Company data:',
              JSON.stringify(companyContext(company), null, 2),
              '',
              'Already set (do not repeat or change):',
              JSON.stringify(alreadySet, null, 2),
            ].join('\n'),
          },
        ],
      },
    ],
  })

  if (message?.stop_reason === 'max_tokens') {
    console.error('design-guide generate truncated at max_tokens')
    throw Object.assign(new Error('Model response was truncated. Try generating again.'), {
      statusCode: 502,
    })
  }

  const parsed = parseSuggestedTokens(message)
  if (!parsed) {
    console.error('design-guide generate: unusable token payload', textFromMessage(message))
    throw Object.assign(new Error('Model did not return valid brand tokens. Try generating again.'), {
      statusCode: 502,
    })
  }

  const merged = applySuggested(tokens, parsed)
  const stillMissing = missingTokenKeys(merged)
  if (stillMissing.length > 0) {
    console.error('design-guide generate: omitted tokens', stillMissing)
    throw Object.assign(
      new Error(`Model omitted required tokens: ${stillMissing.join(', ')}`),
      { statusCode: 502 }
    )
  }
  return merged
}

function tokenFence(tokens) {
  const json = JSON.stringify(
    buildLayer2Tokens({
      accent: tokens.brand_accent,
      positive: tokens.brand_positive,
    }),
    null,
    2
  )
  return '```tokens\n' + json + '\n```'
}

function houseRulesSection() {
  return [
    '## TNV House Rules',
    '',
    TNV_HOUSE_RULES,
    '',
    'These rules are locked. They override the tokens fence when they conflict: use Inter (not the fence font stack), body text at least 16px, font weight 400 or 500 only, and a light page.',
    '',
  ].join('\n')
}

function normalizeAuthored(text) {
  let body = unwrapMarkdown(text).replace(/\r\n/g, '\n')
  body = body.replace(/^#\s+Design Guide\s*/i, '').trim()
  const sectionStart = body.search(/^##\s+1\.\s+Brand tokens\s*$/im)
  if (sectionStart > 0) body = body.slice(sectionStart).trim()
  const lines = body.split('\n').map((line) => {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (!match) return line
    const found = GUIDE_SECTIONS.find(
      (title) => title.toLowerCase() === match[1].toLowerCase()
    )
    return found ? `## ${found}` : line
  })
  return lines.join('\n').trim()
}

function missingSections(body) {
  let cursor = 0
  const missing = []
  for (const title of GUIDE_SECTIONS) {
    const heading = `## ${title}`
    const at = body.indexOf(heading, cursor)
    if (at < 0) missing.push(title)
    else cursor = at + heading.length
  }
  return missing
}

function guideProblems(body, tokens) {
  const problems = []
  const missing = missingSections(body)
  if (missing.length > 0) {
    problems.push(`missing or mis-ordered sections: ${missing.join(', ')}`)
  }
  for (const hex of [tokens.brand_accent, tokens.brand_band, tokens.brand_positive]) {
    if (hex && !body.toLowerCase().includes(hex.toLowerCase())) {
      problems.push(`seed color ${hex} missing`)
    }
  }
  if (tokens.wordmark_primary && !body.includes(tokens.wordmark_primary)) {
    problems.push('wordmark_primary missing')
  }
  if (!/\bInter\b/.test(body)) problems.push('Typography must specify Inter')
  if (!/prefers-reduced-motion/.test(body)) {
    problems.push('Motion must include prefers-reduced-motion')
  }
  if (!/chevron/i.test(body)) {
    problems.push('Components must include a chevron collapsible panel')
  }
  if (!/font-bold|font-semibold|font-black|weight above 500|never bold/i.test(body)) {
    problems.push('Typography or Never must forbid bold weights')
  }
  if (!/#[0-9A-Fa-f]{6}/.test(body)) problems.push('Color must include hex values')
  if (!/rounded-|px-|max-w-|text-\[|gap-/.test(body)) {
    problems.push('Include Tailwind classes')
  }
  if (!/motion\.|framer-motion|whileInView|animate=/.test(body)) {
    problems.push('Include a Framer Motion snippet')
  }
  return problems
}

function authorUserPrompt(company, tokens, reminder) {
  const rendered = toRenderTokens(company, tokens)
  const lines = []
  if (reminder) {
    lines.push(
      `Your previous draft failed these checks: ${reminder}.`,
      'Output the full 10-section skeleton again, and fix only those checks.',
      ''
    )
  }
  lines.push(
    'Author the Design Guide sections for this company.',
    '',
    'Seed tokens (use these exact values; do not change the hex codes):',
    JSON.stringify(
      {
        BRAND_NAME: rendered.BRAND_NAME,
        DOMAIN: rendered.DOMAIN,
        FEEL: rendered.FEEL || '(not set — write one sentence from the company data)',
        ACCENT: rendered.ACCENT,
        BAND: rendered.BAND,
        POSITIVE: rendered.POSITIVE,
        WORDMARK_PRIMARY: rendered.WORDMARK_PRIMARY,
        WORDMARK_ACCENT: rendered.WORDMARK_ACCENT,
        VOICE: rendered.VOICE,
      },
      null,
      2
    ),
    '',
    'Company data:',
    JSON.stringify(companyContext(company), null, 2)
  )
  return lines.join('\n')
}

async function requestAuthoredGuide(apiKey, company, tokens, reminder) {
  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    temperature: 0.7,
    system: GENERATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: authorUserPrompt(company, tokens, reminder),
      },
    ],
  })

  const authored = normalizeAuthored(textFromMessage(message))
  if (!authored) {
    throw Object.assign(new Error('Model did not return a Design Guide. Try generating again.'), {
      statusCode: 502,
    })
  }

  if (message?.stop_reason === 'max_tokens' && guideProblems(authored, tokens).length > 0) {
    console.error('design-guide generate: authored guide truncated at max_tokens')
    throw Object.assign(
      new Error('Model response was truncated before the guide was complete. Try generating again.'),
      { statusCode: 502 }
    )
  }

  return authored
}

async function authorDesignGuide(apiKey, company, tokens) {
  let reminder = ''
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const authored = await requestAuthoredGuide(apiKey, company, tokens, reminder)
      const problems = guideProblems(authored, tokens)
      if (problems.length === 0) return authored
      console.error('design-guide generate: draft failed checks', problems)
      reminder = problems.join('; ')
      lastError = null
    } catch (err) {
      if (!err.statusCode) throw err
      lastError = err
      reminder =
        'The previous draft was cut off. Write a complete, tighter guide: one snippet per pattern, all 10 sections, no repeated explanation.'
      console.error('design-guide generate: author attempt failed', err.message)
    }
  }
  throw (
    lastError ||
    Object.assign(new Error('Model did not return a complete Design Guide. Try generating again.'), {
      statusCode: 502,
    })
  )
}

function assembleDesignGuide(tokens, authored) {
  return `# Design Guide\n\n${tokenFence(tokens)}\n\n${houseRulesSection()}\n${authored.trim()}\n`
}

async function handleGenerate(req, res, body, apiKey) {
  const company = body.company

  if (!company || typeof company !== 'object' || Array.isArray(company)) {
    return json(res, 400, { error: 'company must be an object' })
  }

  let tokens = postedTokens(company)
  const missingKeys = missingTokenKeys(tokens)

  if (missingKeys.length === 0) {
    console.log('design-guide generate: skipped token suggestion (all tokens set)')
  } else {
    console.log('design-guide generate: calling LLM for missing tokens', missingKeys)
    if (!apiKey) {
      console.error('Missing ANTHROPIC_API_KEY')
      return json(res, 500, { error: 'Server configuration error' })
    }
    try {
      tokens = await suggestMissingTokens(apiKey, company, tokens, missingKeys)
    } catch (err) {
      const status = err.statusCode || 500
      return json(res, status, { error: err.message || 'Failed to suggest tokens' })
    }
  }

  const badHex = invalidHexFields(tokens)
  if (badHex.length > 0) {
    console.error(
      'design-guide generate: invalid hex',
      badHex.map((key) => ({ key, value: tokens[key] }))
    )
    return json(res, 502, {
      error: `Invalid hex token (expected #RRGGBB): ${badHex.join(', ')}`,
    })
  }

  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY')
    return json(res, 500, { error: 'Server configuration error' })
  }

  let authored
  try {
    console.log('design-guide generate: authoring guide')
    authored = await authorDesignGuide(apiKey, company, tokens)
  } catch (err) {
    const status = err.statusCode || 500
    return json(res, status, { error: err.message || 'Failed to author Design Guide' })
  }

  const markdown = assembleDesignGuide(tokens, authored)
  return json(res, 200, {
    markdown,
    tokens: responseTokens(company, tokens),
  })
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
    const body = parseBody(req)
    const action = resolveAction(req, body)

    if (action === 'abstract') {
      if (!apiKey) {
        console.error('Missing ANTHROPIC_API_KEY')
        return json(res, 500, { error: 'Server configuration error' })
      }
      return await handleAbstract(req, res, body, apiKey)
    }
    if (action === 'generate') {
      return await handleGenerate(req, res, body, apiKey)
    }

    return json(res, 400, {
      error: 'action is required (abstract | generate)',
    })
  } catch (err) {
    console.error('design-guide error:', err)
    const message =
      err?.error?.message || err?.message || 'Unexpected server error'
    return json(res, 500, { error: String(message) })
  }
}
