function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MODEL = 'claude-sonnet-5'
const LOCATION_CODE = 2840
const LANGUAGE_CODE = 'en'
const SUGGESTIONS_LIMIT = 40
const INTERSECTION_LIMIT = 100
const SITE_KEYWORDS_LIMIT = 200
const SHORTLIST_SIZE = 25
const GAP_BONUS = 30

const PROMPTS = {
  audience_suggestions: `You generate search-phrase suggestions for SEO planning. Given audienceText, domain, description, and notes about a business, return exactly 3 short search-phrase suggestions (each under 10 words) representing what that target audience might type into a search engine related to this business. Return ONLY strict JSON with no markdown fences and no prose: {"suggestions":["...","...","..."]}`,

  find_topics: `You select SEO article topic candidates from a REAL keyword shortlist produced by DataForSEO. You are given domain, description, category, notes, audienceText, audienceSelected, coreKeywords (exactly 5), and shortlist (each item has keyword, searchVolume, keywordDifficulty, competitorGap, seedCore). Pick and write exactly 5 article topic candidates. Rules: every primaryKeyword MUST be copied exactly from the shortlist (do not invent keywords); each candidate must set supportsCores to one or more of the 5 coreKeywords that the topic supports; rationale must cite the provided searchVolume and keywordDifficulty numbers; tags 4-6 short strings; keywords 8-12 short related strings (may include shortlist neighbors); topic under 70 chars. Return ONLY strict JSON with no markdown fences and no prose: {"candidates":[{"topic":"...","primaryKeyword":"...","supportsCores":["..."],"tags":["..."],"keywords":["..."],"rationale":"..."}]}`,

  generate_metadata: `You write SEO metadata for a blog post. Given topic, primaryKeyword, keywords, and rationale, return ONLY strict JSON with no markdown fences and no prose: {"title":"...","description":"...","brief":"..."}. Constraints: title 55-60 characters; description 140-160 characters; brief 1-3 sentences on a single line with no line breaks, giving a concrete angle/substance for the post.`,
}

function parseModelJson(text) {
  let cleaned = String(text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return JSON.parse(cleaned)
}

function lastTextBlock(content) {
  if (!Array.isArray(content)) return null
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i]?.type === 'text' && content[i]?.text) return content[i]
  }
  return null
}

