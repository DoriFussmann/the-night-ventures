// Scheduled publishing (Sprint 3): dates, controls, the daily publisher.
// Run: node scripts/test-publish-schedule.mjs
import assert from 'node:assert/strict'
import {
  addDays,
  dueItems,
  itemLabel,
  nextOf,
  normalizeSettings,
  planDates,
  reflowOpen,
  summarize,
  summaryLine,
  takenDays,
  todayIn,
} from '../lib/publish-schedule/plan.js'
import { figureConflicts } from '../lib/publish-schedule/figures.js'
import { applyCoveragePublished } from '../lib/publish-schedule/coverage.js'
import { teamDirFromContentConfig } from '../lib/publish-to-site/author.js'
import { articleFromRow, publishAndRecord, runPublishDue } from '../lib/publish-schedule/run.js'

let passed = 0
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1
      console.log(`✓ ${name}`)
    })
    .catch((err) => {
      console.error(`✗ ${name}`)
      throw err
    })
}

const S = normalizeSettings({ intervalDays: 2, timezone: 'UTC' })

await test('six articles: today, +2, +4, +6, +8, +10', () => {
  assert.deepEqual(planDates({ count: 6, start: '2026-10-26', settings: S }), [
    '2026-10-26',
    '2026-10-28',
    '2026-10-30',
    '2026-11-01',
    '2026-11-03',
    '2026-11-05',
  ])
})

await test('skip weekends moves Saturday/Sunday to Monday', () => {
  const dates = planDates({ count: 3, start: '2026-10-30', settings: { ...S, weekends: 'skip' } })
  // Fri Oct 30, then Sun Nov 1 → Mon Nov 2, then Wed Nov 4
  assert.deepEqual(dates, ['2026-10-30', '2026-11-02', '2026-11-04'])
})

await test('a day another schedule uses moves to the next free day', () => {
  const dates = planDates({ count: 2, start: '2026-10-26', settings: S, taken: ['2026-10-26'] })
  assert.deepEqual(dates, ['2026-10-27', '2026-10-29'])
})

await test('settings are clamped', () => {
  assert.equal(normalizeSettings({ intervalDays: 30 }).intervalDays, 2)
  assert.equal(normalizeSettings({ approval: 'x' }).approval, 'auto')
  assert.equal(normalizeSettings({}).timezone, 'America/Los_Angeles')
})

await test('todayIn uses the schedule time zone', () => {
  const now = new Date('2026-10-27T03:00:00Z') // Oct 26, 8pm in Los Angeles
  assert.equal(todayIn('America/Los_Angeles', now), '2026-10-26')
  assert.equal(todayIn('UTC', now), '2026-10-27')
})

const schedule = { id: 's1', company_id: 'c1', status: 'active', settings: S, pillar_keyword: 'Investor outreach' }
const item = (id, position, publish_on, status = 'scheduled', extra = {}) => ({
  id,
  schedule_id: 's1',
  company_id: 'c1',
  position,
  publish_on,
  status,
  generated_article_id: status === 'to_write' ? null : `g-${id}`,
  attempts: 0,
  keyword: `kw ${id}`,
  ...extra,
})

await test('publish next now: the rest re-space from today + interval', () => {
  const items = [item('a', 0, '2026-10-26', 'published'), item('b', 1, '2026-10-28'), item('c', 2, '2026-10-30')]
  // b published early on Oct 27 → c moves to Oct 29
  const rest = items.filter((i) => i.id !== 'b')
  assert.deepEqual(reflowOpen(rest, { start: addDays('2026-10-27', 2), settings: S }), [
    { id: 'c', publish_on: '2026-10-29' },
  ])
})

