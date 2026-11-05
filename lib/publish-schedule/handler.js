/**
 * /api/publish-schedule
 *   GET  (Vercel cron, Authorization: Bearer CRON_SECRET)  publish what is due today
 *   POST { op: 'publish_now', itemId }                      publish one item now (signed in)
 *
 * Creating, pausing, moving and cancelling schedules happen in the browser
 * (publish_schedules / publish_schedule_items); only publishing needs the server.
 */
import { timingSafeEqual } from 'node:crypto'
import { createServiceClient, handleOptions, json, requireAuth } from '../seo-advisor/auth.js'
import { publishAndRecord, runPublishDue } from './run.js'
import { isStalePublishing } from './plan.js'

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function isCron(req) {
  return Boolean(req.headers?.['x-vercel-cron-schedule']) || req.method === 'GET'
}

/** Heartbeat for the panel ("Daily publisher last ran …"). Never fails the run. */
async function recordCronRun(supabase, { ok, detail }) {
  try {
    const { error } = await supabase.from('cron_runs').insert({ job: 'publish-schedule', ok, detail })
    if (error) console.error('cron_runs insert failed (run migration 074?):', error.message)
  } catch (err) {
    console.error('cron_runs insert failed:', err?.message || err)
  }
}

function readBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    return null
  }
}

export async function handlePublishSchedule(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method === 'GET' && isCron(req)) {
    const secret = String(process.env.CRON_SECRET || '').trim()
    const header = String(req.headers?.authorization || '')
    if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
      return json(res, 401, { error: 'Unauthorized' })
    }
    let supabase
    try {
      supabase = createServiceClient()
      const result = await runPublishDue({ supabase })
      const summary = { checked: result.checked, published: result.published.length, failed: result.failed.length }
      console.log('publish-schedule cron:', JSON.stringify(summary))
      await recordCronRun(supabase, { ok: true, detail: { ...summary, errors: result.failed.map((f) => f.error) } })
      return json(res, 200, result)
    } catch (err) {
      console.error('publish-schedule cron error:', err)
      if (supabase) await recordCronRun(supabase, { ok: false, detail: { error: err?.message || String(err) } })
      return json(res, 500, { error: err?.message || 'Scheduled publishing failed' })
    }
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }
  const body = readBody(req)
  if (!body) return json(res, 400, { error: 'Invalid JSON body' })

  if (body.op !== 'publish_now') return json(res, 400, { error: 'op must be "publish_now"' })
  const itemId = String(body.itemId || '').trim()
  if (!itemId) return json(res, 400, { error: 'itemId is required' })

  const { supabase } = auth
  const { data: item, error } = await supabase
    .from('publish_schedule_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle()
  if (error) return json(res, 500, { error: error.message })
  if (!item) return json(res, 404, { error: 'Schedule item not found' })
  if (item.status === 'published') return json(res, 409, { error: 'Already published' })
  if (item.status === 'publishing' && !isStalePublishing(item)) return json(res, 409, { error: 'Already publishing' })
  if (!item.generated_article_id) return json(res, 409, { error: 'This article has not been written yet' })

  const { data: schedule } = await supabase
    .from('publish_schedules')
    .select('*')
    .eq('id', item.schedule_id)
    .maybeSingle()
  if (!schedule) return json(res, 404, { error: 'Schedule not found' })
  if (schedule.status === 'cancelled') return json(res, 409, { error: 'This schedule was cancelled' })

  // Publishing on request: a retry after a failure starts its attempts again.
  const fresh = item.status === 'failed' ? { ...item, attempts: 0 } : item
  const result = await publishAndRecord({ supabase, schedule, item: fresh })
  return json(res, result.ok ? 200 : 502, result)
}
