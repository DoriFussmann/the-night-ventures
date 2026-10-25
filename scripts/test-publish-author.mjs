// Article author resolves to a team member the site actually has.
// Run: node scripts/test-publish-author.mjs
import assert from 'node:assert/strict'
import { resolveArticleAuthor, teamSlugsFromListing } from '../lib/publish-to-site/author.js'

const md = (author) => `---\ntitle: "A title"\n${author === undefined ? '' : `author: ${author}\n`}tags: ["a"]\n---\n\nBody text.\n`

assert.deepEqual(
  teamSlugsFromListing([
    { type: 'file', name: 'jane-doe.md' },
    { type: 'file', name: 'dori-fussmann.md' },
    { type: 'file', name: 'notes.txt' },
    { type: 'dir', name: 'drafts' },
  ]),
  ['dori-fussmann', 'jane-doe']
)
assert.deepEqual(teamSlugsFromListing(null), [])

// Existing author kept untouched
{
  const r = resolveArticleAuthor(md('"dori-fussmann"'), ['dori-fussmann', 'jane-doe'])
  assert.equal(r.changed, false)
  assert.equal(r.markdown, md('"dori-fussmann"'))
}

// Missing author on the site → first team member, body and other fields intact
{
  const r = resolveArticleAuthor(md('"dori-fussmann"'), ['jane-doe'])
  assert.equal(r.changed, true)
  assert.equal(r.author, 'jane-doe')
  assert.equal(r.markdown, md('"jane-doe"'))
}

// No author line at all → added
{
  const r = resolveArticleAuthor(md(undefined), ['jane-doe'])
  assert.equal(r.changed, true)
  assert.match(r.markdown, /\nauthor: "jane-doe"\n---\n\nBody text\.\n$/)
}

// CRLF documents keep CRLF
{
  const crlf = md('"x"').replace(/\n/g, '\r\n')
  const r = resolveArticleAuthor(crlf, ['jane-doe'])
  assert.ok(!/[^\r]\n/.test(r.markdown), 'no bare LF introduced')
}

// No team on the site → clear error
assert.match(resolveArticleAuthor(md('"x"'), []).error, /no team member/)
assert.match(resolveArticleAuthor('no frontmatter', ['a']).error, /no frontmatter/)

console.log('✓ publish author')
