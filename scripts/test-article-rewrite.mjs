import assert from 'node:assert/strict'
import {
  parseSections,
  listEligibleSections,
  pickRandomSection,
  recommendOption,
  sectionMenu,
  buildRewritePrompt,
  checkGuardrails,
  applyRewriteToBody,
  splitSentences,
  REWRITE_OPTIONS,
} from '../lib/article-updates/rewrite.js'

let passed = 0
const ok = () => { passed++ }

const body = [
  'Intro paragraph with no heading that should never be a section on its own.',
  '',
  '## Pillars and supporting pieces',
  '',
  'A comprehensive pillar covers the parent topic. Supporting articles take a narrower job. The supporting keyword is the contract that keeps URLs from collapsing into each other over time as the cluster grows.',
  '',
  '## A short one',
  '',
  'Too short.',
  '',
  '## Where Things Stand',
  '<!-- WHERE-THINGS-STAND:START -->',
  'As of 2026, teams that keep clusters healthy assign one target keyword per URL and refresh the pillar.',
  '<!-- WHERE-THINGS-STAND:END -->',
  '',
  '## Key Takeaways',
  '',
  '- One URL owns one target keyword.',
  '- Supporting keywords prevent collapse.',
  '',
  '<!-- CMS-EXTERNAL:START -->',
  'Sources: [x](https://e.com).',
  '<!-- CMS-EXTERNAL:END -->',
].join('\n')

// 1. parseSections finds ## sections; protects WTS/Key Takeaways/markers/short.
{
  const sections = parseSections(body)
  const byHeading = Object.fromEntries(sections.map((s) => [s.heading, s]))
  assert.ok(byHeading['Pillars and supporting pieces'].eligible, 'prose section eligible')
  assert.equal(byHeading['A short one'].eligible, false)
  assert.equal(byHeading['A short one'].ineligibleReason, 'too-short')
  assert.equal(byHeading['Where Things Stand'].eligible, false)
  assert.equal(byHeading['Where Things Stand'].ineligibleReason, 'protected-heading')
  assert.equal(byHeading['Key Takeaways'].eligible, false) // protected-heading or no-prose
  ok()
}

// 2. only the one prose section is eligible; intro is not a section.
{
  const eligible = listEligibleSections(body)
  assert.equal(eligible.length, 1)
  assert.equal(eligible[0].heading, 'Pillars and supporting pieces')
  ok()
}

// 3. pickRandomSection returns an eligible section; null when none.
{
  const picked = pickRandomSection(body, () => 0)
  assert.equal(picked.heading, 'Pillars and supporting pieces')
  const noneBody = '## Where Things Stand\n<!-- WHERE-THINGS-STAND:START -->\nx\n<!-- WHERE-THINGS-STAND:END -->'
  assert.equal(pickRandomSection(noneBody, () => 0), null)
  ok()
}

// 4. recommendOption heuristic.
{
  assert.equal(recommendOption({ text: 'Revenue rose 12% in 2024 and 18% in 2025 across regions.' }), 'stat-refresh')
  assert.equal(recommendOption({ text: 'The practice was invented long ago and historically shaped the field.' }), 'historical-note')
  const longAbstract = { text: Array.from({ length: 130 }, () => 'idea').join(' ') }
  assert.equal(recommendOption(longAbstract), 'analogy')
  assert.equal(recommendOption({ text: 'A plain sentence about clusters and URLs and keywords here.' }), 'concrete-example')
  // menu never auto-recommends wordsmithing
  assert.notEqual(sectionMenu({ text: 'plain text' }).recommended, 'wordsmithing')
  assert.ok(sectionMenu({ text: 'x' }).menu.includes('skip'))
  ok()
}

// 5. buildRewritePrompt flags web search only for stat-refresh; additive flag set.
{
  const s = { text: 'Some section text about clusters.' }
  assert.equal(buildRewritePrompt({ section: s, option: 'stat-refresh' }).needsWebSearch, true)
  assert.equal(buildRewritePrompt({ section: s, option: 'analogy' }).needsWebSearch, false)
  assert.equal(buildRewritePrompt({ section: s, option: 'analogy' }).additive, true)
  assert.equal(buildRewritePrompt({ section: s, option: 'wordsmithing' }).additive, false)
  ok()
}

// 6. guardrails — additive PASS: original sentences kept, one added, keyword kept.
{
  const original = 'Clusters need a map. Two drafts should not compete for one query.'
  const proposed = 'Clusters need a map. Two drafts should not compete for one query. For example, a pricing guide and a pricing FAQ target different intents.'
  const r = checkGuardrails({ original, proposed, option: 'concrete-example', targetKeyword: 'clusters' })
  assert.equal(r.ok, true, JSON.stringify(r.failures))
  ok()
}

// 7. guardrails — additive FAIL: an original sentence was rewritten (not additive).
{
  const original = 'Clusters need a map. Two drafts should not compete.'
  const proposed = 'Clusters really need a solid map. Two drafts should not compete.'
  const r = checkGuardrails({ original, proposed, option: 'concrete-example' })
  assert.equal(r.ok, false)
  assert.ok(r.failures.some((f) => f.startsWith('additive-violation')))
  ok()
}

// 8. guardrails — keyword decrease fails.
{
  const original = 'Topic clusters matter. Topic clusters keep URLs distinct.'
  const proposed = 'Topic clusters matter. They keep URLs distinct.'
  const r = checkGuardrails({ original, proposed, option: 'concrete-example', targetKeyword: 'topic clusters' })
  assert.equal(r.ok, false)
  assert.ok(r.failures.some((f) => f === 'keyword-decreased:target'))
  ok()
}

// 9. guardrails — introduced heading / marker fails.
{
  const original = 'A sentence here.'
  assert.equal(checkGuardrails({ original, proposed: '## New\nA sentence here.', option: 'analogy' }).ok, false)
  assert.equal(checkGuardrails({ original, proposed: 'A sentence here. <!-- CMS-EXTERNAL:START -->', option: 'analogy' }).ok, false)
  ok()
}

// 10. guardrails — wordsmithing allows exactly one changed sentence, not two.
{
  const original = 'Alpha one. Beta two. Gamma three.'
  const oneChanged = 'Alpha one, revised. Beta two. Gamma three.'
  const twoChanged = 'Alpha one, revised. Beta two, revised. Gamma three.'
  assert.equal(checkGuardrails({ original, proposed: oneChanged, option: 'wordsmithing' }).ok, true)
  assert.equal(checkGuardrails({ original, proposed: twoChanged, option: 'wordsmithing' }).ok, false)
  ok()
}

// 11. applyRewriteToBody replaces only the target section; others intact.
{
  const sections = parseSections(body)
  const target = sections.find((s) => s.heading === 'Pillars and supporting pieces')
  const next = applyRewriteToBody(body, target, 'Replaced body text for this section only.')
  assert.ok(next.includes('Replaced body text for this section only.'))
  assert.ok(next.includes('## Pillars and supporting pieces'), 'heading kept')
  assert.ok(next.includes('## Where Things Stand'), 'other sections intact')
  assert.ok(next.includes('<!-- WHERE-THINGS-STAND:START -->'), 'WTS block intact')
  assert.ok(!next.includes('A comprehensive pillar covers the parent topic.'), 'old body replaced')
  ok()
}

// 12. splitSentences basic behaviour.
{
  assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?'])
  ok()
}

console.log(`\nAll ${passed} rewrite assertions passed.`)
