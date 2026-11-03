// AI Visibility category: is the company named and cited when buyers ask AI
// assistants (ChatGPT, Claude, Gemini, Perplexity), does each engine recognize the
// brand, and do Google's AI Overview / AI Mode cite it on core keywords.
// Pure: parsers take DataForSEO result rows; buildAiVisibilityIssues returns { issues, metrics }.

import { makeIssue, dedupeIssues } from '../issues.js'
import { apexDomain } from '../../audit-snapshot/domain.js'

const CATEGORY = 'ai_visibility'

export const ENGINE_LABELS = {
  chat_gpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
}

/** Crawlers behind each engine (see AEO Readiness). */
const AEO_CRAWLERS = {
  chat_gpt: 'OAI-SearchBot and ChatGPT-User',
  claude: 'Claude-SearchBot and Claude-User',
  gemini: 'Googlebot',
  perplexity: 'PerplexityBot and Perplexity-User',
}

/** Share of buyer answers below which share of voice is flagged. */
export const LOW_SOV_SHARE = 0.25
/** A competitor named in at least this many more answers than the company is flagged. */
export const COMPETITOR_LEAD = 2
const MAX_COMPETITOR_ISSUES = 3
const EXCERPT_CHARS = 600
const MAX_SOURCES_PER_ANSWER = 8

const UNKNOWN_BRAND_RE =
  /\b(not (familiar|aware)|no (specific |reliable |public |verifiable )?information|(couldn'?t|could not|unable to|wasn'?t able to|not able to) (find|locate|verify)|don'?t have (any )?(specific |reliable )?(information|details)|no (known|widely known) (company|business|product))\b/i

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function domainMatches(host, apex) {
  const h = apexDomain(host)
  return Boolean(h && apex && (h === apex || h.endsWith(`.${apex}`)))
}

/**
 * Matchers for a brand: names as whole words, plus the domain.
 * Single-word names match case-sensitively (proper noun) so "rupert" in prose
 * or a URL slug doesn't count; multi-word names match case-insensitively.
 * @param {{ names?: string[], apex?: string }} input
 * @returns {RegExp[]}
 */
export function brandMatchers({ names = [], apex = '' }) {
  const out = []
  const seen = new Set()
  for (const raw of names) {
    const name = String(raw || '').trim()
    if (name.length < 3 || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const multi = /\s/.test(name)
    out.push(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, multi ? 'iu' : 'u'))
  }
  if (apex) out.push(new RegExp(`(^|[^a-z0-9-])(www\\.)?${escapeRe(apex)}(?![a-z0-9-])`, 'i'))
  return out
}

/** @param {string} text @param {RegExp[]} matchers */
export function textMentions(text, matchers) {
  const t = String(text || '')
  return matchers.some((re) => re.test(t))
}

/**
 * @param {Array<{ name?: string, url?: string }>} competitors  company_profiles.competitors
 * @param {string} ownApex
 */
export function competitorEntities(competitors, ownApex) {
  const out = []
  const seen = new Set()
  for (const c of Array.isArray(competitors) ? competitors : []) {
    const apex = apexDomain(c?.url || '')
    const name = String(c?.name || '').trim() || apex
    if (!name || (apex && apex === ownApex)) continue
    const key = (apex || name).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: name.slice(0, 120), apex: apex && apex.includes('.') ? apex : '', matchers: brandMatchers({ names: [name], apex: apex.includes('.') ? apex : '' }) })
  }
  return out
}

/** Answer text and source URLs from one llm_responses result row. */
export function extractLlmAnswer(result) {
  const texts = []
  const cited = []
  for (const item of Array.isArray(result?.items) ? result.items : []) {
    for (const section of Array.isArray(item?.sections) ? item.sections : []) {
      if (section?.text) texts.push(String(section.text))
      for (const a of Array.isArray(section?.annotations) ? section.annotations : []) {
        if (a?.url) cited.push(String(a.url))
      }
    }
  }
  // Some engines return sources only as search_results (annotations empty).
  if (!cited.length) {
    for (const r of Array.isArray(result?.search_results) ? result.search_results : []) {
      if (r?.url) cited.push(String(r.url))
    }
  }
  return {
    text: texts.join('\n\n'),
    sources: [...new Set(cited)],
    model: result?.model_name ? String(result.model_name) : null,
  }
}

/**
 * Score one answer against the brand and competitors.
 * @param {{ text: string, sources: string[] }} answer
 * @param {{ apex: string, matchers: RegExp[], competitors: ReturnType<typeof competitorEntities> }} ctx
 */
