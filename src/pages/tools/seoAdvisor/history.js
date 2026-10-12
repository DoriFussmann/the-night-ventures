/** Pure helpers (no browser deps) — unit-tested in scripts/test-seo-advisor-unit.mjs. */

function providerFor(name) {
  if (String(name).startsWith('semrush_')) return 'Semrush'
  if (String(name).startsWith('dataforseo_')) return 'DataForSEO'
  if (String(name).startsWith('moz_')) return 'Moz'
  return null
}

function userText(content) {
  if (typeof content === 'string') return content
  if (content?.text != null) return String(content.text)
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

/**
 * Stored rows → UI messages. Consecutive assistant/tool rows between two user
 * messages become one assistant message made of ordered parts:
 *   { type: 'text', text } | { type: 'tool', id, name, provider, input, status, result }
 *   | { type: 'rec', id, card }
 */
export function messagesToUi(rows) {
  const ui = []
  const partIndex = new Map() // tool_use id → part

  const currentAssistant = (row) => {
    const last = ui[ui.length - 1]
    if (last?.role === 'assistant') return last
    const msg = { id: row.id, role: 'assistant', parts: [] }
    ui.push(msg)
    return msg
  }

  for (const row of rows || []) {
    if (row.role === 'user') {
      const text = userText(row.content)
      if (text) ui.push({ id: row.id, role: 'user', text })
      continue
    }

    if (row.role === 'assistant') {
      const blocks = Array.isArray(row.content) ? row.content : []
      const msg = currentAssistant(row)
      for (const block of blocks) {
        if (block?.type === 'text' && block.text) {
          msg.parts.push({ type: 'text', text: block.text })
        } else if (block?.type === 'tool_use') {
          const provider = providerFor(block.name)
          if (provider) {
            const part = {
              type: 'tool',
              id: block.id,
              name: block.name,
              provider,
              input: block.input,
              status: 'error',
              result: { available: false, reason: 'No result (interrupted)' },
            }
            msg.parts.push(part)
            partIndex.set(block.id, part)
          } else if (block.name === 'recommend_keyword') {
            const part = { type: 'rec', id: block.id, card: null }
            msg.parts.push(part)
            partIndex.set(block.id, part)
          }
        }
      }
      continue
    }

    if (row.role === 'tool') {
      const c = row.content || {}
      const part = partIndex.get(c.tool_use_id)
      if (!part) continue
      const result = c.content
      if (part.type === 'tool') {
        part.result = result
        part.status = result?.available === false ? 'error' : 'ok'
      } else if (part.type === 'rec' && result?.shown && result.card) {
        part.card = result.card
      }
    }
  }

  for (const msg of ui) {
    if (msg.role === 'assistant') {
      msg.parts = msg.parts.filter((p) => p.type !== 'rec' || p.card)
    }
  }
  return ui.filter((m) => m.role !== 'assistant' || m.parts.length > 0)
}
