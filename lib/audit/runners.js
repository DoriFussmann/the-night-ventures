// Per-category step machines. Each call to advanceRun() does one bounded unit of
// work (well under the 300s function limit) and records progress on the run, so a
// run can be resumed by any client after a closed tab.

import {
  onPageTaskPost,
  onPageSummary,
  onPagePages,
  onPageNonIndexable,
  onPageRedirectChains,
  onPageBrokenLinks,
  itemsOf,
} from './providers/dataforseo.js'
import { fetchPage, mapPool } from './fetchPage.js'
import { extractPageFacts } from './pageFacts.js'
import { discoverSitemapUrls, listAuditUrls, MAX_AUDIT_URLS } from './urls.js'
import { runSiteChecks, buildCrawlIssues } from './checks/crawl.js'
import { buildSchemaIssues } from './checks/schema.js'
import { buildSpeedIssues, pickSpeedTargets } from './checks/speed.js'
import { buildClusterModel, clusterUrls, projectClusterFacts, buildClusterIssues } from './checks/clusters.js'
import { buildAuthorityIssues, MAX_COMPETITORS } from './checks/authority.js'
import { runPagespeed } from '../audit-snapshot/pagespeed.js'
import { runMozPanel, mozBatchMetrics } from '../audit-snapshot/sources/moz.js'
import { apexDomain } from '../audit-snapshot/domain.js'
import { assertBudget, updateRun, finishRun, endRun, BudgetError } from './runs.js'

const PAGE_BATCH = 8
const PAGE_CONCURRENCY = 4
const CRAWL_POLL_MS = 10_000
const CRAWL_MAX_MINUTES = 30
const CRAWL_ESTIMATE_USD = 0.05
const MAX_POLL_ERRORS = 5
const PAGESPEED_TIMEOUT_MS = 120_000

/** Which page facts each page-level category keeps in its workspace. */
const FACT_PROJECTIONS = {
  schema: (f) => ({
    structured: f.structured,
    hasFaqSection: f.hasFaqSection,
    timeElements: f.timeElements,
  }),
  clusters: projectClusterFacts,
}

/** Categories whose run is a list of pages fetched in batches. */
const PAGE_CATEGORIES = {
  schema: buildSchemaIssues,
  clusters: buildClusterIssues,
}

export const IMPLEMENTED_RUNNERS = ['crawl', ...Object.keys(PAGE_CATEGORIES), 'speed', 'authority']

function progressPatch(run, patch) {
  return { ...(run.progress || {}), ...patch }
}

/**
 * Resolve the live origin by following the homepage redirect, so www/apex is
 * whatever the site actually serves.
 */
export async function resolveLiveOrigin(siteUrl) {
  const res = await fetchPage(siteUrl, { timeoutMs: 12_000 })
  try {
    return new URL(res.finalUrl || siteUrl).origin
  } catch {
    return new URL(siteUrl).origin
  }
}

// ---------------------------------------------------------------------------
// Crawl

async function crawlInit(supabase, run) {
  const origin = run.site_url
  await assertBudget(supabase, run, CRAWL_ESTIMATE_USD)

  const [sitemap, siteChecks] = await Promise.all([discoverSitemapUrls(origin), runSiteChecks(origin)])
  const host = new URL(origin).hostname.replace(/^www\./, '')
  const posted = await onPageTaskPost({
    target: host,
    startUrl: `${origin}/`,
    maxCrawlPages: MAX_AUDIT_URLS,
    tag: `tnv-audit-${run.id}`,
  })
  if (!posted.ok || !posted.taskId) {
    return endRun(supabase, run, 'error', `Crawl could not start: ${posted.error || 'no task id'}`, posted.cost)
  }

  return updateRun(supabase, run.id, {
    external_task_id: posted.taskId,
    cost_usd: (Number(run.cost_usd) || 0) + posted.cost,
    workspace: {
      sitemapUrls: sitemap.urls,
      sitemapUrl: sitemap.sitemapUrl,
      siteChecks,
    },
    progress: progressPatch(run, {
      phase: 'crawling',
      message: 'Crawl queued at DataForSEO…',
      startedCrawlAt: new Date().toISOString(),
      pollErrors: 0,
    }),
  })
}

