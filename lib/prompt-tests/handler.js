// HTTP entry for the Prompt Tests tool (api/prompt-tests.js).
// GET ?action=state|export, POST { action: settings|preview|start|step|finish }.
//
// A test is driven from the browser in small steps (up to 10 calls each), because
// one capture takes 20 to 35 seconds and a full test would outlast a single request.

import { requireAuth, handleOptions, parseBody, json } from '../seo-advisor/auth.js'
import { dfsCall, llmModels, llmResponse } from '../audit/providers/dataforseo.js'
import { pickModel } from '../audit/runners.js'
import {
  ENGINES,
  ENGINE_IDS,
  DEFAULT_RUNS,
  parseScraperResult,
  parseApiResult,
  deriveRun,
  outcomeFor,
  normalizeQuery,
  nameMatchers,
  cleanUrl,
} from './derive.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_STEP_CALLS = 10
const MAX_RUNS_PER_ENGINE = 5
const DEFAULT_CAP = 10

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const uuid = (v, name) => {
  const s = String(v || '').trim()
  if (!UUID_RE.test(s)) throw new HttpError(`${name} must be a UUID`)
  return s
}
const round = (n) => Math.round(Number(n || 0) * 10000) / 10000

function cleanSettings(row) {
  const runs = {}
  for (const e of ENGINE_IDS) {
    const n = Math.round(Number(row?.runs?.[e]))
    runs[e] = Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_RUNS_PER_ENGINE) : DEFAULT_RUNS[e]
  }
  const engines = (Array.isArray(row?.engines) ? row.engines : ['chatgpt', 'gemini']).filter((e) => ENGINE_IDS.includes(e))
  const cap = Number(row?.monthly_cap)
  return {
    monthly_cap: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_CAP,
    runs,
    engines,
    location_code: Number(row?.location_code) || 2840,
    language_code: String(row?.language_code || 'en'),
  }
}

async function loadSettings(supabase, companyId) {
  const { data, error } = await supabase.from('pt_settings').select('*').eq('company_id', companyId).maybeSingle()
  if (error) throw error
  return cleanSettings(data)
}

async function loadBrands(supabase, companyId) {
  const { data, error } = await supabase.from('pt_brands').select('*').eq('company_id', companyId).order('sort')
  if (error) throw error
  return data || []
}

/** Recorded spend since the first of the month (UTC), failed calls included. */
async function monthSpend(supabase, companyId) {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data, error } = await supabase.from('pt_runs').select('cost').eq('company_id', companyId).gte('ran_at', start).limit(20000)
  if (error) throw error
  return round((data || []).reduce((a, r) => a + Number(r.cost || 0), 0))
}

/** Average recorded cost per call for an engine, falling back to the list price or an estimate. */
async function unitCosts(supabase, companyId) {
  const { data } = await supabase.from('pt_runs').select('engine, cost').eq('company_id', companyId).eq('status', 'ok').order('ran_at', { ascending: false }).limit(400)
  const sum = {}
  const n = {}
  for (const r of data || []) {
    sum[r.engine] = (sum[r.engine] || 0) + Number(r.cost || 0)
    n[r.engine] = (n[r.engine] || 0) + 1
  }
  const out = {}
  for (const e of ENGINE_IDS) out[e] = n[e] >= 5 ? sum[e] / n[e] : ENGINES[e].unitCost
  return out
}

function planCalls(promptIds, settings, engines) {
  const calls = []
  for (const promptId of promptIds) {
    for (const engine of engines) {
      for (let runNo = 1; runNo <= settings.runs[engine]; runNo++) calls.push({ promptId, engine, runNo })
    }
  }
  return calls
}

async function preview(supabase, companyId, body) {
  const settings = await loadSettings(supabase, companyId)
  const promptIds = [...new Set((Array.isArray(body.promptIds) ? body.promptIds : []).map((v) => uuid(v, 'promptIds')))]
  const engines = (Array.isArray(body.engines) && body.engines.length ? body.engines : settings.engines).filter((e) => ENGINE_IDS.includes(e) && settings.runs[e] > 0)
  if (!promptIds.length) throw new HttpError('Select at least one approved prompt')
  if (!engines.length) throw new HttpError('Turn on at least one engine')
  const { data: prompts, error } = await supabase.from('pt_prompts').select('id, status').eq('company_id', companyId).in('id', promptIds)
  if (error) throw error
  const approved = (prompts || []).filter((p) => p.status === 'Approved').map((p) => p.id)
  if (approved.length !== promptIds.length) throw new HttpError('Only approved prompts can be tested')
  const calls = planCalls(approved, settings, engines)
  const costs = await unitCosts(supabase, companyId)
  const perEngine = engines.map((e) => {
    const n = calls.filter((c) => c.engine === e).length
    return { engine: e, label: ENGINES[e].label, method: ENGINES[e].method, calls: n, runs: settings.runs[e], unitCost: round(costs[e]), cost: round(n * costs[e]), estimated: ENGINES[e].method === 'api' }
  })
  const estCost = round(perEngine.reduce((a, x) => a + x.cost, 0))
  const spent = await monthSpend(supabase, companyId)
  return {
    settings,
    engines,
    calls,
    perEngine,
    prompts: approved.length,
    estCost,
    monthSpent: spent,
    cap: settings.monthly_cap,
    remaining: round(Math.max(0, settings.monthly_cap - spent)),
    ok: spent + estCost <= settings.monthly_cap + 1e-9,
  }
}

