// Writer intake: docx-style HTML import, brief/article split helpers, keyword
// option checks, generation clean-up, and publish-time inline images.
// Run: node scripts/test-writer-intake.mjs
import assert from 'node:assert/strict'
import TurndownService from 'turndown'
import {
  addTableRule,
  isolateImageLines,
  keepWriterImages,
  ownSiteLinks,
  removeBlocks,
  splitSourceBlocks,
  tnvImageRefs,
  unlinkOffSite,
  writerImageNumbers,
  writerImagesToStorage,
} from '../lib/writer-intake/markdown.js'
import {
  checkKeyword,
  normalizeImages,
  parsePageMeta,
  probeArticleSlug,
  rankOptions,
  sanitizeOptions,
  sitePageConflicts,
  sitePageUrls,
} from '../lib/writer-intake/analyze.js'
import { finalizeWriterBody } from '../lib/writer-intake/finalize.js'
import { resolveInlineImages } from '../lib/writer-intake/publishImages.js'
import { handleAnalyzeWriterArticle } from '../lib/writer-intake/handler.js'
import { buildModifyPrompt, normalizeWriterBrief } from '../lib/generate-article/prompt.js'
import { isStructuralBlock, processArticleBody } from '../api/generate-article.js'
import { prepareSource } from '../src/pages/tools/articleCompose/sourceText.js'

const DOMAIN = 'albumamicorum.com'

