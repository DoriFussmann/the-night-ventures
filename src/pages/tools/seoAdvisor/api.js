import { supabase } from '@/lib/supabase'
import { slugifyKeyword } from '../../../../lib/seo-advisor/pillars.js'

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Not signed in')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function listSessions(companyId) {
  const headers = await authHeaders()
  const res = await fetch(
    `/api/seo-advisor-sessions?companyId=${encodeURIComponent(companyId)}`,
    { headers }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load sessions')
  return data
}

export async function getSession(companyId, sessionId) {
  const headers = await authHeaders()
  const res = await fetch(
    `/api/seo-advisor-sessions?companyId=${encodeURIComponent(companyId)}&sessionId=${encodeURIComponent(sessionId)}`,
    { headers }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load session')
  return data
}

export async function createSession(companyId) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ companyId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to create session')
  return data
}

export async function patchInsight({ companyId, insightId, action, status }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-insights', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ companyId, insightId, action, status }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to update insight')
  return data
}

/**
 * Stream a chat turn. Calls onEvent(eventName, data) for each SSE event.
 */
export async function streamChat({
  companyId,
  sessionId,
  message,
  mode,
  pillarSlug,
  onEvent,
  signal,
}) {
  const headers = await authHeaders()
  const payload = { companyId, sessionId, message }
  if (mode) payload.mode = mode
  if (pillarSlug) payload.pillarSlug = pillarSlug
  const res = await fetch('/api/seo-advisor-chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Chat failed (${res.status})`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('Streaming not supported')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const lines = chunk.split('\n')
      let event = 'message'
      const dataLines = []
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) continue
      try {
        const data = JSON.parse(dataLines.join('\n'))
        onEvent?.(event, data)
      } catch {
        // ignore malformed
      }
    }
  }
}