const modelCache = {}
async function apiModel(engine) {
  const key = ENGINES[engine].path
  if (modelCache[key]) return modelCache[key]
  const listed = await llmModels(key)
  const model = pickModel(key, listed.models)
  if (model) modelCache[key] = model
  return model
}

/** One call to one engine. Never throws. */
async function callEngine(engine, prompt, settings) {
  const cfg = ENGINES[engine]
  if (cfg.method === 'app') {
    // force_web_search is left out on purpose: the test must show whether the prompt triggers a search on its own.
    const res = await dfsCall(`/v3/ai_optimization/${cfg.path}/llm_scraper/live/advanced`, {
      task: { keyword: String(prompt).slice(0, 2000), location_code: settings.location_code, language_code: settings.language_code },
      timeoutMs: 120_000,
    })
    return { ...res, parsed: res.ok && res.result?.[0] ? parseScraperResult(res.result[0]) : null }
  }
  const model = await apiModel(engine)
  if (!model) return { ok: false, cost: 0, result: [], error: `No ${cfg.label} model is available`, parsed: null }
  const res = await llmResponse({ engine: cfg.path, model, prompt })
  return { ...res, parsed: res.ok && res.result?.[0] ? parseApiResult(res.result[0]) : null }
}

async function runCall(supabase, ctx, call) {
  const { companyId, cycleId, settings, brands, promptText } = ctx
  let res = await callEngine(call.engine, promptText[call.promptId], settings)
  let cost = Number(res.cost) || 0
  if (!res.ok || !res.parsed) {
    // Retry a failed call once. Both attempts count toward spend.
    const again = await callEngine(call.engine, promptText[call.promptId], settings)
    cost += Number(again.cost) || 0
    res = again
  }
  const base = {
    company_id: companyId,
    cycle_id: cycleId,
    prompt_id: call.promptId,
    engine: call.engine,
    method: ENGINES[call.engine].method,
    run_no: call.runNo,
    ran_at: new Date().toISOString(),
    location_code: settings.location_code,
    language_code: settings.language_code,
    cost: round(cost),
  }
  let row
  if (res.ok && res.parsed) {
    const d = deriveRun(res.parsed, brands)
    row = {
      ...base,
      status: 'ok',
      error: null,
      model: res.parsed.model,
      answer: res.parsed.answer,
      fan_out: res.parsed.fanOut,
      search_results: res.parsed.searchResults,
      cited: res.parsed.cited,
      brand_entities: res.parsed.brandEntities,
      searched: d.searched,
      brands: d.brands,
      own_cited_urls: d.ownCitedUrls,
      raw: res.result?.[0] || null,
    }
  } else {
    // Stored as failed; never counted as "no search".
    row = { ...base, status: 'failed', error: String(res.error || 'No result returned').slice(0, 500), searched: null, brands: {}, raw: null }
  }
  const { error } = await supabase.from('pt_runs').upsert(row, { onConflict: 'cycle_id,prompt_id,engine,run_no' })
  if (error) throw error
  return { promptId: call.promptId, engine: call.engine, runNo: call.runNo, status: row.status, cost: row.cost, error: row.error }
}

async function start(supabase, companyId, body) {
  const p = await preview(supabase, companyId, body)
  if (!p.ok) {
    throw new HttpError(`This test would cost about $${p.estCost.toFixed(2)}. $${p.monthSpent.toFixed(2)} of the $${p.cap.toFixed(2)} monthly cap is already spent.`, 402)
  }
  const { data, error } = await supabase
    .from('pt_cycles')
    .insert({ company_id: companyId, engines: p.engines, runs: p.settings.runs, prompt_ids: [...new Set(p.calls.map((c) => c.promptId))], planned_calls: p.calls.length, est_cost: p.estCost, status: 'running' })
    .select('id')
    .single()
  if (error) throw error
  return { cycleId: data.id, calls: p.calls, estCost: p.estCost }
}

