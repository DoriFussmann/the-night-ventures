// AI assistants (as traffic sources) and crawlers (as user agents).
// Pure — shared by the GA4 sync, the bot-hit ingest endpoint, and the UI.

/** Referrer host → assistant name. Matched on the host or any parent domain. */
const AI_REFERRERS = [
  ['chatgpt.com', 'ChatGPT'],
  ['chat.openai.com', 'ChatGPT'],
  ['openai.com', 'ChatGPT'],
  ['perplexity.ai', 'Perplexity'],
  ['gemini.google.com', 'Gemini'],
  ['bard.google.com', 'Gemini'],
  ['copilot.microsoft.com', 'Copilot'],
  ['copilot.cloud.microsoft', 'Copilot'],
  ['claude.ai', 'Claude'],
  ['chat.mistral.ai', 'Mistral'],
  ['chat.deepseek.com', 'DeepSeek'],
  ['meta.ai', 'Meta AI'],
  ['grok.com', 'Grok'],
  ['you.com', 'You.com'],
  ['phind.com', 'Phind'],
  ['poe.com', 'Poe'],
]

/**
 * GA4 sessionSource for an AI assistant ("chatgpt.com", "perplexity",
 * "www.perplexity.ai", ...). Returns the assistant name or null.
 * @param {string} source
 * @returns {string | null}
 */
export function aiAssistantForSource(source) {
  let host = String(source || '').trim().toLowerCase()
  if (!host || host === '(direct)' || host === '(not set)') return null
  host = host.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
  for (const [domain, name] of AI_REFERRERS) {
    if (host === domain || host.endsWith(`.${domain}`)) return name
  }
  // utm_source values without a TLD, e.g. "chatgpt" or "perplexity".
  return AI_BARE_SOURCES[host] || null
}

/** Unambiguous bare utm_source values (no "meta"/"you": those collide with ads and words). */
const AI_BARE_SOURCES = {
  chatgpt: 'ChatGPT',
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  copilot: 'Copilot',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  grok: 'Grok',
  phind: 'Phind',
}

/**
 * Regex (RE2-safe) for a GA4 PARTIAL_REGEXP filter on sessionSource. A superset:
 * rows it lets through are still classified by aiAssistantForSource.
 */
export function ga4AiSourceRegex() {
  const parts = [
    ...AI_REFERRERS.map(([domain]) => domain.replace(/\./g, '\\.')),
    ...Object.keys(AI_BARE_SOURCES),
  ]
  return [...new Set(parts)].join('|')
}

/**
 * Known crawlers. kind:
 *   ai_training — collects content to train models
 *   ai_search   — indexes content for an AI answer engine
 *   ai_user     — fetches a page live because a person asked an assistant
 *   search      — classic search engine crawler
 * Order matters: more specific tokens first.
 */
const BOT_SIGNATURES = [
  ['oai-searchbot', 'OAI-SearchBot', 'ai_search'],
  ['chatgpt-user', 'ChatGPT-User', 'ai_user'],
  ['gptbot', 'GPTBot', 'ai_training'],
  ['claude-searchbot', 'Claude-SearchBot', 'ai_search'],
  ['claude-user', 'Claude-User', 'ai_user'],
  ['claudebot', 'ClaudeBot', 'ai_training'],
  ['anthropic-ai', 'ClaudeBot', 'ai_training'],
  ['perplexity-user', 'Perplexity-User', 'ai_user'],
  ['perplexitybot', 'PerplexityBot', 'ai_search'],
  ['mistralai-user', 'MistralAI-User', 'ai_user'],
  ['duckassistbot', 'DuckAssistBot', 'ai_search'],
  ['meta-externalfetcher', 'Meta-ExternalFetcher', 'ai_user'],
  ['meta-externalagent', 'Meta-ExternalAgent', 'ai_training'],
  ['bytespider', 'Bytespider', 'ai_training'],
  ['ccbot', 'CCBot', 'ai_training'],
  ['amazonbot', 'Amazonbot', 'ai_search'],
  ['cohere-ai', 'Cohere', 'ai_training'],
  ['youbot', 'YouBot', 'ai_search'],
  ['applebot', 'Applebot', 'search'],
  ['googlebot', 'Googlebot', 'search'],
  ['bingbot', 'Bingbot', 'search'],
]

export const BOT_KINDS = ['ai_training', 'ai_search', 'ai_user', 'search']

export const BOT_KIND_LABELS = {
  ai_training: 'AI training',
  ai_search: 'AI search index',
  ai_user: 'AI live fetch',
  search: 'Search engine',
}

/**
 * @param {string} userAgent
 * @returns {{ bot: string, kind: string } | null}
 */
export function classifyBot(userAgent) {
  const ua = String(userAgent || '').toLowerCase()
  if (!ua) return null
  for (const [token, bot, kind] of BOT_SIGNATURES) {
    if (ua.includes(token)) return { bot, kind }
  }
  return null
}

/** Case-insensitive regex source matching every known crawler token. */
export const BOT_UA_REGEX_SOURCE = BOT_SIGNATURES.map(([token]) => token).join('|')