export function analyzeAnswer(answer, { apex, matchers, competitors }) {
  const text = String(answer?.text || '')
  const sources = Array.isArray(answer?.sources) ? answer.sources : []
  const ownSources = sources.filter((u) => domainMatches(u, apex))
  const mentioned = textMentions(text, matchers)
  const competitorsNamed = []
  const competitorsCited = []
  for (const c of competitors) {
    const named = textMentions(text, c.matchers)
    const citedC = Boolean(c.apex) && sources.some((u) => domainMatches(u, c.apex))
    if (named || citedC) competitorsNamed.push(c.name)
    if (citedC) competitorsCited.push(c.name)
  }
  return {
    mentioned: mentioned || ownSources.length > 0,
    namedInText: mentioned,
    cited: ownSources.length > 0,
    citedUrls: ownSources.slice(0, 5),
    sourceDomains: [...new Set(sources.map((u) => apexDomain(u)).filter(Boolean))],
    sources: sources.slice(0, MAX_SOURCES_PER_ANSWER),
    competitorsNamed,
    competitorsCited,
    unknownBrand: UNKNOWN_BRAND_RE.test(text),
    excerpt: text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS),
  }
}

/**
 * Google AI answer (AI Overview inside organic, or the AI Mode answer) → citation facts.
 * @param {{ items?: any[] }} result
 * @param {string} apex
 * @param {ReturnType<typeof competitorEntities>} competitors
 * @param {{ mode: 'overview' | 'ai_mode' }} options
 */
export function parseGoogleAi(result, apex, competitors, { mode }) {
  const items = Array.isArray(result?.items) ? result.items : []
  const aiItems =
    mode === 'overview'
      ? items.filter((i) => i?.type === 'ai_overview')
      : items.filter((i) => i?.type === 'ai_overview' || Array.isArray(i?.references) || Array.isArray(i?.items))
  const refs = []
  const push = (r) => {
    const url = String(r?.url || '').trim()
    if (url) refs.push(url)
  }
  for (const ai of aiItems) {
    for (const r of Array.isArray(ai?.references) ? ai.references : []) push(r)
    for (const el of Array.isArray(ai?.items) ? ai.items : []) {
      for (const r of Array.isArray(el?.references) ? el.references : []) push(r)
    }
  }
  const unique = [...new Set(refs)]
  const organic =
    mode === 'overview'
      ? items.filter((i) => i?.type === 'organic').find((i) => domainMatches(i.domain || i.url, apex))
      : null
  return {
    present: aiItems.length > 0,
    cited: unique.some((u) => domainMatches(u, apex)),
    citedUrls: unique.filter((u) => domainMatches(u, apex)).slice(0, 3),
    competitorsCited: competitors.filter((c) => c.apex && unique.some((u) => domainMatches(u, c.apex))).map((c) => c.name),
    sourceDomains: [...new Set(unique.map((u) => apexDomain(u)).filter(Boolean))].slice(0, 10),
    organicPosition: organic ? Number(organic.rank_group) || null : null,
  }
}

/** LLM Mentions result row → count + top questions. */
export function parseMentionsResult(result) {
  const items = (Array.isArray(result?.items) ? result.items : [])
    .map((item) => ({
      question: String(item?.question || '').slice(0, 300),
      aiSearchVolume: Number(item?.ai_search_volume) || 0,
    }))
    .filter((i) => i.question)
    .slice(0, 10)
  const total = Number(result?.total_count)
  return { totalCount: Number.isFinite(total) ? total : items.length, items }
}

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) : null
}

function ratio(n, d) {
  return d > 0 ? `${n} / ${d}` : '—'
}

/**
 * @param {object} input
 * @param {Array<{ id: string, prompt: string, intent: string }>} input.prompts  buyer + brand prompts
 * @param {Array<{ engine: string, model: string|null, answers: Record<string, any>, error?: string|null }>} input.engines
 *        answers: promptId -> analyzeAnswer() output, or { error }
 * @param {Array<{ keyword: string, overview?: any, aiMode?: any, error?: string }>} input.google
 * @param {Array<{ platform: string, totalCount?: number, items?: any[], error?: string }>} input.mentions
 * @param {Array<{ name: string }>} input.competitors
 * @param {string} input.apex
 * @param {string[]} [input.warnings]
 */