async function step(supabase, companyId, body) {
  const cycleId = uuid(body.cycleId, 'cycleId')
  const calls = (Array.isArray(body.calls) ? body.calls : []).slice(0, MAX_STEP_CALLS).map((c) => ({
    promptId: uuid(c?.promptId, 'promptId'),
    engine: ENGINE_IDS.includes(c?.engine) ? c.engine : null,
    runNo: Math.max(1, Math.min(MAX_RUNS_PER_ENGINE, Math.round(Number(c?.runNo) || 1))),
  }))
  if (!calls.length || calls.some((c) => !c.engine)) throw new HttpError('No valid calls in this step')
  const { data: cycle, error: cErr } = await supabase.from('pt_cycles').select('id, company_id, prompt_ids, status').eq('id', cycleId).maybeSingle()
  if (cErr) throw cErr
  if (!cycle || cycle.company_id !== companyId) throw new HttpError('Test cycle not found', 404)
  if (calls.some((c) => !(cycle.prompt_ids || []).includes(c.promptId))) throw new HttpError('A call is outside this test cycle')

  const [settings, brands, spent, costs] = await Promise.all([loadSettings(supabase, companyId), loadBrands(supabase, companyId), monthSpend(supabase, companyId), unitCosts(supabase, companyId)])
  const stepCost = calls.reduce((a, c) => a + costs[c.engine], 0)
  if (spent + stepCost > settings.monthly_cap + 1e-9) {
    return { capReached: true, results: [], monthSpent: spent, cap: settings.monthly_cap }
  }
  const ids = [...new Set(calls.map((c) => c.promptId))]
  const { data: prompts, error: pErr } = await supabase.from('pt_prompts').select('id, prompt').eq('company_id', companyId).in('id', ids)
  if (pErr) throw pErr
  const promptText = Object.fromEntries((prompts || []).map((p) => [p.id, p.prompt]))
  // Skip calls this cycle already completed (a retried step must not pay twice).
  const { data: done } = await supabase.from('pt_runs').select('prompt_id, engine, run_no, status').eq('cycle_id', cycleId).in('prompt_id', ids)
  const doneKey = new Set((done || []).filter((r) => r.status === 'ok').map((r) => `${r.prompt_id}|${r.engine}|${r.run_no}`))
  const ctx = { companyId, cycleId, settings, brands, promptText }
  const results = await Promise.all(
    calls.map((c) => {
      if (doneKey.has(`${c.promptId}|${c.engine}|${c.runNo}`)) return { ...c, status: 'ok', cost: 0, skipped: true }
      if (!promptText[c.promptId]) return { ...c, status: 'failed', cost: 0, error: 'Prompt not found' }
      return runCall(supabase, ctx, c).catch((err) => ({ ...c, status: 'failed', cost: 0, error: String(err?.message || err).slice(0, 300) }))
    })
  )
  return { capReached: false, results, monthSpent: await monthSpend(supabase, companyId), cap: settings.monthly_cap }
}

async function finish(supabase, companyId, body) {
  const cycleId = uuid(body.cycleId, 'cycleId')
  const { error } = await supabase.from('pt_cycles').update({ status: body.stopped ? 'stopped' : 'done', finished_at: new Date().toISOString() }).eq('id', cycleId).eq('company_id', companyId)
  if (error) throw error
  return { ok: true }
}

async function saveSettings(supabase, companyId, body) {
  const next = cleanSettings({ ...(await loadSettings(supabase, companyId)), ...body.settings })
  const { error } = await supabase.from('pt_settings').upsert({ company_id: companyId, ...next, updated_at: new Date().toISOString() })
  if (error) throw error
  return { settings: next }
}

const SLIM = 'id, cycle_id, prompt_id, engine, method, run_no, status, error, model, ran_at, cost, searched, brands, fan_out, cited, own_cited_urls'

/** Runs of each prompt's latest cycle, per engine. */
function latestRuns(runs, cycles) {
  const at = Object.fromEntries(cycles.map((c) => [c.id, c.created_at]))
  const latest = {}
  for (const r of runs) {
    const key = `${r.prompt_id}|${r.engine}`
    const t = at[r.cycle_id] || r.ran_at
    if (!latest[key] || t > latest[key].t) latest[key] = { t, cycle: r.cycle_id }
  }
  return runs.filter((r) => latest[`${r.prompt_id}|${r.engine}`].cycle === r.cycle_id)
}

const share = (n, base) => ({ n, base })

