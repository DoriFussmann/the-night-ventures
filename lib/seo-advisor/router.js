/**
 * Data agent. The Advisor never calls SEO APIs directly — it calls
 * request_data({ question, ... }) and this agent:
 *   1. reads the registry catalog (generated, with live health),
 *   2. picks the cheapest endpoints that fully answer the question,
 *   3. calls them (falling back to another provider on failure),
 *   4. returns compact results + provenance to the Advisor.
 *
 * Full results are streamed to the UI data panel via callbacks.
 */
import {
  agentToolDefinitions,
  catalogForAgent,
  getEndpoint,
  providerLabel,
} from './registry.js'
import { getProviderHealth } from './health.js'

export const ROUTER_MODEL = process.env.SEO_ROUTER_MODEL || 'claude-haiku-4-5-20251001'
export const MAX_ENDPOINT_CALLS = 6
const MAX_ROUNDS = 3

function routerSystem(health) {
  return [
    'You route SEO data requests to API endpoints. You do not advise; you fetch.',
    '',
    'Rules:',
    '- Pick the smallest set of endpoints that fully answers the request. Prefer cost low > medium > high.',
    '- Batch: put all keywords into ONE call on bulk endpoints (keyword_data takes 20, keyword_difficulty takes 100). Never call a bulk endpoint once per keyword.',
    '- Independent calls go in the same turn (parallel). Only use a second round when round-one results decide what to call next (e.g. SERP → then Domain Authority of the top domains).',
    '- "Difficulty" means organic KD: use *_keyword_difficulty. Ads/paid competition is not difficulty.',
    '- If a call returns available:false, retry the equivalent endpoint from another provider once. Do not retry the same endpoint.',
    '- Avoid providers marked DEGRADED unless nothing else answers.',
    `- Hard limit: ${MAX_ENDPOINT_CALLS} endpoint calls total.`,
    '- When done, reply with ONE short line: what was fetched and any gap (e.g. "volume+KD for 14 keywords; trend missing for 2"). No analysis.',
    '',
    'Endpoint catalog:',
    catalogForAgent(health),
  ].join('\n')
}

function requestText(req) {
  const parts = [`Data request: ${req.question}`]
  if (req.purpose) parts.push(`Purpose: ${req.purpose}`)
  if (req.keywords?.length) parts.push(`Keywords: ${req.keywords.join(' | ')}`)
  if (req.domains?.length) parts.push(`Domains: ${req.domains.join(' | ')}`)
  if (req.topic) parts.push(`Topic: ${req.topic}`)
  return parts.join('\n')
}

function compactFor(endpointId, result) {
  if (!result || result.available === false) {
    return { available: false, reason: result?.reason || 'unavailable' }
  }
  const e = getEndpoint(endpointId)
  try {
    return e ? e.compact(result) : result
  } catch {
    return { available: false, reason: 'could not read result' }
  }
}

/**
 * @param {object} p
 * @param {import('@anthropic-ai/sdk').default} p.anthropic
 * @param {{question: string, purpose?: string, keywords?: string[], domains?: string[], topic?: string}} p.request
 * @param {(e: {id, endpoint, provider, label}) => void} [p.onEndpointStart]
 * @param {(e: {id, endpoint, provider, ok, result}) => void} [p.onEndpointEnd]
 * @param {(plan: {question}) => void} [p.onRoute]
 */
export async function runDataRequest({ anthropic, request, onEndpointStart, onEndpointEnd }) {
  const health = getProviderHealth()
  const tools = agentToolDefinitions()
  const messages = [{ role: 'user', content: requestText(request) }]
  const calls = []
  const endpointResults = []
  let note = ''
  let callsUsed = 0

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await anthropic.messages.create({
      model: ROUTER_MODEL,
      max_tokens: 1024,
      system: routerSystem(health),
      tools,
      messages,
    })

    const blocks = response.content || []
    const toolUses = blocks.filter((b) => b.type === 'tool_use')
    note = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim()

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break

    const toRun = toolUses.slice(0, Math.max(0, MAX_ENDPOINT_CALLS - callsUsed))
    callsUsed += toRun.length

    const results = await Promise.all(
      toRun.map(async (tu) => {
        const endpoint = getEndpoint(tu.name)
        const provider = endpoint ? providerLabel(endpoint.provider) : 'unknown'
        onEndpointStart?.({ id: tu.id, endpoint: tu.name, provider, label: endpoint?.label })
        let result
        try {
          result = endpoint
            ? await endpoint.run(tu.input || {})
            : { available: false, reason: `Unknown endpoint ${tu.name}` }
        } catch (err) {
          result = { available: false, reason: err?.message || 'endpoint failed' }
        }
        const ok = result?.available !== false
        onEndpointEnd?.({ id: tu.id, endpoint: tu.name, provider, ok, result })
        calls.push({
          endpoint: tu.name,
          provider,
          input: tu.input,
          ok,
          reason: ok ? undefined : result?.reason,
        })
        endpointResults.push({ id: tu.id, name: tu.name, result })
        return { tu, result }
      })
    )

    const skipped = toolUses.slice(toRun.length)
    messages.push({ role: 'assistant', content: blocks })
    messages.push({
      role: 'user',
      content: [
        ...results.map(({ tu, result }) => ({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(compactFor(tu.name, result)),
          ...(result?.available === false ? { is_error: true } : {}),
        })),
        ...skipped.map((tu) => ({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Skipped: endpoint call limit reached.',
          is_error: true,
        })),
      ],
    })

    if (callsUsed >= MAX_ENDPOINT_CALLS) break
  }

  const forAdvisor = {
    question: request.question,
    routedTo: calls.map((c) => `${c.endpoint}${c.ok ? '' : ` (failed: ${c.reason})`}`),
    note: note || undefined,
    data: endpointResults.map(({ name, result }) => ({
      endpoint: name,
      ...(compactFor(name, result) || {}),
    })),
  }

  return { forAdvisor, calls, endpointResults }
}
