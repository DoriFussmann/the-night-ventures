// HTTP entry for the Fan-Out Engine (api/fan-out.js).
// POST { action: structure | check | persona | prompts | start_run | run | finish_run | label | score | groups | card | takeaway | sync | topics, companyId, situationId, ... }.
//
// The page reads and edits its own rows (fo_situations, fo_prompts, fo_runs, fo_topics)
// through Supabase directly. This endpoint does the work that needs a key: the requests
// to Claude and the captures of real ChatGPT. A run is driven from the browser in small
// steps, because one capture takes 15 to 100 seconds.

import Anthropic from '@anthropic-ai/sdk'
import { GENERATE_ARTICLE_MODEL } from '../generate-article/prompt.js'
import { requireAuth, handleOptions, parseBody, json } from '../seo-advisor/auth.js'
import { dfsCall } from '../audit/providers/dataforseo.js'
import { ENGINES, parseScraperResult, deriveRun } from '../prompt-tests/derive.js'
import { loadSettings, loadBrands, monthSpend } from '../prompt-tests/handler.js'
import { buildLabelPrompt, labelBatches, parseLabels, scoreRuns, unlabeled } from './score.js'
import { buildCardPrompt, buildGroupsPrompt, closestPage, groupStats, howTheyGotThere, parseCard, parseGroups, plainTakeaway, runQueries, summarizeGroups, takeawayFacts, takeawayOk, ungrouped } from './groups.js'
import { readPage } from './pages.js'
import { movedVerdict } from './compare.js'
import {
  FORMS,
  RUN_STEP,
  buildStructurePrompt,
  parseStructure,
  parseJsonReply,
  buildCheckPrompt,
  parseCheck,
  buildPersonaPrompt,
  parsePersona,
  isPersona,
  buildPromptsPrompt,
  parsePrompts,
  mergeSettings,
  missingFields,
  promptLabel,
  promptIssues,
  collectQueries,
  collectCited,
  buildTopicsPrompt,
  parseTopics,
  parsePageTypes,
  topicStats,
  decideAction,
  staleAfter,
} from './core.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_STEP_CALLS = RUN_STEP
/** Labeling stops starting new requests after this long, to end well inside the function's 300 seconds. */
const LABEL_BUDGET_MS = 200_000
/** Runs of one Scenario that are scored at a time: the Baseline and the latest ones. */
const SCORED_RUNS = 12
const UNIT_COST = ENGINES.chatgpt.unitCost

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
const now = () => new Date().toISOString()

function extractText(blocks) {
  return (Array.isArray(blocks) ? blocks : []).filter((b) => b?.type === 'text' && b.text).map((b) => b.text).join('')
}