function summarize(prompts, runs, brands, altNames) {
  const own = brands.find((b) => b.is_own)
  const byPrompt = Object.fromEntries(prompts.map((p) => [p.id, p]))
  const out = {}
  for (const engine of ENGINE_IDS) {
    const er = runs.filter((r) => r.engine === engine)
    if (!er.length) continue
    const groups = {}
    for (const r of er) (groups[r.prompt_id] = groups[r.prompt_id] || []).push(r)
    const tested = Object.entries(groups).filter(([, rs]) => rs.some((r) => r.status === 'ok'))
    const base = tested.length
    const anyRun = (rs, f) => rs.some((r) => r.status === 'ok' && f(r))
    const rate = (filter) => {
      const g = tested.filter(([id]) => filter(byPrompt[id] || {}))
      return share(g.filter(([, rs]) => anyRun(rs, (r) => r.searched)).length, g.length)
    }
    const brandRows = brands.map((b) => ({
      id: b.id,
      name: b.name,
      own: b.is_own,
      retrieved: tested.filter(([, rs]) => anyRun(rs, (r) => r.brands?.[b.id]?.retrieved)).length,
      cited: tested.filter(([, rs]) => anyRun(rs, (r) => r.brands?.[b.id]?.cited)).length,
      named: tested.filter(([, rs]) => anyRun(rs, (r) => r.brands?.[b.id]?.named)).length,
    }))
    const domains = {}
    const buyDomains = {}
    const ownUrls = {}
    const queryNames = {}
    const matchers = altNames.map((n) => ({ n, re: nameMatchers([n])[0] })).filter((m) => m.re)
    for (const [id, rs] of tested) {
      const seen = new Set()
      for (const r of rs) {
        if (r.status !== 'ok') continue
        for (const c of r.cited || []) seen.add(c.domain)
        // Runs stored before URLs were cleaned may hold the same page with and without tracking parameters.
        for (const u of new Set((r.own_cited_urls || []).map(cleanUrl))) ownUrls[u] = (ownUrls[u] || 0) + 1
        // Queries are not deduplicated across runs: frequency matters.
        for (const q of r.fan_out || []) for (const m of matchers) if (m.re.test(q) || q.toLowerCase().includes(m.n.toLowerCase())) queryNames[m.n] = (queryNames[m.n] || 0) + 1
      }
      for (const d of seen) {
        domains[d] = (domains[d] || 0) + 1
        if ((byPrompt[id] || {}).stage === 'Buy') buyDomains[d] = (buyDomains[d] || 0) + 1
      }
    }
    const top = (m, k) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, n]) => ({ name, n }))
    out[engine] = {
      label: ENGINES[engine].label,
      method: ENGINES[engine].method,
      model: er.find((r) => r.model)?.model || null,
      lastRun: er.reduce((a, r) => (r.ran_at > a ? r.ran_at : a), ''),
      tested: base,
      failedCalls: er.filter((r) => r.status === 'failed').length,
      search: { all: rate(() => true), byStage: Object.fromEntries(['Learn', 'Problem', 'Buy'].map((s) => [s, rate((p) => p.stage === s)])), byType: Object.fromEntries(['Question', 'Comparison', 'Recommendation'].map((t) => [t, rate((p) => p.type === t)])) },
      brands: brandRows,
      topDomains: top(domains, 20).map((d) => ({ ...d, buy: buyDomains[d.name] || 0 })),
      buyBase: tested.filter(([id]) => (byPrompt[id] || {}).stage === 'Buy').length,
      ownUrls: top(ownUrls, 10),
      queryNames: top(queryNames, 15),
      fanOutQueries: er.reduce((a, r) => a + (r.fan_out || []).length, 0),
    }
  }
  return { own: own ? own.id : null, engines: out }
}

