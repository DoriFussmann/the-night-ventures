// Tests for the Build Blueprint "Placeholders" stage engine.
// Run: node scripts/test-placeholders.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { checkPlaceholders, findImageBriefsWithoutSrc, globToRegExp, templateFileHash } from '../lib/placeholders/check.js'
import { githubSiteFiles, isManifest, loadManifest, scanSitePlaceholders } from '../lib/placeholders/handler.js'
import { summarize } from '../src/pages/tools/siteBuildFlow/placeholdersSummary.js'

let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log('✓', name)
}

const BUNDLED = JSON.parse(readFileSync(new URL('../lib/placeholders/blueprint.json', import.meta.url), 'utf8'))
const LOGO = Buffer.from([137, 80, 78, 71, 1, 2, 3])

// A blueprint-shaped repo: files under site/.
function templateRepo(overrides = {}) {
  return {
    'package.json': JSON.stringify({ workspaces: ['site'] }),
    'site/package.json': JSON.stringify({ dependencies: { 'seo-core': 'github:DoriFussmann/seo-core#v1.2.0' } }),
    'site/src/config/site.ts': [
      'export const SITE_URL = "https://example.com";',
      'export const SITE_NAME = "Site Name";',
      'export const SITE_TAGLINE = "Primary positioning phrase";',
      'export const SAME_AS: string[] = [];',
      'export const GA4_MEASUREMENT_ID = "";',
      'export const ARTICLES_DESCRIPTION = "x";',
      'export const TEAM_DESCRIPTION = "y";',
    ].join('\n'),
    'site/Design Guide.md': '{ "brand": { "wordmarkPrimary": "Site", "wordmarkAccent": "Name" } }',
    'site/scripts/template-originals.json': JSON.stringify({ 'public/logo.png': templateFileHash('public/logo.png', LOGO) }),
    'site/public/logo.png': LOGO,
    'site/src/content/pages/home.yaml': 'route: /\nsections:\n  - type: hero\n    slides:\n      - image: A desk.\n        alt: Desk\n',
    'site/src/content/pages/privacy.yaml': 'body: "[PLACEHOLDER: replace with reviewed policy]"\n',
    'site/src/content/pages/terms.yaml': 'body: "[PLACEHOLDER: replace with reviewed policy]"\n',
    'site/src/content/team/site-author.md': 'name: "[PLACEHOLDER: author name]"\n',
    ...overrides,
  }
}

function gitSha(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content))
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

// Minimal Octokit double: branch → tree → blobs, contents, tags.
function fakeOctokit(files, { tags = [], seoCoreFiles = {}, calls = {} } = {}) {
  const bump = (k) => (calls[k] = (calls[k] || 0) + 1)
  const blobs = new Map(Object.entries(files).map(([path, c]) => [gitSha(c), c]))
  const content = (c) => ({ data: { type: 'file', sha: gitSha(c), content: Buffer.from(c).toString('base64') } })
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 })
  return {
    repos: {
      getBranch: async () => (bump('getBranch'), { data: { commit: { sha: 'c0ffee1234567', commit: { tree: { sha: 'tree1' } } } } }),
      listTags: async () => (bump('listTags'), { data: tags }),
      getContent: async ({ repo, path, ref }) => {
        bump('getContent')
        if (repo === 'seo-core') {
          const c = seoCoreFiles[`${ref}:${path}`]
          if (!c) throw notFound()
          return content(c)
        }
        if (!(path in files)) throw notFound()
        return content(files[path])
      },
    },
    git: {
      getTree: async () => (
        bump('getTree'),
        {
          data: {
            truncated: false,
            tree: Object.entries(files).map(([path, c]) => ({ path, type: 'blob', sha: gitSha(c), size: Buffer.from(c).length })),
          },
        }
      ),
      getBlob: async ({ file_sha }) => {
        bump('getBlob')
        const c = blobs.get(file_sha)
        if (c === undefined) throw notFound()
        return { data: { encoding: 'base64', content: Buffer.from(c).toString('base64') } }
      },
    },
  }
}

const DEST = { owner: 'acme', repo: 'site', targetBranch: 'main', tokenKey: 'ACME', token: 't' }
const byId = (report, id) => report.results.find((r) => r.id === id)

await check('bundled manifest is valid and has unique ids', () => {
  assert.ok(isManifest(BUNDLED))
  const ids = BUNDLED.checks.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(BUNDLED.checks.filter((c) => (c.level ?? 'required') === 'required').length, 15)
})

await check('globs and image briefs', () => {
  assert.ok(globToRegExp('src/content/pages/*.yaml').test('src/content/pages/home.yaml'))
  assert.ok(!globToRegExp('src/content/pages/*.yaml').test('src/content/pages/a/home.yaml'))
  assert.deepEqual(
    findImageBriefsWithoutSrc('slides:\n  - image: A\n    alt: a\n  - image: B\n    src: ../b.jpg\n').map((f) => f.brief),
    ['A']
  )
})

