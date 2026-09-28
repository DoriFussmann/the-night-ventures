import Anthropic from '@anthropic-ai/sdk'
import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../lib/seo-advisor/auth.js'
import {
  loadCompanyContext,
  buildSystemPrompt,
  messagesFromRows,
  normalizeMode,
} from '../lib/seo-advisor/context.js'
import { findCoveragePillar } from '../lib/seo-advisor/pillars.js'
import {
  TOOL_DEFINITIONS,
  executeTool,
  MAX_TOOL_CALLS_PER_TURN,
  healthSnapshot,
} from '../lib/seo-advisor/tools.js'
import { extractMetrics, mergeMetrics } from '../lib/seo-advisor/registry.js'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 8192

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function extractText(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return ''
  return contentBlocks
    .filter((b) => b?.type === 'text' && b.text)
    .map((b) => b.text)
    .join('')
}

async function ensureSession(supabase, companyId, sessionId) {
  if (sessionId) {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, company_id, title')
      .eq('id', sessionId)
      .maybeSingle()
    if (error) throw error
    if (!data || data.company_id !== companyId) {
      const err = new Error('Session not found for this company')
      err.statusCode = 404
      throw err
    }
    return data
  }

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ company_id: companyId, title: null })
    .select('id, company_id, title')
    .single()
  if (error) throw error
  return data
}

async function loadHistory(supabase, sessionId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

async function insertMessage(supabase, sessionId, role, content) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ session_id: sessionId, role, content })
    .select('id, role, content, created_at')
    .single()
  if (error) throw error
  return data
}

async function touchSession(supabase, sessionId) {
  await supabase
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}