async function state(supabase, companyId) {
  const [settings, brands, spent, promptsRes, cyclesRes, runsRes] = await Promise.all([
    loadSettings(supabase, companyId),
    loadBrands(supabase, companyId),
    monthSpend(supabase, companyId),
    supabase.from('pt_prompts').select('id, code, persona, situation, stage, type, variables, named_brands, prompt, status').eq('company_id', companyId).order('code').limit(5000),
    supabase.from('pt_cycles').select('id, created_at, finished_at, status, engines, planned_calls, est_cost').eq('company_id', companyId).order('created_at', { ascending: false }).limit(50),
    supabase.from('pt_runs').select(SLIM).eq('company_id', companyId).order('ran_at', { ascending: false }).limit(10000),
  ])
  for (const r of [promptsRes, cyclesRes, runsRes]) if (r.error) throw r.error
  const prompts = promptsRes.data || []
  const cycles = cyclesRes.data || []
  const runs = latestRuns(runsRes.data || [], cycles)
  const own = brands.find((b) => b.is_own)
  const outcomes = {}
  const grouped = {}
  for (const r of runs) ((grouped[r.prompt_id] = grouped[r.prompt_id] || {})[r.engine] = grouped[r.prompt_id][r.engine] || []).push(r)
  for (const [pid, byEngine] of Object.entries(grouped)) {
    outcomes[pid] = {}
    for (const [engine, rs] of Object.entries(byEngine)) outcomes[pid][engine] = outcomeFor(rs, own ? own.id : '')
  }
  const altNames = brands.map((b) => b.name).filter(Boolean)
  // Results count Approved prompts only. A rejected prompt keeps its runs and its own outcome, but leaves the totals.
  const counted = new Set(prompts.filter((p) => p.status === 'Approved').map((p) => p.id))
  return {
    settings,
    brands,
    prompts,
    cycles,
    outcomes,
    summary: summarize(prompts, runs.filter((r) => counted.has(r.prompt_id)), brands, altNames),
    spend: { month: spent, cap: settings.monthly_cap },
    engines: Object.fromEntries(ENGINE_IDS.map((e) => [e, { label: ENGINES[e].label, method: ENGINES[e].method, fanOut: ENGINES[e].fanOut }])),
    dataforseo: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
  }
}

/** One row per run of each prompt's latest cycle, with the full answer text and fan-out queries. */
async function exportRuns(supabase, companyId) {
  const [promptsRes, cyclesRes, runsRes] = await Promise.all([
    supabase.from('pt_prompts').select('id, code, persona, situation, stage, type, prompt').eq('company_id', companyId).limit(5000),
    supabase.from('pt_cycles').select('id, created_at').eq('company_id', companyId).limit(200),
    supabase.from('pt_runs').select(`${SLIM}, answer, search_results`).eq('company_id', companyId).order('ran_at', { ascending: false }).limit(5000),
  ])
  for (const r of [promptsRes, cyclesRes, runsRes]) if (r.error) throw r.error
  const byId = Object.fromEntries((promptsRes.data || []).map((p) => [p.id, p]))
  return {
    runs: latestRuns(runsRes.data || [], cyclesRes.data || []).map((r) => ({
      prompt_code: byId[r.prompt_id]?.code || '',
      persona: byId[r.prompt_id]?.persona || '',
      situation: byId[r.prompt_id]?.situation || '',
      stage: byId[r.prompt_id]?.stage || '',
      type: byId[r.prompt_id]?.type || '',
      prompt: byId[r.prompt_id]?.prompt || '',
      engine: r.engine,
      method: r.method,
      run_no: r.run_no,
      status: r.status,
      error: r.error,
      model: r.model,
      ran_at: r.ran_at,
      cost: r.cost,
      searched: r.searched,
      fan_out_queries: r.fan_out || [],
      fan_out_normalised: (r.fan_out || []).map(normalizeQuery),
      search_result_domains: [...new Set((r.search_results || []).map((x) => x.domain))],
      cited_domains: [...new Set((r.cited || []).map((x) => x.domain))],
      own_cited_urls: [...new Set((r.own_cited_urls || []).map(cleanUrl))],
      brands: r.brands || {},
      answer: r.answer || '',
    })),
  }
}

export async function handlePromptTests(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return
  try {
    const { supabase } = await requireAuth(req)
    const url = new URL(req.url || '/', 'http://localhost')
    const body = req.method === 'POST' ? parseBody(req) : {}
    const action = String(url.searchParams.get('action') || body.action || '')
    const companyId = uuid(url.searchParams.get('companyId') || body.companyId, 'companyId')
    if (req.method === 'GET' && action === 'state') return json(res, 200, await state(supabase, companyId))
    if (req.method === 'GET' && action === 'export') return json(res, 200, await exportRuns(supabase, companyId))
    if (req.method !== 'POST') throw new HttpError('Unknown action', 404)
    if (action === 'settings') return json(res, 200, await saveSettings(supabase, companyId, body))
    if (action === 'preview') return json(res, 200, await preview(supabase, companyId, body))
    if (action === 'start') return json(res, 200, await start(supabase, companyId, body))
    if (action === 'step') return json(res, 200, await step(supabase, companyId, body))
    if (action === 'finish') return json(res, 200, await finish(supabase, companyId, body))
    throw new HttpError('Unknown action', 404)
  } catch (err) {
    const status = err?.status || err?.statusCode || 500
    return json(res, status, { error: err?.message || 'Prompt test request failed' })
  }
}
