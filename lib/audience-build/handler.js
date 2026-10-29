import Anthropic from '@anthropic-ai/sdk'
import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { requireAuth, handleOptions, parseBody, json, createServiceClient } from '../seo-advisor/auth.js'
import { fetchSegments, insights, hasAudienceLabKey, httpError } from './audiencelab.js'
import {
  COUNT_WINDOWS,
  PLAN_SYSTEM,
  RERANK_SYSTEM,
  attachCounts,
  buildProfileText,
  competitorNames,
  compactCandidates,
  coverage,
  dailyNeed,
  filterKey,
  insightsBody,
  isFresh,
  missingKeyFields,
  normalizePlan,
  normalizeRerank,
  parseJsonObject,
  planUserMessage,
  rerankUserMessage,
  summarizeInsights,
} from './logic.js'

// Audience Build: AudienceLab lead sourcing, step 1 (segment matching).
// POST /api/check-article-update?action=audience-build
//   { resource: 'status', companyId }
//   { resource: 'taxonomy-status' }               — segment count + last check (Admin)
//   { resource: 'sync-segments' }                 — check AudienceLab; rewrite only if changed
// GET (Vercel cron, weekly, Authorization: Bearer CRON_SECRET) — same check.
//   { resource: 'match', companyId }              — plan → search → rerank (no counts)
//   { resource: 'count', segmentId }              — 7-day + 1-day high-intent counts (cached 12 h)
//   { resource: 'select', companyId, segmentIds } — save the chosen segments
// Counting is a separate call because /insights takes 10-30 s and AudienceLab
// queues parallel calls; the page counts the top candidates two at a time.
//   { resource: 'save-capacity', companyId, inboxes, dailyCap }

const MODEL = process.env.AUDIENCE_BUILD_MODEL || 'claude-opus-5-5'
const RETRIEVE_LIMIT = 80
const UPSERT_CHUNK = 1000
// Step 1 counts use high intent + hard floors only (no ICP filters yet).
const BASE_COUNT_KEY = filterKey(insightsBody({ segmentId: 'x' }))

const PROFILE_COLUMNS = [
  'company_id',
  'domain',
  'short_description',
  'long_description',
  'target_audience',
  'customer_problem',
  'trigger_moment',
  'buying_criteria',
  'how_it_works',
  'customer_outcome',
  'core_value_proposition',
  'differentiation',
  'market_category',
  'competitive_position',
  'business_model',
  'commercial_model',
  'scope_boundaries',
  'location_markets',
  'company_stage',
  'services',
  'competitors',
  'icp_buyer_titles',
  'icp_seniority',
  'icp_departments',
  'icp_employee_bands',
  'icp_industries',
  'outbound_inboxes',
  'outbound_daily_cap',
].join(', ')

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

let keywordCache = null
function loadKeywords() {
  if (!keywordCache) {
    const buf = readFileSync(new URL('./data/al-keywords.json.gz', import.meta.url))
    keywordCache = JSON.parse(gunzipSync(buf).toString('utf8'))
  }
  return keywordCache
}

async function loadCompany(db, companyId) {
  const id = String(companyId || '').trim()
  if (!id) throw httpError('companyId is required', 400)
  const [{ data: company, error: cErr }, { data: profile, error: pErr }] = await Promise.all([
    db.from('companies').select('id, name').eq('id', id).maybeSingle(),
    db.from('company_profiles').select(PROFILE_COLUMNS).eq('company_id', id).maybeSingle(),
  ])
  if (cErr) throw httpError(cErr.message, 500)
  if (pErr) throw httpError(pErr.message, 500)
  if (!company) throw httpError('Company not found', 404)
  return { company, profile: profile || {} }
}

async function loadConfig(db, companyId) {
  const { data, error } = await db
    .from('lead_sourcing_configs')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw httpError(error.message, 500)
  return data
}

async function upsertConfig(db, companyId, patch) {
  const { data, error } = await db
    .from('lead_sourcing_configs')
    .upsert({ company_id: companyId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'company_id' })
    .select('*')
    .single()
  if (error) throw httpError(error.message, 500)
  return data
}

