// HTTP entry for the Fan-Out Engine (api/fan-out.js).
// POST { action: structure | check | persona | prompts | run | topics, companyId, situationId, ... }.
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
import {
  FORMS,
  RUN_STEP,
  buildStructurePrompt,
  parseStructure,
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

async function askClaude(prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new HttpError('ANTHROPIC_API_KEY not configured', 500)
  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({ model: GENERATE_ARTICLE_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  return extractText(message.content).trim()
}

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
  const { companyId, situationId, settings, brands, promptText } = ctx
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
  const base = { company_id: companyId, situation_id: situationId, prompt_id: call.promptId, run_no: call.runNo, ran_at: now(), attempts, seconds: res.seconds, cost: round(cost) }
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
  const { error } = await supabase.from('fo_runs').upsert(row, { onConflict: 'prompt_id,run_no' })
  if (error) throw error
  return { promptId: call.promptId, runNo: call.runNo, status: row.status, cost: row.cost, seconds: row.seconds, attempts, error: row.error, queries: row.fan_out.length }
}

async function run(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const calls = (Array.isArray(body.calls) ? body.calls : []).slice(0, MAX_STEP_CALLS).map((c) => ({
    promptId: uuid(c?.promptId, 'promptId'),
    runNo: Math.max(1, Math.min(10, Math.round(Number(c?.runNo) || 1))),
  }))
  if (!calls.length) throw new HttpError('No calls in this step')
  const { data: rows, error } = await supabase.from('fo_prompts').select('id, prompt, form, sort, created_at').eq('situation_id', situation.id).is('archived_at', null)
  if (error) throw error
  if (situation.version >= 2 && !situation.prompts_confirmed_at) throw new HttpError('Confirm the prompts first: a Run uses frozen prompts')
  const promptText = Object.fromEntries((rows || []).map((p) => [p.id, p.prompt]))
  if (calls.some((c) => !promptText[c.promptId])) throw new HttpError('A call is outside this situation')
  const { brands } = await ownNames(supabase, companyId)
  const names = allNames(brands)
  for (const p of rows || []) {
    const issues = promptIssues(p.prompt, names)
    if (issues.block.length && calls.some((c) => c.promptId === p.id)) throw new HttpError(`The prompt ${promptLabel(p, rows)} cannot run: ${issues.block[0]}`)
  }
  const [settings, spent] = await Promise.all([loadSettings(supabase, companyId), monthSpend(supabase, companyId)])
  if (spent + calls.length * UNIT_COST > settings.monthly_cap + 1e-9) {
    return { capReached: true, results: [], monthSpent: spent, cap: settings.monthly_cap }
  }
  // A retried step must not pay twice for a capture that already succeeded.
  const { data: done } = await supabase.from('fo_runs').select('prompt_id, run_no, status').eq('situation_id', situation.id)
  const doneKey = new Set((done || []).filter((r) => r.status === 'ok').map((r) => `${r.prompt_id}|${r.run_no}`))
  const ctx = { companyId, situationId: situation.id, settings, brands, promptText }
  const results = await Promise.all(
    calls.map((c) => {
      if (doneKey.has(`${c.promptId}|${c.runNo}`) && !body.again) return { ...c, status: 'ok', cost: 0, skipped: true }
      return runCall(supabase, ctx, c).catch((err) => ({ ...c, status: 'failed', cost: 0, error: String(err?.message || err).slice(0, 300) }))
    })
  )
  if (situation.step !== 'run' || situation.stale_from === 'run') {
    const has = await laterData(supabase, situation.id)
    await saveSituation(supabase, situation.id, { step: 'run', stale_from: staleAfter('run', has) })
  }
  return { capReached: false, results, monthSpent: await monthSpend(supabase, companyId), cap: settings.monthly_cap }
}

async function topics(supabase, companyId, body) {
  const situation = await loadSituation(supabase, companyId, uuid(body.situationId, 'situationId'))
  const [promptsRes, runsRes, pillarsRes, groupsRes, companyRes, existingRes] = await Promise.all([
    supabase.from('fo_prompts').select('*').eq('situation_id', situation.id).is('archived_at', null),
    supabase.from('fo_runs').select('id, prompt_id, run_no, status, fan_out, cited, answer, brands, brand_entities, searched').eq('situation_id', situation.id),
    supabase.from('aeo_pillars').select('id, code, name').eq('company_id', companyId).order('sort'),
    supabase.from('aeo_prompt_groups').select('id, code, name, pillar_id, status').eq('company_id', companyId).order('code'),
    supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
    supabase.from('fo_topics').select('id, status').eq('situation_id', situation.id),
  ])
  for (const r of [promptsRes, runsRes, pillarsRes, groupsRes, existingRes]) if (r.error) throw r.error
  const activeIds = new Set((promptsRes.data || []).map((p) => p.id))
  const runs = (runsRes.data || []).filter((r) => r.status === 'ok' && activeIds.has(r.prompt_id))
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
    if (action === 'run') return json(res, 200, await run(supabase, companyId, body))
    if (action === 'topics') return json(res, 200, await topics(supabase, companyId, body))
    throw new HttpError('Unknown action', 404)
  } catch (err) {
    const status = err?.status || err?.statusCode || 500
    return json(res, status, { error: err?.message || 'Fan-Out request failed' })
  }
}
