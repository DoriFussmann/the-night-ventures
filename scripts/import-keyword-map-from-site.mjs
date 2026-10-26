/**
 * One-off: bring a live site's articles into the SEO Advisor keyword map
 * (content_coverage), with an article spec for every keyword.
 *
 * Preview (default, writes nothing):
 *   node scripts/import-keyword-map-from-site.mjs --articles ../hey-rupert/site/src/content/articles \
 *     --site-url https://www.heyrupert.com --name Rupert [--out preview.md]
 *
 * Apply (after you approved the preview):
 *   SUPABASE_SERVICE_ROLE_KEY=… VITE_SUPABASE_URL=… node scripts/import-keyword-map-from-site.mjs \
 *     --articles … --site-url … --name Rupert --company-id <uuid> --apply
 *
 * Applying never removes anything: existing keywords keep their data and only
 * empty spec fields are filled (see applyImportedMap in lib/seo-advisor/pillars.js).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from '../lib/frontmatter.js'
import { buildSiteKeywordMap, siteMapPreviewMarkdown } from '../lib/seo-advisor/siteMap.js'
import { applyImportedMap, keywordStore, loadCoverageState } from '../lib/seo-advisor/pillars.js'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

const dir = arg('articles')
const siteUrl = arg('site-url', '')
const name = arg('name', 'site')
const out = arg('out')
const apply = arg('apply') === true
const companyId = arg('company-id')

if (!dir) {
  console.error('Missing --articles <dir>')
  process.exit(1)
}

const articles = readdirSync(dir)
  .filter((file) => /\.mdx?$/.test(file))
  .map((file) => {
    const parsed = parseFrontmatter(readFileSync(join(dir, file), 'utf8'))
    if (!parsed.ok) throw new Error(`${file}: frontmatter could not be parsed`)
    return { slug: file.replace(/\.mdx?$/, ''), data: parsed.data, body: parsed.body }
  })

const { cores, skipped } = buildSiteKeywordMap(articles, { siteUrl })
const preview = siteMapPreviewMarkdown({ siteName: name, cores, skipped })
if (out && out !== true) {
  writeFileSync(out, preview)
  console.log(`Preview written to ${out}`)
} else {
  console.log(preview)
}

const thin = cores
  .flatMap((core) => [core, ...core.supporting])
  .filter((item) => item.spec.keyMessages.length < 3)
  .map((item) => item.keyword)
if (thin.length) console.warn(`Fewer than 3 key messages: ${thin.join(', ')}`)

if (!apply) {
  console.log('\nPreview only. Re-run with --company-id <uuid> --apply to write it.')
  process.exit(0)
}

if (!companyId || companyId === true) {
  console.error('--apply needs --company-id <uuid>')
  process.exit(1)
}

const { createServiceClient } = await import('../lib/seo-advisor/auth.js')
const supabase = createServiceClient()

// Dry-run the merge against the stored tree first and show what will change.
const state = await loadCoverageState(supabase, companyId)
const dry = applyImportedMap(state.pillars, cores)
console.log('\nMerge against the stored map:', JSON.stringify(dry.report, null, 2))

const result = await keywordStore.importMap(supabase, companyId, cores)
const supportingTotal = result.tree.reduce((n, p) => n + p.supporting.length, 0)
console.log(`\nSaved. Map now has ${result.tree.length} Core and ${supportingTotal} Supporting keywords.`)
