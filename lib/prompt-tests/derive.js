// Pure helpers for the Prompt Tests tool: read an engine's reply, derive what
// happened (searched, and per brand: retrieved, cited, named) and label a prompt.

/** Engines, in display order. `method: 'app'` captures the real app; `'api'` calls the model API. */
export const ENGINES = {
  chatgpt: { label: 'ChatGPT', method: 'app', path: 'chat_gpt', fanOut: true, unitCost: 0.004 },
  gemini: { label: 'Gemini', method: 'app', path: 'gemini', fanOut: false, unitCost: 0.004 },
  claude: { label: 'Claude', method: 'api', path: 'claude', fanOut: true, unitCost: 0.02 },
  perplexity: { label: 'Perplexity', method: 'api', path: 'perplexity', fanOut: true, unitCost: 0.02 },
}
export const ENGINE_IDS = Object.keys(ENGINES)
export const DEFAULT_RUNS = { chatgpt: 3, gemini: 2, claude: 1, perplexity: 1 }
export const LABELS = ['Named', 'Cited, not named', 'Retrieved, not cited', 'Absent', 'No search', 'Failed']

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Host of a URL or domain, lower case, without protocol, www or path. */
export function normalizeDomain(value) {
  let d = String(value || '').trim().toLowerCase()
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0].split(':')[0]
  return d.replace(/\.$/, '')
}

/** True when `host` is the brand domain or one of its subdomains. */
export function domainHit(host, brandDomain) {
  const h = normalizeDomain(host)
  const b = normalizeDomain(brandDomain)
  return Boolean(h && b) && (h === b || h.endsWith(`.${b}`))
}

/** Remove image markup, so a brand that only appears on an image card is not counted as named. */
export function stripImages(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, ' ')
}

const list = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v))

function linkRow(x) {
  const url = str(x?.url)
  const domain = normalizeDomain(x?.domain || url)
  return domain ? { domain, url, title: str(x?.title || x?.source_name).slice(0, 300) } : null
}

function uniqueLinks(rows) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    if (!r) continue
    const key = r.url || r.domain
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/**
 * One result row of the LLM Scraper (ChatGPT or Gemini app capture).
 * Image, product and ad blocks are left out of the answer text.
 */
export function parseScraperResult(result) {
  const items = list(result?.items)
  const textParts = []
  const itemSources = []
  for (const item of items) {
    const type = str(item?.type)
    for (const s of list(item?.sources)) itemSources.push(linkRow(s))
    if (/images|products|_ad$|carousel/.test(type)) continue
    const body = str(item?.markdown || item?.text || item?.title)
    if (body) textParts.push(body)
  }
  const answer = stripImages(textParts.length ? textParts.join('\n\n') : str(result?.markdown)).trim()
  return {
    model: str(result?.model) || null,
    answer,
    fanOut: list(result?.fan_out_queries).map(str).filter(Boolean),
    searchResults: uniqueLinks(list(result?.search_results).map(linkRow)),
    cited: uniqueLinks(list(result?.sources).map(linkRow).concat(itemSources)),
    brandEntities: list(result?.brand_entities).map((b) => ({ title: str(b?.title), category: str(b?.category) })).filter((b) => b.title),
  }
}

/** One result row of LLM Responses (model API, not the app). */
export function parseApiResult(result) {
  const texts = []
  const cited = []
  for (const item of list(result?.items)) {
    for (const section of list(item?.sections)) {
      if (section?.text) texts.push(str(section.text))
      for (const a of list(section?.annotations)) cited.push(linkRow(a))
    }
  }
  return {
    model: str(result?.model_name) || null,
    answer: stripImages(texts.join('\n\n')).trim(),
    fanOut: list(result?.fan_out_queries).map(str).filter(Boolean),
    searchResults: uniqueLinks(list(result?.search_results).map(linkRow)),
    cited: uniqueLinks(cited),
    brandEntities: list(result?.brand_entities).map((b) => ({ title: str(b?.title), category: str(b?.category) })).filter((b) => b.title),
  }
}