async function crawlCollect(supabase, run, summaryRow) {
  const taskId = run.external_task_id
  const [pages, nonIndexable, redirects, broken] = await Promise.all([
    onPagePages(taskId),
    onPageNonIndexable(taskId),
    onPageRedirectChains(taskId),
    onPageBrokenLinks(taskId),
  ])
  const cost = pages.cost + nonIndexable.cost + redirects.cost + broken.cost
  if (!pages.ok) {
    return endRun(supabase, run, 'error', `Could not read crawl results: ${pages.error}`, cost)
  }

  const ws = run.workspace || {}
  const { issues, metrics } = buildCrawlIssues({
    siteUrl: run.site_url,
    summary: summaryRow,
    pages: itemsOf(pages),
    nonIndexable: nonIndexable.ok ? itemsOf(nonIndexable) : [],
    redirectChains: redirects.ok ? itemsOf(redirects) : [],
    brokenLinks: broken.ok ? itemsOf(broken) : null,
    sitemapUrls: ws.sitemapUrls || [],
    siteChecks: ws.siteChecks || null,
  })
  const warnings = [
    !nonIndexable.ok ? `non_indexable unavailable: ${nonIndexable.error}` : null,
    !redirects.ok ? `redirect_chains unavailable: ${redirects.error}` : null,
    !broken.ok ? `broken links unavailable: ${broken.error}` : null,
  ].filter(Boolean)

  return finishRun(supabase, run, {
    issues,
    metrics: { ...metrics, sitemapUrl: ws.sitemapUrl || null, warnings },
    costDelta: cost,
  })
}

async function crawlPoll(supabase, run) {
  const summary = await onPageSummary(run.external_task_id)
  const startedAt = Date.parse(run.progress?.startedCrawlAt || run.started_at)
  const minutes = (Date.now() - startedAt) / 60_000

  if (!summary.ok) {
    const pollErrors = (Number(run.progress?.pollErrors) || 0) + 1
    if (pollErrors >= MAX_POLL_ERRORS) {
      return endRun(supabase, run, 'error', `Crawl status unavailable: ${summary.error}`, summary.cost)
    }
    return updateRun(supabase, run.id, {
      cost_usd: (Number(run.cost_usd) || 0) + summary.cost,
      progress: progressPatch(run, { pollErrors, message: `Waiting for crawl status (retry ${pollErrors})…` }),
    })
  }

  const row = summary.result[0] || {}
  if (row.crawl_progress === 'finished') {
    return crawlCollect(supabase, { ...run, cost_usd: (Number(run.cost_usd) || 0) + summary.cost }, row)
  }
  if (minutes > CRAWL_MAX_MINUTES) {
    return endRun(supabase, run, 'error', `Crawl did not finish within ${CRAWL_MAX_MINUTES} minutes`, summary.cost)
  }
  const crawled = Number(row?.crawl_status?.pages_crawled) || 0
  const queued = Number(row?.crawl_status?.pages_in_queue) || 0
  return updateRun(supabase, run.id, {
    cost_usd: (Number(run.cost_usd) || 0) + summary.cost,
    progress: progressPatch(run, {
      pollErrors: 0,
      done: crawled,
      total: Math.min(MAX_AUDIT_URLS, crawled + queued) || null,
      message: `Crawling… ${crawled} page(s) crawled${queued ? `, ${queued} queued` : ''}`,
    }),
  })
}

async function advanceCrawl(supabase, run) {
  if (!run.external_task_id) return crawlInit(supabase, run)
  return crawlPoll(supabase, run)
}

// ---------------------------------------------------------------------------
// Page-level categories

async function pagesInit(supabase, run) {
  const listing = await listAuditUrls(supabase, run.company_id, run.site_url)
  if (!listing.urls.length) {
    return endRun(supabase, run, 'error', 'No URLs found (no sitemap and no published articles)')
  }
  return updateRun(supabase, run.id, {
    workspace: { urls: listing.urls, pages: [], capped: listing.capped, totalFound: listing.totalFound },
    progress: progressPatch(run, {
      phase: 'pages',
      done: 0,
      total: listing.urls.length,
      message: `Checking ${listing.urls.length} page(s)…`,
    }),
  })
}

