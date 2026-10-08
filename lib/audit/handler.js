// HTTP entry for the Audit tool. Mounted on api/audit-snapshot.js for any
// action prefixed "audit." (GET ?action=audit.state, POST { action: 'audit.*' }).

import { requireAuth, handleOptions, parseBody, json } from '../seo-advisor/auth.js'
import { resolveSiteUrl } from '../audit-snapshot/runPanel.js'
import { CATEGORY_IDS, categoryById, CONNECTION_IDS } from './categories.js'
import { runConnectionCheck } from './preflight.js'
import {
  AuditError,
  createRun,
  getRun,
  findRunningRun,
  claimStep,
  endRun,
  loadState,
  publicRun,
  updateRun,
} from './runs.js'
import { advanceRun, nextDelayMs, resolveLiveOrigin, IMPLEMENTED_RUNNERS } from './runners.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FINGERPRINT_RE = /^[0-9a-f]{24}$/
const MAX_OVERRIDES = 1000
/** Consecutive failed steps before a run is closed as an error. */
const MAX_STEP_ERRORS = 3

function requireUuid(value, name) {
  const v = String(value || '').trim()
  if (!UUID_RE.test(v)) throw new AuditError(`${name} must be a UUID`)
  return v
}

async function loadCompany(supabase, companyId) {
  const [{ data: company, error }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from('companies').select('id, name').eq('id', companyId).maybeSingle(),
    supabase
      .from('company_profiles')
      .select('domain, ai_training_bot_policy')
      .eq('company_id', companyId)
      .maybeSingle(),
  ])
  if (error) throw error
  if (profileError) throw profileError
  if (!company) throw new AuditError('Company not found', 404)
  return { company, profile: profile || null }
}

/** The action name from ?action= or the JSON body. */
export function auditAction(req) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const fromQuery = url.searchParams.get('action')
    if (fromQuery) return fromQuery
  } catch {
    // ignore
  }
  const body = parseBody(req)
  return String(body?.action || '')
}

async function handleState(supabase, companyId) {
  const { company, profile } = await loadCompany(supabase, companyId)
  const { siteUrl } = await resolveSiteUrl(supabase, companyId)
  const state = await loadState(supabase, companyId)
  return {
    company: {
      id: company.id,
      name: company.name,
      domain: profile?.domain || null,
      siteUrl,
      aiTrainingBotPolicy: profile?.ai_training_bot_policy || 'allow',
    },
    implemented: IMPLEMENTED_RUNNERS,
    ...state,
  }
}

async function handlePreflight(supabase, companyId, body) {
  const check = String(body.check || '').trim()
  if (!CONNECTION_IDS.includes(check)) throw new AuditError('Unknown check')
  await loadCompany(supabase, companyId)
  const { siteUrl } = await resolveSiteUrl(supabase, companyId)
  return runConnectionCheck(check, { supabase, companyId, siteUrl })
}

async function handleStart(supabase, user, companyId, body) {
  const category = String(body.category || '').trim()
  if (!CATEGORY_IDS.includes(category)) throw new AuditError('Unknown category')
  if (!IMPLEMENTED_RUNNERS.includes(category) || !categoryById(category)?.implemented) {
    throw new AuditError(`${categoryById(category)?.label || category} is not available yet`)
  }
  const batchId = body.batchId ? requireUuid(body.batchId, 'batchId') : null
  await loadCompany(supabase, companyId)

  const running = await findRunningRun(supabase, companyId, category)
  if (running) return { run: publicRun(running), resumed: true, nextDelayMs: nextDelayMs(running) }

  const { siteUrl } = await resolveSiteUrl(supabase, companyId)
  if (!siteUrl) throw new AuditError('No domain set — add it in Company Intelligence')
  const origin = await resolveLiveOrigin(siteUrl)

  const run = await createRun(supabase, {
    companyId,
    category,
    batchId,
    siteUrl: origin,
    userId: user?.id,
  })
  return { run: publicRun(run), resumed: false, nextDelayMs: 0 }
}

