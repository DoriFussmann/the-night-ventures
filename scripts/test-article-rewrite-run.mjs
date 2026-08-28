import assert from 'node:assert/strict'
import {
  REWRITE_DEFAULTS,
  readRewriteOpts,
  cleanModelText,
  spliceProposal,
  pickSectionItems,
  proposeRewrites,
  buildRewriteCommitPlan,
} from '../lib/article-updates/rewrite-run.js'

let passed = 0
const ok = () => { passed++ }

const SECTION_HEADING = 'Pillars and supporting pieces'
const SECTION_BODY =
  'A comprehensive pillar covers the parent topic. Supporting articles take a narrower job. The supporting keyword is the contract that keeps topic clusters from collapsing into each other over time.'

function makeArticle(slug, { draft = false } = {}) {
  const body = [
    'Intro line with enough words here to exist as prose but no heading at all.',
    '',
    `## ${SECTION_HEADING}`,
    '',
    SECTION_BODY,
    '',
    '## Where Things Stand',
    '<!-- WHERE-THINGS-STAND:START -->',
    'As of 2026, teams assign one target keyword per URL.',
    '<!-- WHERE-THINGS-STAND:END -->',
  ].join('\n')
  const raw = [
    '---',
    `title: "${slug} title"`,
    'date: "2026-01-01"',
    'updatedDate: "2026-01-01"',
    'pillarKeyword: "content strategy"',
    'targetKeyword: "topic clusters"',
    `draft: ${draft}`,
    '---',
    '',
    body,
  ].join('\n')
  return {
    ok: true,
    slug,
    path: `site/src/content/articles/${slug}.md`,
    raw,
    body,
    data: { title: `${slug} title`, targetKeyword: 'topic clusters', pillarKeyword: 'content strategy', draft },
  }
}

// 1. readRewriteOpts defaults + clamps.
{
  assert.deepEqual(readRewriteOpts({}), REWRITE_DEFAULTS)
  assert.equal(readRewriteOpts({ batchSize: 999 }).batchSize, 25)
  assert.equal(readRewriteOpts({ maxCommit: 99 }).maxCommit, 10)
  assert.equal(readRewriteOpts({ rankThreshold: 20 }).threshold, 20)
  ok()
}

// 2. cleanModelText / spliceProposal.
{
  assert.equal(cleanModelText('```\nhello\n```'), 'hello')
  assert.equal(cleanModelText('"quoted"'), 'quoted')
  const spliced = spliceProposal('Orig sentence.', 'Added sentence.', true)
  assert.ok(spliced.startsWith('Orig sentence.'))
  assert.ok(spliced.endsWith('Added sentence.'))
  assert.ok(spliced.includes('\n\n'))
  assert.equal(spliceProposal('Orig.', 'Whole new section.', false), 'Whole new section.')
  ok()
}

// 3. pickSectionItems picks the eligible section + recommends an option.
{
  const live = [makeArticle('a')]
  const { items, noSection } = pickSectionItems(live, ['a'], { a: { position: 42 } }, { rng: () => 0 })
  assert.equal(items.length, 1)
  assert.equal(items[0].heading, SECTION_HEADING)
  assert.equal(items[0].position, 42)
  assert.ok(items[0].menu.includes('skip'))
  assert.equal(noSection.length, 0)
  ok()
}

// 4. proposeRewrites — additive option appends, passes guardrails.
{
  const live = [makeArticle('a')]
  const callModel = async () => 'For example, a pricing pillar and a pricing FAQ target different intents.'
  const { proposals, dropped } = await proposeRewrites(
    live,
    [{ slug: 'a', heading: SECTION_HEADING, option: 'concrete-example' }],
    {},
    { callModel }
  )
  assert.equal(proposals.length, 1, JSON.stringify(dropped))
  assert.ok(proposals[0].proposedSectionText.includes(SECTION_BODY), 'original kept verbatim')
  assert.ok(proposals[0].proposedSectionText.includes('pricing pillar'), 'addition present')
  ok()
}

// 5. proposeRewrites — a model reply that drops an original sentence is dropped.
{
  const live = [makeArticle('a')]
  const callModel = async () =>
    'A comprehensive pillar covers many topics, revised. Supporting articles do other jobs, revised. The supporting keyword is the contract that keeps topic clusters from collapsing into each other over time.'
  const { proposals, dropped } = await proposeRewrites(
    live,
    [{ slug: 'a', heading: SECTION_HEADING, option: 'wordsmithing' }],
    {},
    { callModel }
  )
  assert.equal(proposals.length, 0)
  assert.equal(dropped[0].reason, 'guardrail')
  ok()
}

// 6. proposeRewrites — skip option is dropped; missing section dropped.
{
  const live = [makeArticle('a')]
  const callModel = async () => 'x'
  const out = await proposeRewrites(
    live,
    [
      { slug: 'a', heading: SECTION_HEADING, option: 'skip' },
      { slug: 'a', heading: 'No Such Heading', option: 'analogy' },
    ],
    {},
    { callModel }
  )
  assert.equal(out.proposals.length, 0)
  const reasons = out.dropped.map((d) => d.reason).sort()
  assert.deepEqual(reasons, ['section-not-eligible', 'skipped'])
  ok()
}

// 7. buildRewriteCommitPlan — additive proposal commits; body changed, date bumped.
{
  const live = [makeArticle('a')]
  const proposed = `${SECTION_BODY}\n\nFor example, a pricing pillar and a pricing FAQ target different intents.`
  const plan = buildRewriteCommitPlan(
    live,
    [{ slug: 'a', heading: SECTION_HEADING, option: 'concrete-example', proposedSectionText: proposed }],
    REWRITE_DEFAULTS
  )
  assert.equal(plan.files.length, 1, JSON.stringify(plan.skipped))
  assert.ok(plan.files[0].content.includes('pricing pillar'))
  assert.ok(plan.files[0].content.includes('## Where Things Stand'), 'other sections intact')
  assert.ok(plan.files[0].content.includes(`updatedDate: ${plan.isoDate}`), 'date bumped')
  ok()
}

// 8. commit-plan — one change per article per run.
{
  const live = [makeArticle('a')]
  const proposed = `${SECTION_BODY}\n\nAdded one.`
  const plan = buildRewriteCommitPlan(
    live,
    [
      { slug: 'a', heading: SECTION_HEADING, option: 'analogy', proposedSectionText: proposed },
      { slug: 'a', heading: SECTION_HEADING, option: 'analogy', proposedSectionText: `${SECTION_BODY}\n\nAdded two.` },
    ],
    REWRITE_DEFAULTS
  )
  assert.equal(plan.files.length, 1)
  assert.ok(plan.skipped.some((s) => s.reason === 'one-per-article'))
  ok()
}

// 9. commit-plan — guardrail-failing proposal is skipped, not committed.
{
  const live = [makeArticle('a')]
  const bad = 'Completely different text with no original sentences and dropped keywords.'
  const plan = buildRewriteCommitPlan(
    live,
    [{ slug: 'a', heading: SECTION_HEADING, option: 'concrete-example', proposedSectionText: bad }],
    REWRITE_DEFAULTS
  )
  assert.equal(plan.files.length, 0)
  assert.equal(plan.skipped[0].reason, 'guardrail')
  ok()
}

console.log(`\nAll ${passed} rewrite-run assertions passed.`)