async function analyzeOne(entry, project) {
  const res = await fetchPage(entry.url)
  const isHtml = String(res.headers['content-type'] || '').includes('html')
  const base = { url: entry.url, kind: entry.kind, status: res.status, finalUrl: res.finalUrl, error: res.error }
  if (!res.ok || !isHtml) {
    return { ...base, facts: null, error: res.error || (res.ok ? 'Not an HTML page' : `HTTP ${res.status}`) }
  }
  const facts = extractPageFacts(res.text, { url: res.finalUrl || entry.url, headers: res.headers })
  return { ...base, facts: project(facts) }
}

async function pagesBatch(supabase, run) {
  const ws = run.workspace || {}
  const urls = Array.isArray(ws.urls) ? ws.urls : []
  const pages = Array.isArray(ws.pages) ? ws.pages : []
  const project = FACT_PROJECTIONS[run.category]
  const batch = urls.slice(pages.length, pages.length + PAGE_BATCH)
  const analyzed = await mapPool(batch, PAGE_CONCURRENCY, (entry) => analyzeOne(entry, project))
  const nextPages = [...pages, ...analyzed]

  if (nextPages.length >= urls.length) {
    const build = PAGE_CATEGORIES[run.category]
    const { issues, metrics } = build(nextPages, ws)
    return finishRun(supabase, run, {
      issues,
      metrics: { ...metrics, urlsCapped: Boolean(ws.capped), urlsFound: ws.totalFound ?? urls.length },
    })
  }
  return updateRun(supabase, run.id, {
    workspace: { ...ws, pages: nextPages },
    progress: progressPatch(run, {
      done: nextPages.length,
      total: urls.length,
      message: `Checked ${nextPages.length} of ${urls.length} page(s)…`,
    }),
  })
}

/** Clusters: fetch only pillar + supporting article pages, keep the cluster model. */
async function clustersInit(supabase, run) {
  const [coverage, library] = await Promise.all([
    supabase.from('content_coverage').select('pillars').eq('company_id', run.company_id).maybeSingle(),
    supabase
      .from('generated_articles')
      .select('pillar_keyword, supporting_keyword, target_keyword, title, published_url')
      .eq('company_id', run.company_id)
      .eq('status', 'published')
      .not('published_url', 'is', null),
  ])
  if (coverage.error) throw coverage.error
  if (library.error) throw library.error

  const model = buildClusterModel(coverage.data?.pillars, library.data || [])
  const urls = clusterUrls(model, MAX_AUDIT_URLS)
  if (!urls.length) {
    return endRun(supabase, run, 'error', 'No published pillar or cluster articles found — publish cluster content first')
  }
  const totalMembers = model.clusters.reduce((n, c) => n + c.articles.length + (c.pillar ? 1 : 0), 0)
  return updateRun(supabase, run.id, {
    workspace: { urls, pages: [], model, capped: totalMembers > urls.length, totalFound: totalMembers },
    progress: progressPatch(run, {
      phase: 'pages',
      done: 0,
      total: urls.length,
      message: `Checking ${model.clusters.length} cluster(s), ${urls.length} page(s)…`,
    }),
  })
}

async function advancePages(supabase, run) {
  if (!Array.isArray(run.workspace?.urls)) {
    return run.category === 'clusters' ? clustersInit(supabase, run) : pagesInit(supabase, run)
  }
  return pagesBatch(supabase, run)
}

// ---------------------------------------------------------------------------
// Speed: one PageSpeed (mobile) call per step, one page per template.

async function speedInit(supabase, run) {
  if (!process.env.GOOGLE_PAGESPEED_API_KEY) {
    return endRun(supabase, run, 'error', 'GOOGLE_PAGESPEED_API_KEY is not configured')
  }
  const listing = await listAuditUrls(supabase, run.company_id, run.site_url)
  const targets = pickSpeedTargets(listing.urls)
  if (!targets.length) targets.push({ url: `${run.site_url}/`, kind: 'home' })
  return updateRun(supabase, run.id, {
    workspace: { targets, results: [] },
    progress: progressPatch(run, {
      phase: 'pages',
      done: 0,
      total: targets.length,
      message: `Testing ${targets.length} template page(s) with PageSpeed…`,
    }),
  })
}

