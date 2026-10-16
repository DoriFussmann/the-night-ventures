// Pure helpers for the tabbed Analytics layout.
// No React, no network — safe to unit-test with plain node.
//
// Two jobs:
//   1. classifyBots / filterSemrushBots — split the robots.txt bot table into
//      "search engine" crawlers vs "AI" crawlers, so one bot-access scan can
//      feed both the Google Crawlability tab and the AI Discoverability tab.
//   2. TAB_SOURCES — the single source of truth for which underlying data
//      source(s) each Analytics tab needs (and therefore which panel a tab's
//      Scan button runs).

// Known AI / LLM crawlers. Checked FIRST so "Applebot-Extended" and
// "Google-Extended" land in AI, not in search.
const AI_MATCHERS = [
  'gptbot',
  'oai-searchbot',
  'chatgpt',
  'claudebot',
  'claude-searchbot',
  'claude-user',
  'claude-web',
  'anthropic',
  'perplexity',
  'ccbot',
  'google-extended',
  'applebot-extended',
  'bytespider',
  'cohere',
  'meta-external',
  'amazonbot',
  'youbot',
  'diffbot',
  'ai2bot',
  'omgili',
  'timpibot',
  'imagesift',
]

// Known search-engine crawlers.
const SEARCH_MATCHERS = [
  'googlebot',
  'bingbot',
  'slurp',
  'duckduckbot',
  'baiduspider',
  'yandex',
  'sogou',
  'applebot',
  'petalbot',
  'seznambot',
]

/**
 * Which bucket a single bot name belongs to.
 * Unknown bots default to 'ai' — the AI list grows fast and is fuzzier, while
 * the set of real search crawlers is small and well known, so an unrecognised
 * agent is far more likely to be a new AI scraper than a new search engine.
 * @returns {'ai' | 'search'}
 */
export function botKind(name) {
  const key = String(name || '').toLowerCase()
  if (AI_MATCHERS.some((m) => key.includes(m))) return 'ai'
  if (SEARCH_MATCHERS.some((m) => key.includes(m))) return 'search'
  return 'ai'
}

/**
 * Split a bot-access map ({ [botName]: { status, reason } }) into two maps.
 * @returns {{ search: object, ai: object }}
 */
export function classifyBots(botsMap) {
  const search = {}
  const ai = {}
  for (const [name, info] of Object.entries(botsMap || {})) {
    if (botKind(name) === 'search') search[name] = info
    else ai[name] = info
  }
  return { search, ai }
}

/**
 * Return a semrush-shaped result whose botAccess.bots is filtered to one kind,
 * leaving every other field intact. Returns the input unchanged when there is
 * nothing to filter, so the existing AiSearchSection can consume it as-is.
 * @param {object|null} semrush
 * @param {'ai'|'search'} kind
 */
export function filterSemrushBots(semrush, kind) {
  if (!semrush || !semrush.botAccess || !semrush.botAccess.bots) return semrush
  const split = classifyBots(semrush.botAccess.bots)
  return {
    ...semrush,
    botAccess: {
      ...semrush.botAccess,
      bots: split[kind] || {},
    },
  }
}

// The valid panel ids that live in ExternalAuditSnapshot's PANELS array.
export const SOURCE_IDS = ['semrush', 'pagespeed', 'moz', 'dataforseo', 'technical']

// Tab id -> the source panel(s) that tab displays and scans.
// AI Discoverability and Crawlability intentionally share the 'semrush'
// (robots.txt bot-access) source: one scan refreshes both.
export const TAB_SOURCES = {
  overview: SOURCE_IDS,
  speed: ['pagespeed'],
  authority: ['moz'],
  ai: ['semrush'],
  crawlability: ['semrush'],
  technical: ['technical'],
  traffic: ['dataforseo'], // GSC will be added here later (currently a stub)
}
