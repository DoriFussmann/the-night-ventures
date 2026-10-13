// Unit tests for the Analytics pure logic (no network, no database).
// Run: node scripts/test-analytics.mjs
import assert from 'node:assert/strict'
import { aiAssistantForSource, classifyBot, ga4AiSourceRegex } from '../lib/analytics/aiSources.js'
import { periodWindows, fromCompactDate, fromMsJsonDate, addDays, dateSpan } from '../lib/analytics/dates.js'
import { pickGscProperty } from '../lib/analytics/gsc.js'
import { pickGa4Property, normalizeGa4Property } from '../lib/analytics/ga4.js'
import { pickBingSite } from '../lib/analytics/bing.js'
import { parseSerpForAi, parseMentions, competitorDomains } from '../lib/analytics/aiVisibility.js'
import { sumSearch, dailySeries, change, comparePages, groupTraffic } from '../lib/analytics/metrics.js'
import { buildOpportunities, expectedCtr, urlKey, brandTerms, aggregateQueries } from '../lib/analytics/opportunities.js'
import { analyticsAction, isCronRequest, normalizeOverrides } from '../lib/analytics/handler.js'
import { readServiceAccount } from '../lib/analytics/google.js'
import { aiCheckDue } from '../lib/analytics/sync.js'

let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`✓ ${name}`)
}

test('AI assistant sources', () => {
  assert.equal(aiAssistantForSource('chatgpt.com'), 'ChatGPT')
  assert.equal(aiAssistantForSource('chat.openai.com'), 'ChatGPT')
  assert.equal(aiAssistantForSource('www.perplexity.ai'), 'Perplexity')
  assert.equal(aiAssistantForSource('perplexity'), 'Perplexity')
  assert.equal(aiAssistantForSource('gemini.google.com'), 'Gemini')
  assert.equal(aiAssistantForSource('copilot.microsoft.com'), 'Copilot')
  assert.equal(aiAssistantForSource('claude.ai'), 'Claude')
  assert.equal(aiAssistantForSource('google'), null)
  assert.equal(aiAssistantForSource('(direct)'), null)
  assert.equal(aiAssistantForSource('meta'), null, 'bare "meta" is ads, not Meta AI')
  assert.equal(aiAssistantForSource('notchatgpt.com'), null)
  const re = new RegExp(ga4AiSourceRegex(), 'i')
  for (const s of ['chatgpt.com', 'perplexity', 'claude.ai', 'gemini.google.com']) assert.ok(re.test(s), s)
})

test('bot classification', () => {
  const ua = (s) => `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ${s}; +https://example.com/bot)`
  assert.deepEqual(classifyBot(ua('GPTBot/1.1')), { bot: 'GPTBot', kind: 'ai_training' })
  assert.deepEqual(classifyBot(ua('OAI-SearchBot/1.0')), { bot: 'OAI-SearchBot', kind: 'ai_search' })
  assert.deepEqual(classifyBot(ua('ChatGPT-User/1.0')), { bot: 'ChatGPT-User', kind: 'ai_user' })
  assert.deepEqual(classifyBot(ua('ClaudeBot/1.0')), { bot: 'ClaudeBot', kind: 'ai_training' })
  assert.deepEqual(classifyBot(ua('PerplexityBot/1.0')), { bot: 'PerplexityBot', kind: 'ai_search' })
  assert.deepEqual(classifyBot(ua('Perplexity-User/1.0')), { bot: 'Perplexity-User', kind: 'ai_user' })
  assert.deepEqual(classifyBot(ua('Googlebot/2.1')), { bot: 'Googlebot', kind: 'search' })
  assert.equal(classifyBot('Mozilla/5.0 (Macintosh) Safari/605.1.15'), null)
  assert.equal(classifyBot(''), null)
})

test('dates', () => {
  assert.deepEqual(periodWindows('2026-10-10', 7), {
    current: { from: '2026-10-04', to: '2026-10-10' },
    previous: { from: '2026-09-27', to: '2026-10-03' },
  })
  assert.equal(fromCompactDate('20261012'), '2026-10-12')
  assert.equal(fromCompactDate('bad'), null)
  assert.equal(fromMsJsonDate('/Date(1316156400000-0700)/'), '2011-09-16')
  assert.equal(fromMsJsonDate('/Date(1399100400000)/'), '2014-05-03')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(dateSpan('2026-01-30', '2026-02-02').length, 4)
})

