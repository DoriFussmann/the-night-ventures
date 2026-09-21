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
} from '../lib/seo-advisor/context.js'
import { randomUUID } from 'node:crypto'
import {
  TOOL_DEFINITIONS,
  executeTool,
  providerLabelForTool,
  MAX_TOOL_CALLS_PER_TURN,
  healthSnapshot,
  EST_CREDITS,
  estCreditsForPlan,
} from '../lib/seo-advisor/tools.js'

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

async function persistAndStreamToolResult({
  supabase,
  sessionId,
  toolUse,
  result,
  closed,
  res,
}) {
  const provider = providerLabelForTool(toolUse.name)
  if (!closed && provider) {
    sseWrite(res, 'tool_end', {
      id: toolUse.id,
      name: toolUse.name,
      provider,
      ok: result?.available !== false && !(result?.saved === false),
    })
  }
  if (
    !closed &&
    toolUse.name !== 'save_insight' &&
    toolUse.name !== 'propose_data_pull' &&
    result
  ) {
    sseWrite(res, 'tool_data', {
      id: toolUse.id,
      name: toolUse.name,
      provider,
      result,
    })
  }
  if (
    !closed &&
    result?.available !== false &&
    EST_CREDITS[toolUse.name]
  ) {
    sseWrite(res, 'spend', {
      tool: toolUse.name,
      estCredits: EST_CREDITS[toolUse.name],
    })
  }

  const stored = {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    name: toolUse.name,
    content: result,
  }
  await insertMessage(supabase, sessionId, 'tool', stored)
  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: JSON.stringify(result),
  }
}