/**
 * Whole-word name matchers. A single word matches case-sensitively (a proper noun),
 * so "rupert" inside a URL slug or ordinary prose does not count; phrases ignore case.
 */
export function nameMatchers(patterns) {
  const out = []
  const seen = new Set()
  for (const raw of list(patterns)) {
    const name = str(raw).trim()
    if (name.length < 2 || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, /\s/.test(name) ? 'iu' : 'u'))
  }
  return out
}

/** Is the brand named in the answer? Image markup is removed and lines matching an exclude pattern are dropped first. */
export function isNamed(answer, brand) {
  const excludes = list(brand?.exclude_patterns).map((p) => str(p).trim().toLowerCase()).filter(Boolean)
  const lines = stripImages(answer)
    .split(/\n+/)
    .filter((line) => !excludes.some((x) => line.toLowerCase().includes(x)))
  const text = lines.join('\n')
  const patterns = list(brand?.name_patterns).length ? brand.name_patterns : [brand?.name]
  return nameMatchers(patterns).some((re) => re.test(text))
}

/**
 * Derived fields for one run.
 * @param {ReturnType<typeof parseScraperResult>} parsed
 * @param {Array<{ id: string, name: string, domains: string[], name_patterns: string[], exclude_patterns: string[], is_own: boolean }>} brands
 */
export function deriveRun(parsed, brands) {
  const searched = parsed.fanOut.length > 0 || parsed.searchResults.length > 0 || parsed.cited.length > 0
  const out = {}
  let ownCitedUrls = []
  for (const b of list(brands)) {
    const domains = list(b.domains).map(normalizeDomain).filter(Boolean)
    const inList = (rows) => rows.filter((r) => domains.some((d) => domainHit(r.domain, d)))
    const citedRows = inList(parsed.cited)
    const cited = citedRows.length > 0
    const retrieved = cited || inList(parsed.searchResults).length > 0
    out[b.id] = { retrieved, cited, named: isNamed(parsed.answer, b) }
    if (b.is_own) ownCitedUrls = [...new Set(citedRows.map((r) => r.url).filter(Boolean))]
  }
  return { searched, brands: out, ownCitedUrls }
}

/**
 * Outcome label for one prompt on one engine, over the runs of its latest cycle.
 * Failed runs are stored but never counted as "no search".
 */
export function outcomeFor(runs, ownBrandId) {
  const ok = runs.filter((r) => r.status === 'ok')
  const count = (f) => ok.filter(f).length
  const own = (r) => (r.brands && r.brands[ownBrandId]) || {}
  const c = {
    runs: ok.length,
    failed: runs.length - ok.length,
    searched: count((r) => r.searched),
    retrieved: count((r) => own(r).retrieved),
    cited: count((r) => own(r).cited),
    named: count((r) => own(r).named),
  }
  let label = 'No search'
  if (!ok.length) label = 'Failed'
  else if (c.named) label = 'Named'
  else if (c.cited) label = 'Cited, not named'
  else if (c.retrieved) label = 'Retrieved, not cited'
  else if (c.searched) label = 'Absent'
  const of = (n) => `${n} of ${c.runs}`
  const detail =
    label === 'Named' ? of(c.named)
    : label === 'Cited, not named' ? of(c.cited)
    : label === 'Retrieved, not cited' ? of(c.retrieved)
    : label === 'Absent' ? `searched ${of(c.searched)}`
    : label === 'No search' ? `0 of ${c.runs} searched`
    : `${c.failed} failed`
  return { label, detail, ...c }
}

const FILLER = new Set(['a', 'an', 'the', 'for', 'of', 'in', 'on', 'to', 'and', 'or', 'with', 'vs', 'best', 'top', 'how', 'what', 'is', 'are'])

/** Lower case, years and common filler words removed. */
export function normalizeQuery(q) {
  return str(q)
    .toLowerCase()
    .replace(/\b(19|20)\d\d\b/g, ' ')
    .split(/[^\p{L}\p{N}$%.-]+/u)
    .filter((w) => w && !FILLER.has(w))
    .join(' ')
    .trim()
}
