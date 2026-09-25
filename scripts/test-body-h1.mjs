// Regression: a body H1 on a destination site fails seo-core's audit and blocks
// the deploy (perfect-ai-websites, local-seo-company, 2026-09-25).
import assert from 'node:assert/strict'
import { demoteArticleMarkdownH1, demoteBodyH1, hasBodyH1 } from '../lib/demoteBodyH1.js'

const fm = (title) => `---\ntitle: "${title}"\nslug: x\n---\n`
let n = 0
const check = (name, fn) => { fn(); n++; console.log('ok -', name) }

check('leading H1 equal to title is removed', () => {
  const out = demoteArticleMarkdownH1(fm('Local SEO Company: What It Does') + '\n# Local SEO Company: What It Does\n\nIntro.\n\n## A\n')
  assert.equal(out, fm('Local SEO Company: What It Does') + '\nIntro.\n\n## A\n')
  assert.equal(hasBodyH1(out), false)
})
check('curly quotes / emphasis still match title', () => {
  const out = demoteArticleMarkdownH1(fm("Don't Panic") + '# *Don\u2019t Panic*\n\nBody\n')
  assert.equal(hasBodyH1(out), false)
  assert.ok(!out.includes('Panic*'))
})
check('non-title H1 is demoted, not removed', () => {
  const out = demoteArticleMarkdownH1(fm('Title') + '# Something Else\n\nBody\n')
  assert.ok(out.includes('## Something Else'))
  assert.equal(hasBodyH1(out), false)
})
check('mid-body H1 and <h1> demoted', () => {
  const out = demoteArticleMarkdownH1(fm('T') + 'Intro\n\n# Mid\n\n<h1 id="a">X</h1>\n')
  assert.ok(out.includes('## Mid') && out.includes('<h2 id="a">X</h2>'))
  assert.equal(hasBodyH1(out), false)
})
check('indented (<=3 spaces) H1 demoted', () => {
  assert.equal(demoteBodyH1('   # Hi'), '   ## Hi')
})
check('## and #hashtag untouched', () => {
  assert.equal(demoteBodyH1('## A\n#hashtag'), '## A\n#hashtag')
})
check('code fences untouched', () => {
  const src = '```\n# comment\n<h1>x</h1>\n```'
  assert.equal(demoteBodyH1(src), src)
})
check('frontmatter untouched', () => {
  const src = '---\ntitle: "# not a heading"\n---\nBody\n'
  assert.equal(demoteArticleMarkdownH1(src), src)
})
check('idempotent', () => {
  const once = demoteArticleMarkdownH1(fm('T') + '# T\n\n# U\n')
  assert.equal(demoteArticleMarkdownH1(once), once)
})
console.log(`\n${n} passed`)