async function executeApprovedPlan({
  supabase,
  sessionId,
  plan,
  toolContext,
  closed,
  res,
}) {
  const steps = (Array.isArray(plan) ? plan : [])
    .map((step) => ({
      id: randomUUID(),
      name: String(step?.tool || '').trim(),
      input: step?.input && typeof step.input === 'object' ? step.input : {},
    }))
    .filter((step) => step.name && step.name !== 'propose_data_pull')
    .slice(0, MAX_TOOL_CALLS_PER_TURN)

  if (steps.length === 0) {
    return { toolCalls: 0, assistantBlocks: [], toolResults: [] }
  }

  const assistantBlocks = steps.map((step) => ({
    type: 'tool_use',
    id: step.id,
    name: step.name,
    input: step.input,
  }))
  await insertMessage(supabase, sessionId, 'assistant', assistantBlocks)

  const toolResults = []
  for (const step of steps) {
    const provider = providerLabelForTool(step.name)
    if (!closed && provider) {
      sseWrite(res, 'tool_start', {
        id: step.id,
        name: step.name,
        provider,
      })
    }
    let result
    try {
      result = await executeTool(step.name, step.input, toolContext)
    } catch (err) {
      result = {
        available: false,
        reason: err?.message || 'Tool execution failed',
      }
    }
    const packed = await persistAndStreamToolResult({
      supabase,
      sessionId,
      toolUse: step,
      result,
      closed,
      res,
    })
    toolResults.push(packed)
  }

  return {
    toolCalls: steps.length,
    assistantBlocks,
    toolResults,
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
  const approval =
    body.approval && typeof body.approval === 'object' ? body.approval : null
  const decision = approval ? String(approval.decision || '').trim() : ''

  if (!companyId) return json(res, 400, { error: 'companyId is required' })
  if (!userMessage && decision !== 'approve' && decision !== 'decline') {
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

    const approvalNote =
      decision === 'approve'
        ? 'User approved the data pull.'
        : decision === 'decline'
          ? 'User declined the data pull'
          : ''
    const storedUserText = userMessage || approvalNote
    if (storedUserText) {
      await insertMessage(supabase, session.id, 'user', {
        type: 'text',
        text: storedUserText,
      })
    }

    const historyRows = await loadHistory(supabase, session.id)
    const system = buildSystemPrompt(ctx)
    let messages = messagesFromRows(historyRows)

    let toolCallsThisTurn = 0
    let finalAssistantBlocks = []
    let streamedText = ''
    let awaitingApproval = false

    const toolContext = {
      supabase,
      companyId,
      sessionId: session.id,
      onInsight: (insight) => {
        if (!closed) sseWrite(res, 'insight', insight)
      },
    }

    if (decision === 'approve') {
      const ran = await executeApprovedPlan({
        supabase,
        sessionId: session.id,
        plan: approval.plan,
        toolContext,
        closed,
        res,
      })
      toolCallsThisTurn += ran.toolCalls
      if (ran.assistantBlocks.length) {
        messages.push({ role: 'assistant', content: ran.assistantBlocks })
        messages.push({ role: 'user', content: ran.toolResults })
      }
    }

    while (!closed && !awaitingApproval) {
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

      stream.on('streamEvent', (event) => {
        if (closed || event.type !== 'content_block_start') return
        const b = event.content_block
        if (b?.type !== 'tool_use') return
        const provider = providerLabelForTool(b.name)
        if (provider) {
          sseWrite(res, 'tool_start', {
            id: b.id,
            name: b.name,
            provider,
          })
        }
      })

      const finalMessage = await stream.finalMessage()
      const blocks = finalMessage.content || []
      finalAssistantBlocks = blocks

      await insertMessage(supabase, session.id, 'assistant', blocks)

      const stopReason = finalMessage.stop_reason
      const toolUses = blocks.filter((b) => b.type === 'tool_use')

      if (stopReason !== 'tool_use' || toolUses.length === 0) {
        break
      }

      const remaining = Math.max(0, MAX_TOOL_CALLS_PER_TURN - toolCallsThisTurn)
      const proposal = toolUses.find((t) => t.name === 'propose_data_pull')
      if (proposal) {
        const requestId = randomUUID()
        const input = proposal.input && typeof proposal.input === 'object' ? proposal.input : {}
        const plan = Array.isArray(input.plan) ? input.plan : []
        if (!closed) {
          sseWrite(res, 'data_request', {
            requestId,
            rationale: String(input.rationale || ''),
            recommended_provider: String(input.recommended_provider || 'DataForSEO'),
            summary: String(input.summary || ''),
            plan,
            estCredits: estCreditsForPlan(plan),
          })
        }
        const result = { status: 'awaiting_approval', requestId }
        await insertMessage(supabase, session.id, 'tool', {
          type: 'tool_result',
          tool_use_id: proposal.id,
          name: proposal.name,
          content: result,
        })
        const skippedPaid = toolUses.filter((t) => t.id !== proposal.id)
        for (const toolUse of skippedPaid) {
          const skipped = {
            available: false,
            reason: 'Deferred until the user approves the data pull',
          }
          await insertMessage(supabase, session.id, 'tool', {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            name: toolUse.name,
            content: skipped,
          })
        }
        awaitingApproval = true
        break
      }

      const toRun = toolUses.slice(0, remaining)
      const skipped = toolUses.slice(remaining)
      const toolResults = []

      if (skipped.length > 0 && !closed) {
        sseWrite(res, 'status', {
          message:
            'Tool call limit reached for this turn; answering with available data.',
        })
      }

      for (const toolUse of toRun) {
        toolCallsThisTurn += 1
        const provider = providerLabelForTool(toolUse.name)
        let result
        try {
          result = await executeTool(toolUse.name, toolUse.input, toolContext)
        } catch (err) {
          result = {
            available: false,
            reason: err?.message || 'Tool execution failed',
          }
        }

        if (!closed && provider) {
          sseWrite(res, 'tool_end', {
            id: toolUse.id,
            name: toolUse.name,
            provider,
            ok: result?.available !== false && !(result?.saved === false),
          })
        }

        if (
          !closed &&
          result?.available !== false &&
          EST_CREDITS[toolUse.name]
        ) {
          sseWrite(res, 'spend', {
            tool: toolUse.name,
            estCredits: EST_CREDITS[toolUse.name],
          })
        }

        // Stream structured tool payload for the Research Data panel (skip save_insight).
        if (!closed && toolUse.name !== 'save_insight' && result) {
          sseWrite(res, 'tool_data', {
            id: toolUse.id,
            name: toolUse.name,
            provider,
            result,
          })
        }

        const stored = {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          name: toolUse.name,
          content: result,
        }
        await insertMessage(supabase, session.id, 'tool', stored)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        })
      }

      for (const toolUse of skipped) {
        const result = {
          available: false,
          reason: 'Skipped: max 6 tool calls per turn',
        }
        if (!closed) {
          const provider = providerLabelForTool(toolUse.name)
          if (provider) {
            sseWrite(res, 'tool_end', {
              id: toolUse.id,
              name: toolUse.name,
              provider,
              ok: false,
            })
          }
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
      storedUserText || userMessage,
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