async function askClaude(prompt, maxTokens, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new HttpError('ANTHROPIC_API_KEY not configured', 500)
  const { full: _full, ...client } = options
  const anthropic = new Anthropic({ apiKey, ...client })
  const message = await anthropic.messages.create({ model: GENERATE_ARTICLE_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  return options.full ? { text: extractText(message.content).trim(), usage: { input_tokens: message.usage?.input_tokens || 0, output_tokens: message.usage?.output_tokens || 0 } } : extractText(message.content).trim()
}

/** The reply with what the call used, for the calls of step 5 whose cost is recorded. */
const askClaudeFull = (prompt, maxTokens) => askClaude(prompt, maxTokens, { full: true, timeout: 120_000, maxRetries: 1 })

async function loadSituation(supabase, companyId, situationId) {
  const { data, error } = await supabase.from('fo_situations').select('*').eq('id', situationId).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError('Situation not found', 404)
  return data
}

async function ownNames(supabase, companyId) {
  const brands = await loadBrands(supabase, companyId)
  const own = brands.find((b) => b.is_own)
  const names = own ? [own.name, ...(Array.isArray(own.name_patterns) ? own.name_patterns : [])] : []
  return { brands, own, names: [...new Set(names.map((n) => String(n || '').trim()).filter((n) => n.length >= 2))] }
}

/** Which later steps already hold data, so a redone step can mark them out of date. */
async function laterData(supabase, situationId) {
  const [p, r, t] = await Promise.all([
    supabase.from('fo_prompts').select('id', { count: 'exact', head: true }).eq('situation_id', situationId).is('archived_at', null),
    // Runs of an archived prompt are kept but are no longer part of the Scenario.
    supabase.from('fo_runs').select('id, fo_prompts!inner(archived_at)', { count: 'exact', head: true }).eq('situation_id', situationId).is('fo_prompts.archived_at', null),
    supabase.from('fo_topics').select('id', { count: 'exact', head: true }).eq('situation_id', situationId),
  ])
  return { prompts: (p.count || 0) > 0, run: (r.count || 0) > 0, topics: (t.count || 0) > 0, push: (t.count || 0) > 0 }
}

async function saveSituation(supabase, id, patch) {
  const { data, error } = await supabase.from('fo_situations').update({ ...patch, updated_at: now() }).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

/** Admin settings of the engine: the defaults with the saved overrides on top. */
async function loadFoSettings(supabase) {
  const { data, error } = await supabase.from('fo_settings').select('values').eq('id', 'global').maybeSingle()
  if (error) throw error
  return mergeSettings(data?.values)
}

/** Every tracked brand name and alias, own and competitors: prompts and personas are unbranded. */
function allNames(brands) {
  const names = brands.flatMap((b) => [b.name, ...(Array.isArray(b.name_patterns) ? b.name_patterns : [])])
  return [...new Set(names.map((n) => String(n || '').trim()).filter((n) => n.length >= 2))]
}

function fieldsFrom(body) {
  const f = body.fields && typeof body.fields === 'object' ? body.fields : {}
  const text = (v, max) => String(v || '').trim().slice(0, max)
  return { who: text(f.who, 600), trigger_event: text(f.trigger_event, 600), goal: text(f.goal, 600), stage: text(f.stage, 20), comments: text(f.comments, 1500) }
}

/** A Run never changes under way: while one is open, the persona and the prompts cannot be rewritten. */
async function noOpenRun(supabase, situationId) {
  const { data, error } = await supabase.from('fo_scenario_runs').select('id').eq('situation_id', situationId).eq('status', 'running').limit(1)
  if (error) throw error
  if ((data || []).length) throw new HttpError('A Run of this Scenario is open. Continue it or end it first.')
}

/** Free text -> the Situation fields. Nothing is saved: the user reviews the fields first. */
async function structure(supabase, companyId, body) {
  const text = String(body.text || '').trim().slice(0, 4000)
  if (text.length < 20) throw new HttpError('Describe the situation in a sentence or two first')
  const settings = await loadFoSettings(supabase)
  const request = buildStructurePrompt({ text, settings })
  const reply = await askClaude(request, 700)
  return { ...parseStructure(reply), details: { request, reply, at: now() } }
}

/** A suggested name, and the saved Situations this one overlaps with. Nothing is saved. */
async function check(supabase, companyId, body) {
  const fields = fieldsFrom(body)
  const missing = missingFields(fields)
  if (missing.length) throw new HttpError(`Fill in ${missing.join(', ')} first`)
  const exclude = body.situationId ? uuid(body.situationId, 'situationId') : ''
  const [settings, { data: rows, error }] = await Promise.all([
    loadFoSettings(supabase),
    supabase.from('fo_situations').select('id, code, title, description, who, trigger_event, goal, stage').eq('company_id', companyId).order('created_at', { ascending: false }).limit(80),
  ])
  if (error) throw error
  const bank = (rows || []).filter((s) => s.id !== exclude)
  const request = buildCheckPrompt({ fields, bank, settings })
  const reply = await askClaude(request, 700)
  return { ...parseCheck(reply, bank), details: { request, reply, at: now() } }
}

async function persona(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const missing = missingFields(situation)
  if (missing.length) throw new HttpError(`Fill in the Situation first: ${missing.join(', ')}`)
  await noOpenRun(supabase, situation.id)
  const [settings, { data: playbook }, { brands }] = await Promise.all([
    loadFoSettings(supabase),
    supabase.from('aeo_playbook').select('icp, icp_strategic_md').eq('company_id', companyId).maybeSingle().then((r) => r),
    ownNames(supabase, companyId),
  ])
  const names = allNames(brands)
  const request = buildPersonaPrompt({ situation, icpMd: playbook?.icp_strategic_md || '', icpShort: playbook?.icp || '', settings, names })
  const reply = await askClaude(request, 600)
  const parsed = parsePersona(reply, names)
  const has = await laterData(supabase, situation.id)
  return {
    situation: await saveSituation(supabase, situation.id, {
      persona: { ...parsed, has_icp: Boolean(playbook?.icp_strategic_md || playbook?.icp) },
      persona_confirmed_at: null,
      prompts_confirmed_at: null,
      baseline_run_id: null, // the next Run is a new Baseline
      step: 'persona',
      stale_from: staleAfter('persona', has),
      details: { ...(situation.details || {}), persona: { request, reply, at: now() } },
    }),
  }
}

/** Takes prompts out of the Scenario. One that already has runs is archived, so its raw runs are kept. */
async function retirePrompts(supabase, ids) {
  if (!ids.length) return
  const { data: used, error } = await supabase.from('fo_runs').select('prompt_id').in('prompt_id', ids)
  if (error) throw error
  const withRuns = new Set((used || []).map((r) => r.prompt_id))
  const archive = ids.filter((id) => withRuns.has(id))
  const remove = ids.filter((id) => !withRuns.has(id))
  if (archive.length) {
    const res = await supabase.from('fo_prompts').update({ archived_at: now(), updated_at: now() }).in('id', archive)
    if (res.error) throw res.error
  }
  if (remove.length) {
    const res = await supabase.from('fo_prompts').delete().in('id', remove)
    if (res.error) throw res.error
  }
}

/**
 * Writes the prompts: all of them (the user's own prompts are kept), or, with promptId, one again on a new angle.
 * The prompts are not frozen until the user confirms them.
 */
async function prompts(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const missing = missingFields(situation)
  if (missing.length) throw new HttpError(`Fill in the Situation first: ${missing.join(', ')}`)
  if (!isPersona(situation.persona)) throw new HttpError('Write the persona first')
  await noOpenRun(supabase, situation.id)
  const [settings, { data: playbook }, { data: current, error: curErr }, { brands }] = await Promise.all([
    loadFoSettings(supabase),
    supabase.from('aeo_playbook').select('icp').eq('company_id', companyId).maybeSingle().then((r) => r),
    supabase.from('fo_prompts').select('*').eq('situation_id', situation.id).is('archived_at', null),
    ownNames(supabase, companyId),
  ])
  const names = allNames(brands)
  if (curErr) throw curErr
  const active = current || []
  const one = body.promptId ? active.find((p) => p.id === uuid(body.promptId, 'promptId')) : null
  if (body.promptId && !one) throw new HttpError('Prompt not found', 404)
  const only = one ? { form: one.form, taken: active.map((p) => p.angle || p.prompt.slice(0, 120)) } : null
  const request = buildPromptsPrompt({ situation, persona: situation.persona, icpShort: playbook?.icp || '', settings, only, names })
  const reply = await askClaude(request, 3000)
  let parsed = parsePrompts(reply, { perType: settings.prompts_per_type, names })
  // The new prompts are saved first and the old ones retired after, so a failed save loses nothing.
  let rows
  let retire
  if (one) {
    parsed = parsed.filter((p) => p.form === one.form).slice(0, 1)
    if (!parsed.length) throw new HttpError('The prompt came back empty. Try again.', 502)
    retire = [one.id]
    rows = [{ company_id: companyId, situation_id: situation.id, form: one.form, angle: parsed[0].angle, prompt: parsed[0].prompt, sort: one.sort, origin: one.origin }]
  } else {
    const lacking = FORMS.filter((f) => !parsed.some((p) => p.form === f))
    if (lacking.length) throw new HttpError(`The reply had no ${lacking.join(' or ')} prompt. Nothing was changed. Try again.`, 502)
    retire = active.filter((p) => p.origin !== 'user').map((p) => p.id)
    const next = {}
    rows = parsed.map((p) => ({ company_id: companyId, situation_id: situation.id, form: p.form, angle: p.angle, prompt: p.prompt, sort: (next[p.form] = (next[p.form] || 0) + 1) - 1, origin: 'ai' }))
  }
  const { error } = await supabase.from('fo_prompts').insert(rows)
  if (error) throw error
  await retirePrompts(supabase, retire)
  const { data, error: readErr } = await supabase.from('fo_prompts').select('*').eq('situation_id', situation.id).is('archived_at', null)
  if (readErr) throw readErr
  const has = await laterData(supabase, situation.id)
  return {
    prompts: data || [],
    situation: await saveSituation(supabase, situation.id, {
      step: 'prompts',
      prompts_confirmed_at: null,
      baseline_run_id: null, // the next Run is a new Baseline
      stale_from: staleAfter('prompts', has),
      details: { ...(situation.details || {}), prompts: { request, reply, at: now() } },
    }),
  }
}

/** One capture of real ChatGPT. The prompt is sent whole or not at all: it is never cut. Never throws. */
async function capture(prompt, settings) {
  const started = Date.now()
  // force_web_search is left out on purpose: the run must show whether the prompt triggers a search on its own.
  const res = await dfsCall(`/v3/ai_optimization/${ENGINES.chatgpt.path}/llm_scraper/live/advanced`, {
    task: { keyword: prompt, location_code: settings.location_code, language_code: settings.language_code },
    timeoutMs: 130_000,
  })
  const parsed = res.ok && res.result?.[0] ? parseScraperResult(res.result[0]) : null
  return { ...res, parsed, seconds: Math.round((Date.now() - started) / 100) / 10 }
}

async function runCall(supabase, ctx, call) {
  const { companyId, situationId, scenarioRunId, settings, brands, promptText, promptForm } = ctx
  let res = await capture(promptText[call.promptId], settings)
  let cost = Number(res.cost) || 0
  let attempts = 1
  if (!res.ok || !res.parsed) {
    // The engine gives up at about 100 seconds on prompts that ask for a lot. One retry; failed captures are not charged.
    const again = await capture(promptText[call.promptId], settings)
    cost += Number(again.cost) || 0
    attempts = 2
    res = again
  }
  const base = { company_id: companyId, situation_id: situationId, scenario_run_id: scenarioRunId, prompt_id: call.promptId, prompt_text: promptText[call.promptId], prompt_form: promptForm[call.promptId], run_no: call.runNo, ran_at: now(), attempts, seconds: res.seconds, cost: round(cost) }
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
    // Stored as failed; never shown as "no search".
    row = { ...base, status: 'failed', error: String(res.error || 'No result returned').slice(0, 500), model: null, answer: null, fan_out: [], search_results: [], cited: [], brand_entities: [], searched: null, brands: {}, own_cited_urls: [], raw: null }
  }
  const { error } = await supabase.from('fo_runs').upsert(row, { onConflict: 'scenario_run_id,prompt_id,run_no' })
  if (error) throw error
  return { promptId: call.promptId, runNo: call.runNo, status: row.status, cost: row.cost, seconds: row.seconds, attempts, error: row.error, queries: row.fan_out.length }
}

/** One step of an open Run: up to four captures of real ChatGPT, in parallel. */
async function run(supabase, companyId, body) {
  const scenarioRun = await loadScenarioRun(supabase, companyId, uuid(body.scenarioRunId, 'scenarioRunId'))
  if (scenarioRun.status !== 'running') throw new HttpError('This Run has ended. Start a new one.')
  const calls = (Array.isArray(body.calls) ? body.calls : []).slice(0, MAX_STEP_CALLS).map((c) => ({
    promptId: uuid(c?.promptId, 'promptId'),
    runNo: Math.max(1, Math.min(scenarioRun.runs_per_prompt, Math.round(Number(c?.runNo) || 1))),
  }))
  if (!calls.length) throw new HttpError('No calls in this step')
  const ids = Array.isArray(scenarioRun.prompt_ids) ? scenarioRun.prompt_ids : []
  if (calls.some((c) => !ids.includes(c.promptId))) throw new HttpError('A call is outside this Run')
  // The Run asks the prompts it was started with, archived or not: a Run never changes under way.
  const { data: rows, error } = await supabase.from('fo_prompts').select('id, prompt, form').in('id', ids)
  if (error) throw error
  const promptText = Object.fromEntries((rows || []).map((p) => [p.id, p.prompt]))
  const promptForm = Object.fromEntries((rows || []).map((p) => [p.id, p.form]))
  if (calls.some((c) => !promptText[c.promptId])) throw new HttpError('A prompt of this Run no longer exists. End the Run and start a new one.')
  const brands = await loadBrands(supabase, companyId)
  const [settings, spent] = await Promise.all([loadSettings(supabase, companyId), monthSpend(supabase, companyId)])
  if (spent + calls.length * UNIT_COST > settings.monthly_cap + 1e-9) {
    return { capReached: true, results: [], monthSpent: spent, cap: settings.monthly_cap }
  }
  // A retried step must not pay twice for a capture that already succeeded.
  const { data: done } = await supabase.from('fo_runs').select('prompt_id, run_no, status').eq('scenario_run_id', scenarioRun.id)
  const doneKey = new Set((done || []).filter((r) => r.status === 'ok').map((r) => `${r.prompt_id}|${r.run_no}`))
  const ctx = { companyId, situationId: scenarioRun.situation_id, scenarioRunId: scenarioRun.id, settings, brands, promptText, promptForm }
  const results = await Promise.all(
    calls.map((c) => {
      if (doneKey.has(`${c.promptId}|${c.runNo}`)) return { ...c, status: 'ok', cost: 0, skipped: true }
      return runCall(supabase, ctx, c).catch((err) => ({ ...c, status: 'failed', cost: 0, error: String(err?.message || err).slice(0, 300) }))
    })
  )
  return { capReached: false, results, monthSpent: await monthSpend(supabase, companyId), cap: settings.monthly_cap }
}

/* ---------- Runs ---------- */

const RUN_COLS = 'id, scenario_run_id, prompt_id, prompt_form, run_no, status, model, cost, searched, answer, fan_out, cited, brand_entities, raw_entities:raw->brand_entities, mention_labels'

async function loadScenarioRun(supabase, companyId, id) {
  const { data, error } = await supabase.from('fo_scenario_runs').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError('Run not found', 404)
  return data
}

/** The prompts of a Scenario that a Run asks: the active ones, checked. */
async function runnablePrompts(supabase, situation, names) {
  const { data: rows, error } = await supabase.from('fo_prompts').select('id, prompt, form, sort, created_at').eq('situation_id', situation.id).is('archived_at', null)
  if (error) throw error
  if (!(rows || []).length) throw new HttpError('Write the prompts first')
  if (situation.version >= 2 && !situation.prompts_confirmed_at) throw new HttpError('Confirm the prompts first: a Run uses frozen prompts')
  for (const p of rows) {
    const issues = promptIssues(p.prompt, names)
    if (issues.block.length) throw new HttpError(`The prompt ${promptLabel(p, rows)} cannot run: ${issues.block[0]}`)
  }
  return rows
}

/**
 * Starts a Run: a record of one execution of the Scenario. The first Run of a Scenario since its prompts
 * were last confirmed is its Baseline. Nothing is asked of ChatGPT yet; the browser drives the captures.
 */
async function startRun(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const { brands } = await ownNames(supabase, companyId)
  const rows = await runnablePrompts(supabase, situation, allNames(brands))
  const { data: earlier, error } = await supabase.from('fo_scenario_runs').select('id, seq, status').eq('situation_id', situation.id).order('seq', { ascending: false })
  if (error) throw error
  const open = (earlier || []).find((r) => r.status === 'running')
  if (open) throw new HttpError('A Run of this Scenario is still open. Continue it or stop it first.')
  const runsPer = Math.max(1, Math.min(10, Math.round(Number(situation.runs) || 7)))
  const est = round(rows.length * runsPer * UNIT_COST)
  const [settings, spent] = await Promise.all([loadSettings(supabase, companyId), monthSpend(supabase, companyId)])
  if (spent + est > settings.monthly_cap + 1e-9) {
    return { capReached: true, monthSpent: spent, cap: settings.monthly_cap, estCost: est }
  }
  const { data: made, error: insErr } = await supabase
    .from('fo_scenario_runs')
    .insert({ company_id: companyId, situation_id: situation.id, seq: ((earlier || [])[0]?.seq || 0) + 1, runs_per_prompt: runsPer, prompt_ids: rows.map((p) => p.id), est_cost: est })
    .select('*')
    .single()
  if (insErr) throw insErr
  const has = await laterData(supabase, situation.id)
  const next = await saveSituation(supabase, situation.id, { step: 'run', stale_from: staleAfter('run', has), ...(situation.baseline_run_id ? {} : { baseline_run_id: made.id }) })
  return { capReached: false, run: made, situation: next }
}

/**
 * Labels every mention that has none yet (Recommended / Listed / Qualified, with the quoted phrase). Saved once.
 * Each round of requests is saved as it returns, and the work stops before the function's time limit:
 * `left` says how many mentions still have no label, to be picked up by the next call.
 */
async function labelMentions(supabase, companyId, scenarioRunId) {
  const started = Date.now()
  const [{ data: rows, error }, brands, settings] = await Promise.all([
    supabase.from('fo_runs').select('id, status, answer, mention_labels').eq('scenario_run_id', scenarioRunId).eq('status', 'ok').limit(200),
    loadBrands(supabase, companyId),
    loadFoSettings(supabase),
  ])
  if (error) throw error
  const todo = unlabeled(rows || [], brands)
  const total = todo.reduce((a, x) => a + x.brands.length, 0)
  if (!total) return { labeled: 0, left: 0 }
  const batches = labelBatches(todo)
  const current = Object.fromEntries((rows || []).map((r) => [r.id, r.mention_labels || {}]))
  let labeled = 0
  for (let i = 0; i < batches.length; i += 3) {
    if (Date.now() - started > LABEL_BUDGET_MS) break
    const out = await Promise.all(
      batches.slice(i, i + 3).map(async (batch) => {
        try {
          return parseLabels(await askClaude(buildLabelPrompt(batch, settings.prompt_labels), 3000, { timeout: 70_000, maxRetries: 1 }), batch, brands)
        } catch {
          return [] // these mentions stay without a label and are asked again by the next call
        }
      })
    )
    const byRun = new Map()
    for (const l of out.flat()) byRun.set(l.runId, { ...(byRun.get(l.runId) || {}), [l.brandId]: { label: l.label, quote: l.quote } })
    for (const [runId, add] of byRun) {
      current[runId] = { ...current[runId], ...add }
      const res = await supabase.from('fo_runs').update({ mention_labels: current[runId] }).eq('id', runId)
      if (res.error) throw res.error
    }
    labeled += out.flat().length
  }
  return { labeled, left: total - labeled }
}

/**
 * Ends a Run and records its actual cost. A Run in which nothing returned is removed: it measured nothing
 * (failed captures are not charged). The mentions are labeled by a separate call, so a slow labeling never
 * leaves a Run open.
 */
async function finishRun(supabase, companyId, body) {
  const run = await loadScenarioRun(supabase, companyId, uuid(body.scenarioRunId, 'scenarioRunId'))
  if (run.status !== 'running') return { run, removed: false }
  const { data: rows, error } = await supabase.from('fo_runs').select('cost, status').eq('scenario_run_id', run.id).limit(200)
  if (error) throw error
  if (!(rows || []).some((r) => r.status === 'ok')) {
    const del = await supabase.from('fo_scenario_runs').delete().eq('id', run.id)
    if (del.error) throw del.error
    return { run: null, removed: true }
  }
  const cost = round((rows || []).reduce((a, r) => a + Number(r.cost || 0), 0))
  const res = await supabase.from('fo_scenario_runs').update({ status: body.stopped ? 'stopped' : 'done', cost, finished_at: now() }).eq('id', run.id).select('*').single()
  if (res.error) throw res.error
  return { run: res.data, removed: false }
}

/** Labels mentions that have none: after a brand was added to the tracked list, or when labeling failed earlier. */
async function label(supabase, companyId, body) {
  const run = await loadScenarioRun(supabase, companyId, uuid(body.scenarioRunId, 'scenarioRunId'))
  return { labels: await labelMentions(supabase, companyId, run.id) }
}

/**
 * The score of every Run of a Scenario, calculated now from the stored answers and today's brand list,
 * so old Runs stay comparable when the list, the aliases or the thresholds change.
 */
async function score(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const [{ data: all, error }, brands, settings, groups] = await Promise.all([
    supabase.from('fo_scenario_runs').select('*').eq('situation_id', situation.id).order('seq'),
    loadBrands(supabase, companyId),
    loadFoSettings(supabase),
    activeGroups(supabase, situation.id),
  ])
  if (error) throw error
  // The Baseline and the latest Runs, each read with its own request (one request returns 1,000 rows at most).
  const list = all || []
  const scored = list.filter((sr, i) => sr.id === situation.baseline_run_id || i >= list.length - SCORED_RUNS)
  const out = await Promise.all(
    scored.map(async (sr) => {
      const { data: mine, error: runErr } = await supabase.from('fo_runs').select(RUN_COLS).eq('scenario_run_id', sr.id).limit(200)
      if (runErr) throw runErr
      const rows = mine || []
      return {
        id: sr.id,
        seq: sr.seq,
        status: sr.status,
        legacy: sr.legacy,
        started_at: sr.started_at,
        finished_at: sr.finished_at,
        unlabeled: unlabeled(rows, brands).reduce((a, x) => a + x.brands.length, 0),
        score: scoreRuns(rows, brands, settings.signal),
        // The Query Groups of this Run, measured the same way for every Run.
        groups: summarizeGroups(groups, rows, brands, { thresholds: settings.signal, cutoffs: settings.cutoffs }),
        ungrouped: ungrouped(runQueries(rows), groups).length,
        takeaway: sr.takeaway || '',
        usage: sr.summary_usage || {},
      }
    })
  )
  return { situationId: situation.id, runs: out, hasOwnBrand: brands.some((b) => b.is_own), direction: situation.direction, limits: { opportunities: settings.opportunities_per_run, wins: settings.wins_per_run }, cutoff: settings.cutoffs.opportunity, signal: settings.signal }
}

/* ---------- Step 5: Query Groups, cards, takeaway ---------- */

const GROUP_RUN_COLS = 'id, scenario_run_id, prompt_id, prompt_form, run_no, status, answer, fan_out, cited, brand_entities, raw_entities:raw->brand_entities, searched, mention_labels, model'

async function runCaptures(supabase, scenarioRunId, cols = GROUP_RUN_COLS) {
  const { data, error } = await supabase.from('fo_runs').select(cols).eq('scenario_run_id', scenarioRunId).limit(200)
  if (error) throw error
  return data || []
}

async function activeGroups(supabase, situationId) {
  const { data, error } = await supabase.from('fo_query_groups').select('*').eq('situation_id', situationId).is('archived_at', null).order('sort')
  if (error) throw error
  return data || []
}

/** Adds what one AI call used to the Run's record of step 5, so its real cost can be read later. */
async function addUsage(supabase, scenarioRunId, usage) {
  const { data } = await supabase.from('fo_scenario_runs').select('summary_usage').eq('id', scenarioRunId).maybeSingle()
  const u = data?.summary_usage || {}
  const next = {
    input_tokens: (u.input_tokens || 0) + (usage.input_tokens || 0),
    output_tokens: (u.output_tokens || 0) + (usage.output_tokens || 0),
    calls: (u.calls || 0) + (usage.calls || 0),
    pages_read: (u.pages_read || 0) + (usage.pages_read || 0),
  }
  await supabase.from('fo_scenario_runs').update({ summary_usage: next, summary_at: now() }).eq('id', scenarioRunId)
}

/**
 * Groups the searches of a Run. At the Baseline every search is grouped and the groups are frozen. In a later
 * Run, new searches are sorted into the existing groups; what fits none becomes a new group flagged New.
 */
async function groupQueries(supabase, companyId, body) {
  const run = await loadScenarioRun(supabase, companyId, uuid(body.scenarioRunId, 'scenarioRunId'))
  const situation = await loadSituation(supabase, companyId, run.situation_id)
  // The groups are frozen at the Baseline, so the Baseline is grouped first, whichever Run asks.
  if (situation.baseline_run_id && run.id !== situation.baseline_run_id && !body.inner) {
    const { data: frozen, error: fErr } = await supabase.from('fo_query_groups').select('id').eq('situation_id', situation.id).eq('baseline_run_id', situation.baseline_run_id).is('archived_at', null).limit(1)
    if (fErr) throw fErr
    if (!(frozen || []).length) await groupQueries(supabase, companyId, { scenarioRunId: situation.baseline_run_id, inner: true })
  }
  const [captures, brands, settings] = await Promise.all([runCaptures(supabase, run.id, 'id, status, prompt_form, fan_out'), loadBrands(supabase, companyId), loadFoSettings(supabase)])
  const queries = runQueries(captures)
  let groups = await activeGroups(supabase, situation.id)
  const baselineId = situation.baseline_run_id
  // A new Baseline (the Scenario changed) starts the groups again; the old ones are kept, archived.
  if (run.id === baselineId && groups.some((g) => g.baseline_run_id !== baselineId)) {
    const res = await supabase.from('fo_query_groups').update({ archived_at: now() }).in('id', groups.map((g) => g.id))
    if (res.error) throw res.error
    groups = []
  }
  const todo = ungrouped(queries, groups)
  if (!todo.length) return { groups: groups.length, added: 0, created: 0, searches: queries.length }
  const request = buildGroupsPrompt({ situation, queries: todo, groups, template: settings.prompt_groups })
  const { text, usage } = await askClaudeFull(request, 6000)
  const parsed = parseGroups(text, todo, groups, allNames(brands))
  // A reply that leaves out many searches is a bad grouping: nothing is saved, so it can be done again.
  if (parsed.leftOver > Math.max(3, todo.length * 0.3)) throw new HttpError('The grouping came back incomplete. Nothing was changed. Try again.', 502)
  for (const a of parsed.into) {
    const g = groups.find((x) => x.id === a.groupId)
    const res = await supabase.from('fo_query_groups').update({ norms: [...new Set([...(g.norms || []), ...a.norms])] }).eq('id', g.id)
    if (res.error) throw res.error
  }
  if (parsed.created.length) {
    const frozen = groups.length > 0 // groups exist already: anything created now is New
    const rows = parsed.created.map((c, i) => ({ company_id: companyId, situation_id: situation.id, label: c.label, norms: c.norms, baseline_run_id: baselineId, first_run_id: run.id, is_new: frozen, sort: groups.length + i }))
    const res = await supabase.from('fo_query_groups').insert(rows)
    if (res.error) throw res.error
  }
  await addUsage(supabase, run.id, { ...usage, calls: 1 })
  return { groups: groups.length + parsed.created.length, added: parsed.into.reduce((a, x) => a + x.norms.length, 0), created: parsed.created.length, searches: queries.length }
}

/**
 * Writes one card. The app reads the most-cited pages, works out how the winner got there and the company's
 * closest page; the AI adds the estimate of why (from the fixed reason list), what to cover and the action.
 * Each card's "why" is saved to the Insights bank.
 */
async function card(supabase, companyId, body) {
  const run = await loadScenarioRun(supabase, companyId, uuid(body.scenarioRunId, 'scenarioRunId'))
  const groupId = uuid(body.groupId, 'groupId')
  const situation = await loadSituation(supabase, companyId, run.situation_id)
  const [captures, brands, settings, groups, topicsRes, pillarsRes] = await Promise.all([
    runCaptures(supabase, run.id),
    loadBrands(supabase, companyId),
    loadFoSettings(supabase),
    activeGroups(supabase, situation.id),
    supabase.from('aeo_prompt_groups').select('id, code, name, status, live_slug, primary_keyword').eq('company_id', companyId).limit(1000),
    supabase.from('aeo_pillars').select('id, code, name').eq('company_id', companyId).order('sort'),
  ])
  if (topicsRes.error) throw topicsRes.error
  const group = groups.find((g) => g.id === groupId)
  if (!group) throw new HttpError('Query Group not found', 404)
  const stats = groupStats(group, captures, brands, { thresholds: settings.signal, cutoffs: settings.cutoffs })
  if (!stats.runs) throw new HttpError('ChatGPT did not search this in this Run')
  const kind = stats.verdict === 'Win' ? 'win' : 'opportunity'
  const { data: before } = await supabase.from('fo_cards').select('id, status, pillar_id, brief_id').eq('scenario_run_id', run.id).eq('group_id', group.id).maybeSingle()
  if (before && before.status !== 'open') throw new HttpError('This card was already acted on, so it is not rewritten')
  const own = brands.find((b) => b.is_own)
  const winner = kind === 'win' ? (own ? { name: own.name, brandId: own.id, runs: stats.standing.named } : null) : stats.leader
  // For a Win the pages that matter are the company's own; for an Opportunity, the most cited ones.
  const wanted = (kind === 'win' && stats.ownCited.length ? [...stats.ownCited, ...stats.cited.filter((p) => !p.own)] : stats.cited).filter((p) => p.url).slice(0, settings.pages_per_group)
  const read = await Promise.all(wanted.map(async (p) => ({ ...p, ...(await readPage(p.url)), runs: p.runs, domain: p.domain })))
  const pagesRead = read.map((p) => ({ url: p.url, domain: p.domain, title: p.title, runs: p.runs, ok: p.ok, error: p.error, modified: p.modified, text: p.text }))
  const how = howTheyGotThere(winner, stats, brands, pagesRead)
  const yourPage = closestPage(stats, topicsRes.data || [])
  const pillars = pillarsRes.data || []
  const request = buildCardPrompt({ kind, situation, stats, winner, how, yourPage, pagesRead, pillars, template: settings.prompt_card })
  const { text, usage } = await askClaudeFull(request, 1200)
  const parsed = parseCard(text, { kind, yourPage, pillars, brandNames: allNames(brands) })
  const row = {
    company_id: companyId,
    situation_id: situation.id,
    scenario_run_id: run.id,
    group_id: group.id,
    kind,
    stats: { label: stats.label, signal: stats.signal, standing: stats.standing, leader: stats.leader, difficulty: stats.difficulty, score: stats.score, searches: stats.searches.slice(0, 12), whoNamed: stats.whoNamed.slice(0, 5), promptIds: stats.promptIds, runs: stats.runs },
    how: how.how,
    how_pages: how.pages,
    your_page: yourPage,
    pages: pagesRead.map(({ text: _text, ...p }) => p),
    reasons: parsed.reasons,
    why: parsed.why,
    cover: parsed.cover,
    action: parsed.action,
    action_line: parsed.actionLine,
    repeat_this: parsed.repeatThis,
    comparison: parsed.comparison,
    pillar_id: before?.pillar_id || parsed.pillarId,
    // The text of the pages that were read is not kept: only which pages, and the reply.
    details: { request: buildCardPrompt({ kind, situation, stats, winner, how, yourPage, pagesRead: pagesRead.map((p) => ({ ...p, text: p.ok ? '(the page text, as read)' : '' })), pillars, template: settings.prompt_card }), reply: text, at: now() },
    updated_at: now(),
  }
  const { data: saved, error } = await supabase.from('fo_cards').upsert(row, { onConflict: 'scenario_run_id,group_id' }).select('*').single()
  if (error) throw error
  const insight = {
    company_id: companyId,
    situation_id: situation.id,
    scenario_run_id: run.id,
    card_id: saved.id,
    tag: kind === 'win' ? 'your_win' : 'competitor_win',
    brand: winner?.name || '',
    search: stats.label,
    reasons: parsed.reasons.filter((r) => r !== 'no_page'), // "no page" is about us, not why the winner wins
    page: how.pages[0]?.url || '',
    counts: { named: winner?.runs || 0, of: stats.runs, signal_x: stats.signal.x, signal_n: stats.signal.n },
  }
  // An Opportunity nobody wins has no "why the winner wins" to keep.
  if (winner && insight.reasons.length) {
    const res = await supabase.from('fo_insights').upsert(insight, { onConflict: 'card_id' })
    if (res.error) throw res.error
  }
  await addUsage(supabase, run.id, { ...usage, calls: 1, pages_read: pagesRead.filter((p) => p.ok).length })
  return { card: saved }
}

/** The three-sentence takeaway. The AI writes it; it may only point to numbers the app calculated, and that is checked. */
async function takeaway(supabase, companyId, body) {
  const run = await loadScenarioRun(supabase, companyId, uuid(body.scenarioRunId, 'scenarioRunId'))
  const [captures, brands, settings, groups] = await Promise.all([runCaptures(supabase, run.id), loadBrands(supabase, companyId), loadFoSettings(supabase), activeGroups(supabase, run.situation_id)])
  const s = scoreRuns(captures, brands, settings.signal)
  if (!s.runs) throw new HttpError('No run has returned yet')
  const g = summarizeGroups(groups, captures, brands, { thresholds: settings.signal, cutoffs: settings.cutoffs })
  const facts = takeawayFacts(s, g)
  let text = ''
  let written = 'app'
  try {
    const out = await askClaudeFull(settings.prompt_takeaway.replace('{facts}', facts.map((f) => `- ${f}`).join('\n')), 400)
    const candidate = String(parseJsonReply(out.text).takeaway || '').trim().slice(0, 700)
    await addUsage(supabase, run.id, { ...out.usage, calls: 1 })
    if (candidate && takeawayOk(candidate, facts)) {
      text = candidate
      written = 'ai'
    }
  } catch {
    // falls back to the app's own sentence below
  }
  if (!text) text = plainTakeaway(s, g)
  const res = await supabase.from('fo_scenario_runs').update({ takeaway: text, summary_at: now() }).eq('id', run.id)
  if (res.error) throw res.error
  return { takeaway: text, written }
}

/**
 * Closes the loop without manual marking. An Opportunity that was sent to AEO Generation is marked Acted on
 * once its brief is published there, with the page address and the date. Then, for every Opportunity acted on
 * before the latest Run, the Insight behind it is marked Confirmed (the brand moved to half or more of the runs
 * for that search) or Not confirmed.
 */
async function sync(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const { data: cards, error } = await supabase.from('fo_cards').select('id, group_id, scenario_run_id, status, brief_id, acted_on_at, acted_url, stats, kind').eq('situation_id', situation.id).eq('kind', 'opportunity')
  if (error) throw error
  let marked = 0
  // A card whose brief was deleted in AEO Generation is open again.
  const orphans = (cards || []).filter((c) => c.status === 'pushed' && !c.brief_id)
  if (orphans.length) {
    const res = await supabase.from('fo_cards').update({ status: 'open', pushed_at: null, aeo_group_id: null, merged_into: null, updated_at: now() }).in('id', orphans.map((c) => c.id))
    if (res.error) throw res.error
    for (const c of orphans) c.status = 'open'
    marked += orphans.length
  }
  const pushed = (cards || []).filter((c) => c.status === 'pushed' && c.brief_id)
  if (pushed.length) {
    const { data: briefs, error: bErr } = await supabase.from('aeo_briefs').select('id, generated_article_id').in('id', [...new Set(pushed.map((c) => c.brief_id))])
    if (bErr) throw bErr
    const ids = (briefs || []).map((b) => b.generated_article_id).filter(Boolean)
    // The article itself says when it went live and where, whether or not AEO Generation was opened since.
    const { data: articles, error: aErr } = ids.length ? await supabase.from('generated_articles').select('id, status, published_at, published_url').in('id', ids) : { data: [] }
    if (aErr) throw aErr
    const live = Object.fromEntries((articles || []).filter((a) => a.status === 'published').map((a) => [a.id, a]))
    for (const b of briefs || []) {
      const article = live[b.generated_article_id]
      if (!article) continue
      const patch = { status: 'acted_on', acted_on_at: article.published_at || now(), acted_url: article.published_url || '', updated_at: now() }
      const res = await supabase.from('fo_cards').update(patch).eq('brief_id', b.id).eq('status', 'pushed').select('id')
      if (res.error) throw res.error
      for (const c of cards) if (c.brief_id === b.id && c.status === 'pushed') Object.assign(c, patch)
      marked += (res.data || []).length
    }
  }
  // Did what we did work? Each acted-on card is judged on its own Query Group, in the latest finished Run that
  // started after the action. When that Run did not search the group, or the group belongs to an earlier
  // Baseline, there is nothing to judge and the Insight keeps the verdict it has.
  let judged = 0
  const acted = (cards || []).filter((c) => ['acted_on', 'done'].includes(c.status) && c.acted_on_at)
  if (acted.length) {
    const { data: runs, error: rErr } = await supabase.from('fo_scenario_runs').select('id, started_at, status, legacy').eq('situation_id', situation.id).neq('status', 'running').eq('legacy', false).order('seq', { ascending: false }).limit(1)
    if (rErr) throw rErr
    const latest = (runs || [])[0]
    const due = latest ? acted.filter((c) => c.scenario_run_id !== latest.id && new Date(c.acted_on_at) < new Date(latest.started_at)) : []
    if (due.length) {
      const [captures, brands, settings, groups] = await Promise.all([runCaptures(supabase, latest.id), loadBrands(supabase, companyId), loadFoSettings(supabase), activeGroups(supabase, situation.id)])
      for (const c of due) {
        const group = groups.find((g) => g.id === c.group_id)
        const stats = group ? groupStats(group, captures, brands, { thresholds: settings.signal, cutoffs: settings.cutoffs }) : null
        if (!stats || !stats.runs) continue
        const moved = movedVerdict(c.stats?.standing, stats.standing, settings.cutoffs.opportunity)
        const res = await supabase.from('fo_insights').update({ verdict: moved ? 'confirmed' : 'not_confirmed', verdict_at: now() }).eq('card_id', c.id)
        if (res.error) throw res.error
        judged += 1
      }
    }
  }
  return { marked, judged }
}

async function topics(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const { data: scenarioRuns, error: srErr } = await supabase.from('fo_scenario_runs').select('id, seq').eq('situation_id', situation.id).order('seq', { ascending: false })
  if (srErr) throw srErr
  // The topics are built from the latest Run that has answers.
  let runs = []
  for (const sr of scenarioRuns || []) {
    const { data, error } = await supabase.from('fo_runs').select('id, prompt_id, prompt_form, scenario_run_id, run_no, status, fan_out, cited, answer, brands, brand_entities, raw_entities:raw->brand_entities, searched').eq('scenario_run_id', sr.id).eq('status', 'ok').limit(200)
    if (error) throw error
    if ((data || []).length) {
      runs = data
      break
    }
  }
  const [promptsRes, pillarsRes, groupsRes, companyRes, existingRes] = await Promise.all([
    supabase.from('fo_prompts').select('*').in('id', [...new Set(runs.map((r) => r.prompt_id))].length ? [...new Set(runs.map((r) => r.prompt_id))] : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('aeo_pillars').select('id, code, name').eq('company_id', companyId).order('sort'),
    supabase.from('aeo_prompt_groups').select('id, code, name, pillar_id, status').eq('company_id', companyId).order('code'),
    supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
    supabase.from('fo_topics').select('id, status').eq('situation_id', situation.id),
  ])
  for (const r of [promptsRes, pillarsRes, groupsRes, existingRes]) if (r.error) throw r.error
  if (!runs.length) throw new HttpError('No run has returned yet. Run the prompts first.')
  const queries = collectQueries(runs, promptsRes.data || [])
  const { brands, own, names } = await ownNames(supabase, companyId)
  const base = { step: 'topics', stale_from: '' }
  // Topics already pushed are kept: their briefs exist.
  const drop = (existingRes.data || []).filter((t) => t.status !== 'pushed').map((t) => t.id)
  if (!queries.length) {
    if (drop.length) await supabase.from('fo_topics').delete().in('id', drop)
    return {
      topics: [],
      noSearch: true,
      situation: await saveSituation(supabase, situation.id, { ...base, details: { ...(situation.details || {}), topics: { request: '', reply: 'ChatGPT ran no web search in any run, so there is nothing to group.', at: now() } } }),
    }
  }
  const pillars = pillarsRes.data || []
  const groups = groupsRes.data || []
  const cited = collectCited(runs)
  const request = buildTopicsPrompt({ situation, prompts: promptsRes.data || [], queries, runs, cited, pillars, groups, ownNames: names, companyName: companyRes.data?.name || '' })
  const reply = await askClaude(request, 4500)
  const parsed = parseTopics(reply, queries)
  const pageTypes = parsePageTypes(reply, cited)
  const rows = parsed.map((t, i) => {
    const stats = topicStats(t, queries, runs, promptsRes.data || [], own?.id || '', { brands, pageTypes })
    const matchGroup = groups.find((g) => g.code.toLowerCase() === t.match_group.toLowerCase()) || null
    const pillar = pillars.find((p) => p.code.toLowerCase() === t.pillar.toLowerCase()) || (matchGroup ? pillars.find((p) => p.id === matchGroup.pillar_id) : null) || null
    const decision = decideAction({ standing: stats.standing, local: t.local, recommendation: t.recommendation, matchGroup, hasOwnBrand: Boolean(own) })
    return {
      company_id: companyId,
      situation_id: situation.id,
      title: t.title,
      ...stats,
      local: t.local,
      recommendation: t.recommendation,
      owner_note: t.owner_note,
      answer_points: t.answer_points,
      action: decision.action,
      action_reason: decision.reason,
      pillar_id: pillar?.id || null,
      group_id: matchGroup?.id || null,
      status: 'proposed',
      sort: i,
    }
  })
  if (drop.length) {
    const { error } = await supabase.from('fo_topics').delete().in('id', drop)
    if (error) throw error
  }
  const { data, error } = await supabase.from('fo_topics').insert(rows).select('*')
  if (error) throw error
  return {
    topics: data || [],
    noSearch: false,
    situation: await saveSituation(supabase, situation.id, { ...base, details: { ...(situation.details || {}), topics: { request, reply, at: now() } } }),
  }
}

export async function handleFanOut(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return
  try {
    const { supabase } = await requireAuth(req)
    if (req.method !== 'POST') throw new HttpError('Unknown action', 404)
    const url = new URL(req.url || '/', 'http://localhost')
    const body = parseBody(req)
    const action = String(url.searchParams.get('action') || body.action || '')
    const companyId = uuid(body.companyId, 'companyId')
    if (action === 'structure') return json(res, 200, await structure(supabase, companyId, body))
    if (action === 'check') return json(res, 200, await check(supabase, companyId, body))
    if (action === 'persona') return json(res, 200, await persona(supabase, companyId, body))
    if (action === 'prompts') return json(res, 200, await prompts(supabase, companyId, body))
    if (action === 'start_run') return json(res, 200, await startRun(supabase, companyId, body))
    if (action === 'run') return json(res, 200, await run(supabase, companyId, body))
    if (action === 'finish_run') return json(res, 200, await finishRun(supabase, companyId, body))
    if (action === 'label') return json(res, 200, await label(supabase, companyId, body))
    if (action === 'groups') return json(res, 200, await groupQueries(supabase, companyId, body))
    if (action === 'card') return json(res, 200, await card(supabase, companyId, body))
    if (action === 'sync') return json(res, 200, await sync(supabase, companyId, body))
    if (action === 'takeaway') return json(res, 200, await takeaway(supabase, companyId, body))
    if (action === 'score') return json(res, 200, await score(supabase, companyId, body))
    if (action === 'topics') return json(res, 200, await topics(supabase, companyId, body))
    throw new HttpError('Unknown action', 404)
  } catch (err) {
    const status = err?.status || err?.statusCode || 500
    return json(res, status, { error: err?.message || 'Fan-Out request failed' })
  }
}
