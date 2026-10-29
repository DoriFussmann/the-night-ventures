import Anthropic from '@anthropic-ai/sdk'
import { requireAuth, handleOptions, parseBody, json } from '../lib/seo-advisor/auth.js'
import {
  loadCompanyContext,
  buildSystemPrompt,
  messagesFromRows,
} from '../lib/seo-advisor/context.js'
import {
  TOOL_DEFINITIONS,
  executeTool,
  providerLabelForTool,
  TOOL_BUDGET,
  planToolRun,
  healthSnapshot,
} from '../lib/seo-advisor/tools.js'
import { researchLocale } from '../lib/seo-advisor/markets.js'
import { authorityFromToolResult, seoControlsStatus } from '../lib/seo-advisor/seoControls.js'
import { guardKeyword } from '../lib/seo-advisor/keywordGuard.js'
import { computeNextStep, formatProgress } from '../lib/seo-advisor/nextStep.js'

const MODEL = process.env.SEO_ADVISOR_MODEL || 'claude-sonnet-5-5'
const TITLE_MODEL = process.env.SEO_ADVISOR_TITLE_MODEL || 'claude-haiku-5-5'
const MAX_TOKENS = 8192
// Safety stop: a turn never loops through more than this many tool rounds.
const MAX_TOOL_ROUNDS = 8

// Tool definitions never change, so cache them with a breakpoint on the last one.
const CACHED_TOOLS = TOOL_DEFINITIONS.map((tool, i) =>
  i === TOOL_DEFINITIONS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool
)

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

/** Copy messages with a cache breakpoint on the final block only. */
function withCacheBreakpoint(messages) {
  if (messages.length === 0) return messages
  const out = messages.slice(0, -1)
  const last = messages[messages.length - 1]
  const content =
    typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content]
  const tail = content[content.length - 1]
  content[content.length - 1] = { ...tail, cache_control: { type: 'ephemeral' } }
  out.push({ ...last, content })
  return out
}

const SESSION_COLUMNS = 'id, company_id, title, market, language'