await check('scan over GitHub: site root from the seo-core pin, statuses per item', async () => {
  const calls = {}
  const result = await scanSitePlaceholders(fakeOctokit(templateRepo(), { calls }), DEST)
  assert.equal(result.siteRoot, 'site')
  assert.equal(result.commitSha, 'c0ffee1234567')
  assert.equal(result.coreVersion, '1.2.0')
  assert.equal(result.manifestSource, 'bundled with TNV', 'no tags → bundled list')
  const r = result.report
  for (const id of ['site-url', 'site-name', 'same-as', 'wordmark', 'template-images', 'image-briefs', 'privacy', 'terms', 'author']) {
    assert.equal(byId(r, id).status, 'placeholder', id)
  }
  assert.equal(byId(r, 'services').status, 'replaced', 'no services files → nothing left (missing: replaced)')
  assert.equal(byId(r, 'page-copy').status, 'replaced')
  assert.equal(byId(r, 'image-briefs').findings[0].file, 'src/content/pages/home.yaml', 'paths are relative to the site root')
  assert.equal(calls.getTree, 1, 'one tree call')
})

await check('manifest comes from seo-core latest tag when it has one', async () => {
  const custom = { ...BUNDLED, checks: BUNDLED.checks.filter((c) => c.id === 'site-url') }
  const octokit = fakeOctokit(templateRepo(), {
    tags: [{ name: 'v1.2.0' }, { name: 'v1.3.0' }],
    seoCoreFiles: { 'v1.3.0:src/placeholders/blueprint.json': JSON.stringify(custom) },
  })
  const result = await scanSitePlaceholders(octokit, DEST)
  assert.equal(result.manifestSource, 'seo-core v1.3.0')
  assert.deepEqual(result.report.results.map((x) => x.id), ['site-url'])
})

await check('latest tag without a manifest (pre-1.3.0) falls back to the bundled list', async () => {
  const { source } = await loadManifest(fakeOctokit({}, { tags: [{ name: 'v1.2.0' }] }), { owner: 'DoriFussmann', repo: 'seo-core' })
  assert.equal(source, 'bundled with TNV')
})

await check('an activated site: replaced, review, then sign-off completes the stage', async () => {
  const files = templateRepo({
    'site/src/config/site.ts': [
      'export const SITE_URL = "https://acme.com";',
      'export const SITE_NAME = "Acme";',
      'export const SITE_TAGLINE = "We fix things";',
      'export const SAME_AS: string[] = ["https://www.linkedin.com/company/acme"];',
      'export const GA4_MEASUREMENT_ID = "";',
      'export const ARTICLES_DESCRIPTION = "x";',
      'export const TEAM_DESCRIPTION = "y";',
    ].join('\n'),
    'site/Design Guide.md': '{ "brand": { "wordmarkPrimary": "Ac", "wordmarkAccent": "me" } }',
    'site/public/logo.png': Buffer.from([1, 2, 3]),
    'site/src/content/pages/home.yaml': 'route: /\nsections:\n  - type: hero\n    slides:\n      - image: A desk.\n        alt: Desk\n        src: ../a.jpg\n',
    'site/src/content/pages/privacy.yaml': 'body: Our policy.\n',
    'site/src/content/pages/terms.yaml': 'body: Our terms.\n',
    'site/src/content/team/site-author.md': 'name: "Jane Doe"\n',
  })
  const { report } = await scanSitePlaceholders(fakeOctokit(files), DEST)
  assert.equal(report.clear, true)
  assert.equal(byId(report, 'privacy').status, 'review')
  assert.equal(byId(report, 'testimonials').status, 'review', 'no testimonials page: still confirmed by a person')

  let s = summarize(report, {})
  assert.equal(s.complete, false)
  assert.equal(s.openSignoffs, 3)
  s = summarize(report, { privacy: { at: 'x' }, terms: { at: 'x' }, testimonials: { at: 'x' } })
  assert.equal(s.complete, true)
  assert.equal(s.requiredDone, s.requiredTotal)
})

await check('sign-off is ignored while the placeholder is still there', async () => {
  const { report } = await scanSitePlaceholders(fakeOctokit(templateRepo()), DEST)
  const s = summarize(report, { privacy: { at: 'x' } })
  assert.equal(s.items.find((i) => i.id === 'privacy').state, 'placeholder')
})

await check('reader: prefetch is parallel-safe and cached; files over 5 MB are skipped', async () => {
  const calls = {}
  const files = { 'site/a.png': Buffer.alloc(10), 'site/b.png': Buffer.alloc(20) }
  const octokit = fakeOctokit(files, { calls })
  const tree = Object.entries(files).map(([path, c]) => ({ path, type: 'blob', sha: gitSha(c), size: c.length }))
  tree.push({ path: 'site/huge.png', type: 'blob', sha: 'x', size: 6 * 1024 * 1024 })
  const reader = githubSiteFiles(octokit, DEST, tree, 'site')
  assert.deepEqual(reader.list().sort(), ['a.png', 'b.png', 'huge.png'])
  await reader.prefetch(['a.png', 'b.png', 'a.png'])
  assert.equal((await reader.read('a.png')).length, 10)
  assert.equal(await reader.read('huge.png'), null)
  assert.equal(await reader.read('missing.png'), null)
  assert.equal(calls.getBlob, 2)
})

await check('an unknown check kind reports "unknown", not a crash', async () => {
  const report = await checkPlaceholders(
    { list: () => [], read: () => null },
    { version: 1, template: 't', checks: [{ id: 'x', label: 'X', group: 'g', kind: 'fromTheFuture' }] }
  )
  assert.equal(report.results[0].status, 'unknown')
  assert.equal(report.clear, false)
})

console.log(`All ${passed} placeholder checks passed.`)