async function maybeTitleSession(anthropic, supabase, session, userText, assistantText) {
  if (session.title) return session.title
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 40,
      messages: [
        {
          role: 'user',
          content: `Write a short chat session title (max 6 words, no quotes) for this exchange:\nUser: ${userText.slice(0, 400)}\nAssistant: ${assistantText.slice(0, 400)}`,
        },
      ],
    })
    const title = extractText(msg.content)
      .replace(/^["']|["']$/g, '')
      .trim()
      .slice(0, 80)
    if (!title) return null
    await supabase
      .from('chat_sessions')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', session.id)
    return title
  } catch (err) {
    console.error('title generation failed:', err)
    return null
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }

  const { supabase } = auth
  const body = parseBody(req)
  const companyId = String(body.companyId || '').trim()
  const userMessage = String(body.message || '').trim()
  const sessionIdIn = body.sessionId ? String(body.sessionId).trim() : null
  const mode = normalizeMode(body.mode)
  const pillarSlug = String(body.pillarSlug || '').trim()

  if (!companyId) return json(res, 400, { error: 'companyId is required' })
  if (!userMessage) {
    return json(res, 400, { error: 'message is required' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY')
    return json(res, 500, { error: 'Server configuration error' })
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  const anthropic = new Anthropic({ apiKey })
  let closed = false
  req.on('close', () => {
    closed = true
  })

  try {
    const ctx = await loadCompanyContext(supabase, companyId)
    const session = await ensureSession(supabase, companyId, sessionIdIn)
    sseWrite(res, 'session', { id: session.id, title: session.title })

    await insertMessage(supabase, session.id, 'user', {
      type: 'text',
      text: userMessage,
    })

    const historyRows = await loadHistory(supabase, session.id)
    const focusPillar = findCoveragePillar(ctx.coveragePillars, pillarSlug)
    const system = buildSystemPrompt({ ...ctx, mode, focusPillar })
    let messages = messagesFromRows(historyRows)

    // Every keyword metric fetched in this session, so proposal cards show
    // only numbers an API actually returned.
    const metricsIndex = new Map()
    for (const row of historyRows) {
      if (row.role !== 'tool') continue
      const c = row.content || {}
      if (Array.isArray(c.endpoint_results)) {
        for (const r of c.endpoint_results) mergeMetrics(metricsIndex, extractMetrics(r.name, r.result))
      } else if (c.name) {
        mergeMetrics(metricsIndex, extractMetrics(c.name, c.content)) // legacy rows
      }
    }

    let toolCallsThisTurn = 0
    let finalAssistantBlocks = []
    let streamedText = ''

    const emit = (event, data) => {
      if (!closed) sseWrite(res, event, data)
    }

    const toolContext = {
      supabase,
      companyId,
      sessionId: session.id,
      anthropic,
      metricsIndex,
      coveragePillars: ctx.coveragePillars,
      focusPillar,
      proposalsThisTurn: 0,
      emit,
      onInsight: (insight) => emit('insight', insight),
    }

    while (!closed) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: TOOL_DEFINITIONS,
        messages,
      })

      stream.on('text', (text) => {
        if (closed) return
        streamedText += text
        sseWrite(res, 'text_delta', { text })
      })

      const finalMessage = await stream.finalMessage()
      const blocks = finalMessage.content || []
      finalAssistantBlocks = blocks

      await insertMessage(supabase, session.id, 'assistant', blocks)

      const toolUses = blocks.filter((b) => b.type === 'tool_use')
      if (finalMessage.stop_reason !== 'tool_use' || toolUses.length === 0) break

      const remaining = Math.max(0, MAX_TOOL_CALLS_PER_TURN - toolCallsThisTurn)
      const toRun = toolUses.slice(0, remaining)
      const skipped = toolUses.slice(remaining)
      const toolResults = []

      if (skipped.length > 0) {
        emit('status', {
          message: 'Tool call limit reached for this turn; answering with available data.',
        })
      }

      for (const toolUse of toRun) {
        toolCallsThisTurn += 1
        if (toolUse.name === 'request_data') {
          emit('router_start', { id: toolUse.id, question: toolUse.input?.question || '' })
        }

        let result
        try {
          result = await executeTool(toolUse.name, toolUse.input, toolContext)
        } catch (err) {
          result = { available: false, reason: err?.message || 'Tool execution failed' }
        }

        let forModel = result
        const stored = {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          name: toolUse.name,
          content: result,
        }
        if (result && typeof result === 'object' && '__forAdvisor' in result) {
          forModel = result.__forAdvisor
          stored.content = result.__forAdvisor
          stored.endpoint_results = result.__endpointResults
          stored.calls = result.__calls
          emit('router_end', {
            id: toolUse.id,
            question: toolUse.input?.question || '',
            calls: result.__calls,
            note: result.__forAdvisor?.note,
          })
        }

        await insertMessage(supabase, session.id, 'tool', stored)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof forModel === 'string' ? forModel : JSON.stringify(forModel),
        })
      }

      for (const toolUse of skipped) {
        const result = {
          available: false,
          reason: `Skipped: max ${MAX_TOOL_CALLS_PER_TURN} tool calls per turn`,
        }
        await insertMessage(supabase, session.id, 'tool', {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          name: toolUse.name,
          content: result,
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
          is_error: true,
        })
      }

      messages.push({ role: 'assistant', content: blocks })
      messages.push({ role: 'user', content: toolResults })
    }

    const assistantText =
      streamedText || extractText(finalAssistantBlocks) || ''
    const title = await maybeTitleSession(
      anthropic,
      supabase,
      session,
      userMessage,
      assistantText
    )
    if (title && !closed) {
      sseWrite(res, 'title', { title })
    }

    await touchSession(supabase, session.id)

    if (!closed) {
      sseWrite(res, 'done', {
        sessionId: session.id,
        toolCalls: toolCallsThisTurn,
        providerHealth: healthSnapshot(),
      })
    }
    res.end()
  } catch (err) {
    console.error('seo-advisor-chat error:', err)
    if (!res.headersSent) {
      return json(res, err.statusCode || 500, {
        error: err.message || 'Unexpected server error',
      })
    }
    try {
      sseWrite(res, 'error', { error: err.message || 'Unexpected server error' })
      res.end()
    } catch {
      // ignore
    }
  }
}