// --- import: tables and writer images survive the HTML -> markdown step ---
{
  const service = addTableRule(new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' }))
  const html = [
    '<h3><strong>How It Compares</strong></h3>',
    '<p><img src="writer-image:2" /></p>',
    '<table><tr><td><p><strong>Option</strong></p></td><td><p><strong>Screen needed</strong></p></td></tr>',
    '<tr><td><p>Friend book</p></td><td><p>No</p></td></tr>',
    '<tr><td><p>Digital | typed</p></td><td><p>Yes</p></td></tr></table>',
    '<p>See <a href="https://www.albumamicorum.com/friend-book/animals/">the Animals edition</a>',
    ' and <a href="https://example.org/study">a study</a>.</p>',
    '<p><a href="https://www.albumamicorum.com/"></a>Trailing empty link.</p>',
    '<h3></h3>',
  ].join('')
  const markdown = service.turndown(html)
  assert.match(markdown, /\| Option \| Screen needed \|\n\| --- \| --- \|\n\| Friend book \| No \|/)
  assert.match(markdown, /Digital \\\| typed/, 'pipes inside cells are escaped')

  const prepared = prepareSource(markdown, DOMAIN)
  assert.equal(prepared.writerImageCount, 1)
  assert.equal(prepared.imagesRemoved, 0)
  assert.match(prepared.source, /^### How It Compares$/m, 'bold markers stripped from headings')
  assert.doesNotMatch(prepared.source, /^###\s*$/m, 'empty headings dropped')
  assert.match(prepared.source, /\n\n!\[\]\(writer-image:2\)\n\n/, 'image on its own block')
  assert.match(prepared.source, /\[the Animals edition\]\(https:\/\/www\.albumamicorum\.com\/friend-book\/animals\/\)/)
  assert.doesNotMatch(prepared.source, /example\.org/, 'off-site link pulled out of the text')
  assert.deepEqual(prepared.userLinks.map((l) => l.url), ['https://example.org/study'])
  assert.doesNotMatch(prepared.source, /(^|[^!])\[\]\(/m, 'empty Word links removed')

  // A non-writer image is still removed.
  const other = prepareSource('Text ![x](https://cdn.example.com/a.png) more', DOMAIN)
  assert.equal(other.imagesRemoved, 1)
  assert.equal(other.writerImageCount, 0)
}

// --- markdown helpers ---
{
  const source = 'Brief line\n\n![](writer-image:1)\n\nIntro text.\n\n![](writer-image:2)\n\nBody.\n\n![](writer-image:3)'
  assert.deepEqual(writerImageNumbers(source), [1, 2, 3])
  assert.equal(removeBlocks(source, [0]).startsWith('![](writer-image:1)'), true)
  assert.equal(splitSourceBlocks(source).length, 6)
  const kept = keepWriterImages(source, [2])
  assert.deepEqual(writerImageNumbers(kept), [2])
  assert.doesNotMatch(kept, /\n{3,}/)
  const stored = writerImagesToStorage('![A shelf of books](writer-image:2)\n\n![](writer-image:9)', { 2: 'co/writer/b/2.png' })
  assert.equal(stored, '![A shelf of books](tnv-image:co/writer/b/2.png)')
  assert.deepEqual(tnvImageRefs(stored).map((r) => r.path), ['co/writer/b/2.png'])
  assert.equal(isolateImageLines('Text ![a](writer-image:1) more'), 'Text\n\n![a](writer-image:1)\n\nmore')
  const tableWithImage = '| a | b |\n| --- | --- |\n| ![x](writer-image:1) | y |'
  assert.equal(isolateImageLines(tableWithImage), tableWithImage, 'images inside table cells stay put')
  const links = 'Go [here](https://www.albumamicorum.com/friend-book/) or [there](https://other.com/x).'
  assert.equal(unlinkOffSite(links, DOMAIN), 'Go [here](https://www.albumamicorum.com/friend-book/) or there.')
  assert.deepEqual(ownSiteLinks(links, DOMAIN).map((l) => l.url), ['https://www.albumamicorum.com/friend-book/'])
}

// --- generation clean-up: placeholders exactly once, alt text, own links only ---
{
  const brief = normalizeWriterBrief({ domain: DOMAIN, imageNumbers: [2, 3], imageAlts: { 2: 'Three friend book covers on a table' } })
  const body = [
    'Intro with [a link](https://other.com/) and [our shop](https://www.albumamicorum.com/friend-book/).',
    '![](writer-image:2)',
    'More text ![dup](writer-image:2) and ![x](writer-image:7).',
  ].join('\n\n')
  const out = finalizeWriterBody(body, brief)
  assert.equal((out.body.match(/writer-image:2/g) || []).length, 1, 'duplicate placeholder removed')
  assert.doesNotMatch(out.body, /writer-image:7/, 'unknown placeholder removed')
  assert.match(out.body, /!\[Three friend book covers on a table\]\(writer-image:2\)/, 'suggested alt filled in')
  assert.doesNotMatch(out.body, /other\.com/)
  assert.match(out.body, /\[our shop\]\(https:\/\/www\.albumamicorum\.com\/friend-book\/\)/)
  assert.equal(out.errors.length, 1)
  assert.match(out.errors[0], /writer-image:3/)
  assert.deepEqual(finalizeWriterBody('x', null), { body: 'x', errors: [] })
}

// --- body post-processing keeps images and short tables as their own blocks ---
{
  assert.equal(isStructuralBlock('| a | b |\n| --- | --- |\n| 1 | 2 |'), true)
  assert.equal(isStructuralBlock('![Alt text here](writer-image:2)'), true)
  assert.equal(isStructuralBlock('Prose with ![img](x.png) inside.'), false)
  const body = 'A full paragraph of prose. It has two sentences.\n\n![Alt text here](writer-image:2)\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nNext paragraph. Also two sentences.'
  const processed = processArticleBody(body)
  assert.match(processed, /\n\n!\[Alt text here\]\(writer-image:2\)\n\n/)
  assert.match(processed, /\n\n\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|\n\n/)
}

// --- modify prompt: writer brief replaces "no links"; SEO Controls included ---
{
  const base = {
    abstract: 'x',
    shortDescription: 'y',
    competitors: [],
    audience: '',
    article: { targetKeyword: 'what to write in a friend book', type: 'howto', wordCount: 900 },
    pillarKeyword: 'Friend Books & Friendship Keepsakes',
    supportingKeyword: 'how to start a friendship book for kids',
    sourceArticle: 'word '.repeat(400),
  }
  const plain = buildModifyPrompt(base)
  assert.match(plain, /Do not put links in the body\./)
  assert.doesNotMatch(plain, /WRITER BRIEF/)

  const withBrief = buildModifyPrompt({
    ...base,
    seoControls: { conversionAction: 'Shop My Friends Book', outOfScope: 'Medical advice' },
    writerBrief: {
      domain: DOMAIN,
      targetUrl: 'https://www.albumamicorum.com/friend-book/animals/',
      writerKeyword: 'animal-themed friend book',
      metaTitle: 'Animal Themed Friend Book: Memories Kids Will Treasure',
      imageNumbers: [2, 3],
      imageAlts: { 2: 'Friend book covers' },
      changes: 'Lead with what friends can write.',
    },
  })
  assert.doesNotMatch(withBrief, /Do not put links in the body\./)
  assert.match(withBrief, /WRITER BRIEF/)
  assert.match(withBrief, /now targets "what to write in a friend book"/)
  assert.match(withBrief, /Keep at least one link to https:\/\/www\.albumamicorum\.com\/friend-book\/animals\//)
  assert.match(withBrief, /!\[\]\(writer-image:2\), !\[\]\(writer-image:3\)/)
  assert.match(withBrief, /SEO CONTROLS/)
  assert.match(withBrief, /OUT-OF-SCOPE TOPICS/)
  assert.equal(normalizeWriterBrief(null), null)
}

// --- keyword options: map only, conflicts with pages, retired URLs, articles ---
const keywordMap = [
  {
    keyword: 'Friend Books & Friendship Keepsakes',
    supporting: ['album amicorum', 'how to start a friendship book for kids', 'when to give a friendship book for kids'],
  },
  { keyword: "Children's Keepsakes & Memory", supporting: ['goodbye gift for friend moving away', 'childhood memory book'] },
]
const sitePages = [
  {
    url: 'https://www.albumamicorum.com/friend-book/animals/',
    title: 'Animal-Themed Friend Book for Kids | Album Amicorum',
    h1: 'Animals',
  },
]
const existing = [
  { slug: 'childhood-memory-book', title: 'Childhood Memory Book', targetKeyword: 'childhood memory book', status: 'published', where: 'library' },
]

/** Mirrors the live site: apex -> www, one retired URL, one live article. */
function siteFetch(url, init = {}) {
  const u = new URL(url)
  const res = (status, headers = {}, body = '') => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] || null },
    text: async () => body,
  })
  if (u.hostname === 'albumamicorum.com') return res(308, { location: `https://www.albumamicorum.com${u.pathname}` })
  if (u.pathname === '/articles/memory-book-for-kids/')
    return res(308, { location: '/articles/how-to-start-a-friendship-book-for-kids/' })
  if (u.pathname === '/articles/childhood-memory-book/') return res(200, {}, '<html><title>x</title></html>')
  if (u.pathname === '/articles/old-static/')
    return res(200, {}, '<meta http-equiv="refresh" content="0;url=/articles/new-page/">')
  if (u.pathname === '/friend-book/animals/')
    return res(200, {}, '<title>Animal-Themed Friend Book for Kids | Album Amicorum</title><h1>Animals</h1>')
  assert.equal(init.redirect === 'manual' || !u.pathname.startsWith('/articles/'), true)
  return res(404)
}

{
  assert.deepEqual(await probeArticleSlug(DOMAIN, 'memory-book-for-kids', siteFetch), {
    status: 'retired',
    location: 'https://www.albumamicorum.com/articles/how-to-start-a-friendship-book-for-kids/',
  })
  assert.equal((await probeArticleSlug(DOMAIN, 'what-to-write-in-a-friend-book', siteFetch)).status, 'free')
  assert.equal((await probeArticleSlug(DOMAIN, 'childhood-memory-book', siteFetch)).status, 'live')
  assert.equal((await probeArticleSlug(DOMAIN, 'old-static', siteFetch)).status, 'retired')
  assert.equal((await probeArticleSlug(DOMAIN, 'x', () => Promise.reject(new Error('offline')))).status, 'unknown')

  assert.deepEqual(parsePageMeta('<title>A &amp; B</title><h1 class="x"><span>Hi</span> there</h1>'), { title: 'A & B', h1: 'Hi there' })
  assert.deepEqual(
    sitePageUrls(
      'see https://www.albumamicorum.com/friend-book/animals/ and https://www.albumamicorum.com/articles/x/ and https://other.com/',
      DOMAIN,
      ['https://www.albumamicorum.com/friend-book/']
    ),
    ['https://www.albumamicorum.com/friend-book/', 'https://www.albumamicorum.com/friend-book/animals/']
  )

  assert.equal(sitePageConflicts('animal themed friend book', sitePages).length, 1, "the Animals page owns the writer's keyword")
  assert.equal(sitePageConflicts('what to write in a friend book', sitePages).length, 0)

  const options = sanitizeOptions(
    [
      { pillarKeyword: 'friend books & friendship keepsakes', supportingKeyword: 'How to start a friendship book for kids', targetKeyword: 'What to Write in a Friend Book', fit: 'strong', articleType: 'howto' },
      { pillarKeyword: 'Made Up Pillar', supportingKeyword: 'x', targetKeyword: 'y' },
      { pillarKeyword: "Children's Keepsakes & Memory", supportingKeyword: 'not in map', targetKeyword: 'z' },
      { pillarKeyword: "Children's Keepsakes & Memory", supportingKeyword: 'childhood memory book', targetKeyword: 'memory book for kids', fit: 'strong', articleType: 'bogus' },
    ],
    keywordMap
  )
  assert.equal(options.length, 2, 'options outside the map are dropped')
  assert.equal(options[0].pillarKeyword, 'Friend Books & Friendship Keepsakes', 'canonical labels')
  assert.equal(options[0].targetKeyword, 'what to write in a friend book')
  assert.equal(options[1].articleType, 'flex')

  const opts = { existing, sitePages, domain: DOMAIN, fetchImpl: siteFetch }
  const checked = await Promise.all(options.map((o) => checkKeyword(o, opts)))
  assert.equal(checked[0].blocked, false)
  assert.equal(checked[1].blocked, true)
  assert.ok(checked[1].conflicts.some((c) => c.kind === 'retired-url'), 'retired URL found')
  const ranked = rankOptions([checked[1], checked[0]])
  assert.equal(ranked[0].targetKeyword, 'what to write in a friend book', 'clear options rank first')

  const images = normalizeImages(
    [
      { n: 1, role: 'inline', alt: 'Banner', hasText: true, textOnImage: 'ANIMAL-THEMED FRIEND BOOK' },
      { n: 4, role: 'exclude', reason: 'QuillBot AI-detection screenshot' },
      { n: 99, role: 'hero' },
    ],
    [1, 2, 3, 4]
  )
  assert.deepEqual(images.map((i) => [i.n, i.role]), [[1, 'hero'], [2, 'inline'], [3, 'inline'], [4, 'exclude']])
  assert.equal(normalizeImages([{ n: 1, role: 'exclude' }], [1])[0].role, 'exclude', 'no hero when nothing is usable')
}

// --- analyze handler end to end (model and site mocked) ---
{
  const blocks = [
    '**84 (OCT 2026) -** [**albumamicorum**](https://www.albumamicorum.com/) **- Web blog**',
    '| Web blog | https://www.albumamicorum.com/ | https://www.albumamicorum.com/friend-book/animals/ | animal-themed friend book |',
    '**Meta Title:** Animal Themed Friend Book: Memories Kids Will Treasure',
    '# Animal-Themed Friend Book: Creative Ways to Capture Memories',
    '![](writer-image:1)',
    'Childhood friendships are full of small moments.',
    '![](writer-image:4)',
  ]
  let seenContent = null
  const modelJson = {
    briefBlocks: [0, 1, 2, 3, 4, 99],
    brief: { keyword: 'Animal-Themed Friend Book', targetUrl: 'https://www.albumamicorum.com/friend-book/animals/', metaTitle: 'Animal Themed Friend Book: Memories Kids Will Treasure' },
    images: [
      { n: 1, role: 'hero', alt: 'Two girls filling in an animal friend book', hasText: true, textOnImage: 'ANIMAL-THEMED FRIEND BOOK' },
      { n: 4, role: 'exclude', reason: 'AI-detector screenshot' },
    ],
    keywordOptions: [
      { pillarKeyword: "Children's Keepsakes & Memory", supportingKeyword: 'childhood memory book', targetKeyword: 'memory book for kids', fit: 'strong' },
      { pillarKeyword: 'Friend Books & Friendship Keepsakes', supportingKeyword: 'how to start a friendship book for kids', targetKeyword: 'what to write in a friend book', fit: 'partial', reason: 'Most of the article is page ideas.' },
    ],
    writerKeyword: { keyword: 'animal-themed friend book', verdict: 'It is the Animals product page keyword.' },
  }
  const req = {
    method: 'POST',
    body: {
      domain: DOMAIN,
      commercialUrl: 'https://www.albumamicorum.com/friend-book/',
      blocks,
      images: [
        { n: 1, mediaType: 'image/jpeg', data: 'aGVsbG8=' },
        { n: 4, mediaType: 'image/jpeg', data: 'aGVsbG8=' },
        { n: 7, mediaType: 'image/jpeg', data: 'aGVsbG8=' },
      ],
      keywordMap,
      existing,
    },
  }
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
  await handleAnalyzeWriterArticle(req, res, {
    requireAuth: async () => ({}),
    fetch: siteFetch,
    callModel: async (content) => {
      seenContent = content
      return '```json\n' + JSON.stringify(modelJson) + '\n```'
    },
  })
  assert.equal(res.statusCode, 200, res.body)
  const data = JSON.parse(res.body)
  assert.deepEqual(data.briefBlocks, [0, 1, 2, 3], 'image blocks and out-of-range indices are never brief')
  assert.equal(seenContent.filter((c) => c.type === 'image').length, 2, 'only images present in the document are sent')
  const prompt = seenContent[0].text
  assert.match(prompt, /SITE PAGES THAT OWN KEYWORDS[\s\S]*Animal-Themed Friend Book for Kids/)
  assert.match(prompt, /"childhood memory book"/)
  assert.equal(data.options[0].targetKeyword, 'what to write in a friend book')
  assert.equal(data.options[1].blocked, true)
  assert.equal(data.writerKeyword.blocked, true)
  assert.ok(data.writerKeyword.conflicts.some((c) => c.kind === 'page'))
  assert.equal(data.writerKeyword.inMap, false)
  assert.deepEqual(data.images.map((i) => [i.n, i.role]), [[1, 'hero'], [4, 'exclude']])

  const bad = { ...res, statusCode: 0 }
  await handleAnalyzeWriterArticle({ method: 'POST', body: { blocks, keywordMap: [] } }, bad, {
    requireAuth: async () => ({}),
    callModel: async () => '{}',
  })
  assert.equal(bad.statusCode, 400)
}

// --- publish: inline images committed beside the hero, paths rewritten ---
{
  const company = '11111111-2222-3333-4444-555555555555'
  const markdown = `---\ntitle: x\n---\n\nIntro.\n\n![Covers](tnv-image:${company}/writer/b/2.png)\n\nText.\n\n![Covers again](tnv-image:${company}/writer/b/2.png)\n\n![Grid](tnv-image:${company}/writer/b/3.jpg)\n`
  const downloads = []
  const out = await resolveInlineImages(markdown, {
    companyId: company,
    slug: 'what-to-write-in-a-friend-book',
    download: async (path) => {
      downloads.push(path)
      return 'aGVsbG8='
    },
  })
  assert.equal(out.error, undefined)
  assert.deepEqual(out.files.map((f) => f.path), [
    'site/src/assets/articles/what-to-write-in-a-friend-book-2.png',
    'site/src/assets/articles/what-to-write-in-a-friend-book-3.jpg',
  ])
  assert.equal(downloads.length, 2, 'each image downloaded once')
  assert.match(out.markdown, /!\[Covers\]\(\.\.\/\.\.\/assets\/articles\/what-to-write-in-a-friend-book-2\.png\)/)
  assert.match(out.markdown, /!\[Covers again\]\(\.\.\/\.\.\/assets\/articles\/what-to-write-in-a-friend-book-2\.png\)/)
  assert.doesNotMatch(out.markdown, /tnv-image:/)

  const foreign = await resolveInlineImages('![x](tnv-image:other-company/a.png)', { companyId: company, slug: 's', download: async () => 'x' })
  assert.match(foreign.error, /not one of this company's images/)
  const missing = await resolveInlineImages(`![x](tnv-image:${company}/a.png)`, { companyId: company, slug: 's', download: async () => null })
  assert.match(missing.error, /could not be loaded/)
  const none = await resolveInlineImages('No images.', { companyId: company, slug: 's', download: async () => 'x' })
  assert.deepEqual(none, { markdown: 'No images.', files: [] })
}

console.log('✓ writer intake')

// --- link wiring: a cluster article never takes its head's keyword as anchor ---
// Reproduces album-amicorum, Oct 2026: an article filed under supporting keyword
// "album amicorum" got "album amicorum" links in four articles, and
// childhood-memory-book linked its own keyword to a newer article.
{
  const { parseArticleMarkdown, planDeltas } = await import('../lib/wire-internal-links/plan.js')
  const md = (fm, body) =>
    `---\n${Object.entries(fm).map(([k, v]) => `${k}: "${v}"`).join('\n')}\ndraft: false\n---\n\n${body}\n`
  const pillar = 'Friend Books & Friendship Keepsakes'
  const memory = "Children's Keepsakes & Memory"
  const articles = [
    parseArticleMarkdown(
      md(
        { title: 'Album Amicorum', pillarKeyword: pillar, supportingKeyword: 'album amicorum', targetKeyword: 'album amicorum', articleType: 'flex' },
        'This is the album amicorum, a book of friends with a long history behind it.'
      ),
      'album-amicorum.md'
    ),
    parseArticleMarkdown(
      md(
        { title: 'Animal friend book', pillarKeyword: pillar, supportingKeyword: 'album amicorum', targetKeyword: 'animal themed friend book', articleType: 'flex' },
        'An animal themed friend book keeps the album amicorum tradition alive for children.'
      ),
      'animal-themed-friend-book.md'
    ),
    parseArticleMarkdown(
      md(
        { title: 'Childhood memory book', pillarKeyword: memory, supportingKeyword: 'childhood memory book', targetKeyword: 'childhood memory book', articleType: 'flex' },
        'There is a version of a childhood memory book that most parents know well.'
      ),
      'childhood-memory-book.md'
    ),
    parseArticleMarkdown(
      md(
        { title: 'Memory book', pillarKeyword: memory, supportingKeyword: 'childhood memory book', targetKeyword: 'memory book for kids', articleType: 'comprehensive' },
        'A memory book for kids is filled by friends rather than a parent.'
      ),
      'memory-book-for-kids-2.md'
    ),
  ]
  const { proposed } = planDeltas(articles)
  const added = proposed.flatMap((p) => p.added.map((a) => ({ from: p.slug, to: a.slug, anchor: a.anchor.toLowerCase() })))
  assert.ok(
    !added.some((a) => a.to === 'animal-themed-friend-book' && a.anchor === 'album amicorum'),
    'the cluster head keeps "album amicorum"'
  )
  assert.ok(
    !added.some((a) => a.from === 'childhood-memory-book' && a.anchor === 'childhood memory book'),
    "an article's own keyword is never linked away from it"
  )
  assert.ok(
    added.some((a) => a.from === 'animal-themed-friend-book' && a.to === 'album-amicorum' && a.anchor === 'album amicorum'),
    '"album amicorum" still links to the article that owns it'
  )
  console.log('✓ link wiring respects keyword ownership')
}
