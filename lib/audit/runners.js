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
  AI_ENGINES,
  llmModels,
  llmResponse,
  serpWithAiOverview,
  serpAiMode,
  llmMentions,
} from './providers/dataforseo.js'
import { fetchPage, mapPool } from './fetchPage.js'
import { extractPageFacts } from './pageFacts.js'
import { discoverSitemapUrls, listAuditUrls, MAX_AUDIT_URLS } from './urls.js'
import { runSiteChecks, buildCrawlIssues } from './checks/crawl.js'
import { buildSchemaIssues } from './checks/schema.js'
import { buildSpeedIssues, pickSpeedTargets } from './checks/speed.js'
import { buildClusterModel, clusterUrls, projectClusterFacts, buildClusterIssues } from './checks/clusters.js'
import { buildAuthorityIssues, MAX_COMPETITORS } from './checks/authority.js'
import {
  brandMatchers,
  competitorEntities,
  extractLlmAnswer,
  analyzeAnswer,
  parseGoogleAi,
  parseMentionsResult,
  buildAiVisibilityIssues,
  ENGINE_LABELS,
} from './checks/aiVisibility.js'
import { ensurePrompts, loadBrandContext, brandNames } from './aiPrompts.js'
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

export const IMPLEMENTED_RUNNERS = ['crawl', ...Object.keys(PAGE_CATEGORIES), 'speed', 'authority', 'ai_visibility']

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
// AI Visibility: buyer + brand prompts on 4 LLM engines (one step per engine),
// then Google AI Overview / AI Mode on core keywords, then LLM Mentions.

const AI_CONCURRENCY = 5
const AI_MAX_KEYWORDS = 7
/** Conservative per-call estimates used only for the budget guard. */
const AI_EST = { answer: 0.04, google: 0.01, mentions: 0.05 }

/** Cheapest web-search-capable model per engine, first match wins. Env overrides. */
const MODEL_PREFERENCES = {
  chat_gpt: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4.1'],
  claude: ['claude-haiku-4-5', 'claude-3-5-haiku', 'claude-sonnet-4-5', 'claude-sonnet-4'],
  gemini: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
  perplexity: ['sonar', 'sonar-pro'],
}

/** @param {string} engine @param {any[]} models */
export function pickModel(engine, models) {
  const override = String(process.env[`AUDIT_AI_MODEL_${engine.toUpperCase()}`] || '').trim()
  if (override) return override
  const prefs = MODEL_PREFERENCES[engine] || []
  const usable = (models || []).filter((m) => m?.model_name && m.web_search_supported !== false)
  for (const pref of prefs) {
    if (usable.some((m) => m.model_name === pref)) return pref
    const versioned = usable.find((m) => String(m.model_name).startsWith(`${pref}-`))
    if (versioned) return versioned.model_name
  }
  return usable[0]?.model_name || prefs[0]
}

function aiContext(ws) {
  const apex = ws.brand?.apex || ''
  return {
    apex,
    matchers: brandMatchers({ names: ws.brand?.names || [], apex }),
    competitors: competitorEntities(ws.competitors || [], apex),
  }
}

/** Remaining budget can cover `estimate`? (Never throws.) */
async function aiBudgetOk(supabase, run, estimate) {
  try {
    await assertBudget(supabase, run, estimate)
    return true
  } catch (err) {
    if (err instanceof BudgetError) return false
    throw err
  }
}

async function aiInit(supabase, run) {
  const ctx = await loadBrandContext(supabase, run.company_id)
  const apex = ctx.apex || apexDomain(run.site_url)
  let promptSet
  try {
    promptSet = await ensurePrompts(supabase, run.company_id)
  } catch (err) {
    if (/audit_ai_prompts/i.test(err?.message || '')) {
      return endRun(supabase, run, 'error', 'Prompt table missing — apply supabase/migrations/074_audit_ai_prompts.sql')
    }
    return endRun(supabase, run, 'error', `Could not prepare AI prompts: ${err?.message || 'unknown error'}`)
  }
  const prompts = promptSet.prompts.map((p) => ({ id: p.id, prompt: p.prompt, intent: p.intent }))
  if (!prompts.some((p) => p.intent !== 'brand')) {
    return endRun(supabase, run, 'error', 'No buyer prompts — regenerate the prompt set')
  }

  const listed = await Promise.all(AI_ENGINES.map((e) => llmModels(e)))
  const models = Object.fromEntries(AI_ENGINES.map((e, i) => [e, pickModel(e, listed[i].models)]))
  const warnings = []
  if (promptSet.generated) warnings.push('Prompt set generated on this run — this run is the baseline.')
  if (!ctx.competitors.length) warnings.push('No competitors in Company Intelligence — share of voice has nothing to compare against.')
  if (!ctx.coreKeywords.length) warnings.push('No core keywords — Google AI Overview / AI Mode checks skipped.')

  return updateRun(supabase, run.id, {
    workspace: {
      prompts,
      brand: { names: brandNames(ctx), apex },
      competitors: ctx.competitors.map((c) => ({ name: c?.name || '', url: c?.url || '' })),
      keywords: ctx.coreKeywords.slice(0, AI_MAX_KEYWORDS),
      models,
      engines: [],
      google: null,
      mentions: null,
      warnings,
    },
    progress: progressPatch(run, {
      phase: 'engines',
      done: 0,
      total: AI_ENGINES.length + 2,
      message: `Asking ${ENGINE_LABELS[AI_ENGINES[0]]} ${prompts.length} question(s)…`,
    }),
  })
}

