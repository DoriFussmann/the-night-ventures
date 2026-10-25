// Length check for ChatGPT's site-content document, and the Do-tasks export.
// Run: node scripts/test-content-lengths.mjs
import assert from 'node:assert/strict'
import { checkContentLengths } from '../src/pages/tools/siteContentBuild/checkLengths.js'
import { buildDoTasksMarkdown } from '../src/lib/doTasksMarkdown.js'

const pad = (n, ch = 'a') => ch.repeat(n)

const doc = `=== PAGE: home ===
\`\`\`yaml
route: "/"
meta_title: "${pad(55)}"
meta_description: "${pad(150)}"
sections:
  - type: "hero"
    meta_title: "${pad(5)}"
\`\`\`
=== PAGE: privacy ===
\`\`\`yaml
route: "/privacy/"
meta_title: "Privacy Policy \\"Rupert\\""
meta_description: "${pad(139)}"
\`\`\`
=== SERVICE: ai-automation ===
\`\`\`markdown
---
title: "AI automation"
description: "${pad(133)}"
order: 1
---
Body
\`\`\`
=== SERVICE: outreach ===
\`\`\`markdown
---
title: "Outreach"
order: 2
---
\`\`\`
=== QA ===
description: "${pad(10)}"
`

const report = checkContentLengths(doc)
assert.equal(report.blocks, 4)

const find = (where, field) => report.results.find((r) => r.where === where && r.field === field)

assert.equal(find('Page: home', 'meta_title').ok, true)
assert.equal(find('Page: home', 'meta_title').length, 55, 'nested meta_title is ignored')
assert.equal(find('Page: home', 'meta_description').ok, true)

const privacyTitle = find('Page: privacy', 'meta_title')
assert.equal(privacyTitle.value, 'Privacy Policy "Rupert"', 'escaped quotes are unescaped')
assert.equal(privacyTitle.ok, true, 'legal pages only have a max')
assert.equal(find('Page: privacy', 'meta_description').problem, 'too short')

const service = find('Service: ai-automation', 'description')
assert.equal(service.length, 133)
assert.equal(service.ok, false)
assert.equal(service.rule, '140–160')

assert.deepEqual(report.missing, [{ where: 'Service: outreach', field: 'description' }])
assert.equal(report.results.length, 5, 'QA section is not read as a service')

assert.equal(checkContentLengths('just some text').blocks, 0)
assert.equal(checkContentLengths(doc.replace(pad(55), pad(61))).results[0].problem, 'too long')

// Do-tasks export
const { filename, content } = buildDoTasksMarkdown(
  [
    { name: 'Fix token instructions', details: 'Clear steps\nfor Vercel' },
    { name: 'Rename projects', details: '' },
  ],
  new Date('2026-10-24T12:00:00Z')
)
assert.equal(filename, 'tnv-do-tasks-2026-10-24.md')
assert.equal(
  content,
  '# Do tasks\n\nExported 2026-10-24 · 2 tasks\n\n## Fix token instructions\n\nClear steps\nfor Vercel\n\n## Rename projects\n'
)
assert.match(buildDoTasksMarkdown([{ name: 'One', details: '' }]).content, /· 1 task\n/)

console.log('✓ content lengths + do-tasks export')