async function handleStep(supabase, companyId, body) {
  const runId = requireUuid(body.runId, 'runId')
  const expectedStep = Number(body.expectedStep)
  if (!Number.isInteger(expectedStep) || expectedStep < 0) throw new AuditError('expectedStep is required')

  const run = await getRun(supabase, runId, companyId)
  if (run.status !== 'running') {
    return { run: publicRun(run), done: true, nextDelayMs: null }
  }
  const claimed = await claimStep(supabase, run, expectedStep)
  if (!claimed) {
    // Another client advanced it; hand back the current state.
    const current = await getRun(supabase, runId, companyId)
    return { run: publicRun(current), done: current.status !== 'running', conflict: true, nextDelayMs: 1000 }
  }
  try {
    let next = await advanceRun(supabase, claimed)
    if (next.status === 'running' && next.progress?.stepErrors) {
      next = await updateRun(supabase, next.id, {
        progress: { ...next.progress, stepErrors: 0, lastError: null },
      })
    }
    return { run: publicRun(next), done: next.status !== 'running', nextDelayMs: nextDelayMs(next) }
  } catch (err) {
    console.error('[audit] step failed', err)
    const message = String(err?.message || 'Step failed')
    const stepErrors = (Number(claimed.progress?.stepErrors) || 0) + 1
    if (stepErrors >= MAX_STEP_ERRORS) {
      const failed = await endRun(supabase, claimed, 'error', `${message} (failed ${stepErrors} times in a row)`)
      return { run: publicRun(failed), done: true, nextDelayMs: null }
    }
    // Likely transient (e.g. a dropped socket): keep the run open; the client retries the step.
    const retry = await updateRun(supabase, claimed.id, {
      progress: {
        ...claimed.progress,
        stepErrors,
        lastError: message.slice(0, 300),
        message: `Retrying after an error (${stepErrors}/${MAX_STEP_ERRORS - 1})…`,
      },
    })
    return { run: publicRun(retry), done: false, nextDelayMs: 2000 * stepErrors }
  }
}

async function handleRun(supabase, companyId, runIdRaw) {
  const runId = requireUuid(runIdRaw, 'runId')
  const run = await getRun(supabase, runId, companyId)
  return { run: publicRun(run), nextDelayMs: nextDelayMs(run) }
}

async function handleCancel(supabase, companyId, body) {
  const runId = requireUuid(body.runId, 'runId')
  const run = await getRun(supabase, runId, companyId)
  if (run.status !== 'running') return { run: publicRun(run) }
  const ended = await endRun(supabase, run, 'cancelled', 'Cancelled')
  return { run: publicRun(ended) }
}

async function handleOverride(supabase, user, companyId, body) {
  const raw = Array.isArray(body.issues) ? body.issues : []
  if (!raw.length || raw.length > MAX_OVERRIDES) {
    throw new AuditError(`issues must contain 1–${MAX_OVERRIDES} items`)
  }
  const items = raw.map((item) => {
    const fingerprint = String(item?.fingerprint || '').trim()
    if (!FINGERPRINT_RE.test(fingerprint)) throw new AuditError('Invalid fingerprint')
    return { fingerprint, checkId: String(item?.checkId || '').trim().slice(0, 120) || null }
  })
  await loadCompany(supabase, companyId)

  if (body.accepted === false) {
    // Chunked: fingerprints travel in the query string on DELETE.
    for (let i = 0; i < items.length; i += 100) {
      const { error } = await supabase
        .from('audit_issue_overrides')
        .delete()
        .eq('company_id', companyId)
        .in(
          'fingerprint',
          items.slice(i, i + 100).map((item) => item.fingerprint)
        )
      if (error) throw error
    }
    return { count: items.length, accepted: false }
  }
  const note = String(body.note || '').trim().slice(0, 500) || null
  const { error } = await supabase.from('audit_issue_overrides').upsert(
    items.map((i) => ({
      company_id: companyId,
      fingerprint: i.fingerprint,
      check_id: i.checkId,
      note,
      created_by: user?.id || null,
    })),
    { onConflict: 'company_id,fingerprint' }
  )
  if (error) throw error
  return { count: items.length, accepted: true }
}

export async function handleAudit(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return
  res.setHeader('Access-Control-Allow-Origin', '*')

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }
  const { supabase, user } = auth
  const action = auditAction(req)
  const body = parseBody(req)
  const url = new URL(req.url || '/', 'http://localhost')

  try {
    const companyId = requireUuid(body.companyId || url.searchParams.get('companyId'), 'companyId')

    if (req.method === 'GET') {
      if (action === 'audit.state') return json(res, 200, await handleState(supabase, companyId))
      if (action === 'audit.run') {
        return json(res, 200, await handleRun(supabase, companyId, url.searchParams.get('runId')))
      }
      return json(res, 400, { error: 'Unknown audit action' })
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

    switch (action) {
      case 'audit.preflight':
        return json(res, 200, await handlePreflight(supabase, companyId, body))
      case 'audit.start':
        return json(res, 200, await handleStart(supabase, user, companyId, body))
      case 'audit.step':
        return json(res, 200, await handleStep(supabase, companyId, body))
      case 'audit.cancel':
        return json(res, 200, await handleCancel(supabase, companyId, body))
      case 'audit.override':
        return json(res, 200, await handleOverride(supabase, user, companyId, body))
      default:
        return json(res, 400, { error: 'Unknown audit action' })
    }
  } catch (err) {
    if (err instanceof AuditError) return json(res, err.statusCode, { error: err.message })
    if (/audit_runs|audit_issues|audit_issue_overrides|ai_training_bot_policy/i.test(err?.message || '')) {
      return json(res, 500, {
        error: 'Audit tables missing — apply supabase/migrations/057_audit_v1.sql',
      })
    }
    console.error('[audit]', err)
    return json(res, 500, { error: err?.message || 'Internal server error' })
  }
}
