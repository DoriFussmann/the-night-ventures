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
import { assertBudget, updateRun, finishRun, endRun, BudgetError } from './runs.js'

const PAGE_BATCH = 8
const PAGE_CONCURRENCY = 4
const CRAWL_POLL_MS = 10_000
const CRAWL_MAX_MINUTES = 30
const CRAWL_ESTIMATE_USD = 0.05
const MAX_POLL_ERRORS = 5

/** Which page facts each page-level category keeps in its workspace. */
const FACT_PROJECTIONS = {
  schema: (f) => ({
    structured: f.structured,
    hasFaqSection: f.hasFaqSection,
    timeElements: f.timeElements,
  }),
}

/** Categories whose run is a list of pages fetched in batches. */
const PAGE_CATEGORIES = {
  schema: buildSchemaIssues,
}

export const IMPLEMENTED_RUNNERS = ['crawl', ...Object.keys(PAGE_CATEGORIES)]

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
    const { issues, metrics } = build(nextPages)
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

async function advancePages(supabase, run) {
  if (!Array.isArray(run.workspace?.urls)) return pagesInit(supabase, run)
  return pagesBatch(supabase, run)
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
