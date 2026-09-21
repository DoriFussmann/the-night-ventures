import { supabase } from '@/lib/supabase'

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
  approval,
  onEvent,
  signal,
}) {
  const headers = await authHeaders()
  const payload = { companyId, sessionId, message }
  if (approval) payload.approval = approval
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

/** Convert stored messages into UI chat bubbles (text + tool markers). */
export function messagesToUi(rows) {
  const ui = []
  for (const row of rows || []) {
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
        .map((b) => ({ name: b.name, id: b.id }))
      const visibleTools = tools.filter((t) => t.name !== 'propose_data_pull')
      if (text || visibleTools.length) {
        ui.push({ id: row.id, role: 'assistant', text: text || '', tools: visibleTools })
      }
      const proposal = tools.find((t) => t.name === 'propose_data_pull')
      if (proposal) {
        const input = blocks.find((b) => b.type === 'tool_use' && b.id === proposal.id)
          ?.input
        ui.push({
          id: `${row.id}-approval`,
          role: 'approval',
          requestId: '',
          rationale: input?.rationale || '',
          recommended_provider: input?.recommended_provider || 'DataForSEO',
          summary: input?.summary || '',
          plan: Array.isArray(input?.plan) ? input.plan : [],
          estCredits: null,
          status: 'pending',
        })
      }
    }
  }

  for (let i = 0; i < ui.length; i += 1) {
    const item = ui[i]
    if (item.role !== 'approval') continue
    const nextTool = (rows || []).find((row) => {
      if (row.role !== 'tool') return false
      return row.content?.name === 'propose_data_pull'
    })
    const content = nextTool?.content?.content || nextTool?.content
    if (content?.requestId) item.requestId = content.requestId
    if (content?.status === 'awaiting_approval') item.status = 'pending'
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
