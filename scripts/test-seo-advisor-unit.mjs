/**
 * Offline unit tests for the SEO Advisor: keyword store (content_coverage),
 * chat history repair, recommendation tool, market injection, UI history mapping.
 * No network, no keys. Run: node scripts/test-seo-advisor-unit.mjs
 */
import assert from 'node:assert/strict'
import {
  applyAddCore,
  applyAddSupporting,
  applyRemoveCore,
  applyRemoveSupporting,
  applyReplaceTree,
  keywordStore,
  mutateCoverage,
  serializeTree,
  toCoreKeywordsMirror,
} from '../lib/seo-advisor/pillars.js'
import { buildSystemPrompt, messagesFromRows } from '../lib/seo-advisor/context.js'
import { executeTool, recommendKeyword, TOOL_DEFINITIONS } from '../lib/seo-advisor/tools.js'
import { researchLocale } from '../lib/seo-advisor/markets.js'
import { messagesToUi } from '../src/pages/tools/seoAdvisor/history.js'

let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`✓ ${name}`)
  } catch (err) {
    console.error(`✗ ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

const tree = () => [
  {
    slug: 'email-marketing',
    keyword: 'Email Marketing',
    pillarArticle: { status: 'planned', title: 'Guide' },
    supporting: [
      { slug: 'email-templates', keyword: 'email templates', plannedArticles: [{ title: 'x' }] },
      { slug: 'newsletter-tools', keyword: 'newsletter tools', plannedArticles: [] },
    ],
  },
  {
    slug: 'crm-software',
    keyword: 'CRM Software',
    supporting: [{ slug: 'crm-pricing', keyword: 'crm pricing', plannedArticles: [] }],
  },
]

/* ---------------- Tree operations ---------------- */

await test('add core: appends with metrics, rejects duplicates anywhere', () => {
  const { pillars, added } = applyAddCore(tree(), { keyword: '  Sales  Automation ', searchVolume: '1900', difficulty: 41 }, { source: 'advisor' })
  assert.equal(pillars.length, 3)
  assert.equal(added.keyword, 'Sales Automation')
  assert.equal(added.slug, 'sales-automation')
  assert.equal(added.searchVolume, 1900)
  assert.equal(added.difficulty, 41)
  assert.equal(added.source, 'advisor')
  assert.throws(() => applyAddCore(tree(), { keyword: 'crm software' }), (e) => e.statusCode === 409)
  assert.throws(() => applyAddCore(tree(), { keyword: 'CRM Pricing' }), /Supporting keyword under “CRM Software”/)
})

await test('add supporting: under named core; rejects missing core and duplicates', () => {
  const { pillars, core } = applyAddSupporting(tree(), { core: 'crm software', keyword: 'best crm for startups', searchVolume: 880 })
  assert.equal(core, 'CRM Software')
  assert.deepEqual(pillars[1].supporting.map((s) => s.keyword), ['crm pricing', 'best crm for startups'])
  assert.deepEqual(pillars[1].supporting[1].plannedArticles, [])
  assert.throws(() => applyAddSupporting(tree(), { core: 'Nope', keyword: 'x' }), (e) => e.statusCode === 404)
  assert.throws(() => applyAddSupporting(tree(), { core: 'CRM Software', keyword: 'Email Templates' }), (e) => e.code === 'duplicate')
  assert.throws(() => applyAddSupporting(tree(), { core: 'CRM Software', keyword: 'email marketing' }), (e) => e.code === 'duplicate')
})

await test('remove: locked items refuse, unlocked go', () => {
  assert.throws(() => applyRemoveCore(tree(), { core: 'Email Marketing' }), (e) => e.code === 'locked')
  assert.throws(() => applyRemoveSupporting(tree(), { core: 'Email Marketing', keyword: 'email templates' }), (e) => e.code === 'locked')
  const a = applyRemoveSupporting(tree(), { core: 'Email Marketing', keyword: 'newsletter tools' })
  assert.equal(a.pillars[0].supporting.length, 1)
  const b = applyRemoveCore(tree(), { core: 'crm-software' })
  assert.deepEqual(b.pillars.map((p) => p.keyword), ['Email Marketing'])
  // A generated article locks the core and its supporting keyword.
  const articles = [{ pillar_keyword: 'CRM Software', supporting_keyword: 'crm pricing' }]
  assert.throws(() => applyRemoveCore(tree(), { core: 'CRM Software' }, articles), (e) => e.code === 'locked')
  assert.throws(() => applyRemoveSupporting(tree(), { core: 'CRM Software', keyword: 'crm pricing' }, articles), (e) => e.code === 'locked')
})

await test('serializeTree flags locks and metrics', () => {
  const t = serializeTree(tree())
  assert.equal(t[0].locked, true)
  assert.equal(t[0].supporting[0].locked, true)
  assert.equal(t[0].supporting[1].locked, false)
  assert.equal(t[1].locked, false)
  assert.equal(t[1].searchVolume, null)
})

await test('replace tree: preserves data, keeps locked, renames, reorders, skips dupes', () => {
  const input = [
    { keyword: 'crm software', supporting: ['CRM Pricing', 'crm for agencies', 'newsletter tools'] },
    { keyword: 'Sales Automation', supporting: ['crm for agencies', 'sales cadence'] },
    { keyword: 'email templates', supporting: [] }, // locked supporting elsewhere → skipped
    { keyword: '', supporting: ['orphan'] },
  ]
  const { pillars, keptLocked, skipped } = applyReplaceTree(tree(), input)
  assert.deepEqual(pillars.map((p) => p.keyword), ['crm software', 'Sales Automation', 'Email Marketing'])
  // CRM: existing object kept (slug), label updated, existing supporting matched by slug
  assert.equal(pillars[0].slug, 'crm-software')
  assert.deepEqual(pillars[0].supporting.map((s) => s.keyword), ['CRM Pricing', 'crm for agencies', 'newsletter tools'])
  // Locked Email Marketing kept with its pillarArticle and only its locked child
  assert.deepEqual(pillars[2].pillarArticle, { status: 'planned', title: 'Guide' })
  assert.deepEqual(pillars[2].supporting.map((s) => s.keyword), ['email templates'])
  assert.deepEqual(pillars[2].supporting[0].plannedArticles, [{ title: 'x' }])
  assert.deepEqual(keptLocked, ['Email Marketing'])
  assert.deepEqual(skipped.sort(), ['crm for agencies', 'email templates'])
  assert.deepEqual(pillars[1].supporting.map((s) => s.keyword), ['sales cadence'])
})

await test('replace tree: locked core cannot be claimed as someone else’s supporting', () => {
  const { pillars, skipped } = applyReplaceTree(tree(), [
    { keyword: 'CRM Software', supporting: ['email marketing'] },
  ])
  assert.deepEqual(skipped, ['email marketing'])
  assert.ok(pillars.some((p) => p.keyword === 'Email Marketing'))
})

await test('mirror shape matches Company Data', () => {
  assert.deepEqual(toCoreKeywordsMirror(tree()), [
    { keyword: 'Email Marketing', supporting: ['email templates', 'newsletter tools'] },
    { keyword: 'CRM Software', supporting: ['crm pricing'] },
  ])
})

/* ---------------- Persistence with a mock Supabase ---------------- */

function mockSupabase({ row, conflictsBeforeSuccess = 0 }) {
  const state = { row: row ? { ...row } : null, profileCoreKeywords: null, updates: 0, inserts: 0 }
  let conflicts = conflictsBeforeSuccess
  const builder = (table) => {
    const q = { table, filters: {}, op: 'select', payload: null }
    const api = {
      select() {
        return api
      },
      eq(col, val) {
        q.filters[col] = val
        return api
      },
      update(payload) {
        q.op = 'update'
        q.payload = payload
        return api
      },
      insert(payload) {
        q.op = 'insert'
        q.payload = payload
        if (table === 'content_coverage') {
          state.inserts += 1
          state.row = { id: 'cov-1', ...payload }
        }
        return Promise.resolve({ error: null })
      },
      maybeSingle() {
        if (table === 'content_coverage') return Promise.resolve({ data: state.row, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      then(resolve, reject) {
        let result = { data: [], error: null }
        if (table === 'generated_articles') result = { data: [], error: null }
        if (table === 'content_coverage' && q.op === 'update') {
          if (conflicts > 0) {
            conflicts -= 1
            state.row = { ...state.row, updated_at: `bumped-${conflicts}` }
            result = { data: [], error: null }
          } else if (q.filters.updated_at && q.filters.updated_at !== state.row.updated_at) {
            result = { data: [], error: null }
          } else {
            state.updates += 1
            state.row = { ...state.row, ...q.payload }
            result = { data: [{ id: state.row.id }], error: null }
          }
        }
        if (table === 'company_profiles' && q.op === 'update') {
          state.profileCoreKeywords = q.payload.core_keywords
          result = { data: null, error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return api
  }
  return { client: { from: builder }, state }
}

await test('mutateCoverage retries on concurrent write and mirrors to profile', async () => {
  const { client, state } = mockSupabase({
    row: { id: 'cov-1', pillars: tree(), updated_at: 't0' },
    conflictsBeforeSuccess: 2,
  })
  const result = await mutateCoverage(client, 'co-1', (pillars) =>
    applyAddCore(pillars, { keyword: 'Lead Scoring' })
  )
  assert.equal(state.updates, 1)
  assert.equal(state.row.pillars.length, 3)
  assert.equal(result.tree[2].keyword, 'Lead Scoring')
  assert.equal(state.profileCoreKeywords.length, 3)
})

await test('mutateCoverage inserts when no coverage row exists', async () => {
  const { client, state } = mockSupabase({ row: null })
  await mutateCoverage(client, 'co-1', (pillars) => applyAddCore(pillars, { keyword: 'First Core' }))
  assert.equal(state.inserts, 1)
  assert.equal(state.row.pillars[0].keyword, 'First Core')
})

await test('replaceTree refuses when the tree changed since the editor loaded it', async () => {
  const { client } = mockSupabase({ row: { id: 'cov-1', pillars: tree(), updated_at: 't0' } })
  const expected = toCoreKeywordsMirror(tree())
  // Someone adds a keyword in the Advisor after Company Data loaded.
  await keywordStore.addCore(client, 'co-1', { keyword: 'Lead Scoring' })
  await assert.rejects(
    keywordStore.replaceTree(client, 'co-1', [{ keyword: 'CRM Software', supporting: [] }], { expected }),
    (e) => e.code === 'stale' && e.statusCode === 409
  )
  // With a fresh baseline it goes through.
  const fresh = toCoreKeywordsMirror([...tree(), { keyword: 'Lead Scoring', supporting: [] }])
  const ok = await keywordStore.replaceTree(client, 'co-1', fresh, { expected: fresh })
  assert.equal(ok.tree.length, 3)
})

/* ---------------- Chat history repair ---------------- */

await test('history: interrupted tool_use gets a synthetic result; orphans dropped; roles merged', () => {
  const rows = [
    { role: 'user', content: { type: 'text', text: 'hi' } },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 't1', name: 'semrush_keyword_research', input: {} },
        { type: 'tool_use', id: 't2', name: 'dataforseo_keyword_volume', input: {} },
      ],
    },
    { role: 'tool', content: { tool_use_id: 't1', content: { available: true, big: 'x'.repeat(5000) } } },
    // t2 never got a result (crash)
    { role: 'tool', content: { tool_use_id: 'zzz', content: {} } }, // orphan
    { role: 'user', content: { type: 'text', text: 'again' } },
    { role: 'assistant', content: [] }, // empty assistant row
    { role: 'user', content: { type: 'text', text: 'third' } },
  ]
  const msgs = messagesFromRows(rows)
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user'])
  const results = msgs[2].content.filter((b) => b.type === 'tool_result')
  assert.deepEqual(results.map((r) => r.tool_use_id), ['t1', 't2'])
  assert.equal(results[1].is_error, true)
  assert.ok(results[0].content.length < 3200, 'old tool results are truncated')
  const texts = msgs[2].content.filter((b) => b.type === 'text').map((b) => b.text)
  assert.deepEqual(texts, ['again', 'third'])
  // tool_results come before text in the merged user turn
  assert.equal(msgs[2].content[0].type, 'tool_result')
})

/* ---------------- Recommendation tool ---------------- */

await test('recommend_keyword: emits card; blocks duplicates; flags missing core', () => {
  const cards = []
  const ctx = { pillars: tree(), onRecommendation: (c) => cards.push(c) }
  const ok = recommendKeyword({ type: 'supporting', keyword: 'crm for agencies', core: 'crm software', search_volume: 320, difficulty: 22, reason: 'fits' }, ctx)
  assert.equal(ok.shown, true)
  assert.equal(cards[0].core, 'CRM Software')
  assert.equal(cards[0].coreExists, true)
  const dup = recommendKeyword({ type: 'core', keyword: 'Newsletter Tools', reason: 'x' }, ctx)
  assert.equal(dup.shown, false)
  assert.match(dup.reason, /already a Supporting keyword/)
  const missing = recommendKeyword({ type: 'supporting', keyword: 'sales cadence', core: 'Sales Automation', reason: 'x' }, ctx)
  assert.equal(missing.shown, true)
  assert.equal(cards[1].coreExists, false)
  assert.equal(cards.length, 2)
})

await test('tool definitions are valid and locale is injected', async () => {
  const names = TOOL_DEFINITIONS.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
  for (const t of TOOL_DEFINITIONS) assert.equal(t.input_schema.type, 'object')

  const calls = []
  const realFetch = globalThis.fetch
  process.env.SEMRUSH_API_KEY = 'test'
  process.env.DATAFORSEO_LOGIN = 'test'
  process.env.DATAFORSEO_PASSWORD = 'test'
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    return { ok: false, status: 418, text: async () => 'nope', json: async () => ({}) }
  }
  try {
    const locale = researchLocale('uk')
    await executeTool('semrush_keyword_research', { keyword: 'crm' }, { locale })
    await executeTool('dataforseo_keyword_volume', { keywords: ['crm'] }, { locale })
    const il = researchLocale('il')
    await executeTool('dataforseo_keyword_ideas', { keyword: 'crm' }, { locale: il })
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(new URL(calls[0].url).searchParams.get('database'), 'uk')
  assert.equal(calls[1].body[0].location_code, 2826)
  assert.equal(calls[1].body[0].language_code, 'en')
  assert.equal(calls[2].body[0].location_code, 2376)
  assert.equal(calls[2].body[0].language_code, 'he')
})

await test('system prompt carries SEO Controls, CI, tree and market', () => {
  const prompt = buildSystemPrompt({
    company: { name: 'Acme' },
    profile: { domain: 'acme.com', target_audience: 'Agency owners', competitors: [{ name: 'Rival', url: 'rival.com' }] },
    industries: ['SaaS'],
    tree: serializeTree(tree()),
    locale: researchLocale('uk'),
  })
  assert.match(prompt, /Company: Acme/)
  assert.match(prompt, /## SEO Controls\n/)
  assert.match(prompt, /Target searcher: Agency owners/)
  assert.match(prompt, /Primary offer: \(not set\)/)
  assert.ok(prompt.indexOf('## SEO Controls') < prompt.indexOf('## Company Intelligence'))
  assert.match(prompt, /Business competitors: Rival — rival\.com/)
  assert.match(prompt, /CORE: Email Marketing \(status planned, LOCKED\) \[2\/10 supporting\]/)
  assert.match(prompt, /supporting: newsletter tools/)
  assert.match(prompt, /United Kingdom/)
})

/* ---------------- UI history mapping ---------------- */

await test('messagesToUi groups parts and rebuilds cards', () => {
  const rows = [
    { id: 'u1', role: 'user', content: { type: 'text', text: 'go' } },
    {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking' },
        { type: 'tool_use', id: 't1', name: 'semrush_keyword_research', input: { keyword: 'crm' } },
      ],
    },
    { id: 'r1', role: 'tool', content: { tool_use_id: 't1', content: { available: true, keyword: 'crm' } } },
    {
      id: 'a2',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Add it' },
        { type: 'tool_use', id: 't2', name: 'recommend_keyword', input: {} },
        { type: 'tool_use', id: 't3', name: 'recommend_keyword', input: {} },
      ],
    },
    { id: 'r2', role: 'tool', content: { tool_use_id: 't2', content: { shown: true, card: { type: 'core', keyword: 'CRM' } } } },
    { id: 'r3', role: 'tool', content: { tool_use_id: 't3', content: { shown: false, reason: 'dup' } } },
  ]
  const ui = messagesToUi(rows)
  assert.equal(ui.length, 2)
  assert.deepEqual(ui[1].parts.map((p) => p.type), ['text', 'tool', 'text', 'rec'])
  assert.equal(ui[1].parts[1].status, 'ok')
  assert.equal(ui[1].parts[3].card.keyword, 'CRM')
})

console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`)