await test('nextOf: due today, later, not written, needs approval, stuck on failure', () => {
  assert.equal(nextOf(schedule, [item('a', 0, '2026-10-26')], '2026-10-26').due, true)
  assert.equal(nextOf(schedule, [item('a', 0, '2026-10-28')], '2026-10-26').reason, 'later')
  assert.equal(nextOf(schedule, [item('a', 0, '2026-10-26', 'to_write')], '2026-10-26').reason, 'not_written')
  const approve = { ...schedule, settings: { ...S, approval: 'approve' } }
  assert.equal(nextOf(approve, [item('a', 0, '2026-10-26')], '2026-10-26').reason, 'needs_approval')
  assert.equal(nextOf(approve, [item('a', 0, '2026-10-26', 'scheduled', { approved_at: 'x' })], '2026-10-26').due, true)
  const stuck = nextOf(schedule, [item('a', 0, '2026-10-24', 'failed'), item('b', 1, '2026-10-26')], '2026-10-26')
  assert.equal(stuck.reason, 'failed')
  assert.equal(stuck.due, false)
  assert.equal(nextOf({ ...schedule, status: 'paused' }, [item('a', 0, '2026-10-26')], '2026-10-26').due, false)
})

await test('dueItems: one per site per day across pillars', () => {
  const s2 = { ...schedule, id: 's2' }
  const items = [item('a', 0, '2026-10-26'), { ...item('b', 0, '2026-10-26'), schedule_id: 's2' }]
  const now = new Date('2026-10-26T16:00:00Z')
  assert.equal(dueItems([schedule, s2], items, { now }).length, 1)
  assert.equal(dueItems([schedule, s2], items, { now, publishedToday: new Set(['c1']) }).length, 0)
  const other = { ...s2, company_id: 'c2' }
  assert.equal(dueItems([schedule, other], items.map((i) => ({ ...i, company_id: i.schedule_id === 's2' ? 'c2' : 'c1' })), { now }).length, 2)
})

await test('summary: 3 of 6 published, next Nov 1', () => {
  const items = [
    item('a', 0, '2026-10-26', 'published'),
    item('b', 1, '2026-10-28', 'published'),
    item('c', 2, '2026-10-30', 'published'),
    item('d', 3, '2026-11-01'),
    item('e', 4, '2026-11-03'),
    item('f', 5, '2026-11-05'),
    item('g', 6, '2026-11-07', 'skipped'),
  ]
  const s = summarize(schedule, items, '2026-10-31')
  assert.equal(s.published, 3)
  assert.equal(s.total, 6)
  assert.equal(s.next.id, 'd')
  assert.equal(summaryLine(schedule, items, '2026-10-31'), 'Investor outreach: 3 of 6 published, next Nov 1')
  assert.equal(itemLabel(items[3], schedule, '2026-11-01'), 'Due')
  assert.equal(itemLabel(items[6], schedule, '2026-11-01'), 'Skipped')
  assert.deepEqual(takenDays(items), ['2026-11-01', '2026-11-03', '2026-11-05'])
})