export async function getLiveHealth({ force = false } = {}) {
  const headers = await authHeaders()
  const res = await fetch(
    `/api/seo-advisor-sessions?health=1${force ? '&force=1' : ''}`,
    { headers }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to check APIs')
  return data
}

const CARD_TOOLS = new Set([
  'ideation_verdict',
  'propose_core_keyword',
  'propose_cluster_keyword',
])

/** Convert stored messages into UI chat bubbles (text + tool markers). */
export function messagesToUi(rows, opts = {}) {
  const ui = []
  const list = rows || []
  const toolRows = new Map()
  for (const row of list) {
    if (row.role === 'tool' && row.content?.tool_use_id) {
      toolRows.set(row.content.tool_use_id, row.content)
    }
  }
  const savedCore = new Set(
    (opts.pillars || []).map((p) => slugifyKeyword(p.slug || p.keyword))
  )
  const savedCluster = (coreSlug, kw) => {
    const pillar = (opts.pillars || []).find(
      (p) => slugifyKeyword(p.slug || p.keyword) === slugifyKeyword(coreSlug)
    )
    return (pillar?.supporting || []).some(
      (s) => slugifyKeyword(s.slug || s.keyword) === slugifyKeyword(kw)
    )
  }
  const laterUserIndex = (i) =>
    list.findIndex((r, j) => j > i && r.role === 'user')

  for (let i = 0; i < list.length; i += 1) {
    const row = list[i]
    if (row.role === 'tool' && row.content?.name === 'request_data') {
      const c = row.content
      ui.push({
        id: `${row.id}-router`,
        role: 'router',
        question: c.content?.question || '',
        calls: Array.isArray(c.calls) ? c.calls : [],
        done: true,
      })
      continue
    }
    if (row.role === 'assistant' && Array.isArray(row.content)) {
      const text = row.content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n')
      if (text) ui.push({ id: row.id, role: 'assistant', text })
      for (const b of row.content) {
        if (b.type !== 'tool_use' || !CARD_TOOLS.has(b.name)) continue
        const result = toolRows.get(b.id)?.content
        const card = result && typeof result === 'object' ? result.card : null
        if (!card) continue
        if (b.name === 'ideation_verdict') {
          ui.push({ id: `${row.id}-${b.id}`, role: 'ideation_verdict', ...card })
          continue
        }
        const saved =
          card.kind === 'core'
            ? savedCore.has(slugifyKeyword(card.keyword))
            : savedCluster(card.core_slug || card.core_keyword, card.keyword)
        const decided = laterUserIndex(i) !== -1
        ui.push({
          id: `${row.id}-${b.id}`,
          role: 'keyword_proposal',
          ...card,
          status: saved ? 'approved' : decided ? 'skipped' : 'pending',
        })
      }
      // Legacy v2 proposals fall through to the old mapper below.
      if (
        !row.content.some(
          (b) =>
            b.type === 'tool_use' &&
            ['propose_audience', 'propose_pillars', 'propose_clusters'].includes(b.name)
        )
      ) {
        continue
      }
      ui.push(...legacyAssistantToUi(row, opts))
      continue
    }
    ui.push(...legacyRowToUi(row, opts))
  }
  return ui
}

function legacyAssistantToUi(row, opts) {
  return legacyRowToUi(row, opts).filter((m) => m.role !== 'assistant')
}

function legacyRowToUi(rowIn, opts = {}) {
  const ui = []
  for (const row of [rowIn]) {
    if (row.role === 'user') {
      const text =
        typeof row.content === 'string'
          ? row.content
          : row.content?.text != null
            ? String(row.content.text)
            : Array.isArray(row.content)
              ? row.content
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text)
                  .join('\n')
              : ''
      if (text) ui.push({ id: row.id, role: 'user', text })
      continue
    }
    if (row.role === 'assistant') {
      const blocks = Array.isArray(row.content) ? row.content : []
      const text = blocks
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n')
      const tools = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ name: b.name, id: b.id, input: b.input }))
      if (text || tools.length) {
        ui.push({
          id: row.id,
          role: 'assistant',
          text: text || '',
          tools: tools.filter(
            (t) =>
              t.name !== 'propose_audience' &&
              t.name !== 'propose_pillars' &&
              t.name !== 'propose_clusters'
          ),
        })
      }
      const audience = tools.find((t) => t.name === 'propose_audience')
      if (audience) {
        const audienceText = String(audience.input?.audience_text || '').trim()
        const current = String(opts.targetAudience || '').trim()
        ui.push({
          id: `${row.id}-audience`,
          role: 'audience_proposal',
          brief: String(audience.input?.brief || ''),
          audience_text: audienceText,
          confirmed: Boolean(current && audienceText && current === audienceText),
        })
      }
      const pillarsTool = tools.find((t) => t.name === 'propose_pillars')
      if (pillarsTool) {
        const pillars = Array.isArray(pillarsTool.input?.pillars)
          ? pillarsTool.input.pillars
          : []
        const savedSlugs = new Set(
          (opts.pillars || []).map((item) =>
            slugifyKeyword(item.slug || item.keyword)
          )
        )
        const confirmed =
          pillars.length > 0 &&
          pillars.every((item) =>
            savedSlugs.has(slugifyKeyword(item.keyword))
          )
        ui.push({
          id: `${row.id}-pillars`,
          role: 'pillars_proposal',
          rationale: String(pillarsTool.input?.rationale || ''),
          pillars,
          confirmed,
        })
      }
      const clustersTool = tools.find((t) => t.name === 'propose_clusters')
      if (clustersTool) {
        const clusters = Array.isArray(clustersTool.input?.clusters)
          ? clustersTool.input.clusters
          : []
        const pillarSlug = slugifyKeyword(
          clustersTool.input?.pillar_slug || clustersTool.input?.pillar_keyword
        )
        const pillar = (opts.pillars || []).find(
          (item) => slugifyKeyword(item.slug || item.keyword) === pillarSlug
        )
        const savedSlugs = new Set(
          (pillar?.supporting || []).map((item) =>
            slugifyKeyword(item.slug || item.keyword)
          )
        )
        const confirmed =
          clusters.length > 0 &&
          clusters.every((item) =>
            savedSlugs.has(slugifyKeyword(item.keyword))
          )
        ui.push({
          id: `${row.id}-clusters`,
          role: 'clusters_proposal',
          pillar_slug: String(clustersTool.input?.pillar_slug || ''),
          pillar_keyword: String(clustersTool.input?.pillar_keyword || ''),
          rationale: String(clustersTool.input?.rationale || ''),
          clusters,
          confirmed,
        })
      }
    }
  }

  return ui
}

export async function getComposerFields(companyId) {
  const headers = await authHeaders()
  const res = await fetch(
    `/api/seo-advisor-sessions?companyId=${encodeURIComponent(companyId)}&composer=1`,
    { headers }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load company fields')
  return data
}

export async function saveSessionShortlist({ companyId, sessionId, shortlist }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-sessions', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ companyId, sessionId, shortlist }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save shortlist')
  return data
}

export async function deleteSession({ companyId, sessionId }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-sessions', {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ companyId, sessionId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to clear topic')
  return data
}

export async function getCoveragePillars(companyId) {
  const headers = await authHeaders()
  const res = await fetch(
    `/api/seo-advisor-sessions?companyId=${encodeURIComponent(companyId)}&pillars=1`,
    { headers }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load pillars')
  return data
}

export async function saveClusters({ companyId, pillarSlug, clusters }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-insights', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      companyId,
      action: 'save_clusters',
      pillarSlug,
      clusters,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save clusters')
  return data
}

export async function savePillars({ companyId, pillars }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-insights', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      companyId,
      action: 'save_pillars',
      pillars,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save pillars')
  return data
}

export async function saveAudience({ companyId, audience_text, override }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-insights', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      companyId,
      action: 'save_audience',
      audience_text,
      override: Boolean(override),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save audience')
  return data
}

export async function saveShortlistInsight({ companyId, sessionId, items, title }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-insights', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      companyId,
      sessionId,
      action: 'save_shortlist',
      items,
      title,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save insight')
  return data
}

export async function pushKeywords({ companyId, items }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-insights', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      companyId,
      action: 'push_keywords',
      items,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to push keywords')
  return data
}
