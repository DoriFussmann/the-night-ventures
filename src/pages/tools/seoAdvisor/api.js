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

async function request(url, { method = 'GET', body, errorLabel } = {}) {
  const headers = await authHeaders()
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `${errorLabel || 'Request failed'} (${res.status})`)
    err.status = res.status
    err.code = data.code
    err.overlap = data.overlap
    err.blocked = data.blocked
    throw err
  }
  return data
}

/* ---------------- Sessions ---------------- */

export function listSessions(companyId) {
  return request(`/api/seo-advisor-sessions?companyId=${encodeURIComponent(companyId)}`, {
    errorLabel: 'Failed to load chats',
  })
}

export function getSession(companyId, sessionId) {
  return request(
    `/api/seo-advisor-sessions?companyId=${encodeURIComponent(companyId)}&sessionId=${encodeURIComponent(sessionId)}`,
    { errorLabel: 'Failed to load chat' }
  )
}

export function deleteSession({ companyId, sessionId }) {
  return request('/api/seo-advisor-sessions', {
    method: 'DELETE',
    body: { companyId, sessionId },
    errorLabel: 'Failed to delete chat',
  })
}

/* ---------------- Keyword tree (content_coverage) ---------------- */

export function getKeywordTree(companyId) {
  return request(`/api/seo-advisor-keywords?companyId=${encodeURIComponent(companyId)}`, {
    errorLabel: 'Failed to load keywords',
  })
}

/**
 * @param action add_core | add_supporting | update_spec | add_backlog | remove_backlog
 *   | remove_core | remove_supporting | replace_tree
 * @returns {Promise<{ pillars: object[], keptLocked?: string[], skipped?: string[] }>}
 */
export function keywordAction(companyId, action, payload = {}) {
  return request('/api/seo-advisor-keywords', {
    method: 'POST',
    body: { companyId, action, ...payload },
    errorLabel: 'Keyword update failed',
  })
}

/* ---------------- Chat ---------------- */

/** Stream a chat turn. Calls onEvent(eventName, data) for each SSE event. */
export async function streamChat({ companyId, sessionId, message, market, language, onEvent, signal }) {
  const headers = await authHeaders()
  const res = await fetch('/api/seo-advisor-chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ companyId, sessionId, message, market, language }),
    signal,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || `Chat failed (${res.status})`)
    err.status = res.status
    err.code = data.code
    err.seoControls = data.seoControls
    throw err
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
      let event = 'message'
      const dataLines = []
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) continue
      try {
        onEvent?.(event, JSON.parse(dataLines.join('\n')))
      } catch {
        // ignore malformed event
      }
    }
  }
}

export { messagesToUi } from './history.js'
