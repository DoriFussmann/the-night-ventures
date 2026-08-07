const NAV_BRAND_PATTERNS = [
  /\b(login|log in|sign in|signin|sign up|signup|register|download app|official site|customer service|near me)\b/i,
  /\b(facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|reddit|pinterest|wikipedia)\b/i,
  /\b(amazon|ebay|walmart|craigslist|etsy|shopify)\b/i,
  /\.(com|net|org|io)\b/i,
  /\bwww\./i,
]

const MALFORMED_PATTERNS = [
  /(.)\1{4,}/, // aaaaa
  /[^\w\s'"&+\-./?]/, // odd symbols
  /^\d+$/,
  /\b(a to z|0-9|vs\.?\s*vs)\b/i,
]

/**
 * Deterministic junk filters before audience/intent LLM pass.
 * @returns {{ keep: object[], dropped: { keyword: string, reason: string }[] }}
 */
export function applyHeuristicFilters(rows) {
  const keep = []
  const dropped = []
  const seen = new Set()

  for (const row of rows) {
    const keyword = String(row?.keyword || '').trim()
    const norm = keyword.toLowerCase().replace(/\s+/g, ' ')
    if (!keyword || !norm) {
      dropped.push({ keyword, reason: 'empty' })
      continue
    }
    if (seen.has(norm)) {
      dropped.push({ keyword, reason: 'duplicate' })
      continue
    }
    seen.add(norm)

    if (norm.length < 3 || norm.split(' ').length > 12) {
      dropped.push({ keyword, reason: 'malformed_length' })
      continue
    }
    if (MALFORMED_PATTERNS.some((re) => re.test(norm))) {
      dropped.push({ keyword, reason: 'malformed' })
      continue
    }
    if (NAV_BRAND_PATTERNS.some((re) => re.test(norm))) {
      dropped.push({ keyword, reason: 'navigational_or_brand' })
      continue
    }
    // Misspelling / aggregate: unusual punctuation density or glued tokens.
    if (/[a-z]{20,}/i.test(norm.replace(/\s/g, '')) && !norm.includes(' ')) {
      dropped.push({ keyword, reason: 'malformed_aggregate' })
      continue
    }

    keep.push({ ...row, keyword })
  }

  return { keep, dropped }
}

function stripMarkdownFences(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return cleaned
}

/**
 * Audience + buyer-intent filter via Anthropic. Falls back to input on failure.
 */
export async function applyAudienceFilter(rows, {
  keyword,
  pillarKeyword = '',
  audienceFilter = '',
  apiKey,
}) {
  if (!rows.length) return { keep: [], dropped: [], usedLlm: false }
  if (!apiKey || !String(audienceFilter || '').trim()) {
    return { keep: rows, dropped: [], usedLlm: false }
  }

  const compact = rows.map((r) => ({
    keyword: r.keyword,
    volume: r.searchVolume,
    cpc: r.cpc,
  }))

  const system = `You filter SEO keyword research rows for content planning.
Keep only keywords a buyer matching the audience description would plausibly search while researching the target keyword / pillar topic.
EXCLUDE:
- wrong-buyer-intent (audience is selling TO someone; drop queries from the opposite side of the market, unrelated industries, loans/grants/jobs unless audience is about those)
- navigational/brand/site-name junk
- misspellings and malformed aggregates
- keywords that clearly leave the pillar/supporting keyword territory

Return ONLY strict JSON: {"keep":["exact keyword strings to keep"]}
Copy keywords exactly from the input list. Prefer keeping useful long-tail variants in-territory.`

  const userPayload = {
    targetKeyword: keyword,
    pillarKeyword: pillarKeyword || null,
    audienceFilter,
    candidates: compact,
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: JSON.stringify(userPayload) }],
          },
        ],
      }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      throw new Error(data?.error?.message || `Anthropic HTTP ${res.status}`)
    }
    const text =
      Array.isArray(data?.content)
        ? [...data.content].reverse().find((b) => b?.type === 'text')?.text
        : null
    if (!text) throw new Error('No text in Anthropic filter response')

    const parsed = JSON.parse(stripMarkdownFences(text))
    const keepSet = new Set(
      (Array.isArray(parsed?.keep) ? parsed.keep : [])
        .map((k) => String(k || '').trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean)
    )

    // If the model returns nothing usable, keep heuristics result.
    if (keepSet.size === 0) {
      return { keep: rows, dropped: [], usedLlm: true, warning: 'LLM keep list empty — kept heuristic set' }
    }

    const keep = []
    const dropped = []
    for (const row of rows) {
      const norm = row.keyword.toLowerCase().replace(/\s+/g, ' ')
      if (keepSet.has(norm)) keep.push(row)
      else dropped.push({ keyword: row.keyword, reason: 'audience_or_intent' })
    }
    return { keep, dropped, usedLlm: true }
  } catch (err) {
    return {
      keep: rows,
      dropped: [],
      usedLlm: false,
      warning: `Audience filter skipped: ${err.message || String(err)}`,
    }
  }
}