export function buildAiVisibilityIssues({ prompts, engines, google = [], mentions = [], competitors = [], apex, warnings = [] }) {
  const issues = []
  const buyer = prompts.filter((p) => p.intent !== 'brand')
  const brand = prompts.find((p) => p.intent === 'brand') || null

  // --- Buyer answers
  let answered = 0
  let named = 0
  let cited = 0
  const perEngine = []
  const compCounts = new Map(competitors.map((c) => [c.name, 0]))
  const sourceCounts = new Map()
  const competitorApexes = new Map(competitors.filter((c) => c.apex).map((c) => [c.apex, c.name]))

  for (const e of engines) {
    let eAnswered = 0
    let eNamed = 0
    let eCited = 0
    for (const p of buyer) {
      const a = e.answers?.[p.id]
      if (!a || a.error) continue
      eAnswered += 1
      if (a.mentioned) eNamed += 1
      if (a.cited) eCited += 1
      for (const name of a.competitorsNamed || []) compCounts.set(name, (compCounts.get(name) || 0) + 1)
      for (const d of a.sourceDomains || []) sourceCounts.set(d, (sourceCounts.get(d) || 0) + 1)
    }
    answered += eAnswered
    named += eNamed
    cited += eCited
    perEngine.push({ engine: e.engine, answered: eAnswered, named: eNamed, cited: eCited })
  }

  const enginesAnswered = perEngine.filter((e) => e.answered > 0)
  const share = answered > 0 ? named / answered : null

  if (answered > 0 && named === 0) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'ai_invisible',
        severity: 'critical',
        title: 'Not named in any AI answer to buyer questions',
        detail: `0 of ${answered} answers across ${enginesAnswered.length} engine(s) name the company.`,
        target: 'all',
        evidence: { answered, engines: enginesAnswered.map((e) => e.engine) },
        fixHint:
          'Publish one answer-first page per buyer question (direct answer in the first two sentences), and get listed on the domains under "Sources AI trusts".',
      })
    )
  } else if (answered > 0) {
    for (const e of enginesAnswered) {
      if (e.named > 0) continue
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'ai_engine_absent',
          severity: 'high',
          title: 'Not named by one AI engine',
          detail: `${ENGINE_LABELS[e.engine] || e.engine}: 0 of ${e.answered} buyer answers name the company.`,
          target: e.engine,
          evidence: { engine: e.engine, answered: e.answered },
          fixHint: `Run AEO Readiness and check ${AEO_CRAWLERS[e.engine] || `${ENGINE_LABELS[e.engine] || e.engine}'s crawlers`} in its crawler access table; a block there is the usual cause. Then look at which sources it cited instead.`,
        })
      )
    }
    if (share != null && share < LOW_SOV_SHARE) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'ai_low_share_of_voice',
          severity: 'medium',
          title: `Named in under ${Math.round(LOW_SOV_SHARE * 100)}% of AI buyer answers`,
          detail: `Named in ${named} of ${answered} answers (${pct(named, answered)}%).`,
          target: 'sov',
          evidence: { named, answered },
          fixHint: 'Widen coverage: one strong page per buyer problem, each with a clear statement of who it is for and what you do.',
        })
      )
    }
  }

  const compRanked = [...compCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  compRanked
    .filter((c) => c.count >= named + COMPETITOR_LEAD)
    .slice(0, MAX_COMPETITOR_ISSUES)
    .forEach((c) => {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'ai_competitor_ahead',
          severity: 'high',
          title: 'A competitor is named more often in AI answers',
          detail: `${c.name} is named in ${c.count} answers; you are named in ${named}.`,
          target: c.name.toLowerCase(),
          evidence: { competitor: c.name, competitorNamed: c.count, named },
          fixHint: `Open the answers that name ${c.name} and target the sources cited there; publish a fair comparison page.`,
        })
      )
    })

  // --- Brand prompt
  let brandAnswered = 0
  let brandRecognized = 0
  let anyCited = cited > 0
  if (brand) {
    for (const e of engines) {
      const a = e.answers?.[brand.id]
      if (!a || a.error) continue
      brandAnswered += 1
      if (a.cited) anyCited = true
      const recognized = a.cited || (a.mentioned && !a.unknownBrand)
      if (recognized) {
        brandRecognized += 1
        continue
      }
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'ai_brand_unrecognized',
          severity: 'high',
          title: 'An AI engine does not recognize the brand',
          detail: `${ENGINE_LABELS[e.engine] || e.engine}, asked "${brand.prompt}", ${a.unknownBrand ? 'said it has no information' : 'did not name or cite your site'}.`,
          target: e.engine,
          evidence: { engine: e.engine, excerpt: String(a.excerpt || '').slice(0, 300) },
          fixHint:
            'Add Organization schema with sameAs links, a clear About page, and consistent profiles (LinkedIn, Crunchbase, directories) that state what the company does.',
        })
      )
    }
  }

  if (answered + brandAnswered > 0 && !anyCited) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'ai_never_cited',
        severity: 'high',
        title: 'Your site is never cited as a source',
        detail: `0 of ${answered + brandAnswered} AI answers cite a page on your domain.`,
        target: 'cited',
        evidence: { answers: answered + brandAnswered },
        fixHint: 'Give AI something to quote: specific facts, numbers, definitions and FAQs on crawlable pages.',
      })
    )
  }

  // --- Google AI surfaces
  const gRows = google.filter((g) => !g.error)
  for (const g of gRows) {
    if (g.overview?.present && !g.overview.cited) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'aio_not_cited',
          severity: 'medium',
          title: 'Google AI Overview does not cite you',
          detail: `"${g.keyword}": AI Overview shown${g.overview.competitorsCited?.length ? `, citing ${g.overview.competitorsCited.join(', ')}` : ''}.`,
          target: `aio:${g.keyword.toLowerCase()}`,
          evidence: { keyword: g.keyword, sources: g.overview.sourceDomains, organicPosition: g.overview.organicPosition },
          fixHint: 'Answer the query directly in the first two sentences of the pillar page, with the keyword in the H1.',
        })
      )
    }
    if (g.aiMode?.present && !g.aiMode.cited) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'ai_mode_not_cited',
          severity: 'medium',
          title: 'Google AI Mode does not cite you',
          detail: `"${g.keyword}"${g.aiMode.competitorsCited?.length ? `: cites ${g.aiMode.competitorsCited.join(', ')}` : ''}.`,
          target: `aimode:${g.keyword.toLowerCase()}`,
          evidence: { keyword: g.keyword, sources: g.aiMode.sourceDomains },
          fixHint: 'Same as AI Overview: answer-first pillar content; AI Mode leans on the same sources.',
        })
      )
    }
  }

  // --- LLM Mentions database
  const mOk = mentions.filter((m) => !m.error)
  const mentionTotal = mOk.reduce((n, m) => n + (Number(m.totalCount) || 0), 0)
  if (mOk.length && mentionTotal === 0) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'ai_mentions_none',
        severity: 'low',
        title: 'No questions in the LLM Mentions database cite your domain',
        detail: `Checked ${mOk.map((m) => (m.platform === 'google' ? 'Google AI Overview' : 'ChatGPT')).join(' and ')}.`,
        target: 'mentions',
        fixHint: 'A lagging signal; it rises as the issues above are fixed.',
      })
    )
  }

  // --- Metrics
  const engineNames = perEngine.filter((e) => e.named > 0).length
  const overviewShown = gRows.filter((g) => g.overview?.present)
  const aiModeShown = gRows.filter((g) => g.aiMode?.present)
  const topSources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({
      domain,
      count,
      self: domainMatches(domain, apex),
      competitor: competitorApexes.get(domain) || null,
    }))

  const matrix = prompts.map((p) => ({
    id: p.id,
    prompt: p.prompt,
    intent: p.intent,
    cells: Object.fromEntries(
      engines.map((e) => {
        const a = e.answers?.[p.id]
        if (!a) return [e.engine, null]
        if (a.error) return [e.engine, { error: String(a.error).slice(0, 200) }]
        return [
          e.engine,
          {
            mentioned: a.mentioned,
            cited: a.cited,
            competitorsNamed: a.competitorsNamed,
            unknownBrand: a.unknownBrand,
            excerpt: a.excerpt,
            sources: a.sources,
          },
        ]
      })
    ),
  }))

  return {
    issues: dedupeIssues(issues),
    metrics: {
      shareOfVoice: share == null ? null : `${Math.round(share * 100)}%`,
      citedShare: answered > 0 ? `${pct(cited, answered)}%` : null,
      enginesNaming: ratio(engineNames, enginesAnswered.length),
      brandRecognized: ratio(brandRecognized, brandAnswered),
      aioCited: ratio(overviewShown.filter((g) => g.overview.cited).length, overviewShown.length),
      aiModeCited: ratio(aiModeShown.filter((g) => g.aiMode.cited).length, aiModeShown.length),
      buyerAnswers: answered,
      named,
      cited,
      mentionTotal: mOk.length ? mentionTotal : null,
      models: Object.fromEntries(engines.map((e) => [e.engine, e.model || null])),
      perEngine,
      shareOfVoiceRows: [
        { name: 'You', self: true, count: named },
        ...compRanked.map((c) => ({ name: c.name, self: false, count: c.count })),
      ],
      topSources,
      matrix,
      google: google.map((g) => ({
        keyword: g.keyword,
        error: g.error || null,
        overview: g.overview || null,
        aiMode: g.aiMode || null,
      })),
      mentions: mentions.map((m) => ({
        platform: m.platform,
        totalCount: m.error ? null : Number(m.totalCount) || 0,
        items: (m.items || []).slice(0, 5),
        error: m.error || null,
      })),
      warnings,
    },
  }
}
