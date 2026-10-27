/**
 * "Where Things Stand" freshness check: ask the model (with web search) whether
 * the paragraph needs updating. Shared by the live-article update route and the
 * scheduled publisher (which refreshes drafts that waited too long).
 */
export const MODEL = 'claude-sonnet-4-6'
export const MAX_TOKENS = 4000

const TASK_INSTRUCTION = `Search for genuine news, data, or developments related to the targetKeyword / pillarKeyword from the past 45 days. Here is the article's CURRENT 'Where Things Stand' paragraph (extracted from the live published page). If you find substantive, genuinely new information not already reflected in the current paragraph, draft a replacement paragraph (100-150 words, same tone/style as the current one). If you find nothing substantive or new since the current paragraph was likely written, respond that no update is warranted — do not force a rewrite for the sake of it. Also list any source URLs actually used for new information (title + URL), separately from the paragraph itself.

Respond ONLY with valid JSON, no markdown fences:
{ "updateWarranted": boolean, "currentParagraph": string, "proposedParagraph": string | null, "newSources": [{ "title": string, "url": string }], "reasoning": string }`

function stripMarkdownFences(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  cleaned = cleaned.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
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

function looksLikeUpdateResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof value.updateWarranted === 'boolean' || typeof value.reasoning === 'string'
}

function parseModelJson(text) {
  const cleaned = stripMarkdownFences(text)

  try {
    const direct = JSON.parse(cleaned)
    if (looksLikeUpdateResult(direct)) return direct
  } catch {
    // Fall through.
  }

  const objects = extractBalancedJsonObjects(cleaned)
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(objects[i])
      if (looksLikeUpdateResult(parsed)) return parsed
    } catch {
      // Try earlier candidates.
    }
  }

  throw new Error('No valid update JSON found in model response')
}

function extractTextBlocks(content) {
  if (!Array.isArray(content)) return []
  return content
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => String(block.text))
}

export function extractTextContent(content) {
  return extractTextBlocks(content).join('\n').trim()
}

export function parseUpdateFromContent(content) {
  const texts = extractTextBlocks(content)
  if (!texts.length) {
    throw new Error('No text content in Anthropic response')
  }

  const candidates = [texts[texts.length - 1], texts.join('\n')]
  let lastError = null

  for (const candidate of candidates) {
    try {
      return parseModelJson(candidate)
    } catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('Failed to parse model response as JSON')
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      title: String(item.title || '').trim(),
      url: String(item.url || '').trim(),
    }))
    .filter((item) => item.title || item.url)
}

export function normalizeResult(parsed, currentParagraph) {
  const updateWarranted = Boolean(parsed?.updateWarranted)
  const proposedRaw =
    parsed?.proposedParagraph == null ? null : String(parsed.proposedParagraph).trim()

  return {
    updateWarranted,
    currentParagraph: String(parsed?.currentParagraph || currentParagraph || '').trim(),
    proposedParagraph: updateWarranted && proposedRaw ? proposedRaw : null,
    newSources: updateWarranted ? normalizeSources(parsed?.newSources) : [],
    reasoning: String(parsed?.reasoning || '').trim() ||
      (updateWarranted
        ? 'Update warranted based on recent developments.'
        : 'No substantive developments found in the past 45 days.'),
  }
}

export function buildUserPrompt({ publishedUrl, targetKeyword, pillarKeyword, currentParagraph }) {
  return [
    `publishedUrl: ${publishedUrl}`,
    `targetKeyword: ${targetKeyword}`,
    `pillarKeyword: ${pillarKeyword}`,
    '',
    'CURRENT WHERE THINGS STAND PARAGRAPH:',
    currentParagraph,
    '',
    TASK_INSTRUCTION,
  ].join('\n')
}


/**
 * @returns normalized result { updateWarranted, proposedParagraph, newSources, reasoning }
 */
export async function proposeWtsUpdate({ anthropic, publishedUrl, targetKeyword, pillarKeyword, currentParagraph }) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content: buildUserPrompt({ publishedUrl, targetKeyword, pillarKeyword, currentParagraph }),
      },
    ],
  })
  if (message?.stop_reason === 'max_tokens') throw new Error('Model response was truncated')
  const result = normalizeResult(parseUpdateFromContent(message?.content), currentParagraph)
  result.currentParagraph = currentParagraph
  return result
}