async function aiEngineStep(supabase, run) {
  const ws = run.workspace
  const engine = AI_ENGINES[ws.engines.length]
  const model = ws.models?.[engine]
  const ctx = aiContext(ws)
  let cost = 0
  let entry

  if (!(await aiBudgetOk(supabase, run, ws.prompts.length * AI_EST.answer))) {
    entry = { engine, model, answers: {}, error: 'Skipped — batch budget reached' }
  } else {
    const results = await mapPool(ws.prompts, AI_CONCURRENCY, async (p) => {
      const res = await llmResponse({ engine, model, prompt: p.prompt })
      cost += res.cost
      if (!res.ok) return [p.id, { error: res.error || 'Request failed' }]
      const answer = extractLlmAnswer(res.result[0])
      return [p.id, analyzeAnswer(answer, ctx)]
    })
    const answers = Object.fromEntries(results)
    const failed = results.filter(([, a]) => a.error)
    entry = {
      engine,
      model,
      answers,
      error: failed.length === results.length ? `All calls failed: ${failed[0]?.[1]?.error || 'unknown'}` : null,
    }
  }

  const engines = [...ws.engines, entry]
  const next = AI_ENGINES[engines.length]
  return updateRun(supabase, run.id, {
    cost_usd: (Number(run.cost_usd) || 0) + cost,
    workspace: { ...ws, engines },
    progress: progressPatch(run, {
      phase: next ? 'engines' : 'google',
      done: engines.length,
      message: next
        ? `Asking ${ENGINE_LABELS[next]} ${ws.prompts.length} question(s)…`
        : `Checking Google AI Overview and AI Mode on ${ws.keywords.length} keyword(s)…`,
    }),
  })
}

async function aiGoogleStep(supabase, run) {
  const ws = run.workspace
  const ctx = aiContext(ws)
  let cost = 0
  let google = []
  const warnings = [...(ws.warnings || [])]

  if (ws.keywords.length && (await aiBudgetOk(supabase, run, ws.keywords.length * 2 * AI_EST.google))) {
    google = await mapPool(ws.keywords, 4, async (keyword) => {
      const [organic, aiMode] = await Promise.all([serpWithAiOverview(keyword), serpAiMode(keyword)])
      cost += organic.cost + aiMode.cost
      if (!organic.ok && !aiMode.ok) return { keyword, error: organic.error || aiMode.error }
      return {
        keyword,
        overview: organic.ok ? parseGoogleAi(organic.result[0], ctx.apex, ctx.competitors, { mode: 'overview' }) : null,
        aiMode: aiMode.ok ? parseGoogleAi(aiMode.result[0], ctx.apex, ctx.competitors, { mode: 'ai_mode' }) : null,
      }
    })
  } else if (ws.keywords.length) {
    warnings.push('Google AI checks skipped — batch budget reached.')
  }

  return updateRun(supabase, run.id, {
    cost_usd: (Number(run.cost_usd) || 0) + cost,
    workspace: { ...ws, google, warnings },
    progress: progressPatch(run, {
      phase: 'mentions',
      done: AI_ENGINES.length + 1,
      message: 'Checking the LLM Mentions database…',
    }),
  })
}

async function aiMentionsAndFinish(supabase, run) {
  const ws = run.workspace
  const warnings = [...(ws.warnings || [])]
  let cost = 0
  let mentions = []

  if (ws.brand?.apex && (await aiBudgetOk(supabase, run, 2 * AI_EST.mentions))) {
    mentions = await Promise.all(
      ['chat_gpt', 'google'].map(async (platform) => {
        const res = await llmMentions(ws.brand.apex, platform)
        cost += res.cost
        if (!res.ok) {
          // DataForSEO reports an empty result set as a task error.
          if (/no search results/i.test(String(res.error || ''))) return { platform, totalCount: 0, items: [] }
          return { platform, error: res.error }
        }
        return { platform, ...parseMentionsResult(res.result[0]) }
      })
    )
  } else if (ws.brand?.apex) {
    warnings.push('LLM Mentions skipped — batch budget reached.')
  }

  for (const e of ws.engines) {
    if (e.error) warnings.push(`${ENGINE_LABELS[e.engine] || e.engine}: ${e.error}`)
  }
  const ctx = aiContext(ws)
  const { issues, metrics } = buildAiVisibilityIssues({
    prompts: ws.prompts,
    engines: ws.engines,
    google: ws.google || [],
    mentions,
    competitors: ctx.competitors.map((c) => ({ name: c.name, apex: c.apex })),
    apex: ctx.apex,
    warnings,
  })
  if (!metrics.buyerAnswers && !(ws.google || []).some((g) => !g.error)) {
    return endRun(supabase, run, 'error', warnings.find((w) => /failed|skipped/i.test(w)) || 'No AI answers collected', cost)
  }
  return finishRun(supabase, run, { issues, metrics, costDelta: cost })
}

async function advanceAiVisibility(supabase, run) {
  const ws = run.workspace || {}
  if (!Array.isArray(ws.prompts)) return aiInit(supabase, run)
  if (ws.engines.length < AI_ENGINES.length) return aiEngineStep(supabase, run)
  if (ws.google === null) return aiGoogleStep(supabase, run)
  return aiMentionsAndFinish(supabase, run)
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
    if (run.category === 'ai_visibility') return await advanceAiVisibility(supabase, run)
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