test('GSC property pick', () => {
  const sites = [
    { siteUrl: 'https://www.acme.com/', permissionLevel: 'siteFullUser' },
    { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteRestrictedUser' },
    { siteUrl: 'sc-domain:other.com', permissionLevel: 'siteUnverifiedUser' },
  ]
  assert.equal(pickGscProperty(sites, 'https://www.acme.com'), 'sc-domain:acme.com')
  assert.equal(pickGscProperty(sites.slice(0, 1), 'acme.com'), 'https://www.acme.com/')
  assert.equal(pickGscProperty(sites, 'other.com'), null)
  assert.equal(pickGscProperty(sites, ''), null)
})

test('GA4 property pick + normalize', () => {
  const props = [
    { property: 'properties/1', hosts: ['other.com'] },
    { property: 'properties/2', hosts: ['acme.com'] },
  ]
  assert.equal(pickGa4Property(props, 'www.acme.com'), 'properties/2')
  assert.equal(pickGa4Property(props, 'nope.com'), null)
  assert.equal(normalizeGa4Property('123'), 'properties/123')
  assert.equal(normalizeGa4Property('properties/9'), 'properties/9')
  assert.equal(normalizeGa4Property('G-ABC'), null)
})

test('Bing site pick', () => {
  const sites = [
    { Url: 'http://acme.com/', IsVerified: true },
    { Url: 'https://www.acme.com/', IsVerified: true },
    { Url: 'https://other.com/', IsVerified: true },
    { Url: 'https://unverified.com/', IsVerified: false },
  ]
  assert.equal(pickBingSite(sites, 'acme.com'), 'https://www.acme.com/')
  assert.equal(pickBingSite(sites, 'unverified.com'), null)
})

test('AI Overview parsing', () => {
  const result = {
    items: [
      {
        type: 'ai_overview',
        references: [
          { type: 'ai_overview_reference', domain: 'rival.io', url: 'https://rival.io/a', title: 'A' },
          { type: 'ai_overview_reference', domain: 'wiki.org', url: 'https://wiki.org/b', title: 'B' },
        ],
        items: [
          {
            type: 'ai_overview_element',
            references: [{ domain: 'www.acme.com', url: 'https://www.acme.com/guide', title: 'G' }],
          },
        ],
      },
      { type: 'organic', rank_group: 4, domain: 'www.acme.com', url: 'https://www.acme.com/guide' },
    ],
  }
  const parsed = parseSerpForAi(result, 'acme.com', competitorDomains([{ name: 'Rival', url: 'https://rival.io' }]))
  assert.equal(parsed.hasAiOverview, true)
  assert.equal(parsed.cited, true)
  assert.deepEqual(parsed.citedUrls, ['https://www.acme.com/guide'])
  assert.deepEqual(parsed.competitorsCited, ['Rival'])
  assert.deepEqual(parsed.citedDomains.sort(), ['rival.io', 'wiki.org'])
  assert.equal(parsed.organicPosition, 4)

  const none = parseSerpForAi({ items: [{ type: 'organic', rank_group: 1, domain: 'x.com' }] }, 'acme.com')
  assert.equal(none.hasAiOverview, false)
  assert.equal(none.cited, false)
  assert.equal(none.organicPosition, null)

  const mentions = parseMentions(
    {
      total_count: 42,
      items: [
        {
          question: 'best widget?',
          ai_search_volume: 900,
          sources: [
            { domain: 'acme.com', url: 'https://acme.com/w' },
            { domain: 'x.com', url: 'https://x.com' },
          ],
        },
      ],
    },
    'acme.com'
  )
  assert.equal(mentions.totalCount, 42)
  assert.deepEqual(mentions.items[0].urls, ['https://acme.com/w'])
})

test('metrics', () => {
  const rows = [
    { date: '2026-10-01', clicks: 10, impressions: 100, position: 5 },
    { date: '2026-10-02', clicks: 20, impressions: 300, position: 9 },
    { date: '2026-09-01', clicks: 999, impressions: 999, position: 1 },
  ]
  const s = sumSearch(rows, '2026-10-01', '2026-10-02')
  assert.equal(s.clicks, 30)
  assert.equal(s.impressions, 400)
  assert.equal(s.ctr, 30 / 400)
  assert.equal(s.position, (5 * 100 + 9 * 300) / 400)
  assert.equal(dailySeries(rows, '2026-10-01', '2026-10-03', ['clicks'])[2].clicks, 0)
  assert.equal(change(15, 10), 0.5)
  assert.equal(change(5, 0), null)

  const cmp = comparePages(
    [
      { page: '/a', clicks: 50, impressions: 500, position: 3 },
      { page: '/b', clicks: 5, impressions: 50, position: 8 },
    ],
    [
      { page: '/a', clicks: 20, impressions: 400, position: 4 },
      { page: '/b', clicks: 30, impressions: 300, position: 6 },
      { page: '/c', clicks: 12, impressions: 90, position: 7 },
    ]
  )
  assert.equal(cmp.top[0].page, '/a')
  assert.equal(cmp.gainers[0].page, '/a')
  assert.deepEqual(
    cmp.losers.map((l) => l.page),
    ['/b', '/c']
  )

  const traffic = groupTraffic(
    [
      { source: 'google', channel: 'Organic Search', ai_assistant: null, sessions: 100, engaged_sessions: 60 },
      { source: 'chatgpt.com', channel: 'Referral', ai_assistant: 'ChatGPT', sessions: 10, engaged_sessions: 8 },
    ],
    [{ source: 'chatgpt.com', channel: 'Referral', ai_assistant: 'ChatGPT', sessions: 4, engaged_sessions: 2 }]
  )
  assert.deepEqual(
    traffic.channels.map((c) => c.name),
    ['Organic Search', 'AI assistants']
  )
  assert.equal(traffic.assistants[0].name, 'ChatGPT')
  assert.equal(traffic.assistants[0].prevSessions, 4)
})

test('opportunities', () => {
  assert.equal(expectedCtr(1), 0.28)
  assert.equal(expectedCtr(14), 0.02)
  assert.equal(expectedCtr(null), null)
  assert.equal(urlKey('https://www.acme.com/blog/x/?q=1'), 'acme.com/blog/x')
  assert.deepEqual(brandTerms('Acme Labs', 'https://www.acme.com'), ['acme labs', 'acme'])
  assert.equal(aggregateQueries([{ query: 'q', page: '/a', clicks: 1, impressions: 10, position: 5 }])[0].page, '/a')

  const library = new Map([[urlKey('https://acme.com/widgets'), { slug: 'widgets', title: 'Widgets' }]])
  const out = buildOpportunities({
    days: 28,
    queries: [
      { query: 'best widgets', page: 'https://acme.com/widgets', clicks: 3, impressions: 400, position: 8.2 },
      { query: 'acme login', page: 'https://acme.com/', clicks: 50, impressions: 400, position: 1 },
      { query: 'widget pricing guide', page: 'https://acme.com/', clicks: 0, impressions: 200, position: 34 },
    ],
    pagesCurrent: [
      { page: 'https://acme.com/widgets', clicks: 2, impressions: 900, position: 3 },
      { page: 'https://acme.com/old', clicks: 4, impressions: 100, position: 12 },
    ],
    pagesPrevious: [{ page: 'https://acme.com/old', clicks: 40, impressions: 300, position: 6 }],
    aiChecks: [
      { keyword: 'widgets', has_ai_overview: true, cited: false, organic_url: 'https://acme.com/widgets', competitors_cited: ['Rival'] },
      { keyword: 'gadgets', has_ai_overview: true, cited: true },
      { keyword: 'gizmos', has_ai_overview: false, cited: false },
    ],
    brand: ['acme'],
    library,
  })
  assert.deepEqual(
    out.striking.map((o) => o.query),
    ['best widgets']
  )
  assert.equal(out.striking[0].library.slug, 'widgets')
  assert.deepEqual(
    out.gap.map((o) => o.query),
    ['widget pricing guide']
  )
  assert.equal(out.gap[0].action, 'idea')
  assert.deepEqual(
    out.low_ctr.map((o) => o.page),
    ['https://acme.com/widgets']
  )
  assert.deepEqual(
    out.decaying.map((o) => o.page),
    ['https://acme.com/old']
  )
  assert.equal(out.decaying[0].metrics.prevClicks, 40)
  assert.deepEqual(
    out.ai_gap.map((o) => [o.query, o.action]),
    [['widgets', 'modify']]
  )
})

test('handler helpers', () => {
  assert.equal(analyticsAction({ url: '/api/audit-snapshot?action=analytics.summary&companyId=x' }), 'analytics.summary')
  assert.equal(analyticsAction({ url: '/api/audit-snapshot', body: { action: 'analytics.refresh' } }), 'analytics.refresh')
  assert.equal(analyticsAction({ url: '/api/audit-snapshot?action=audit.state' }), '')
  assert.equal(isCronRequest({ headers: { 'x-vercel-cron-schedule': '0 9 * * *' } }), true)
  assert.equal(isCronRequest({ headers: {} }), false)
  assert.deepEqual(normalizeOverrides({ gsc: 'sc-domain:acme.com', ga4: '123', bing: '' }), {
    gsc_property_override: 'sc-domain:acme.com',
    ga4_property_override: 'properties/123',
    bing_site_override: null,
  })
  assert.throws(() => normalizeOverrides({ gsc: 'acme.com' }))
  assert.throws(() => normalizeOverrides({ ga4: 'G-123' }))
  assert.throws(() => normalizeOverrides({ bing: 'ftp://x' }))
})

test('service account parsing + AI cadence', () => {
  const json = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: 'line1\\nline2' })
  assert.equal(readServiceAccount(json).client_email, 'sa@p.iam.gserviceaccount.com')
  assert.equal(readServiceAccount(Buffer.from(json).toString('base64')).client_email, 'sa@p.iam.gserviceaccount.com')
  assert.equal(readServiceAccount('not json'), null)
  assert.equal(readServiceAccount(''), null)
  assert.equal(aiCheckDue(null), true)
  assert.equal(aiCheckDue({ ai_checked_at: new Date().toISOString() }), false)
  assert.equal(aiCheckDue({ ai_checked_at: new Date(Date.now() - 8 * 86400000).toISOString() }), true)
})

console.log(`\n${passed} analytics test groups passed`)