async function speedStep(supabase, run) {
  const ws = run.workspace || {}
  const targets = ws.targets || []
  const results = Array.isArray(ws.results) ? ws.results : []
  const target = targets[results.length]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PAGESPEED_TIMEOUT_MS)
  let result
  try {
    result = await runPagespeed({
      url: target.url,
      strategy: 'mobile',
      apiKey: process.env.GOOGLE_PAGESPEED_API_KEY,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  const nextResults = [...results, { ...target, result }]

  if (nextResults.length >= targets.length) {
    if (!nextResults.some((p) => p.result?.ok)) {
      return endRun(
        supabase,
        run,
        'error',
        `PageSpeed failed on every page: ${nextResults[0]?.result?.error || 'unknown error'}`
      )
    }
    const { issues, metrics } = buildSpeedIssues({ pages: nextResults })
    return finishRun(supabase, run, { issues, metrics })
  }
  return updateRun(supabase, run.id, {
    workspace: { ...ws, results: nextResults },
    progress: progressPatch(run, {
      done: nextResults.length,
      total: targets.length,
      message: `Tested ${nextResults.length} of ${targets.length} page(s) — next: ${targets[nextResults.length].kind}…`,
    }),
  })
}

async function advanceSpeed(supabase, run) {
  if (!Array.isArray(run.workspace?.targets)) return speedInit(supabase, run)
  return speedStep(supabase, run)
}

// ---------------------------------------------------------------------------
// Authority: Moz for the site + competitors, single step.

async function advanceAuthority(supabase, run) {
  const [{ data: company }, { data: profile, error }] = await Promise.all([
    supabase.from('companies').select('name').eq('id', run.company_id).maybeSingle(),
    supabase
      .from('company_profiles')
      .select('product_name, competitors')
      .eq('company_id', run.company_id)
      .maybeSingle(),
  ])
  if (error) throw error

  const own = await runMozPanel({
    siteUrl: run.site_url,
    productName: profile?.product_name || null,
    companyName: company?.name || null,
  })
  if (!own.ok) return endRun(supabase, run, 'error', `Moz: ${own.error || 'request failed'}`)

  const ownApex = apexDomain(run.site_url)
  const seen = new Set([ownApex])
  const competitors = []
  for (const c of Array.isArray(profile?.competitors) ? profile.competitors : []) {
    const domain = apexDomain(c?.url || '')
    if (!domain || !domain.includes('.') || seen.has(domain)) continue
    seen.add(domain)
    competitors.push({ name: String(c?.name || domain).slice(0, 120), domain })
    if (competitors.length >= MAX_COMPETITORS) break
  }

  if (competitors.length) {
    const batch = await mozBatchMetrics(competitors.map((c) => c.domain))
    competitors.forEach((c, i) => {
      if (!batch.available) {
        c.error = batch.reason || 'Moz request failed'
        return
      }
      const row = batch.rows[i]
      if (!row || row.domainAuthority == null) {
        c.error = 'No Moz data'
        return
      }
      c.domainAuthority = row.domainAuthority
      c.linkingRootDomains = row.linkingRootDomains
      c.spamScore = row.spamScore
    })
  }

  const { issues, metrics } = buildAuthorityIssues({
    site: { ...own.metrics, target: own.target },
    competitors,
    stale: own.stale,
  })
  return finishRun(supabase, run, { issues, metrics: { ...metrics, mozLastCrawled: own.metrics?.lastCrawled || null } })
}

// ---------------------------------------------------------------------------

/**
 * Advance a claimed run by one step. Returns the updated run row.
 * Budget refusals close the run as 'skipped'.
 */
export async function advanceRun(supabase, run) {
  try {
    if (run.category === 'crawl') return await advanceCrawl(supabase, run)
    if (PAGE_CATEGORIES[run.category]) return await advancePages(supabase, run)
    if (run.category === 'speed') return await advanceSpeed(supabase, run)
    if (run.category === 'authority') return await advanceAuthority(supabase, run)
    return await endRun(supabase, run, 'error', `Category ${run.category} is not available yet`)
  } catch (err) {
    if (err instanceof BudgetError) return endRun(supabase, run, 'skipped', err.message)
    throw err
  }
}

/** Suggested client delay before the next step. */
export function nextDelayMs(run) {
  if (run.status !== 'running') return null
  return run.category === 'crawl' && run.external_task_id ? CRAWL_POLL_MS : 0
}
