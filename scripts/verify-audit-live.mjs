/**
 * Live verify for the Audit tool's external dependencies (no database writes).
 * Runs a small real DataForSEO On-Page crawl (10 pages, ~$0.002) and prints the
 * raw response keys the crawl checks read, then runs the schema checks on a few pages.
 *
 * Usage (repo root, .env.local with DATAFORSEO_LOGIN/PASSWORD):
 *   node scripts/verify-audit-live.mjs https://www.yoursite.com
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  userData,
  onPageTaskPost,
  onPageSummary,
  onPagePages,
  onPageNonIndexable,
  onPageRedirectChains,
  onPageBrokenLinks,
  itemsOf,
} from '../lib/audit/providers/dataforseo.js'
import { discoverSitemapUrls, classifyUrl } from '../lib/audit/urls.js'
import { fetchPage } from '../lib/audit/fetchPage.js'
import { extractPageFacts } from '../lib/audit/pageFacts.js'
import { runSiteChecks, buildCrawlIssues } from '../lib/audit/checks/crawl.js'
import { buildSchemaIssues } from '../lib/audit/checks/schema.js'
import { detectHosting } from '../lib/audit/preflight.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = path.join(root, '.env.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

const siteArg = process.argv[2]
if (!siteArg) {
  console.error('Usage: node scripts/verify-audit-live.mjs https://www.yoursite.com')
  process.exit(1)
}

let failures = 0
function report(ok, label, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const keysOf = (obj) => (obj && typeof obj === 'object' ? Object.keys(obj).sort().join(', ') : String(obj))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const home = await fetchPage(siteArg)
report(home.ok, 'Homepage', `HTTP ${home.status} → ${home.finalUrl} · hosting ${detectHosting(home.headers)}`)
const origin = new URL(home.finalUrl || siteArg).origin

const account = await userData()
report(account.ok, 'DataForSEO account', account.ok ? `balance $${account.balance}` : account.error)

const sitemap = await discoverSitemapUrls(origin)
report(Boolean(sitemap.sitemapUrl), 'Sitemap', `${sitemap.urls.length} URLs at ${sitemap.sitemapUrl}`)

const siteChecks = await runSiteChecks(origin)
console.log('     site checks:', JSON.stringify(siteChecks))

const posted = await onPageTaskPost({
  target: new URL(origin).hostname.replace(/^www\./, ''),
  startUrl: `${origin}/`,
  maxCrawlPages: 10,
  tag: 'tnv-audit-verify',
})
report(posted.ok, 'On-Page task_post', posted.ok ? `task ${posted.taskId} · cost $${posted.cost}` : posted.error)
if (!posted.ok) process.exit(1)

let summaryRow = null
for (let i = 0; i < 60; i += 1) {
  await sleep(10_000)
  const summary = await onPageSummary(posted.taskId)
  if (!summary.ok) {
    console.log(`     summary not ready: ${summary.error}`)
    continue
  }
  summaryRow = summary.result[0] || {}
  console.log(
    `     crawl_progress=${summaryRow.crawl_progress} pages_crawled=${summaryRow.crawl_status?.pages_crawled}`
  )
  if (summaryRow.crawl_progress === 'finished') break
}
report(summaryRow?.crawl_progress === 'finished', 'Crawl finished')
console.log('     summary keys:', keysOf(summaryRow))
console.log('     summary.crawl_status keys:', keysOf(summaryRow?.crawl_status))
console.log('     summary.domain_info.ssl_info keys:', keysOf(summaryRow?.domain_info?.ssl_info))
console.log('     summary.page_metrics keys:', keysOf(summaryRow?.page_metrics))

const [pages, nonIndexable, redirects, broken] = await Promise.all([
  onPagePages(posted.taskId),
  onPageNonIndexable(posted.taskId),
  onPageRedirectChains(posted.taskId),
  onPageBrokenLinks(posted.taskId),
])
const firstPage = itemsOf(pages)[0]
report(pages.ok && Boolean(firstPage), 'On-Page pages', pages.ok ? `${itemsOf(pages).length} items` : pages.error)
console.log('     page item keys:', keysOf(firstPage))
console.log('     page.meta keys:', keysOf(firstPage?.meta))
console.log('     page.meta.htags keys:', keysOf(firstPage?.meta?.htags))
console.log('     page.checks keys:', keysOf(firstPage?.checks))
report(nonIndexable.ok, 'On-Page non_indexable', nonIndexable.ok ? `${itemsOf(nonIndexable).length} items; item keys: ${keysOf(itemsOf(nonIndexable)[0])}` : nonIndexable.error)
report(redirects.ok, 'On-Page redirect_chains', redirects.ok ? `${itemsOf(redirects).length} items; item keys: ${keysOf(itemsOf(redirects)[0])}` : redirects.error)
report(broken.ok, 'On-Page links (is_broken filter)', broken.ok ? `${itemsOf(broken).length} items; item keys: ${keysOf(itemsOf(broken)[0])}` : broken.error)

const crawl = buildCrawlIssues({
  siteUrl: origin,
  summary: summaryRow,
  pages: itemsOf(pages),
  nonIndexable: nonIndexable.ok ? itemsOf(nonIndexable) : [],
  redirectChains: redirects.ok ? itemsOf(redirects) : [],
  brokenLinks: broken.ok ? itemsOf(broken) : null,
  sitemapUrls: sitemap.urls,
  siteChecks,
})
console.log('     crawl metrics:', JSON.stringify(crawl.metrics))
console.log('     crawl issues by check:', JSON.stringify(countBy(crawl.issues)))

const sample = [`${origin}/`, ...sitemap.urls.filter((u) => /\/articles\/[^/]+\/?$/.test(u)).slice(0, 4)]
const analyzed = []
for (const url of sample) {
  const res = await fetchPage(url)
  analyzed.push({
    url,
    kind: classifyUrl(url, new Set()),
    status: res.status,
    facts: res.ok ? extractPageFacts(res.text, { url: res.finalUrl, headers: res.headers }) : null,
  })
}
const schema = buildSchemaIssues(analyzed)
report(schema.metrics.pagesChecked > 0, 'Schema checks', `${schema.metrics.pagesChecked} pages`)
console.log('     schema metrics:', JSON.stringify(schema.metrics))
console.log('     schema issues by check:', JSON.stringify(countBy(schema.issues)))

console.log(failures ? `\n${failures} check(s) failed` : '\nAll live checks passed')
process.exit(failures ? 1 : 0)

function countBy(issues) {
  return issues.reduce((m, i) => ((m[i.check_id] = (m[i.check_id] || 0) + 1), m), {})
}