function normalizeKeyword(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeDomain(value) {
  let d = String(value || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  return d.replace(/\.$/, '')
}

function splitCompetitors(competitors) {
  if (typeof competitors !== 'string' || !competitors.trim()) return []
  return [
    ...new Set(
      competitors
        .split(',')
        .map((part) => normalizeDomain(part))
        .filter(Boolean)
    ),
  ]
}

function isFuzzyExcluded(keywordNorm, exclusionNorms) {
  for (const saved of exclusionNorms) {
    if (!saved) continue
    if (keywordNorm === saved) return true
    if (saved.length >= 4 && keywordNorm.includes(saved)) return true
    if (keywordNorm.length >= 4 && saved.includes(keywordNorm)) return true
  }
  return false
}

function dataforSeoAuthHeader(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

async function dataforSeoPost(authHeader, path, task) {
  const res = await fetch(`https://api.dataforseo.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([task]),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.error(`DataForSEO HTTP ${res.status} ${path}:`, JSON.stringify(data))
    throw new Error(`DataForSEO HTTP ${res.status} for ${path}`)
  }
  if (!data || data.status_code !== 20000) {
    console.error(`DataForSEO top-level error ${path}:`, JSON.stringify(data))
    throw new Error(
      data?.status_message || `DataForSEO status_code ${data?.status_code} for ${path}`
    )
  }
  const taskResult = Array.isArray(data.tasks) ? data.tasks[0] : null
  if (!taskResult || taskResult.status_code !== 20000) {
    console.error(`DataForSEO task error ${path}:`, JSON.stringify(data))
    throw new Error(
      taskResult?.status_message ||
        `DataForSEO task status_code ${taskResult?.status_code} for ${path}`
    )
  }
  return taskResult
}

function extractSuggestionItems(taskResult, label) {
  const result0 = Array.isArray(taskResult.result) ? taskResult.result[0] : null
  const items = result0?.items
  if (!Array.isArray(items)) {
    console.error(`DataForSEO suggestions shape mismatch (${label}):`, JSON.stringify(taskResult))
    throw new Error(`Unexpected keyword_suggestions response shape for "${label}"`)
  }
  return items
    .map((item) => {
      const keyword = item?.keyword
      if (typeof keyword !== 'string' || !keyword.trim()) return null
      return {
        keyword: keyword.trim(),
        searchVolume: item?.keyword_info?.search_volume ?? null,
        cpc: item?.keyword_info?.cpc ?? null,
        competition: item?.keyword_info?.competition ?? null,
      }
    })
    .filter(Boolean)
}

function extractBulkDifficultyMap(taskResult) {
  const result0 = Array.isArray(taskResult.result) ? taskResult.result[0] : null
  const items = result0?.items
  if (!Array.isArray(items)) {
    console.error('DataForSEO bulk KD shape mismatch:', JSON.stringify(taskResult))
    throw new Error('Unexpected bulk_keyword_difficulty response shape')
  }
  const map = new Map()
  for (const item of items) {
    if (typeof item?.keyword === 'string') {
      map.set(normalizeKeyword(item.keyword), item.keyword_difficulty ?? null)
    }
  }
  return map
}

function extractIntersectionKeywords(taskResult, label) {
  const result0 = Array.isArray(taskResult.result) ? taskResult.result[0] : null
  const items = result0?.items
  if (!Array.isArray(items)) {
    console.error(`DataForSEO intersection shape mismatch (${label}):`, JSON.stringify(taskResult))
    throw new Error(`Unexpected domain_intersection response shape for "${label}"`)
  }
  const keywords = []
  for (const item of items) {
    const kw = item?.keyword_data?.keyword
    if (typeof kw === 'string' && kw.trim()) keywords.push(kw.trim())
  }
  return keywords
}

function extractSiteKeywords(taskResult) {
  const result0 = Array.isArray(taskResult.result) ? taskResult.result[0] : null
  const items = result0?.items
  if (!Array.isArray(items)) {
    console.error('DataForSEO keywords_for_site shape mismatch:', JSON.stringify(taskResult))
    throw new Error('Unexpected keywords_for_site response shape')
  }
  return items
    .map((item) => (typeof item?.keyword === 'string' ? item.keyword.trim() : ''))
    .filter(Boolean)
}

async function callAnthropic(apiKey, { system, payload, maxTokens = 4096 }) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        },
      ],
    }),
  })

  const anthropicData = await anthropicRes.json().catch(() => null)

  if (!anthropicRes.ok) {
    const message =
      anthropicData?.error?.message ||
      anthropicData?.error ||
      `Anthropic API error (${anthropicRes.status})`
    const err = new Error(String(message))
    err.status = 502
    err.anthropic = true
    throw err
  }

  const textBlock = lastTextBlock(anthropicData?.content)
  if (!textBlock?.text) {
    const err = new Error('No text content in Anthropic response')
    err.status = 502
    throw err
  }

  try {
    return parseModelJson(textBlock.text)
  } catch (parseErr) {
    const err = new Error('Failed to parse model JSON response')
    err.status = 502
    err.raw = textBlock.text
    throw err
  }
}

async function runFindTopicsPipeline(body, anthropicKey, dfsLogin, dfsPassword) {
  const warnings = []
  const domain = normalizeDomain(body.domain)
  const coreKeywords = body.coreKeywords.map((k) => String(k).trim())
  const savedTopics = Array.isArray(body.savedTopics) ? body.savedTopics : []
  const competitorDomains = splitCompetitors(body.competitors).filter((d) => d !== domain)
  const authHeader = dataforSeoAuthHeader(dfsLogin, dfsPassword)

  const phase1Jobs = []

  for (const seed of coreKeywords) {
    phase1Jobs.push({
      kind: 'suggestions',
      seed,
      promise: dataforSeoPost(
        authHeader,
        '/v3/dataforseo_labs/google/keyword_suggestions/live',
        {
          keyword: seed,
          location_code: LOCATION_CODE,
          language_code: LANGUAGE_CODE,
          limit: SUGGESTIONS_LIMIT,
        }
      ),
    })
  }

  phase1Jobs.push({
    kind: 'site',
    promise: dataforSeoPost(authHeader, '/v3/dataforseo_labs/google/keywords_for_site/live', {
      target: domain,
      location_code: LOCATION_CODE,
      language_code: LANGUAGE_CODE,
      limit: SITE_KEYWORDS_LIMIT,
    }),
  })

  for (const competitor of competitorDomains) {
    phase1Jobs.push({
      kind: 'intersection',
      competitor,
      promise: dataforSeoPost(
        authHeader,
        '/v3/dataforseo_labs/google/domain_intersection/live',
        {
          target1: competitor,
          target2: domain,
          intersections: false,
          location_code: LOCATION_CODE,
          language_code: LANGUAGE_CODE,
          limit: INTERSECTION_LIMIT,
          item_types: ['organic'],
        }
      ),
    })
  }

  const phase1Settled = await Promise.allSettled(phase1Jobs.map((job) => job.promise))

  const candidateMap = new Map()
  const gapSet = new Set()
  const siteKeywordNorms = new Set()
  let suggestionSuccesses = 0

  phase1Settled.forEach((settled, index) => {
    const job = phase1Jobs[index]
    if (settled.status === 'rejected') {
      const msg = settled.reason?.message || String(settled.reason)
      if (job.kind === 'suggestions') {
        warnings.push(`Keyword suggestions failed for "${job.seed}": ${msg}`)
      } else if (job.kind === 'site') {
        warnings.push(`Keywords for site failed: ${msg}`)
      } else {
        warnings.push(`Domain intersection failed for "${job.competitor}": ${msg}`)
      }
      return
    }

    try {
      if (job.kind === 'suggestions') {
        const items = extractSuggestionItems(settled.value, job.seed)
        suggestionSuccesses += 1
        for (const item of items) {
          const key = normalizeKeyword(item.keyword)
          if (!key) continue
          const existing = candidateMap.get(key)
          if (!existing) {
            candidateMap.set(key, { ...item, seedCore: job.seed })
          } else if ((item.searchVolume || 0) > (existing.searchVolume || 0)) {
            candidateMap.set(key, { ...item, seedCore: existing.seedCore || job.seed })
          }
        }
      } else if (job.kind === 'site') {
        for (const kw of extractSiteKeywords(settled.value)) {
          siteKeywordNorms.add(normalizeKeyword(kw))
        }
      } else if (job.kind === 'intersection') {
        for (const kw of extractIntersectionKeywords(settled.value, job.competitor)) {
          gapSet.add(normalizeKeyword(kw))
        }
      }
    } catch (parseErr) {
      warnings.push(parseErr.message || String(parseErr))
    }
  })

  if (suggestionSuccesses === 0 || candidateMap.size === 0) {
    const err = new Error(
      'All DataForSEO keyword suggestion calls failed or returned no candidates'
    )
    err.status = 502
    err.warnings = warnings
    throw err
  }

  const candidateKeywords = [...candidateMap.values()].map((c) => c.keyword)
  let difficultyMap = new Map()
  try {
    const kdTask = await dataforSeoPost(
      authHeader,
      '/v3/dataforseo_labs/google/bulk_keyword_difficulty/live',
      {
        keywords: candidateKeywords.slice(0, 1000),
        location_code: LOCATION_CODE,
        language_code: LANGUAGE_CODE,
      }
    )
    difficultyMap = extractBulkDifficultyMap(kdTask)
  } catch (kdErr) {
    warnings.push(`Bulk keyword difficulty failed: ${kdErr.message || String(kdErr)}`)
  }

  const savedNorms = savedTopics.map((t) => normalizeKeyword(t)).filter(Boolean)
  const exclusionNorms = new Set([...siteKeywordNorms, ...savedNorms])

  const ranked = []
  for (const [key, candidate] of candidateMap) {
    if (siteKeywordNorms.has(key) || isFuzzyExcluded(key, savedNorms)) continue
    const keywordDifficulty = difficultyMap.has(key) ? difficultyMap.get(key) : null
    const competitorGap = gapSet.has(key)
    const searchVolume = candidate.searchVolume ?? 0
    const score =
      searchVolume / (1 + (keywordDifficulty ?? 50)) + (competitorGap ? GAP_BONUS : 0)
    ranked.push({
      keyword: candidate.keyword,
      searchVolume: candidate.searchVolume,
      keywordDifficulty,
      competitorGap,
      seedCore: candidate.seedCore,
      cpc: candidate.cpc,
      competition: candidate.competition,
      score,
    })
  }

  ranked.sort((a, b) => b.score - a.score)
  const shortlist = ranked.slice(0, SHORTLIST_SIZE)

  if (shortlist.length === 0) {
    const err = new Error('No keyword candidates remained after exclusion filtering')
    err.status = 502
    err.warnings = warnings
    throw err
  }

  const shortlistByNorm = new Map(shortlist.map((item) => [normalizeKeyword(item.keyword), item]))

  const parsed = await callAnthropic(anthropicKey, {
    system: PROMPTS.find_topics,
    maxTokens: 8192,
    payload: {
      domain: body.domain,
      description: body.description,
      category: body.category,
      notes: body.notes,
      audienceText: body.audienceText,
      audienceSelected: body.audienceSelected,
      coreKeywords,
      shortlist: shortlist.map((item) => ({
        keyword: item.keyword,
        searchVolume: item.searchVolume,
        keywordDifficulty: item.keywordDifficulty,
        competitorGap: item.competitorGap,
        seedCore: item.seedCore,
      })),
    },
  })

  if (!parsed || !Array.isArray(parsed.candidates) || parsed.candidates.length < 3) {
    const err = new Error('Model response must include candidates array of at least 3 items')
    err.status = 502
    err.raw = JSON.stringify(parsed)
    throw err
  }

  const candidates = parsed.candidates.slice(0, 5).map((c) => {
    const pk = typeof c.primaryKeyword === 'string' ? c.primaryKeyword.trim() : ''
    const metrics = shortlistByNorm.get(normalizeKeyword(pk)) || {}
    return {
      topic: c.topic,
      primaryKeyword: pk,
      supportsCores: Array.isArray(c.supportsCores) ? c.supportsCores : [],
      searchVolume: metrics.searchVolume ?? null,
      keywordDifficulty: metrics.keywordDifficulty ?? null,
      competitorGap: Boolean(metrics.competitorGap),
      tags: Array.isArray(c.tags) ? c.tags : [],
      keywords: Array.isArray(c.keywords) ? c.keywords : [],
      rationale: c.rationale,
    }
  })

  return { candidates, dataforSeoWarnings: warnings }
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
    const mode = body.mode

    if (
      mode !== 'audience_suggestions' &&
      mode !== 'find_topics' &&
      mode !== 'generate_metadata'
    ) {
      return json(res, 400, {
        error: 'mode must be "audience_suggestions", "find_topics", or "generate_metadata"',
      })
    }

    if (mode === 'audience_suggestions') {
      const { audienceText, domain, description, notes } = body
      if (typeof audienceText !== 'string' || !audienceText.trim()) {
        return json(res, 400, { error: 'audienceText is required' })
      }
      const parsed = await callAnthropic(apiKey, {
        system: PROMPTS.audience_suggestions,
        payload: { audienceText, domain, description, notes },
      })
      if (!parsed || !Array.isArray(parsed.suggestions) || parsed.suggestions.length !== 3) {
        return json(res, 502, {
          error: 'Model response must include suggestions array of length 3',
          raw: JSON.stringify(parsed),
        })
      }
      return json(res, 200, { suggestions: parsed.suggestions })
    }

    if (mode === 'find_topics') {
      const dfsLogin = process.env.DATAFORSEO_LOGIN
      const dfsPassword = process.env.DATAFORSEO_PASSWORD
      if (!dfsLogin || !dfsPassword) {
        console.error('Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD')
        return json(res, 500, { error: 'Server configuration error' })
      }

      if (typeof body.domain !== 'string' || !normalizeDomain(body.domain)) {
        return json(res, 400, { error: 'domain is required' })
      }
      if (
        !Array.isArray(body.coreKeywords) ||
        body.coreKeywords.length !== 5 ||
        !body.coreKeywords.every((k) => typeof k === 'string' && k.trim())
      ) {
        return json(res, 400, { error: 'coreKeywords must be an array of exactly 5 strings' })
      }
      if (body.savedTopics != null && !Array.isArray(body.savedTopics)) {
        return json(res, 400, { error: 'savedTopics must be an array' })
      }

      const result = await runFindTopicsPipeline(body, apiKey, dfsLogin, dfsPassword)
      return json(res, 200, result)
    }

    const { topic, primaryKeyword, keywords, rationale } = body
    if (typeof topic !== 'string' || !topic.trim()) {
      return json(res, 400, { error: 'topic is required' })
    }
    if (typeof primaryKeyword !== 'string' || !primaryKeyword.trim()) {
      return json(res, 400, { error: 'primaryKeyword is required' })
    }
    const parsed = await callAnthropic(apiKey, {
      system: PROMPTS.generate_metadata,
      payload: { topic, primaryKeyword, keywords, rationale },
    })
    if (
      !parsed ||
      typeof parsed.title !== 'string' ||
      typeof parsed.description !== 'string' ||
      typeof parsed.brief !== 'string'
    ) {
      return json(res, 502, {
        error: 'Model response must include title, description, and brief strings',
        raw: JSON.stringify(parsed),
      })
    }
    return json(res, 200, {
      title: parsed.title,
      description: parsed.description,
      brief: parsed.brief,
    })
  } catch (err) {
    if (err?.anthropic) {
      console.error('topic-generator Anthropic error:', err.message)
      return json(res, 502, { error: err.message })
    }
    if (err?.raw != null) {
      console.error('topic-generator JSON parse failed:', err)
      return json(res, 502, { error: err.message, raw: err.raw })
    }
    if (err?.status === 502) {
      console.error('topic-generator error:', err)
      return json(res, 502, {
        error: err.message,
        ...(err.warnings ? { dataforSeoWarnings: err.warnings } : {}),
      })
    }
    console.error('topic-generator error:', err)
    return json(res, 500, { error: 'Unexpected server error' })
  }
}