async function selectSession(supabase, sessionId) {
  const first = await supabase
    .from('chat_sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle()
  if (!first.error) return first.data
  if (/market|language|column/i.test(first.error.message || '')) {
    const retry = await supabase
      .from('chat_sessions')
      .select('id, company_id, title')
      .eq('id', sessionId)
      .maybeSingle()
    if (retry.error) throw retry.error
    return retry.data
  }
  throw first.error
}

async function ensureSession(supabase, companyId, sessionId, locale) {
  if (sessionId) {
    const data = await selectSession(supabase, sessionId)
    if (!data || data.company_id !== companyId) {
      const err = new Error('Session not found for this company')
      err.statusCode = 404
      throw err
    }
    if (data.market !== locale.market || data.language !== locale.language) {
      const { error } = await supabase
        .from('chat_sessions')
        .update({ market: locale.market, language: locale.language })
        .eq('id', sessionId)
      if (error) console.error('Failed to store session market:', error.message)
    }
    return data
  }

  let { data, error } = await supabase
    .from('chat_sessions')
    .insert({ company_id: companyId, title: null, market: locale.market, language: locale.language })
    .select('id, company_id, title')
    .single()
  if (error && /market|language|column/i.test(error.message || '')) {
    ;({ data, error } = await supabase
      .from('chat_sessions')
      .insert({ company_id: companyId, title: null })
      .select('id, company_id, title')
      .single())
  }
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
  const { error } = await supabase.from('chat_messages').insert({ session_id: sessionId, role, content })
  if (error) throw error
}

async function maybeTitleSession(anthropic, supabase, session, userText, assistantText) {
  if (session.title) return null
  try {
    const msg = await anthropic.messages.create({
      model: TITLE_MODEL,
      max_tokens: 40,
      messages: [
        {
          role: 'user',
          content: `Write a short chat title (max 6 words, no quotes, no trailing punctuation) for this SEO keyword discussion:\nUser: ${userText.slice(0, 400)}\nAssistant: ${assistantText.slice(0, 400)}`,
        },
      ],
    })
    const title = extractText(msg.content)
      .replace(/^["'\s]+|["'\s.]+$/g, '')
      .slice(0, 80)
    if (!title) return null
    await supabase.from('chat_sessions').update({ title }).eq('id', session.id)
    return title
  } catch (err) {
    console.error('title generation failed:', err)
    return null
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

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
  const locale = researchLocale(String(body.market || ''), String(body.language || ''))

  if (!companyId) return json(res, 400, { error: 'companyId is required' })
  if (!userMessage) return json(res, 400, { error: 'message is required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY')
    return json(res, 500, { error: 'Server configuration error' })
  }

  // Gate: no keyword suggestions until SEO Controls are complete.
  let ctx
  try {
    ctx = await loadCompanyContext(supabase, companyId)
  } catch (err) {
    console.error('seo-advisor-chat context error:', err)
    return json(res, err.statusCode || 500, { error: err.message || 'Failed to load company' })
  }
  const seoStatus = seoControlsStatus(ctx.profile)
  if (!seoStatus.ready) {
    return json(res, 409, {
      error: 'Complete SEO Controls in Company Intelligence before using the SEO Advisor.',
      code: 'seo_controls_incomplete',
      seoControls: seoStatus,
    })
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
  const send = (event, data) => {
    if (!closed) sseWrite(res, event, data)
  }

  try {
    const session = await ensureSession(supabase, companyId, sessionIdIn, locale)
    send('session', { id: session.id, title: session.title })

    await insertMessage(supabase, session.id, 'user', { type: 'text', text: userMessage })

    const historyRows = await loadHistory(supabase, session.id)
    const system = [
      {
        type: 'text',
        text: buildSystemPrompt({ ...ctx, locale, nextStep: computeNextStep(ctx.tree) }),
        cache_control: { type: 'ephemeral' },
      },
    ]
    const messages = messagesFromRows(historyRows)

    const toolContext = {
      locale,
      pillars: ctx.pillars,
      onRecommendation: null,
      checkOverlap: async (keyword) => {
        if (!keyword) return { available: false, reason: 'keyword is required' }
        try {
          const { overlap } = await guardKeyword(supabase, companyId, keyword, locale)
          return { available: overlap.checked, keyword, ...overlap, reason: overlap.checked ? undefined : overlap.message }
        } catch (err) {
          if (err.code === 'same_results') return { available: true, keyword, ...err.overlap }
          return { available: false, reason: err.message || 'Same-results check failed' }
        }
      },
    }

    let used = { data: 0, cards: 0 }
    let toolCalls = 0
    let forceAnswer = false
    let rounds = 0
    let authorityChain = Promise.resolve()
    let assistantText = ''

    while (!closed) {
      rounds += 1
      // Once the budget is spent (or after many rounds), the next turn must answer in text.
      const mustAnswer = forceAnswer || rounds > MAX_TOOL_ROUNDS
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: CACHED_TOOLS,
        ...(mustAnswer ? { tool_choice: { type: 'none' } } : {}),
        messages: withCacheBreakpoint(messages),
      })

      stream.on('text', (text) => {
        assistantText += text
        send('text_delta', { text })
      })

      const finalMessage = await stream.finalMessage()
      const blocks = finalMessage.content || []
      await insertMessage(supabase, session.id, 'assistant', blocks)

      const toolUses = blocks.filter((b) => b.type === 'tool_use')
      if (finalMessage.stop_reason !== 'tool_use' || toolUses.length === 0) {
        if (finalMessage.stop_reason === 'max_tokens') {
          send('status', { message: 'The reply hit the length limit and was cut short.' })
        }
        break
      }

      const plan = planToolRun(toolUses, used)
      const { toRun, skipped } = plan
      used = plan.used
      toolCalls += toRun.length

      const outcomes = await Promise.all(
        toRun.map(async (toolUse) => {
          const provider = providerLabelForTool(toolUse.name)
          if (provider) {
            send('tool_start', { id: toolUse.id, name: toolUse.name, provider, input: toolUse.input })
          }
          let result
          try {
            result = await executeTool(toolUse.name, toolUse.input, {
              ...toolContext,
              onRecommendation: (card) => send('recommendation', { id: toolUse.id, ...card }),
            })
          } catch (err) {
            result = { available: false, reason: err?.message || 'Tool execution failed' }
          }
          // Capture the company's own domain strength (SEO Controls), one write at a time.
          authorityChain = authorityChain.then(async () => {
            const authority = authorityFromToolResult(
              toolUse.name,
              result,
              ctx.profile?.domain,
              ctx.profile?.seo_authority
            )
            if (!authority) return
            ctx.profile = { ...ctx.profile, seo_authority: authority }
            const { error: authorityError } = await supabase
              .from('company_profiles')
              .update({ seo_authority: authority })
              .eq('company_id', companyId)
            if (authorityError) console.error('seo_authority save failed:', authorityError.message)
          })
          await authorityChain
          if (provider) {
            send('tool_end', {
              id: toolUse.id,
              name: toolUse.name,
              provider,
              ok: result?.available !== false,
              result,
            })
          }
          return { toolUse, result, isError: false }
        })
      )

      if (skipped.length > 0) {
        forceAnswer = true
        send('status', {
          message: `Used this message's ${TOOL_BUDGET.data} data lookups; the Advisor is answering with what it has. Ask again to continue.`,
        })
        for (const toolUse of skipped) {
          outcomes.push({
            toolUse,
            result: {
              available: false,
              reason: `Skipped: this message's budget (${TOOL_BUDGET.data} data lookups, ${TOOL_BUDGET.cards} Add cards) is used up. Answer now with the data you have; the user can ask a follow-up to continue.`,
            },
            isError: true,
          })
        }
      }

      const toolResults = []
      for (const { toolUse, result, isError } of outcomes) {
        await insertMessage(supabase, session.id, 'tool', {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          name: toolUse.name,
          content: result,
          ...(isError ? { is_error: true } : {}),
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          // Tell the model what budget is left so it can plan the rest of the turn.
          content: JSON.stringify(
            result && typeof result === 'object' && !Array.isArray(result)
              ? { ...result, budget_remaining: plan.remaining }
              : result
          ),
          ...(isError ? { is_error: true } : {}),
        })
      }

      messages.push({ role: 'assistant', content: blocks })
      messages.push({ role: 'user', content: toolResults })
    }

    const title = await maybeTitleSession(anthropic, supabase, session, userMessage, assistantText)
    if (title) send('title', { title })

    await supabase
      .from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', session.id)

    send('done', { sessionId: session.id, toolCalls, providerHealth: healthSnapshot() })
    res.end()
  } catch (err) {
    console.error('seo-advisor-chat error:', err)
    try {
      send('error', { error: err.message || 'Unexpected server error' })
      res.end()
    } catch {
      // ignore
    }
  }
}
