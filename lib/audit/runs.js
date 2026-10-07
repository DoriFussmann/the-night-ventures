// audit_runs / audit_issues / audit_issue_overrides persistence + state assembly.

import { BATCH_BUDGET_USD, CATEGORIES } from './categories.js'
import { scoreCategory, overallScore, diffIssues, partitionAccepted } from './scoring.js'

/** Columns returned to the client (never the workspace blob). */
export const RUN_COLUMNS =
  'id, company_id, batch_id, category, status, site_url, started_at, finished_at, score, cost_usd, external_task_id, progress, metrics, error'

const ISSUE_COLUMNS =
  'id, run_id, category, check_id, fingerprint, severity, scope, title, detail, url, evidence, fix_hint'

const ISSUE_INSERT_CHUNK = 500
const PAGE_SIZE = 1000
const HISTORY_PER_CATEGORY = 5

export class AuditError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   */
  constructor(message, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

export class BudgetError extends AuditError {
  constructor(message) {
    super(message, 402)
  }
}

/** Shape a run row for the client. */
export function publicRun(row) {
  if (!row) return null
  const { workspace: _workspace, ...rest } = row
  return { ...rest, cost_usd: Number(row.cost_usd) || 0 }
}

export async function createRun(supabase, { companyId, category, batchId, siteUrl, userId }) {
  const { data, error } = await supabase
    .from('audit_runs')
    .insert({
      company_id: companyId,
      category,
      batch_id: batchId || null,
      site_url: siteUrl,
      status: 'running',
      progress: { step: 0, phase: 'init', message: 'Starting…' },
      workspace: {},
      created_by: userId || null,
    })
    .select(`${RUN_COLUMNS}, workspace`)
    .single()
  if (error) throw error
  return data
}

export async function getRun(supabase, runId, companyId) {
  const { data, error } = await supabase
    .from('audit_runs')
    .select(`${RUN_COLUMNS}, workspace`)
    .eq('id', runId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new AuditError('Run not found', 404)
  return data
}

/** Latest running run for a category, if any. */
export async function findRunningRun(supabase, companyId, category) {
  const { data, error } = await supabase
    .from('audit_runs')
    .select(`${RUN_COLUMNS}, workspace`)
    .eq('company_id', companyId)
    .eq('category', category)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Claim the next step of a run. Succeeds only if nobody advanced it since the
 * caller last saw it (progress.step === expectedStep). Returns the claimed row or null.
 */
export async function claimStep(supabase, run, expectedStep) {
  const progress = { ...(run.progress || {}), step: expectedStep + 1 }
  const { data, error } = await supabase
    .from('audit_runs')
    .update({ progress })
    .eq('id', run.id)
    .eq('status', 'running')
    .eq('progress->>step', String(expectedStep))
    .select(`${RUN_COLUMNS}, workspace`)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function updateRun(supabase, runId, patch) {
  const { data, error } = await supabase
    .from('audit_runs')
    .update(patch)
    .eq('id', runId)
    .select(`${RUN_COLUMNS}, workspace`)
    .single()
  if (error) throw error
  return data
}

/** Total recorded spend for the run's batch (or the run alone when it has no batch). */
export async function batchSpend(supabase, run) {
  let query = supabase.from('audit_runs').select('cost_usd')
  query = run.batch_id ? query.eq('batch_id', run.batch_id) : query.eq('id', run.id)
  const { data, error } = await query
  if (error) throw error
  return (data || []).reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0)
}

/** Throw BudgetError if spending `estimate` more would exceed the batch cap. */
export async function assertBudget(supabase, run, estimate) {
  const spent = await batchSpend(supabase, run)
  if (spent + estimate > BATCH_BUDGET_USD) {
    throw new BudgetError(
      `Skipped — budget: $${spent.toFixed(2)} of $${BATCH_BUDGET_USD.toFixed(2)} already spent in this batch`
    )
  }
  return spent
}

async function insertIssues(supabase, run, issues) {
  for (let i = 0; i < issues.length; i += ISSUE_INSERT_CHUNK) {
    const chunk = issues.slice(i, i + ISSUE_INSERT_CHUNK).map((issue) => ({
      ...issue,
      run_id: run.id,
      company_id: run.company_id,
    }))
    const { error } = await supabase.from('audit_issues').insert(chunk)
    if (error) throw error
  }
}

/** Persist issues + metrics and close the run. Clears the workspace. */
export async function finishRun(supabase, run, { issues, metrics, costDelta = 0 }) {
  await insertIssues(supabase, run, issues)
  const score = scoreCategory(issues, { pagesChecked: metrics?.pagesChecked })
  return updateRun(supabase, run.id, {
    status: 'done',
    finished_at: new Date().toISOString(),
    score,
    metrics: { ...(metrics || {}), issueCount: issues.length },
    cost_usd: (Number(run.cost_usd) || 0) + costDelta,
    progress: { ...(run.progress || {}), phase: 'done', message: 'Done' },
    workspace: {},
  })
}

/** Close a run as failed / skipped / cancelled. */
export async function endRun(supabase, run, status, message, costDelta = 0) {
  return updateRun(supabase, run.id, {
    status,
    finished_at: new Date().toISOString(),
    error: String(message || '').slice(0, 1000),
    cost_usd: (Number(run.cost_usd) || 0) + costDelta,
    progress: { ...(run.progress || {}), phase: status, message: String(message || status).slice(0, 300) },
    workspace: {},
  })
}

async function fetchIssuesForRuns(supabase, runIds) {
  if (!runIds.length) return []
  const out = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('audit_issues')
      .select(ISSUE_COLUMNS)
      .in('run_id', runIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return out
}

/**
 * Everything the Audit page needs: latest + previous completed run per category,
 * live scores (overrides applied), diffs, running runs, and short history.
 */
export async function loadState(supabase, companyId) {
  const [runsResult, overridesResult] = await Promise.all([
    supabase
      .from('audit_runs')
      .select(RUN_COLUMNS)
      .eq('company_id', companyId)
      .order('started_at', { ascending: false })
      .limit(300),
    supabase
      .from('audit_issue_overrides')
      .select('fingerprint, check_id, note, created_at')
      .eq('company_id', companyId),
  ])
  if (runsResult.error) throw runsResult.error
  if (overridesResult.error) throw overridesResult.error

  const runs = (runsResult.data || []).map(publicRun)
  const accepted = new Set((overridesResult.data || []).map((o) => o.fingerprint))

  const perCategory = {}
  const neededRunIds = []
  for (const category of CATEGORIES) {
    const mine = runs.filter((r) => r.category === category.id)
    const done = mine.filter((r) => r.status === 'done')
    const latest = done[0] || null
    const previous = done[1] || null
    const running = mine.find((r) => r.status === 'running') || null
    const lastAttempt = mine.find((r) => r.status !== 'running') || null
    if (latest) neededRunIds.push(latest.id)
    if (previous) neededRunIds.push(previous.id)
    perCategory[category.id] = {
      latest,
      previous,
      running,
      lastAttempt,
      history: done.slice(0, HISTORY_PER_CATEGORY).map((r) => ({
        id: r.id,
        started_at: r.started_at,
        score: r.score,
        cost_usd: r.cost_usd,
      })),
    }
  }

  const issues = await fetchIssuesForRuns(supabase, neededRunIds)
  const byRun = new Map()
  for (const issue of issues) {
    const list = byRun.get(issue.run_id) || []
    list.push(issue)
    byRun.set(issue.run_id, list)
  }

  /** @type {Record<string, number>} */
  const scores = {}
  for (const category of CATEGORIES) {
    const entry = perCategory[category.id]
    if (!entry.latest) {
      entry.score = null
      entry.issues = []
      entry.fixed = []
      entry.accepted = []
      entry.diffCounts = null
      continue
    }
    const current = partitionAccepted(byRun.get(entry.latest.id) || [], accepted)
    const previous = entry.previous
      ? partitionAccepted(byRun.get(entry.previous.id) || [], accepted).active
      : null
    const diff = diffIssues(current.active, previous)
    entry.score = scoreCategory(current.active, { pagesChecked: entry.latest.metrics?.pagesChecked })
    entry.issues = diff.current
    entry.fixed = diff.fixed
    entry.accepted = current.accepted
    entry.diffCounts = previous
      ? {
          new: diff.current.filter((i) => i.diff === 'new').length,
          persisting: diff.current.filter((i) => i.diff === 'persisting').length,
          fixed: diff.fixed.length,
        }
      : null
    scores[category.id] = entry.score
  }

  return {
    categories: perCategory,
    overall: overallScore(scores),
    overrides: overridesResult.data || [],
  }
}