await test('figure check flags the same claim with a different number', () => {
  const mine = 'Carta data shows that seed rounds raised a median of $14.4M across the companies in the dataset last year.'
  const theirs = 'Carta data shows that seed rounds raised a median of $12M across the companies in the dataset last year.'
  const notes = figureConflicts(mine, [{ slug: 'other', body: theirs }])
  assert.equal(notes.length, 1)
  assert.match(notes[0].message, /\$14\.4M.*\$12M.*\/articles\/other\//)
  assert.equal(figureConflicts(mine, [{ slug: 'x', body: mine }]).length, 0)
  assert.equal(figureConflicts(mine, [{ slug: 'x', body: 'Cats sleep 70% of the day.' }]).length, 0)
})

await test('author folder comes from the content config', () => {
  assert.equal(
    teamDirFromContentConfig('const team = defineCollection({ loader: glob({ base: "./src/content/team" }), schema: teamSchema })'),
    'site/src/content/team'
  )
  assert.equal(
    teamDirFromContentConfig('const people = defineCollection({ loader: glob({ base: "./src/content/people" }), schema: ({image}) => teamSchema(image) })'),
    'site/src/content/people'
  )
  assert.equal(teamDirFromContentConfig(''), 'site/src/content/team')
})

const MAP = [
  {
    slug: 'investor-outreach',
    keyword: 'Investor outreach',
    spec: { status: 'live' },
    supporting: [
      {
        slug: 'cold-email-investors',
        keyword: 'cold email investors',
        spec: { status: 'drafted', keyMessages: ['a', 'b', 'c'] },
        plannedArticles: [{ title: 'How to cold email investors', targetKeyword: 'cold email investors', status: 'drafted' }],
      },
    ],
  },
]

await test('coverage: published article goes Live with its URL', () => {
  const r = applyCoveragePublished(MAP, {
    pillarKeyword: 'Investor outreach',
    supportingKeyword: 'cold email investors',
    successes: [{ targetKeyword: 'cold email investors', title: 'x', frontmatter: { slug: 'how-to-cold-email-investors' } }],
    publishedUrl: 'https://www.heyrupert.com/articles/how-to-cold-email-investors/',
  })
  assert.equal(r.updated, 1)
  const sup = r.pillars[0].supporting[0]
  assert.equal(sup.spec.status, 'live')
  assert.equal(sup.plannedArticles[0].status, 'published')
  assert.equal(MAP[0].supporting[0].spec.status, 'drafted', 'input is not mutated')
})

// ── Publisher with an in-memory database ──────────────────────────────
function fakeDb(tables) {
  const db = JSON.parse(JSON.stringify(tables))
  const match = (row, filters) => filters.every(([k, op, v]) => (op === 'in' ? v.includes(row[k]) : row[k] === v))
  function q(table) {
    const state = { filters: [], patch: null, upsert: null }
    const rows = () => (db[table] || []).filter((r) => match(r, state.filters))
    const api = {
      select: () => api,
      eq: (k, v) => (state.filters.push([k, 'eq', v]), api),
      in: (k, v) => (state.filters.push([k, 'in', v]), api),
      update: (patch) => ((state.patch = patch), api),
      upsert: (row) => {
        db[table] = (db[table] || []).filter((r) => r.company_id !== row.company_id)
        db[table].push(row)
        return Promise.resolve({ error: null })
      },
      maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
      then: (resolve) => {
        if (state.patch) {
          for (const r of rows()) Object.assign(r, state.patch)
          return resolve({ error: null })
        }
        return resolve({ data: rows(), error: null })
      },
    }
    return api
  }
  return { db, from: q }
}

const ROW = {
  id: 'g-b',
  company_id: 'c1',
  slug: 'how-to-cold-email-investors',
  title: 'How to cold email investors',
  description: 'd',
  body: 'Intro.\n\n## Where Things Stand\n<!-- WHERE-THINGS-STAND:START -->\nOld paragraph.\n<!-- WHERE-THINGS-STAND:END -->\n',
  pillar_keyword: 'Investor outreach',
  supporting_keyword: 'cold email investors',
  target_keyword: 'cold email investors',
  type: 'howto',
  tags: [],
  keywords: [],
  faqs: [],
  created_at: '2026-10-01T10:00:00Z',
  hero_storage_path: 'c1/how-to-cold-email-investors.png',
}

function tablesWith(itemPatch = {}) {
  return {
    generated_articles: [ROW],
    companies: [{ id: 'c1', github_owner: 'DoriFussmann', github_repo: 'hey-rupert', github_token_key: 'HEYRUPERT' }],
    company_profiles: [{ company_id: 'c1', domain: 'www.heyrupert.com' }],
    content_coverage: [{ company_id: 'c1', pillars: MAP }],
    publish_schedules: [schedule],
    publish_schedule_items: [
      item('a', 0, '2026-10-24', 'published', { published_at: '2026-10-24T16:00:00Z' }),
      { ...item('b', 1, '2026-10-26'), ...itemPatch },
    ],
  }
}

function fakeDeps(overrides = {}) {
  const calls = { commit: [], merge: 0, wire: 0, wts: 0 }
  const deps = {
    readDestination: (b) => ({ owner: b.owner, repo: b.repo, tokenKey: b.tokenKey, targetBranch: 'main', token: 't' }),
    checkContract: async () => ({ ok: true }),
    commitArticle: async (args) => {
      calls.commit.push(args)
      return { ok: true, branch: 'publish/x', committed: [{ path: 'a' }], skipped: [], errors: [] }
    },
    mergePublishBranch: async () => {
      calls.merge += 1
      return { sha: 'abc' }
    },
    wireLinksOnSite: async () => {
      calls.wire += 1
      return { ok: true, updated: 2 }
    },
    loadLiveArticles: async () => [],
    refreshWts: async () => {
      calls.wts += 1
      return { updateWarranted: true, proposedParagraph: 'Fresh paragraph.' }
    },
    ...overrides,
  }
  return { deps, calls }
}

const NOW = new Date('2026-10-26T16:00:00Z')

await test('daily run publishes the due article, dated today, and marks it Live', async () => {
  const supabase = fakeDb(tablesWith())
  const { deps, calls } = fakeDeps()
  const result = await runPublishDue({ supabase, now: NOW, deps })
  assert.equal(result.published.length, 1)
  assert.equal(calls.merge, 1)
  assert.equal(calls.wire, 1, 'links wired after publishing')
  const md = calls.commit[0].article.content
  assert.match(md, /^date: "?2026-10-26"?$/m)
  assert.match(md, /^draft: false$/m)
  assert.match(md, /Fresh paragraph\./, 'stale draft (25 days) got its Where Things Stand refreshed')
  const it = supabase.db.publish_schedule_items.find((i) => i.id === 'b')
  assert.equal(it.status, 'published')
  assert.equal(it.published_url, 'https://www.heyrupert.com/articles/how-to-cold-email-investors/')
  assert.equal(supabase.db.generated_articles[0].status, 'published')
  assert.equal(supabase.db.content_coverage[0].pillars[0].supporting[0].spec.status, 'live')
  assert.equal(supabase.db.publish_schedules[0].status, 'done', 'schedule done when nothing is left')
})

await test('a site that already published today waits for tomorrow', async () => {
  const supabase = fakeDb(tablesWith())
  supabase.db.publish_schedule_items[0].published_at = '2026-10-26T09:00:00Z'
  const { deps } = fakeDeps()
  const result = await runPublishDue({ supabase, now: NOW, deps })
  assert.equal(result.published.length, 0)
})

await test('failure: error saved, retried, Failed after 3 attempts', async () => {
  const supabase = fakeDb(tablesWith())
  const { deps } = fakeDeps({
    commitArticle: async () => ({ ok: false, committed: [], skipped: [], errors: [{ message: 'The site has no team member in site/src/content/team/' }] }),
  })
  for (let n = 1; n <= 3; n += 1) {
    const it = supabase.db.publish_schedule_items.find((i) => i.id === 'b')
    await publishAndRecord({ supabase, schedule, item: { ...it }, now: NOW, deps })
    const after = supabase.db.publish_schedule_items.find((i) => i.id === 'b')
    assert.equal(after.attempts, n)
    assert.equal(after.status, n < 3 ? 'scheduled' : 'failed')
    assert.match(after.last_error, /no team member/)
  }
  assert.equal(supabase.db.generated_articles[0].status, undefined, 'draft untouched on failure')
})

await test('a fresh draft is published as written (no refresh)', async () => {
  const supabase = fakeDb(tablesWith())
  supabase.db.generated_articles[0].created_at = '2026-10-20T10:00:00Z'
  const { deps, calls } = fakeDeps()
  await runPublishDue({ supabase, now: NOW, deps })
  assert.equal(calls.wts, 0)
  assert.match(calls.commit[0].article.content, /Old paragraph\./)
})

await test('articleFromRow: hero path and author', () => {
  const { article } = articleFromRow(ROW, '2026-10-26')
  assert.equal(article.filename, 'how-to-cold-email-investors.md')
  assert.equal(article.storagePath, 'c1/how-to-cold-email-investors.png')
  assert.match(article.content, /^author: dori-fussmann$/m)
})

console.log(`\n${passed} passed`)
