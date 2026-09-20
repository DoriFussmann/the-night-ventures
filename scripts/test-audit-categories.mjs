// Logic gate for the tabbed Analytics change.
// Run: node scripts/test-audit-categories.mjs
// Must end with "assertions passed."

import {
  botKind,
  classifyBots,
  filterSemrushBots,
  TAB_SOURCES,
  SOURCE_IDS,
} from '../src/pages/tools/auditSnapshot/botCategories.js'

let passed = 0
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
  passed += 1
}

// --- botKind: search engines ---
assert(botKind('Googlebot') === 'search', 'Googlebot is search')
assert(botKind('bingbot') === 'search', 'bingbot is search')
assert(botKind('DuckDuckBot') === 'search', 'DuckDuckBot is search')
assert(botKind('Applebot') === 'search', 'Applebot is search')

// --- botKind: AI crawlers ---
assert(botKind('GPTBot') === 'ai', 'GPTBot is ai')
assert(botKind('ClaudeBot') === 'ai', 'ClaudeBot is ai')
assert(botKind('PerplexityBot') === 'ai', 'PerplexityBot is ai')
assert(botKind('CCBot') === 'ai', 'CCBot is ai')

// --- botKind: the tricky "extended" overrides (AI must win over search) ---
assert(botKind('Google-Extended') === 'ai', 'Google-Extended is ai, not search')
assert(
  botKind('Applebot-Extended') === 'ai',
  'Applebot-Extended is ai, not search'
)

// --- botKind: unknown defaults to ai ---
assert(botKind('SomeBrandNewScraper') === 'ai', 'unknown bot defaults to ai')
assert(botKind('') === 'ai', 'empty name defaults to ai')

// --- classifyBots: splits a real-looking map, drops nothing ---
const bots = {
  Googlebot: { status: 'allowed', reason: 'default' },
  Bingbot: { status: 'allowed', reason: 'default' },
  GPTBot: { status: 'blocked', reason: 'disallow' },
  ClaudeBot: { status: 'allowed', reason: 'default' },
  'Google-Extended': { status: 'blocked', reason: 'disallow' },
}
const split = classifyBots(bots)
assert(Object.keys(split.search).length === 2, 'two search bots')
assert(Object.keys(split.ai).length === 3, 'three ai bots')
assert('Googlebot' in split.search, 'Googlebot bucketed to search')
assert('Google-Extended' in split.ai, 'Google-Extended bucketed to ai')
assert(
  Object.keys(split.search).length + Object.keys(split.ai).length ===
    Object.keys(bots).length,
  'no bot is lost in the split'
)

// --- classifyBots: preserves the per-bot info object (status/reason) ---
assert(split.ai.GPTBot.status === 'blocked', 'GPTBot status preserved')
assert(split.search.Googlebot.reason === 'default', 'Googlebot reason preserved')

// --- filterSemrushBots: keeps other fields, filters the table ---
const semrush = {
  botAccess: {
    ok: true,
    robotsUrl: 'https://x.com/robots.txt',
    bots,
  },
  extraField: 42,
}
const aiView = filterSemrushBots(semrush, 'ai')
assert(aiView.extraField === 42, 'unrelated fields preserved')
assert(aiView.botAccess.ok === true, 'botAccess.ok preserved')
assert(aiView.botAccess.robotsUrl === 'https://x.com/robots.txt', 'robotsUrl preserved')
assert(Object.keys(aiView.botAccess.bots).length === 3, 'ai view shows 3 bots')
assert(!('Googlebot' in aiView.botAccess.bots), 'ai view excludes Googlebot')

const searchView = filterSemrushBots(semrush, 'search')
assert(Object.keys(searchView.botAccess.bots).length === 2, 'search view shows 2 bots')
assert('Googlebot' in searchView.botAccess.bots, 'search view includes Googlebot')

// --- filterSemrushBots: null / empty inputs don't throw ---
assert(filterSemrushBots(null, 'ai') === null, 'null semrush returns null')
assert(
  filterSemrushBots({ botAccess: null }, 'ai').botAccess === null,
  'missing bots returns input unchanged'
)

// --- TAB_SOURCES: every tab maps only to valid source ids ---
for (const [tab, sources] of Object.entries(TAB_SOURCES)) {
  assert(Array.isArray(sources) && sources.length > 0, `${tab} has sources`)
  for (const s of sources) {
    assert(SOURCE_IDS.includes(s), `${tab} source "${s}" is a known panel id`)
  }
}
// AI + Crawlability share the same single source (the shared-scan promise).
assert(
  TAB_SOURCES.ai.length === 1 &&
    TAB_SOURCES.crawlability.length === 1 &&
    TAB_SOURCES.ai[0] === TAB_SOURCES.crawlability[0],
  'AI Discoverability and Crawlability share one source'
)

console.log(`${passed} assertions passed.`)