async function taxonomyStatus(db) {
  const [{ count, error }, { data: latest }] = await Promise.all([
    db.from('al_segments').select('segment_id', { count: 'exact', head: true }),
    db.from('al_segments').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (error) throw httpError(error.message, 500)
  return { segments: count || 0, synced_at: latest?.synced_at || null }
}

async function askClaude(anthropic, system, user, maxTokens) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (message?.stop_reason === 'max_tokens') throw httpError('Model reply was truncated', 502)
  const text = (message?.content || [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('\n')
  return parseJsonObject(text)
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

async function syncState(db) {
  const { data, error } = await db.from('al_sync_state').select('*').eq('id', true).maybeSingle()
  if (error) throw httpError(error.message, 500)
  return data
}

async function saveSyncState(db, patch) {
  const { error } = await db.from('al_sync_state').upsert({ id: true, ...patch }, { onConflict: 'id' })
  if (error) throw httpError(`Saving sync state failed: ${error.message}`, 500)
}

/** Stable hash of everything we store per segment, so unchanged lists are skipped. */
function fingerprint(rows) {
  const h = createHash('sha256')
  for (const r of [...rows].sort((a, b) => (a.segment_id < b.segment_id ? -1 : 1))) {
    h.update(
      [r.segment_id, r.taxonomy_type, r.topic, r.category, r.subcategory, r.description, r.keywords, r.available_scores.join(',')]
        .map((v) => v ?? '')
        .join('\u0001')
    )
    h.update('\n')
  }
  return h.digest('hex')
}

/**
 * Check AudienceLab's segment list; rewrite al_segments only when it changed
 * (or when the table is empty). Used by the Admin button and the weekly cron.
 */
async function syncSegments(db) {
  const checkedAt = new Date().toISOString()
  try {
    const [segments, keywords] = await Promise.all([fetchSegments(), Promise.resolve(loadKeywords())])
    const rows = segments
      .filter((s) => s && s.topic_id && s.topic)
      .map((s) => ({
        segment_id: String(s.topic_id),
        taxonomy_type: String(s.taxonomy_type || String(s.topic_id).split('_')[0] || '').toLowerCase(),
        topic: String(s.topic),
        category: s.topic_category || null,
        subcategory: s.topic_subcategory || null,
        description: s.description || null,
        keywords: keywords[s.topic_id] || null,
        available_scores: Array.isArray(s.available_scores) ? s.available_scores : [],
        synced_at: checkedAt,
      }))
    if (rows.length < 1000) throw httpError(`AudienceLab returned only ${rows.length} segments; sync aborted`, 502)

    const fp = fingerprint(rows)
    const [state, { segments: stored }] = await Promise.all([syncState(db), taxonomyStatus(db)])
    const summary = {
      segments: rows.length,
      with_keywords: rows.filter((r) => r.keywords).length,
      with_high: rows.filter((r) => r.available_scores.includes('high')).length,
      checked_at: checkedAt,
    }
    if (state?.fingerprint === fp && stored === rows.length) {
      await saveSyncState(db, { checked_at: checkedAt, segments: rows.length, last_error: null })
      return { ...summary, changed: false, synced_at: state.synced_at }
    }

    for (const part of chunk(rows, UPSERT_CHUNK)) {
      const { error } = await db.from('al_segments').upsert(part, { onConflict: 'segment_id' })
      if (error) throw httpError(`Saving segments failed: ${error.message}`, 500)
    }
    // Segments AudienceLab no longer offers.
    const { error: delErr } = await db.from('al_segments').delete().lt('synced_at', checkedAt)
    if (delErr) throw httpError(`Pruning old segments failed: ${delErr.message}`, 500)

    await saveSyncState(db, { fingerprint: fp, segments: rows.length, checked_at: checkedAt, synced_at: checkedAt, last_error: null })
    return { ...summary, changed: true, synced_at: checkedAt }
  } catch (err) {
    await saveSyncState(db, { checked_at: checkedAt, last_error: err.message || 'Sync failed' }).catch(() => {})
    throw err
  }
}

async function taxonomyOverview(db) {
  const [counts, state] = await Promise.all([taxonomyStatus(db), syncState(db)])
  return {
    segments: counts.segments,
    synced_at: state?.synced_at || counts.synced_at,
    checked_at: state?.checked_at || null,
    last_error: state?.last_error || null,
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

async function cachedCounts(db, segmentIds) {
  if (!segmentIds.length) return []
  const { data, error } = await db
    .from('al_segment_counts')
    .select('segment_id, days_back, reach, summary, counted_at')
    .eq('filter_key', BASE_COUNT_KEY)
    .in('segment_id', segmentIds)
  if (error) throw httpError(error.message, 500)
  return data || []
}

async function countSegment(db, segmentId) {
  const id = String(segmentId || '').trim()
  if (!/^b2[bc]_\d+$/.test(id)) throw httpError('A b2b_/b2c_ segmentId is required', 400)
  const cached = await cachedCounts(db, [id])
  const fresh = new Map(cached.filter((r) => isFresh(r.counted_at)).map((r) => [r.days_back, r]))
  const missing = COUNT_WINDOWS.filter((d) => !fresh.has(d))
  if (missing.length) {
    const results = await Promise.all(missing.map((d) => insights(insightsBody({ segmentId: id, daysBack: d }))))
    const now = new Date().toISOString()
    const rows = missing.map((d, i) => ({
      segment_id: id,
      days_back: d,
      filter_key: BASE_COUNT_KEY,
      reach: Number(results[i]?.reach) || 0,
      summary: summarizeInsights(results[i]),
      counted_at: now,
    }))
    const { error } = await db.from('al_segment_counts').upsert(rows, { onConflict: 'segment_id,days_back,filter_key' })
    if (error) throw httpError(`Saving counts failed: ${error.message}`, 500)
    for (const r of rows) fresh.set(r.days_back, r)
  }
  return [...fresh.values()]
}

async function withCounts(db, lastMatch, need) {
  if (!lastMatch?.candidates?.length) return lastMatch
  const rows = await cachedCounts(db, lastMatch.candidates.map((c) => c.segment_id))
  return { ...lastMatch, need, candidates: attachCounts(lastMatch.candidates, rows, need) }
}

async function match(db, companyId) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim()
  if (!apiKey) throw httpError('Server is missing ANTHROPIC_API_KEY', 500)
  if (!hasAudienceLabKey()) throw httpError('AUDIENCELAB_API_KEY is not set in the server environment', 400)

  const { segments } = await taxonomyStatus(db)
  if (!segments) throw httpError('The AudienceLab taxonomy has not been synced yet', 400)

  const { company, profile } = await loadCompany(db, companyId)
  const profileText = buildProfileText(company.name, profile)
  const anthropic = new Anthropic({ apiKey })

  // 1) Plan: buyer-side search phrases + competitor names.
  const plan = normalizePlan(
    await askClaude(anthropic, PLAN_SYSTEM, planUserMessage(profileText), 2000),
    competitorNames(profile)
  )

  // 2) Retrieve: full-text + trigram over the synced taxonomy.
  const { data: candidates, error } = await db.rpc('search_al_segments', {
    phrases: plan.phrases,
    names: plan.names,
    segment_type: 'b2b',
    max_results: RETRIEVE_LIMIT,
  })
  if (error) throw httpError(`Segment search failed: ${error.message}`, 500)
  if (!candidates?.length) throw httpError('No segments matched this company profile', 404)

  // 3) Rerank with the full profile.
  const ranked = normalizeRerank(
    await askClaude(
      anthropic,
      RERANK_SYSTEM,
      rerankUserMessage(profileText, plan.buyer_summary, compactCandidates(candidates)),
      3000
    ),
    candidates.map((c) => c.segment_id)
  )
  if (!ranked.length) throw httpError('Claude did not rank any candidate segments', 502)

  const byId = new Map(candidates.map((c) => [c.segment_id, c]))
  const { need, targetPool } = dailyNeed(profile)
  const results = ranked.map((r) => {
    const c = byId.get(r.segment_id) || {}
    return {
      segment_id: r.segment_id,
      topic: c.topic,
      category: c.category,
      subcategory: c.subcategory,
      relevance: r.relevance,
      reason: r.reason,
      name_match: Boolean(c.name_match),
    }
  })

  const lastMatch = {
    ran_at: new Date().toISOString(),
    model: MODEL,
    buyer_summary: plan.buyer_summary,
    phrases: plan.phrases,
    names: plan.names,
    retrieved: candidates.length,
    need,
    target_pool: targetPool,
    candidates: results,
  }
  const config = await upsertConfig(db, company.id, { last_match: lastMatch })
  return { config, lastMatch: await withCounts(db, lastMatch, need) }
}

async function selectSegments(db, companyId, segmentIds) {
  const ids = Array.isArray(segmentIds) ? segmentIds.map((s) => String(s).trim()).filter(Boolean) : []
  const config = await loadConfig(db, companyId)
  const counted = await withCounts(db, config?.last_match, 0)
  const pool = new Map((counted?.candidates || []).map((c) => [c.segment_id, c]))
  const chosen = ids
    .map((id, i) => {
      const c = pool.get(id)
      if (!c) return null
      return {
        segment_id: c.segment_id,
        topic: c.topic,
        category: c.category,
        relevance: c.relevance,
        reason: c.reason,
        reach_7d_high: c.reach_7d_high,
        reach_1d_high: c.reach_1d_high,
        role: i === 0 ? 'primary' : 'additional',
      }
    })
    .filter(Boolean)
  if (ids.length && !chosen.length) throw httpError('Selected segments are not in the last match; run it again', 400)
  return upsertConfig(db, companyId, {
    segments: chosen,
    status: chosen.length ? 'segments_selected' : 'draft',
  })
}

async function saveCapacity(db, companyId, inboxes, dailyCap) {
  const i = Math.round(Number(inboxes))
  const c = Math.round(Number(dailyCap))
  if (!Number.isFinite(i) || i < 1 || i > 20) throw httpError('Inboxes must be 1–20', 400)
  if (!Number.isFinite(c) || c < 1 || c > 200) throw httpError('Daily cap must be 1–200', 400)
  const { error } = await db
    .from('company_profiles')
    .update({ outbound_inboxes: i, outbound_daily_cap: c })
    .eq('company_id', companyId)
  if (error) throw httpError(error.message, 500)
  return dailyNeed({ outbound_inboxes: i, outbound_daily_cap: c })
}

export async function handleAudienceBuild(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return

  // Weekly Vercel cron: check the taxonomy, rewrite only if AudienceLab changed it.
  if (req.method === 'GET') {
    const secret = String(process.env.CRON_SECRET || '').trim()
    if (!secret || !safeEqual(req.headers?.authorization || '', `Bearer ${secret}`)) {
      return json(res, 401, { error: 'Unauthorized' })
    }
    try {
      const result = await syncSegments(createServiceClient())
      console.log('audience-build taxonomy cron:', JSON.stringify(result))
      return json(res, 200, { ok: true, data: result })
    } catch (err) {
      console.error('audience-build taxonomy cron error:', err)
      return json(res, err.statusCode || 500, { ok: false, error: err.message || 'Taxonomy sync failed' })
    }
  }

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const body = parseBody(req) || {}
  const resource = String(body.resource || '').trim()
  const db = auth.supabase

  try {
    let data
    switch (resource) {
      case 'status': {
        const { company, profile } = await loadCompany(db, body.companyId)
        const [taxonomy, config] = await Promise.all([taxonomyOverview(db), loadConfig(db, company.id)])
        const capacity = dailyNeed(profile)
        if (config?.last_match) config.last_match = await withCounts(db, config.last_match, capacity.need)
        data = {
          company,
          taxonomy,
          config,
          capacity,
          missingFields: missingKeyFields(profile),
          audienceLabConfigured: hasAudienceLabKey(),
        }
        break
      }
      case 'taxonomy-status':
        data = await taxonomyOverview(db)
        break
      case 'sync-segments':
        data = await syncSegments(db)
        break
      case 'match':
        data = await match(db, body.companyId)
        break
      case 'count':
        data = await countSegment(db, body.segmentId)
        break
      case 'select':
        data = await selectSegments(db, String(body.companyId || '').trim(), body.segmentIds)
        break
      case 'save-capacity':
        data = await saveCapacity(db, String(body.companyId || '').trim(), body.inboxes, body.dailyCap)
        break
      default:
        throw httpError(`Unknown resource "${resource}"`, 400)
    }
    return json(res, 200, { ok: true, data })
  } catch (err) {
    console.error(`audience-build ${resource} failed:`, err)
    return json(res, err.statusCode || 500, { ok: false, error: err.message || 'Audience Build request failed' })
  }
}
